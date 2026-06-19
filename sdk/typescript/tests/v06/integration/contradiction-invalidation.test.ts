// v0.6 contradiction-invalidation.test.ts (RFC 0007 §2.2/2.3 + RFC 0008 §5)
// 「从不踩雷」最小闭环：
//   B 检索过滤——belief_state != 'active' 的记录默认从 search 隐藏。
//   A 矛盾失效——reflect 检测到新事实推翻现有 personal_semantic 时，标旧记录失效。
//   gate——features.invalidation 默认关时，reflect 仅标记冲突、不失效（v0.5 行为不变）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../../src/index.js";
import type { Memory } from "../../../src/types.js";
import { SqliteStorage } from "../../../src/storage/sqlite-impl.js";
import { makeReflectMockLLMConfig } from "../../helpers.js";

function tmpDb(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, path: join(dir, "t.db") };
}
function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows: WAL/SHM 偶发被锁
  }
}

const PSEM: Memory = {
  id: "psem_dog",
  layer: "personal_semantic",
  type: "user",
  content: "用户养了一只狗叫 Max",
  scope: "global",
  source: { authoritative: false, kind: "derived", origin: "seed", chain_depth: 1 },
  arousal: { value: 0.3, signal_sources: [] },
  surprise: { value: 0.2, basis: "x" },
  ownership: { kind: "self", consent_status: "implicit" },
  created_at: "2026-01-01T00:00:00.000Z",
  last_accessed: "2026-01-01T00:00:00.000Z",
  access_count: 0,
  stability: 1.0,
  schema_version: "0.6",
};

test("v0.6 B: markInvalidated 后 search 默认隐藏，includeInvalidated 取回", () => {
  const { dir, path } = tmpDb("nemos-inv-b-");
  try {
    const store = new SqliteStorage(path);
    store.insert("default", "alice", { ...PSEM });

    // 失效前：检索得到
    const before = store.searchFts("default", "alice", "Max", ["personal_semantic"], undefined, 10);
    assert.equal(before.length, 1, "失效前可检索到");

    // 标失效
    store.markInvalidated("default", "alice", "personal_semantic", "psem_dog", {
      invalidAt: "2026-06-01T00:00:00.000Z",
      expiredAt: "2026-06-01T00:00:00.000Z",
      correctedBy: "psem_new",
    });

    // 失效后：默认检索为空（从不踩雷）
    const after = store.searchFts("default", "alice", "Max", ["personal_semantic"], undefined, 10);
    assert.equal(after.length, 0, "失效后默认检索隐藏");

    // includeInvalidated 取回全集 + 字段正确
    const all = store.searchFts("default", "alice", "Max", ["personal_semantic"], undefined, 10, {
      includeInvalidated: true,
    });
    assert.equal(all.length, 1, "includeInvalidated 取回");
    assert.equal(all[0]!.belief_state, "invalidated");
    assert.equal(all[0]!.invalid_at, "2026-06-01T00:00:00.000Z");
    assert.equal(all[0]!.expired_at, "2026-06-01T00:00:00.000Z");
    assert.deepEqual(all[0]!.corrected_by, ["psem_new"]);

    store.close();
  } finally {
    cleanup(dir);
  }
});

test("v0.6 A: reflect 矛盾失效（invalidation 开）——旧 psem 被失效，search 不再踩雷", async () => {
  const { dir, path } = tmpDb("nemos-inv-a-");
  try {
    const mem = new Nemos({
      storage: { type: "sqlite", path },
      llm: makeReflectMockLLMConfig({
        invalidatesAnchors: true,
        conflict: true,
        fixedContent: "用户曾养狗 Max，最近 Max 去世了",
      }),
      features: {
        doubleCheck: false,
        reflect: { enabled: true },
        invalidation: { enabled: true },
      },
      worker: { manualWorker: true },
    });
    const u = mem.forUser("alice");

    // 1) 种入旧事实（derived psem，authoritative=false 合规 I4）
    const old = await u.write({
      layer: "personal_semantic",
      content: "用户养了一只狗叫 Max",
      source: { authoritative: false, origin: "seed" },
    });

    // 2) 用户陈述变化 → episodic（mock 按「今天」判 episodic）
    await u.ingest("今天 Max 去世了");

    // 3) reflect：检测矛盾 → 失效旧事实
    const r = await u.runReflect();
    assert.equal(r.invalidated, 1, "失效 1 条旧 personal_semantic");
    assert.equal(r.derived.length, 1, "产出 1 条新 psem");
    const fresh = r.derived[0]!;

    // 4) 「从不踩雷」：默认检索拿不到旧的"养着 Max"，但能拿到新事实
    const hits = await u.search("Max", { layers: ["personal_semantic"] });
    const ids = hits.map((m) => m.id);
    assert.ok(!ids.includes(old.id), "旧失效事实默认不出现");
    assert.ok(ids.includes(fresh.id), "新事实正常出现");

    // 5) 旧记录字段正确（含回链）
    const psems = await u.listByLayer("personal_semantic");
    const oldRow = psems.find((m) => m.id === old.id)!;
    assert.equal(oldRow.belief_state, "invalidated");
    assert.ok(oldRow.invalid_at, "invalid_at 已写");
    assert.ok(oldRow.corrected_by?.includes(fresh.id), "corrected_by 回链新记录");

    // 6) 审计：includeInvalidated 仍可取回旧事实
    const withInv = await u.search("Max", {
      layers: ["personal_semantic"],
      includeInvalidated: true,
    });
    assert.ok(withInv.map((m) => m.id).includes(old.id), "includeInvalidated 取回旧事实");

    mem.close();
  } finally {
    cleanup(dir);
  }
});

test("v0.6 gate: invalidation 默认关 → reflect 不失效，旧事实仍活跃（向后兼容）", async () => {
  const { dir, path } = tmpDb("nemos-inv-gate-");
  try {
    const mem = new Nemos({
      storage: { type: "sqlite", path },
      llm: makeReflectMockLLMConfig({
        invalidatesAnchors: true,
        conflict: true,
        fixedContent: "用户曾养狗 Max，最近 Max 去世了",
      }),
      features: {
        doubleCheck: false,
        reflect: { enabled: true },
        // invalidation 不配 → 默认关
      },
      worker: { manualWorker: true },
    });
    const u = mem.forUser("alice");

    const old = await u.write({
      layer: "personal_semantic",
      content: "用户养了一只狗叫 Max",
      source: { authoritative: false, origin: "seed" },
    });
    await u.ingest("今天 Max 去世了");
    const r = await u.runReflect();

    assert.equal(r.invalidated, 0, "flag 关：不失效");
    const psems = await u.listByLayer("personal_semantic");
    const oldRow = psems.find((m) => m.id === old.id)!;
    assert.equal(oldRow.belief_state, undefined, "旧事实仍 active");
    const hits = await u.search("Max", { layers: ["personal_semantic"] });
    assert.ok(hits.map((m) => m.id).includes(old.id), "旧事实默认仍可检索（v0.5 行为不变）");

    mem.close();
  } finally {
    cleanup(dir);
  }
});
