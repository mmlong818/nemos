import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStorage } from "../../../src/storage.js";

test("v0.7 queue: persisted next_attempt_at enforces real backoff", () => {
  const storage = new InMemoryStorage();
  storage.enqueueIngest({
    id: "iq_backoff", tenant_id: "default", user_id: "alice", archival_id: "arch_1",
    scope: "global", content: "x", scenario_json: null, origin_agent: null,
    content_date: null, perspectives_json: null, status: "queued", attempts: 0,
    last_error: null, created_at: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(storage.takeNextQueued("2026-07-24T00:00:00.000Z")?.id, "iq_backoff");
  storage.updateQueueStatus("iq_backoff", {
    status: "queued",
    next_attempt_at: "2026-07-24T00:00:10.000Z",
  });
  assert.equal(storage.takeNextQueued("2026-07-24T00:00:09.999Z"), null);
  assert.equal(storage.takeNextQueued("2026-07-24T00:00:10.000Z")?.id, "iq_backoff");
});