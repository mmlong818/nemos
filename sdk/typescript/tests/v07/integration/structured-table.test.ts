import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

test("v0.7.5 Markdown tables preserve row and column relationships", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, autoLinking: false },
    worker: { manualWorker: true },
  });
  const user = nemos.forUser("alice");
  const result = await user.ingest([
    "Support rotation",
    "",
    "|  | Day Shift | Night Shift |",
    "| --- | --- | --- |",
    "| Sunday | Ada | Ben |",
    "| Monday | Ben | Ada |",
  ].join("\n"));

  const sunday = result.derived.find((memory) =>
    memory.source.origin === "deterministic-structure"
      && memory.content.includes("Sunday")
      && memory.content.includes("Day Shift = Ada"));
  assert.ok(sunday);
  assert.equal(sunday.layer, "semantic");
  assert.equal(sunday.archival_ref, result.archival.id);
  assert.equal(sunday.source.extractor, "deterministic_normalizer");

  const packet = await user.recall("What shift does Ada have on Sunday?", {
    maxResults: 20,
    maxTokens: 6000,
  });
  assert.ok(packet.items.some((item) => item.memory.id === sunday.id));
  await nemos.close();
});
