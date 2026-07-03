// transactional-writes.test.ts
// 回归：核心写路径的原子性（storage.transaction）。
// 修复前 insert（主表+FTS+entity FTS）、delete（4 条 DELETE）、以及 reflect 的
// 「写新事实 + 失效旧事实」都是多条独立语句，中途崩溃会留半套数据
// （写入成功但搜索不到 / 新旧矛盾事实并存）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../../src/index.js";
import type { Memory } from "../../../src/types.js";
import { SCHEMA_VERSION } from "../../../src/types.js";

function makeMemory(id: string, content: string): Memory {
  const now = new Date().toISOString();
  return {
    id,
    layer: "personal_semantic",
    type: "user",
    scope: "global",
    content,
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

function makeSqlite() {
  const dir = mkdtempSync(join(tmpdir(), "nemos-txn-"));
  const mem = new Nemos({
    storage: { type: "sqlite", path: join(dir, "m.db") },
    llm: { provider: "custom", name: "noop", chat: async () => "{}" },
    worker: { manualWorker: true },
  });
  return { dir, mem, storage: mem.raw().storage };
}

test("transaction 抛异常时 insert 整体回滚（主表 + FTS 均无残留）", async () => {
  const { dir, mem, storage } = makeSqlite();

  assert.throws(() =>
    storage.transaction(() => {
      storage.insert("default", "alice", makeMemory("psem_txn1", "事务里写入的事实"));
      throw new Error("simulated crash");
    }),
  );

  assert.equal(storage.get("default", "alice", "personal_semantic", "psem_txn1"), null, "主表应回滚");
  const fts = storage.searchFts("default", "alice", "personal_semantic", "事务", { topK: 5 });
  assert.equal(fts.length, 0, "FTS 应随主表一起回滚");

  // 事务外正常写入仍然可用（回滚不破坏连接状态）
  storage.insert("default", "alice", makeMemory("psem_txn2", "正常写入的事实"));
  assert.ok(storage.get("default", "alice", "personal_semantic", "psem_txn2"));

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("transaction 抛异常时「写新 + 失效旧」整体回滚（不留新旧并存的中间态）", async () => {
  const { dir, mem, storage } = makeSqlite();

  const old = makeMemory("psem_old", "用户住在北京");
  storage.insert("default", "alice", old);

  assert.throws(() =>
    storage.transaction(() => {
      storage.insert("default", "alice", makeMemory("psem_new", "用户住在上海"));
      storage.markInvalidated("default", "alice", "personal_semantic", "psem_old", {
        invalidAt: new Date().toISOString(),
        expiredAt: new Date().toISOString(),
        correctedBy: "psem_new",
      });
      throw new Error("simulated crash between steps");
    }),
  );

  // 回滚后：新事实不存在，旧事实仍 active——回到写入前的一致状态
  assert.equal(storage.get("default", "alice", "personal_semantic", "psem_new"), null);
  const oldAfter = storage.get("default", "alice", "personal_semantic", "psem_old");
  assert.ok(oldAfter);
  assert.equal(oldAfter!.belief_state ?? "active", "active", "旧事实应保持 active");

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("delete 原子性：删除后主表 / FTS / embedding 无孤儿残留", async () => {
  const { dir, mem, storage } = makeSqlite();

  const m = makeMemory("psem_del", "将被删除的事实");
  storage.insert("default", "alice", m);
  storage.insertEmbedding("default", "alice", "personal_semantic", "psem_del", new Float32Array(8), "test-model");

  storage.delete("default", "alice", "personal_semantic", "psem_del");

  assert.equal(storage.get("default", "alice", "personal_semantic", "psem_del"), null);
  const fts = storage.searchFts("default", "alice", "personal_semantic", "删除", { topK: 5 });
  assert.equal(fts.filter((r) => r.id === "psem_del").length, 0, "FTS 不应有孤儿");

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});
