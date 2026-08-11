// memory-visibility.test.ts — v0.8 五层可见性作用域
//
// 验证：默认隔离、显式共享、老数据不被迁移隐藏，以及 SQLite 与内存实现给出同一套判定。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Nemos } from "../../src/index.js";
import { SqliteStorage } from "../../src/storage/sqlite-impl.js";
import { InMemoryStorage } from "../../src/storage/memory-impl.js";
import { SCHEMA_VERSION, type Memory } from "../../src/types.js";
import { makeMockLLMConfig } from "../helpers.js";
import {
  canView,
  defaultVisibility,
  normalizeScopeRef,
  scopeRefKey,
  serializeSharedKeys,
  type MemoryVisibility,
} from "../../src/visibility.js";

function makeMemory(id: string, content: string, visibility?: MemoryVisibility): Memory {
  const now = new Date().toISOString();
  return {
    id,
    layer: "personal_semantic",
    type: "user",
    scope: "global",
    content,
    visibility,
    source: { authoritative: false, kind: "derived", origin: "llm-extract", chain_depth: 1 },
    arousal: { value: 0, signal_sources: [] },
    surprise: { value: 0, basis: "r" },
    ownership: { kind: "user" },
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 1,
    schema_version: SCHEMA_VERSION,
  } as unknown as Memory;
}

function makeSqlite(): { storage: SqliteStorage; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "nemos-visibility-"));
  const storage = new SqliteStorage(join(dir, "m.db"));
  return { storage, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("非 global 作用域必须指明归属 id，缺失时直接拒绝", () => {
  assert.deepEqual(normalizeScopeRef("global"), { kind: "global" });
  assert.deepEqual(normalizeScopeRef("agent", "研究员"), { kind: "agent", id: "研究员" });
  // 静默放行会让隔离形同虚设，所以这里必须抛。
  assert.throws(() => normalizeScopeRef("agent"), /必须指明归属 id/);
  assert.throws(() => normalizeScopeRef("team", "  "), /必须指明归属 id/);
  assert.throws(() => normalizeScopeRef("nope", "x"), /未知的记忆作用域/);
});

test("agent 私有记忆默认不对同用户的另一个角色可见", () => {
  const owned: MemoryVisibility = { owner: normalizeScopeRef("agent", "研究员") };
  assert.equal(canView(owned, { userId: "alice", agentId: "研究员" }), true);
  assert.equal(canView(owned, { userId: "alice", agentId: "写作者" }), false);
  // 同一用户也看不见——这正是「默认隔离」区别于既有 tenant/user 过滤的地方。
  assert.equal(canView(owned, { userId: "alice" }), false);
});

test("显式共享后跨层可见，且只对被共享的那一层生效", () => {
  const shared: MemoryVisibility = {
    owner: normalizeScopeRef("agent", "研究员"),
    sharedWith: [normalizeScopeRef("team", "增长组")],
  };
  assert.equal(canView(shared, { userId: "alice", agentId: "写作者", teamIds: ["增长组"] }), true);
  assert.equal(canView(shared, { userId: "alice", agentId: "写作者", teamIds: ["风控组"] }), false);
});

test("global 对任何读取方可见，未标注归属的老记忆同样放行", () => {
  assert.equal(canView({ owner: { kind: "global" } }, { userId: "bob" }), true);
  // 迁移前写入的记忆没有 visibility，不能因为上线新机制就集体消失。
  assert.equal(canView(undefined, { userId: "bob" }), true);
});

test("共享键两侧带分隔符，前缀相同的 id 不会互相错配", () => {
  const keys = serializeSharedKeys([
    normalizeScopeRef("team", "t2"),
    normalizeScopeRef("agent", "a1"),
  ]);
  assert.equal(keys, "|team:t2|agent:a1|");
  // SQL 用 LIKE '%|team:t20|%' 匹配时不会命中上面的 team:t2。
  assert.ok(!keys!.includes("|team:t20|"));
  assert.equal(scopeRefKey({ kind: "global" }), "global");
  assert.equal(serializeSharedKeys(undefined), null);
  assert.equal(serializeSharedKeys([]), null);
});

test("SQLite 落盘后作用域随记忆一起还原，隔离在重启后依然成立", () => {
  const { storage, cleanup } = makeSqlite();
  try {
    storage.insert(
      "default",
      "alice",
      makeMemory("psem_agent", "研究员的私有笔记", {
        owner: normalizeScopeRef("agent", "研究员"),
      }),
    );
    storage.insert(
      "default",
      "alice",
      makeMemory("psem_shared", "共享给增长组的结论", {
        owner: normalizeScopeRef("agent", "研究员"),
        sharedWith: [normalizeScopeRef("team", "增长组")],
      }),
    );

    const restored = storage.get("default", "alice", "personal_semantic", "psem_shared");
    assert.equal(restored?.visibility?.owner.kind, "agent");
    assert.equal(restored?.visibility?.owner.id, "研究员");
    assert.deepEqual(restored?.visibility?.sharedWith, [{ kind: "team", id: "增长组" }]);

    // 另一个角色只应看到被共享的那条。
    const asWriter = storage.searchByTime(
      "default",
      "alice",
      {},
      ["personal_semantic"],
      undefined,
      50,
      { viewer: { userId: "alice", agentId: "写作者", teamIds: ["增长组"] } },
    );
    assert.deepEqual(asWriter.map((m) => m.id), ["psem_shared"]);

    // 归属角色两条都能看到。
    const asResearcher = storage.searchByTime(
      "default",
      "alice",
      {},
      ["personal_semantic"],
      undefined,
      50,
      { viewer: { userId: "alice", agentId: "研究员" } },
    );
    assert.deepEqual(asResearcher.map((m) => m.id).sort(), ["psem_agent", "psem_shared"]);

    // 不传 viewer 时不做可见性过滤，维护和导出路径仍拿得到全量。
    const unfiltered = storage.searchByTime(
      "default",
      "alice",
      {},
      ["personal_semantic"],
      undefined,
      50,
      {},
    );
    assert.equal(unfiltered.length, 2);
  } finally {
    storage.close?.();
    cleanup();
  }
});

test("写入方不声明归属时落到该用户私有，两种实现给出同一结果", () => {
  const { storage, cleanup } = makeSqlite();
  try {
    storage.insert("default", "alice", makeMemory("psem_plain", "没声明归属的事实"));
    const stored = storage.get("default", "alice", "personal_semantic", "psem_plain");
    assert.deepEqual(stored?.visibility, defaultVisibility("alice"));

    const inMemory = new InMemoryStorage();
    inMemory.insert("default", "alice", makeMemory("psem_plain", "没声明归属的事实"));
    const mirrored = inMemory.get("default", "alice", "personal_semantic", "psem_plain");
    assert.deepEqual(mirrored?.visibility, stored?.visibility);
  } finally {
    storage.close?.();
    cleanup();
  }
});

test("viewer 一路穿透到公开检索：另一个角色召回不到别人的私有记忆", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  });
  const user = nemos.forUser("alice");
  const write = (content: string, visibility: MemoryVisibility) =>
    user.write({
      layer: "episodic",
      content,
      visibility,
      source: { authoritative: false, origin: "test", chain_depth: 1 },
    });

  await write("研究员整理的竞品定价表", { owner: normalizeScopeRef("agent", "研究员") });
  await write("增长组共享的获客口径", {
    owner: normalizeScopeRef("agent", "研究员"),
    sharedWith: [normalizeScopeRef("team", "增长组")],
  });

  const asWriter = await user.recall("竞品定价 获客口径", {
    viewer: { userId: "alice", agentId: "写作者", teamIds: ["增长组"] },
  });
  const writerContents = asWriter.items.map((item) => item.memory.content);
  assert.ok(!writerContents.some((c) => c.includes("竞品定价表")), JSON.stringify(writerContents));

  const asResearcher = await user.recall("竞品定价 获客口径", {
    viewer: { userId: "alice", agentId: "研究员" },
  });
  const researcherContents = asResearcher.items.map((item) => item.memory.content);
  assert.ok(
    researcherContents.some((c) => c.includes("竞品定价表")),
    JSON.stringify(researcherContents),
  );

  await nemos.close();
});

test("迁移到 v0.8 之后，旧库里的记忆不会因为新过滤而消失", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-visibility-migrate-"));
  const dbPath = join(dir, "legacy.db");
  try {
    // 先用当前 schema 建库并写入，再手工把可见性列清空，模拟迁移前落盘的行。
    const seed = new SqliteStorage(dbPath);
    seed.insert("default", "alice", makeMemory("psem_legacy", "迁移前写入的事实"));
    seed.close?.();

    const raw = new Database(dbPath);
    raw.exec(
      `UPDATE personal_semantic SET scope_kind = NULL, scope_owner_id = NULL,
         shared_keys = NULL, shared_with_json = NULL;`,
    );
    raw.close();

    const reopened = new SqliteStorage(dbPath);
    const legacy = reopened.get("default", "alice", "personal_semantic", "psem_legacy");
    assert.equal(legacy?.visibility, undefined);

    // 任意读取方都应看得见，否则升级当天历史记忆就被静默隐藏了。
    const visible = reopened.searchByTime(
      "default",
      "alice",
      {},
      ["personal_semantic"],
      undefined,
      50,
      { viewer: { userId: "alice", agentId: "写作者" } },
    );
    assert.deepEqual(visible.map((m) => m.id), ["psem_legacy"]);
    reopened.close?.();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
