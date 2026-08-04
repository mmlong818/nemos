import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { SqliteStorage } from "../../../src/storage.js";
import { makeMockLLMConfig, makePerspectiveMockLLMConfig } from "../../helpers.js";

function tempDb(): string {
  return join(tmpdir(), `nemos-v07-${randomUUID()}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
}

test("v0.7 sqlite: event_seq and lifecycle status survive restart", async () => {
  const path = tempDb();
  try {
    const first = new Nemos({
      storage: { type: "sqlite", path }, llm: makeMockLLMConfig(), worker: { manualWorker: true },
    });
    const one = await first.forUser("alice").ingest("第一条", { skipAnalysis: true });
    assert.equal(first.getLifecycleStatus(one.archival.id)?.event.event_seq, 1);
    await first.close();

    const second = new Nemos({
      storage: { type: "sqlite", path }, llm: makeMockLLMConfig(), worker: { manualWorker: true },
    });
    assert.equal(second.getLifecycleStatus(one.archival.id)?.completed, true);
    const two = await second.forUser("alice").ingest("第二条", { skipAnalysis: true });
    assert.equal(second.getLifecycleStatus(two.archival.id)?.event.event_seq, 2);
    assert.equal(two.archival.generation, 0);
    await second.close();
  } finally {
    cleanup(path);
  }
});

test("v0.7 sqlite queue: next_attempt_at survives storage restart", () => {
  const path = tempDb();
  try {
    let storage = new SqliteStorage(path);
    storage.enqueueIngest({
      id: "iq_sqlite_backoff", tenant_id: "default", user_id: "alice", archival_id: "arch_1",
      scope: "global", content: "x", scenario_json: null, origin_agent: null,
      content_date: null, perspectives_json: null, status: "queued", attempts: 0,
      last_error: null, created_at: "2026-07-24T00:00:00.000Z",
    });
    assert.equal(storage.takeNextQueued("2026-07-24T00:00:00.000Z")?.id, "iq_sqlite_backoff");
    storage.updateQueueStatus("iq_sqlite_backoff", {
      status: "queued", next_attempt_at: "2026-07-24T00:01:00.000Z",
    });
    storage.close();

    storage = new SqliteStorage(path);
    assert.equal(storage.takeNextQueued("2026-07-24T00:00:59.999Z"), null);
    assert.equal(storage.takeNextQueued("2026-07-24T00:01:00.000Z")?.id, "iq_sqlite_backoff");
    storage.close();
  } finally {
    cleanup(path);
  }
});
test("v0.7 sqlite reflection state: cursor and lease survive restart", () => {
  const path = tempDb();
  try {
    let storage = new SqliteStorage(path);
    const state = storage.getReflectionState("default", "alice", "global");
    storage.updateReflectionState({ ...state, last_event_seq: 7, last_run_at: "2026-07-24T00:00:00.000Z" });
    assert.equal(
      storage.tryAcquireReflectionLease(
        "default", "alice", "global", "worker-a", "2026-07-24T00:10:00.000Z", "2026-07-24T00:00:00.000Z",
      ),
      true,
    );
    storage.close();

    storage = new SqliteStorage(path);
    assert.equal(storage.getReflectionState("default", "alice", "global").last_event_seq, 7);
    assert.equal(
      storage.tryAcquireReflectionLease(
        "default", "alice", "global", "worker-b", "2026-07-24T00:11:00.000Z", "2026-07-24T00:01:00.000Z",
      ),
      false,
    );
    storage.close();
  } finally {
    cleanup(path);
  }
});
test("v0.7 sqlite auto-linking never mutates the immutable archival event", async () => {
  const path = tempDb();
  try {
    const nemos = new Nemos({
      storage: { type: "sqlite", path },
      llm: makePerspectiveMockLLMConfig(),
      features: { autoLinking: true, doubleCheck: false },
      worker: { manualWorker: true },
    });
    const result = await nemos.forUser("alice").ingest("ProjectAlpha 已完成接口联调");
    const archival = nemos.raw().storage.findById("default", "alice", result.archival.id);
    assert.equal(archival?.content, "ProjectAlpha 已完成接口联调");
    assert.equal(archival?.entities, undefined);
    assert.equal(nemos.getLifecycleStatus(result.archival.id)?.completed, true);
    assert.ok(result.derived.some((memory) => (memory.entities?.length ?? 0) > 0));
    await nemos.close();
  } finally {
    cleanup(path);
  }
});
