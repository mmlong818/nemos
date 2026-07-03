// queue-decay-scale.test.ts
// 规模化次级项回归：busy_timeout / 队列原子出队 + 租约 / decay 游标轮转。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../../src/index.js";
import type { Memory } from "../../../src/types.js";
import { SCHEMA_VERSION } from "../../../src/types.js";

function makeSqlite() {
  const dir = mkdtempSync(join(tmpdir(), "nemos-p1-"));
  const mem = new Nemos({
    storage: { type: "sqlite", path: join(dir, "m.db") },
    llm: { provider: "custom", name: "noop", chat: async () => "{}" },
    worker: { manualWorker: true },
  });
  return { dir, mem, storage: mem.raw().storage };
}

function makeMemory(id: string, content: string): Memory {
  const now = new Date().toISOString();
  return {
    id, layer: "personal_semantic", type: "user", scope: "global", content,
    source: { authoritative: false, kind: "derived", origin: "llm-extract", chain_depth: 1 },
    arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "r" },
    ownership: { kind: "user" }, created_at: now, last_accessed: now,
    access_count: 0, stability: 1, schema_version: SCHEMA_VERSION,
  } as unknown as Memory;
}

function enqueue(storage: ReturnType<typeof makeSqlite>["storage"], id: string) {
  const now = new Date().toISOString();
  storage.enqueueIngest({
    id, tenant_id: "default", user_id: "alice",
    archival_id: `arch_${id}`, scope: "global", content: `内容 ${id}`,
    scenario_json: null, origin_agent: null,
    status: "queued", attempts: 0, last_error: null, created_at: now,
  });
}

test("busy_timeout 已设置（多写者排队等锁而非立即 SQLITE_BUSY）", async () => {
  const { dir, mem, storage } = makeSqlite();
  const timeout = (storage as unknown as { db: { pragma(q: string, o: { simple: true }): number } })
    .db.pragma("busy_timeout", { simple: true });
  assert.equal(timeout, 5000);
  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("takeNextQueued 原子认领：出队即标 analyzing，二次出队拿不到同一任务", async () => {
  const { dir, mem, storage } = makeSqlite();
  enqueue(storage, "iq_p1_a");

  const first = storage.takeNextQueued();
  assert.ok(first);
  assert.equal(first!.id, "iq_p1_a");
  assert.equal(first!.status, "analyzing", "返回前应已认领");
  assert.equal(storage.takeNextQueued(), null, "已认领任务不可被再次取走");
  assert.equal(storage.getQueueRow("iq_p1_a")!.status, "analyzing");

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("resetStaleAnalyzing 租约：窗口内的 analyzing 不被抢，超窗的被回收", async () => {
  const { dir, mem, storage } = makeSqlite();
  enqueue(storage, "iq_p1_fresh");
  storage.takeNextQueued(); // 认领 → analyzing，updated_at=刚刚

  // 大租约：刚认领的任务在窗口内，不应被重置
  assert.equal(storage.resetStaleAnalyzing(60_000), 0, "窗口内任务不应被回收");
  // 零租约（默认单实例语义）：全部重置
  assert.equal(storage.resetStaleAnalyzing(0), 1, "默认语义应回收全部 analyzing");
  assert.equal(storage.getQueueRow("iq_p1_fresh")!.status, "queued");

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("decay 游标：多轮扫描轮转整库，而非反复选同一批", async () => {
  const { dir, mem, storage } = makeSqlite();
  const N = 6, BATCH = 3;
  for (let i = 0; i < N; i++) storage.insert("default", "alice", makeMemory(`psem_d${i}`, `事实 ${i}`));

  const round1 = storage.listDecayCandidates(BATCH).map((c) => c.id);
  assert.equal(round1.length, BATCH);
  // 模拟 runDecayScan 的回写：给第一轮候选盖 last_decay_at 章
  const now = new Date().toISOString();
  for (const id of round1) storage.updateDecayMeta("default", "alice", "personal_semantic", id, 0.9, now);

  const round2 = storage.listDecayCandidates(BATCH).map((c) => c.id);
  const overlap = round2.filter((id) => round1.includes(id));
  assert.deepEqual(overlap, [], `第二轮应轮转到未检查的记录，实际重复: ${overlap.join(",")}`);
  assert.deepEqual([...round1, ...round2].sort(), Array.from({ length: N }, (_, i) => `psem_d${i}`).sort(), "两轮应覆盖全部记录");

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});
