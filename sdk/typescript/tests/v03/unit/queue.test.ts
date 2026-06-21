// queue.test.ts — 队列 CRUD + status 流转 + 崩溃恢复
//
// 直接通过 InMemoryStorage 测试 queue API；不涉及 worker tick。

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStorage } from "../../../src/storage.js";

test("enqueueIngest + getQueueRow 回环", () => {
  const s = new InMemoryStorage();
  const row = s.enqueueIngest({
    id: "iq_1",
    tenant_id: "default",
    user_id: "alice",
    archival_id: "arch_x",
    scope: "global",
    content: "hello",
    scenario_json: null,
    origin_agent: null,
    content_date: null,
    perspectives_json: null,
    status: "queued",
    attempts: 0,
    last_error: null,
    created_at: "2026-06-05T00:00:00.000Z",
  });
  assert.equal(row.status, "queued");
  const got = s.getQueueRow("iq_1");
  assert.ok(got);
  assert.equal(got.archival_id, "arch_x");
});

test("takeNextQueued 按 created_at 升序", () => {
  const s = new InMemoryStorage();
  s.enqueueIngest({
    id: "iq_b",
    tenant_id: "default",
    user_id: "alice",
    archival_id: "arch_b",
    scope: "global",
    content: "later",
    scenario_json: null,
    origin_agent: null,
    content_date: null,
    perspectives_json: null,
    status: "queued",
    attempts: 0,
    last_error: null,
    created_at: "2026-06-05T00:00:01.000Z",
  });
  s.enqueueIngest({
    id: "iq_a",
    tenant_id: "default",
    user_id: "alice",
    archival_id: "arch_a",
    scope: "global",
    content: "earlier",
    scenario_json: null,
    origin_agent: null,
    content_date: null,
    perspectives_json: null,
    status: "queued",
    attempts: 0,
    last_error: null,
    created_at: "2026-06-05T00:00:00.000Z",
  });
  const next = s.takeNextQueued();
  assert.ok(next);
  assert.equal(next.id, "iq_a");
});

test("updateQueueStatus 改 status / attempts / last_error / completed_at / derived_count", () => {
  const s = new InMemoryStorage();
  s.enqueueIngest({
    id: "iq_x",
    tenant_id: "default",
    user_id: "alice",
    archival_id: "arch",
    scope: "global",
    content: "x",
    scenario_json: null,
    origin_agent: null,
    content_date: null,
    perspectives_json: null,
    status: "queued",
    attempts: 0,
    last_error: null,
    created_at: "2026-06-05T00:00:00.000Z",
  });
  s.updateQueueStatus("iq_x", { status: "analyzing", attempts: 1 });
  let r = s.getQueueRow("iq_x");
  assert.equal(r?.status, "analyzing");
  assert.equal(r?.attempts, 1);

  s.updateQueueStatus("iq_x", {
    status: "completed",
    derived_count: 3,
    completed_at: "2026-06-05T00:01:00.000Z",
  });
  r = s.getQueueRow("iq_x");
  assert.equal(r?.status, "completed");
  assert.equal(r?.derived_count, 3);
  assert.equal(r?.completed_at, "2026-06-05T00:01:00.000Z");
});

test("resetStaleAnalyzing 把 'analyzing' 重置为 'queued'（崩溃恢复）", () => {
  const s = new InMemoryStorage();
  s.enqueueIngest({
    id: "iq_1",
    tenant_id: "default",
    user_id: "alice",
    archival_id: "arch_1",
    scope: "global",
    content: "x",
    scenario_json: null,
    origin_agent: null,
    content_date: null,
    perspectives_json: null,
    status: "queued",
    attempts: 1,
    last_error: null,
    created_at: "2026-06-05T00:00:00.000Z",
  });
  s.updateQueueStatus("iq_1", { status: "analyzing" });
  const n = s.resetStaleAnalyzing();
  assert.equal(n, 1);
  const r = s.getQueueRow("iq_1");
  assert.equal(r?.status, "queued");
});

test("listPendingByUser 仅返回未完成（queued / analyzing / failed）", () => {
  const s = new InMemoryStorage();
  const base = {
    tenant_id: "default",
    user_id: "alice",
    scope: "global",
    content: "x",
    scenario_json: null,
    origin_agent: null,
    content_date: null,
    perspectives_json: null,
    attempts: 0,
    last_error: null,
    created_at: "2026-06-05T00:00:00.000Z",
  };
  s.enqueueIngest({ ...base, id: "iq_q", archival_id: "a1", status: "queued" });
  s.enqueueIngest({ ...base, id: "iq_a", archival_id: "a2", status: "analyzing" });
  s.enqueueIngest({ ...base, id: "iq_f", archival_id: "a3", status: "failed" });
  s.enqueueIngest({ ...base, id: "iq_c", archival_id: "a4", status: "completed" });

  const pending = s.listPendingByUser("default", "alice");
  const ids = new Set(pending.map((r) => r.id));
  assert.equal(pending.length, 3);
  assert.ok(ids.has("iq_q"));
  assert.ok(ids.has("iq_a"));
  assert.ok(ids.has("iq_f"));
  assert.ok(!ids.has("iq_c"));
});

test("跨 user 不互相可见", () => {
  const s = new InMemoryStorage();
  const base = {
    tenant_id: "default",
    scope: "global",
    content: "x",
    scenario_json: null,
    origin_agent: null,
    content_date: null,
    perspectives_json: null,
    attempts: 0,
    last_error: null,
    created_at: "2026-06-05T00:00:00.000Z",
  };
  s.enqueueIngest({ ...base, id: "iq_alice", user_id: "alice", archival_id: "a", status: "queued" });
  s.enqueueIngest({ ...base, id: "iq_bob", user_id: "bob", archival_id: "b", status: "queued" });

  const a = s.listPendingByUser("default", "alice");
  const b = s.listPendingByUser("default", "bob");
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(a[0]!.id, b[0]!.id);
});
