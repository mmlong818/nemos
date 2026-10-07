import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Memory, Nemos } from "../../src/index.js";
import { MemoryForgetCoordinator } from "../../examples/companion/memory-forget.js";
import type { PersonalWorkStore } from "../../examples/companion/personal-work.js";

function memory(id: string, archival_ref?: string, extra: Partial<Memory> = {}): Memory {
  return { id, layer: "semantic", content: `PRIVATE_TEXT_${id}`, scope: "global", source: { origin: "fixture", source_message_id: id, conversation_id: "fixture" }, archival_ref, ...extra } as Memory;
}
function fixture(records: Memory[], queue: Array<{ id: string; archival_id: string; status: string }> = []) {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-forget-unit-"));
  const dbPath = join(dir, "memory.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE ingest_queue(id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,archival_id TEXT,status TEXT,updated_at TEXT,completed_at TEXT)");
  for (const item of queue) db.prepare("INSERT INTO ingest_queue VALUES(?,?,?,?,?,?,?)").run(item.id, "default", "me", item.archival_id, item.status, "", null);
  db.close();
  const active = new Map(records.map((item) => [item.id, item]));
  const failed = new Set<string>();
  const storage = {
    listPendingByUser: () => { const connection = new Database(dbPath, { readonly: true }); try { return connection.prepare("SELECT * FROM ingest_queue WHERE status IN ('queued','analyzing','failed')").all() as any[]; } finally { connection.close(); } },
    getQueueRow: (id: string) => { const connection = new Database(dbPath, { readonly: true }); try { return connection.prepare("SELECT * FROM ingest_queue WHERE id=?").get(id) as any; } finally { connection.close(); } },
    findById: (_tenant: string, _user: string, id: string) => active.get(id) ?? null,
  };
  const nemos = { forUser: () => ({ listByLayer: async (layer: string) => [...active.values()].filter((item) => item.layer === layer), forget: async (id: string) => { if (failed.has(id)) throw new Error("synthetic failure"); active.delete(id); } }), raw: () => ({ storage }) } as unknown as Nemos;
  const work = { proposals: () => [], revokeForgottenMemory: () => [] } as unknown as PersonalWorkStore;
  const receiptPath = join(dir, "receipts.json");
  const coordinator = new MemoryForgetCoordinator(receiptPath, dbPath, () => nemos, work, "me");
  return { active, failed, dbPath, receiptPath, coordinator, restart: () => new MemoryForgetCoordinator(receiptPath, dbPath, () => nemos, work, "me"), close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("forget preview isolates the exact archival chain and rejects stale or expired confirmation", async () => {
  const target = memory("target", "archive-a");
  const peer = memory("peer", "archive-a");
  const independent = memory("independent", "archive-a", { evidence_count: 2 });
  const other = memory("other", "archive-b");
  const f = fixture([target, peer, independent, other]);
  try {
    const preview = await f.coordinator.preview("target");
    assert.deepEqual(preview.auto.memories.map((item) => item.id), ["target", "peer"]);
    assert.ok(preview.manual.some((item) => item.id === "independent"));
    assert.ok(!preview.auto.memories.some((item) => item.id === "other"));
    await assert.rejects(f.coordinator.confirm(preview.token, false));
    assert.equal(f.active.size, 4);
    target.content = "changed after preview";
    await assert.rejects(f.coordinator.confirm(preview.token, true), /已变化/);
    assert.equal(f.active.size, 4);
    const next = await f.coordinator.preview("target");
    const originalNow = Date.now;
    try { Date.now = () => new Date(next.expiresAt).getTime() + 1; await assert.rejects(f.coordinator.confirm(next.token, true), /已过期/); }
    finally { Date.now = originalNow; }
    assert.equal(f.active.size, 4);
  } finally { f.close(); }
});

test("forget receipt preserves partial failure, stops exact queued source and is idempotent", async () => {
  const f = fixture([memory("target", "archive-a"), memory("peer", "archive-a"), memory("other", "archive-b")], [{ id: "job-a", archival_id: "archive-a", status: "queued" }, { id: "job-b", archival_id: "archive-b", status: "queued" }]);
  try {
    f.failed.add("peer");
    const preview = await f.coordinator.preview("target");
    assert.equal(existsSync(`${f.receiptPath}.plans`), false, "preview must not persist a plan before confirmation");
    const receipt = await f.coordinator.confirm(preview.token, true);
    assert.equal(receipt.status, "partial");
    assert.ok(receipt.steps.some((step) => step.id === "peer" && step.status === "failed"));
    assert.equal(f.coordinator.latest()?.id, receipt.id);
    assert.ok(!readFileSync(`${f.receiptPath}.plans`, "utf8").includes("PRIVATE_TEXT_"));
    assert.equal((await f.coordinator.confirm(preview.token, true)).id, receipt.id);
    assert.equal(f.coordinator.latest()?.id, receipt.id);
    assert.ok(f.active.has("peer"));
    assert.ok(f.active.has("other"));
    f.failed.delete("peer");
    const restarted = f.restart();
    assert.equal(restarted.latest()?.id, receipt.id);
    const resumed = await restarted.confirm(preview.token, true);
    assert.equal(resumed.id, receipt.id);
    assert.equal(resumed.status, "partial");
    assert.ok(resumed.manual.some((item) => item.kind === "archival"));
    assert.ok(!f.active.has("target"));
    assert.ok(!f.active.has("peer"));
    assert.ok(f.active.has("other"));
    assert.equal(resumed.steps.filter((step) => step.kind === "memory" && step.id === "target" && step.status === "success").length, 1);
    assert.equal(resumed.steps.filter((step) => step.kind === "memory" && step.id === "peer").at(-1)?.status, "success");
    assert.equal(resumed.steps.at(-1)?.status, "success");
    const db = new Database(f.dbPath, { readonly: true });
    try {
      assert.equal((db.prepare("SELECT status FROM ingest_queue WHERE id='job-a'").get() as { status: string }).status, "completed");
      assert.equal((db.prepare("SELECT status FROM ingest_queue WHERE id='job-b'").get() as { status: string }).status, "queued");
    } finally { db.close(); }
  } finally { f.close(); }
});

test("analyzing source cannot be confirmed while a worker may write it back", async () => {
  const f = fixture([memory("target", "archive-a")], [{ id: "running", archival_id: "archive-a", status: "analyzing" }]);
  try {
    const preview = await f.coordinator.preview("target");
    assert.ok(preview.manual.some((item) => item.id === "running"));
    await assert.rejects(f.coordinator.confirm(preview.token, true), /正在运行/);
    assert.ok(f.active.has("target"));
  } finally { f.close(); }
});
