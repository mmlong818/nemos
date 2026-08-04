import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { prepareDerived } from "../../../src/persist-derived.js";
import { makeMockLLMConfig } from "../../helpers.js";

test("v0.7 lifecycle: sync ingest records ordered event and completed stages", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, autoLinking: false },
    worker: { manualWorker: true },
  });
  const user = nemos.forUser("alice");
  const first = await user.ingest("我每天早上写代码");
  const second = await user.ingest("今天完成了一个版本");

  const firstStatus = nemos.getLifecycleStatus(first.archival.id);
  const secondStatus = nemos.getLifecycleStatus(second.archival.id);
  assert.equal(firstStatus?.event.event_seq, 1);
  assert.equal(secondStatus?.event.event_seq, 2);
  assert.equal(firstStatus?.completed, true);
  assert.deepEqual(
    firstStatus?.stages.map((stage) => stage.stage).sort(),
    ["append", "complete", "extract", "link", "persist", "schedule"].sort(),
  );
  assert.equal(first.archival.generation, 0);
  assert.ok(first.derived.every((memory) => memory.generation === 1));
  await nemos.close();
});

test("v0.7 lifecycle: skipAnalysis still closes the lifecycle explicitly", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    worker: { manualWorker: true },
  });
  const result = await nemos.forUser("alice").ingest("只保留原文", { skipAnalysis: true });
  const status = nemos.getLifecycleStatus(result.archival.id);
  assert.equal(status?.completed, true);
  assert.equal(status?.stages.find((stage) => stage.stage === "extract")?.status, "skipped");
  await nemos.close();
});

test("v0.7 lifecycle: background ingest uses the same persisted stages", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, autoLinking: false },
    worker: { manualWorker: true },
  });
  const handle = await nemos.forUser("alice").ingest("后台整理这段内容", { background: true });
  await nemos.runWorkerTick();
  const status = nemos.getLifecycleStatus(handle.archival.id);
  assert.equal(status?.completed, true);
  assert.equal(status?.stages.find((stage) => stage.stage === "persist")?.status, "completed");
  await nemos.close();
});
test("v0.7 generation: automatic derivation cannot recurse beyond generation 2", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, autoLinking: false },
    worker: { manualWorker: true },
  });
  const result = await nemos.forUser("alice").ingest("我每天写代码");
  assert.ok(result.derived[0]);
  await assert.rejects(
    () => prepareDerived(null, () => undefined, [{ ...result.derived[0]!, generation: 3 }]),
    /generation limit exceeded/,
  );
  await nemos.close();
});
test("v0.7 lifecycle: direct structured write is observable and ordered", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  });
  const memory = await nemos.forUser("alice").write({
    layer: "episodic",
    content: "结构化写入事件",
    source: { authoritative: false, origin: "test", chain_depth: 1 },
  });
  const status = nemos.getLifecycleStatus(memory.id);
  assert.equal(status?.event.event_seq, 1);
  assert.equal(status?.completed, true);
  assert.equal(status?.stages.find((stage) => stage.stage === "extract")?.status, "skipped");
  await nemos.close();
});
test("v0.7 lifecycle: extraction failure remains visible after archival commit", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: { provider: "custom", name: "fail", chat: async () => { throw new Error("extract failed"); } },
    features: { doubleCheck: false, autoLinking: false },
    worker: { manualWorker: true },
  });
  await assert.rejects(() => nemos.forUser("alice").ingest("必须保留原文"), /extract failed/);
  const archival = nemos.raw().storage.list("default", "alice", "archival", { limit: 1 })[0];
  assert.ok(archival);
  const status = nemos.getLifecycleStatus(archival!.id);
  assert.equal(status?.failed, true);
  assert.equal(status?.stages.find((stage) => stage.stage === "extract")?.last_error?.includes("extract failed"), true);
  await nemos.close();
});
test("v0.7 lifecycle: repeated queue claim reuses extraction and does not duplicate derived rows", async () => {
  const nemos = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, autoLinking: false },
    worker: { manualWorker: true },
  });
  const handle = await nemos.forUser("alice").ingest("重复领取也只能提交一次", { background: true });
  await nemos.runWorkerTick();
  const storage = nemos.raw().storage;
  const before = storage.listAll("default", "alice").filter((memory) => memory.layer !== "archival").length;
  storage.updateQueueStatus(handle.id, {
    status: "queued",
    next_attempt_at: "2000-01-01T00:00:00.000Z",
  });
  await nemos.runWorkerTick();
  const after = storage.listAll("default", "alice").filter((memory) => memory.layer !== "archival").length;
  assert.equal(after, before);
  assert.equal(nemos.getLifecycleStatus(handle.archival.id)?.completed, true);
  await nemos.close();
});