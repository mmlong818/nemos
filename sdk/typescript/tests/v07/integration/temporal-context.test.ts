import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos, type WriteMemoryInput } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

function createNemos(): Nemos {
  return new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  });
}

function residence(content: string, object: string, validFrom: string, mode: WriteMemoryInput["utteranceMode"] = "literal", layer: WriteMemoryInput["layer"] = "personal_semantic"): WriteMemoryInput {
  return {
    layer,
    content,
    source: { authoritative: false, origin: "test:user", chain_depth: 1, extractor: "user_typed" },
    subject: "user:self",
    predicate: "residence.current",
    object,
    trustTier: 1,
    utteranceMode: mode,
    validFrom,
  };
}

test("v0.7.2 current recall rejects roleplay statements even when FTS matches", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const current = await user.write(residence(
    "\u6211\u73b0\u5728\u4f4f\u5728\u798f\u5dde",
    "\u798f\u5dde",
    "2026-01-01T00:00:00.000Z",
  ));
  const roleplay = await user.write(residence(
    "\u6211\u73b0\u5728\u4f4f\u5728\u6708\u7403\uff0c\u662f\u6545\u4e8b\u91cc\u7684\u516c\u7235",
    "\u6708\u7403",
    "2026-02-01T00:00:00.000Z",
    "roleplay",
    "semantic",
  ));

  nemos.raw().storage.updateRelated("default", "alice", current.layer, current.id, [roleplay.id]);

  const packet = await user.recall("\u6211\u73b0\u5728\u4f4f\u5728\u54ea\u91cc\uff1f", {
    now: "2026-07-24T12:00:00.000Z",
  });
  assert.deepEqual(packet.items.map((item) => item.memory.id), [current.id]);
  const trace = await user.explainRecall(packet.trace_id);
  assert.ok(trace.rejected.some((item) =>
    item.memory_id === roleplay.id && item.reason === "utterance_roleplay",
  ));
  await nemos.close();
});

test("v0.7.2 future facts activate by valid time without hiding the present", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const original = await user.write(residence(
    "\u6211\u73b0\u5728\u4f4f\u5728\u4e0a\u6d77",
    "\u4e0a\u6d77",
    "2026-01-01T00:00:00.000Z",
  ));
  const future = await user.write(residence(
    "\u6211\u5c06\u5728 2099 \u5e74\u642c\u5230\u706b\u661f\u57ce",
    "\u706b\u661f\u57ce",
    "2099-01-01T00:00:00.000Z",
  ));

  assert.equal(nemos.raw().storage.findById("default", "alice", original.id)?.belief_state ?? "active", "active");
  assert.equal(nemos.raw().storage.findById("default", "alice", future.id)?.belief_state ?? "active", "active");

  const present = await user.recall("\u6211\u73b0\u5728\u4f4f\u5728\u54ea\u91cc\uff1f", {
    now: "2026-07-24T12:00:00.000Z",
  });
  assert.deepEqual(present.items.map((item) => item.memory.id), [original.id]);

  const intermediate = await user.write(residence(
    "\u66f4\u65b0\uff1a\u6211\u73b0\u5728\u4f4f\u5728\u798f\u5dde",
    "\u798f\u5dde",
    "2026-06-01T00:00:00.000Z",
  ));
  assert.equal(nemos.raw().storage.findById("default", "alice", original.id)?.belief_state, "superseded");
  assert.equal(nemos.raw().storage.findById("default", "alice", future.id)?.belief_state ?? "active", "active");

  const updatedPresent = await user.recall("\u6211\u73b0\u5728\u4f4f\u5728\u54ea\u91cc\uff1f", {
    now: "2026-07-24T12:00:00.000Z",
  });
  assert.deepEqual(updatedPresent.items.map((item) => item.memory.id), [intermediate.id]);

  const futurePresent = await user.recall("\u6211\u73b0\u5728\u4f4f\u5728\u54ea\u91cc\uff1f", {
    now: "2099-02-01T00:00:00.000Z",
  });
  assert.deepEqual(futurePresent.items.map((item) => item.memory.id), [future.id]);
  const trace = await user.explainRecall(futurePresent.trace_id);
  assert.ok(trace.rejected.some((item) =>
    item.memory_id === intermediate.id && item.reason === "historical_version",
  ));
  await nemos.close();
});
