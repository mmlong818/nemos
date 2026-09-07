import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelationshipMemory } from "../../examples/companion/relationship-memory.js";
import { buildReviewQueue, groupReviewQueue } from "../../examples/companion/product-platform.js";

const events = require("../../examples/companion/web/assets/agent-events.js");

for (const raw of ["{broken", "{}", "null", '[{"id":"x"}]']) {
  test(`unreadable relationship memory is never treated as absence: ${raw}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "buzz-memory-"));
    try {
      const file = join(dir, "counterparts.json");
      writeFileSync(file, raw);
      const memory = new RelationshipMemory(dir);
      assert.deepEqual(memory.getReadStatus(), { state: "unavailable", writable: false });
      for (const action of [() => memory.list(), () => memory.get("x"), () => memory.buildPromptBlock("x"),
        () => memory.upsert("x", {}), () => memory.remove("x")]) {
        assert.throws(action, { code: "RELATIONSHIP_MEMORY_UNAVAILABLE" });
      }
      assert.equal(readFileSync(file, "utf8"), raw);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("only a missing file initializes empty; external changes block writes until reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "buzz-memory-"));
  try {
    const memory = new RelationshipMemory(dir);
    assert.equal(memory.getReadStatus().state, "missing");
    assert.deepEqual(memory.list(), []);
    memory.upsert("client", { boundaries: ["不得分享成本"] });
    const file = join(dir, "counterparts.json");
    const original = readFileSync(file, "utf8");
    writeFileSync(file, "unreadable external change");
    assert.throws(() => memory.upsert("client", { boundaries: [] }), { code: "RELATIONSHIP_MEMORY_UNAVAILABLE" });
    assert.equal(readFileSync(file, "utf8"), "unreadable external change");
    writeFileSync(file, original);
    assert.deepEqual(new RelationshipMemory(dir).get("client")?.boundaries, ["不得分享成本"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("filesystem read errors do not initialize a new profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "buzz-memory-"));
  try {
    mkdirSync(join(dir, "counterparts.json"));
    const memory = new RelationshipMemory(dir);
    assert.equal(memory.getReadStatus().state, "unavailable");
    assert.throws(() => memory.upsert("x", {}), /不能当作空档案/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("failed atomic replacement preserves both durable and in-memory boundaries", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "buzz-memory-"));
  try {
    const memory = new RelationshipMemory(dir);
    memory.upsert("client", { boundaries: ["不得分享成本"] });
    const original = readFileSync(join(dir, "counterparts.json"), "utf8");
    const mocked = t.mock.method(fs, "renameSync", () => { throw new Error("simulated disk failure"); });
    assert.throws(() => memory.upsert("client", { boundaries: [] }), /simulated disk failure/);
    assert.throws(() => memory.remove("client"), /simulated disk failure/);
    assert.deepEqual(memory.get("client")?.boundaries, ["不得分享成本"]);
    assert.equal(readFileSync(join(dir, "counterparts.json"), "utf8"), original);
    assert.deepEqual(readdirSync(dir), ["counterparts.json"]);
    mocked.mock.restore();
    memory.upsert("client", { tone: "简洁" });
    assert.equal(new RelationshipMemory(dir).get("client")?.tone, "简洁");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("duplicate identities and malformed boundaries are not silently discarded", () => {
  const dir = mkdtempSync(join(tmpdir(), "buzz-memory-"));
  try {
    const memory = new RelationshipMemory(dir);
    const profile = memory.upsert("client", {});
    for (const entries of [[profile, profile], [{ ...profile, boundaries: "secret" }], [{ ...profile, notes: [null] }]]) {
      writeFileSync(join(dir, "counterparts.json"), JSON.stringify(entries));
      assert.equal(new RelationshipMemory(dir).getReadStatus().state, "unavailable");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("attention orders uncertainty before decisions, failures and unconfirmed delivery", () => {
  const items = buildReviewQueue({ approvals: [{ id: "a", runId: "r", status: "pending", tool: { name: "发邮件" } }], jobs: [
    { id: "uncertain", status: "uncertain" }, { id: "failed", status: "failed", payload: { title: "日报" } },
    { id: "delivery", status: "succeeded", deliveryRequired: true }, { id: "done", status: "succeeded", deliveryRequired: true, deliveredAt: "today" },
    { id: "running", status: "running" }, { id: "cancelled", status: "cancelled" },
  ], runs: [{ runId: "r", status: "interrupted", resumable: true }, { runId: "ok", status: "completed" }] });
  assert.deepEqual(items.map((item) => item.priority), [0, 1, 2, 2, 3]);
  assert.equal(items.find((item) => item.id === "job:failed")?.title, "日报");
  assert.equal(items.at(-1)?.kind, "delivery");
  assert.equal(groupReviewQueue(items).find((group) => group.id === "run:r")?.items.length, 2);
});

test("stable groups retain separate approvals without duplicating repeated events", () => {
  const approval = { id: "a", runId: "r" };
  const source = { approvals: [approval, approval, { id: "b", runId: "r" }], jobs: [] };
  const items = buildReviewQueue(source);
  assert.equal(items.length, 2);
  assert.deepEqual(groupReviewQueue(items).map((group) => group.id), ["run:r"]);
  assert.deepEqual(source.approvals, [approval, approval, { id: "b", runId: "r" }]);
});

test("resolved, expired and invalid-expiry decisions disappear from attention", () => {
  const items = buildReviewQueue({ approvals: [
    { id: "done", status: "consumed" }, { id: "old", expiresAt: "2020-01-01" },
    { id: "invalid", expiresAt: "invalid" }, { id: "fresh", expiresAt: "2099-01-01" },
  ], jobs: [] }, Date.parse("2026-09-06"));
  assert.deepEqual(items.map((item) => item.id), ["approval:fresh"]);
});

class FakeSource extends EventTarget {
  static instances: FakeSource[] = [];
  readyState = 0;
  closed = false;
  constructor(public url: string) { super(); FakeSource.instances.push(this); }
  close() { this.closed = true; this.readyState = 2; }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
}
function streamHarness(onSync: () => unknown = () => {}) {
  FakeSource.instances = [];
  const lifecycle = new EventTarget();
  const timers = new Map<number, () => unknown>();
  let id = 0;
  const statuses: string[] = [];
  const stream = events.connect({ EventSource: FakeSource, lifecycle, onSync, onStatus: (state: string) => statuses.push(state),
    setTimeout: (fn: () => unknown) => { timers.set(++id, fn); return id; }, clearTimeout: (key: number) => timers.delete(key) });
  const tick = async () => { const ready = [...timers.values()]; timers.clear(); for (const fn of ready) await fn(); };
  return { stream, lifecycle, timers, statuses, tick, source: FakeSource.instances[0] };
}

test("upstream reconnect guard covers all Boolean combinations", () => {
  for (let bits = 0; bits < 32; bits++) {
    const values = [0, 1, 2, 3, 4].map((index) => Boolean(bits & (1 << index)));
    const [terminal, hasPendingReconnect, hasLiveSocket, keepAliveRequested, hasLiveSubscriptions] = values;
    assert.equal(events.shouldScheduleReconnect({ terminal, hasPendingReconnect, hasLiveSocket, keepAliveRequested, hasLiveSubscriptions }),
      !terminal && !hasPendingReconnect && !hasLiveSocket && (keepAliveRequested || hasLiveSubscriptions));
  }
});

test("initial and reconnect opens each catch up durable state without replaying actions", async () => {
  let syncs = 0;
  const h = streamHarness(() => { syncs++; });
  h.source.emit("open"); await h.tick();
  h.source.emit("error"); h.source.emit("open"); await h.tick();
  assert.equal(syncs, 2);
  assert.equal(FakeSource.instances.length, 1, "native retry is not duplicated");
  h.stream.close();
});

test("bursts coalesce and events during sync get one trailing refresh", async () => {
  let release!: () => void;
  let syncs = 0;
  const h = streamHarness(async () => { if (++syncs === 1) await new Promise<void>((resolve) => { release = resolve; }); });
  for (const name of ["open", "job", "run", "approval"]) h.source.emit(name);
  assert.equal(h.timers.size, 1);
  const pending = h.tick();
  h.source.emit("job"); h.source.emit("approval");
  assert.equal(h.timers.size, 0);
  release(); await pending; await h.tick();
  assert.equal(syncs, 2);
  h.stream.close();
});

test("terminal streams are not restarted by pageshow, only by explicit retry", () => {
  const h = streamHarness();
  h.source.readyState = 2; h.source.emit("error");
  h.lifecycle.dispatchEvent(new Event("pagehide")); h.lifecycle.dispatchEvent(new Event("pageshow"));
  assert.equal(FakeSource.instances.length, 1);
  assert.equal(h.statuses.at(-1), "closed");
  h.stream.retry();
  assert.equal(FakeSource.instances.length, 2);
  h.stream.close();
});

test("pagehide closes connections and discards stale events; pageshow resubscribes", async () => {
  let syncs = 0;
  const h = streamHarness(() => { syncs++; });
  h.source.emit("open");
  h.lifecycle.dispatchEvent(new Event("pagehide"));
  h.source.emit("job"); await h.tick();
  assert.equal(syncs, 0);
  assert.equal(h.source.closed, true);
  h.lifecycle.dispatchEvent(new Event("pageshow"));
  FakeSource.instances[1].emit("open"); await h.tick();
  assert.equal(syncs, 1);
  h.stream.close();
  h.lifecycle.dispatchEvent(new Event("pageshow"));
  assert.equal(FakeSource.instances.length, 2);
});

test("a late sync completion cannot mutate the next connection's refresh state", async () => {
  let release!: () => void;
  let syncs = 0;
  const h = streamHarness(async () => { if (++syncs === 1) await new Promise<void>((resolve) => { release = resolve; }); });
  h.source.emit("open"); const old = h.tick();
  h.stream.retry(); FakeSource.instances[1].emit("open");
  release(); await old; await h.tick();
  assert.equal(syncs, 2);
  h.stream.close();
});
