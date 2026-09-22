import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateExecutionPlan } from "../../examples/companion/execution-plan.js";
import {
  FileStepReceiptStore,
  createFailedStepReceipt,
  createSucceededStepReceipt,
  mergeStepReceipts,
  nextStepAttempt,
  observedMaterialEvidence,
  renderStructuredMergeContext,
  ruleHash,
  stepResultEvidence,
  structuredPlanHash,
  type StepProducerV1,
} from "../../examples/companion/structured-handoff.js";

const allowed = new Set(["worker-a", "worker-b", "clownfish"]);
const plan = () => validateExecutionPlan({
  version: 1, taskId: "task-1", revision: 1, finalStepId: "final",
  steps: [
    { id: "a", executorId: "worker-a", objective: "A", output: "A", dependsOn: [] },
    { id: "b", executorId: "worker-b", objective: "B", output: "B", dependsOn: [] },
    { id: "final", executorId: "clownfish", objective: "final", output: "final", dependsOn: ["a", "b"] },
  ],
}, allowed);
const producer = (botId = "worker-a"): StepProducerV1 => ({
  botId, botRevision: 2, ruleHash: ruleHash(`rules:${botId}`), model: "mock-model", tools: "off",
});
const success = (executionPlan: ReturnType<typeof plan>, stepId: string, attempt: number, output: string, extra: Record<string, unknown> = {}) =>
  createSucceededStepReceipt({
    taskId: executionPlan.taskId,
    planHash: structuredPlanHash(executionPlan),
    stepId,
    attempt,
    inputHash: "a".repeat(64),
    output,
    producer: producer(stepId === "b" ? "worker-b" : stepId === "final" ? "clownfish" : "worker-a"),
    allowedEvidence: observedMaterialEvidence("[S1] observed [S2] source"),
    startedAt: "2026-09-14T00:00:00Z",
    completedAt: "2026-09-14T00:00:01Z",
    ...extra,
  });

test("material labels with a description ([S1 会议背景]) observe the bare identifier only", () => {
  const refs = observedMaterialEvidence("[S1 会议背景]\n目的：评审\n[S2 示例材料 A：群聊节选] 小周：档期没了\n[S3] 纯标识 [不是标识] [S4:附件] x").map((item) => item.ref);
  assert.deepEqual(refs, ["material:S1", "material:S2", "material:S3", "material:S4"]);
  assert.ok(refs.every((ref) => !/[\s示例]/.test(ref)), "说明文字不得进入 ref");
});

test("step results are versioned, hashed, source-linked without claiming fact verification", () => {
  const p = plan();
  const receipt = success(p, "a", 1, JSON.stringify({
    summary: "A result",
    claims: [{ key: "date", value: "2026-10-06", sourceRefs: ["S1"] }],
    unresolvedItems: [],
  }));
  assert.equal(receipt.version, 1);
  assert.equal(receipt.result.id.startsWith("step-result:"), true);
  assert.equal(receipt.result.inputHash.length, 64);
  assert.equal(receipt.result.outputHash?.length, 64);
  assert.deepEqual(receipt.result.claims[0], {
    key: "date", value: "2026-10-06", canonicalValue: "2026-10-06",
    sourceRefs: ["material:S1"], evidenceState: "source-linked",
  });
  assert.equal(receipt.result.evidenceRefs[0]?.factVerified, false);
});

test("no evidence is explicit unknown and a forged artifact ref is rejected", () => {
  const p = plan();
  const unknown = success(p, "a", 1, JSON.stringify({ summary: "guess", claims: [{ key: "owner", value: "Ada", sourceRefs: [] }] }));
  assert.equal(unknown.result.claims[0]?.evidenceState, "unknown");
  assert.match(unknown.result.unresolvedItems.join(" "), /fact status is unknown/);
  assert.throws(() => success(p, "a", 1, JSON.stringify({
    summary: "forged", claims: [{ key: "owner", value: "Ada", sourceRefs: ["artifact:forged"] }],
  })), /unobserved evidence ref/);
});

test("deterministic merge follows plan order and reports canonical conflicts, failures, and missing results", () => {
  const p = plan();
  const a = success(p, "a", 1, JSON.stringify({ summary: "A", claims: [{ key: "count", value: "10", sourceRefs: ["S1"] }] }));
  const b = success(p, "b", 1, JSON.stringify({ summary: "B", claims: [{ key: "count", value: "11", sourceRefs: ["S2"] }] }));
  const failed = createFailedStepReceipt({
    taskId: p.taskId, planHash: structuredPlanHash(p), stepId: "final", attempt: 1,
    inputHash: "b".repeat(64), producer: producer("clownfish"), error: "invalid final",
    startedAt: "2026-09-14T00:00:02Z", completedAt: "2026-09-14T00:00:03Z",
  });
  const first = mergeStepReceipts(p, [b, failed, a]);
  const second = mergeStepReceipts(p, [failed, a, b]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.orderedResults.map((item) => item.stepId), ["a", "b"]);
  assert.equal(first.status, "unresolved");
  assert.match(first.unresolvedItems.join("\n"), /conflicting canonical values/);
  assert.match(first.unresolvedItems.join("\n"), /final.*failed/);
});

test("retry appends a new immutable attempt and persistence survives restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "structured-handoff-"));
  try {
    const p = plan();
    const file = join(dir, "receipts.json");
    const store = new FileStepReceiptStore(file);
    const first = createFailedStepReceipt({
      taskId: p.taskId, planHash: structuredPlanHash(p), stepId: "a", attempt: 1,
      inputHash: "c".repeat(64), producer: producer(), error: "first failed",
      startedAt: "2026-09-14T00:00:00Z", completedAt: "2026-09-14T00:00:01Z",
    });
    store.append(first);
    const second = success(p, "a", nextStepAttempt(store.list(p.taskId), structuredPlanHash(p), "a"), "legacy plain output");
    store.append(second);
    assert.deepEqual(store.list(p.taskId).map((item) => [item.attempt, item.state]), [[1, "failed"], [2, "succeeded"]]);
    assert.deepEqual(new FileStepReceiptStore(file).list(p.taskId), store.list(p.taskId));
    assert.throws(() => store.append({ ...first, error: "changed" }), /does not match|identity/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("damaged persisted history stays readable as empty but is never overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "structured-handoff-damaged-"));
  try {
    const file = join(dir, "receipts.json");
    writeFileSync(file, "{damaged", "utf8");
    const store = new FileStepReceiptStore(file);
    assert.deepEqual(store.list("task-1"), []);
    assert.throws(() => store.append(createFailedStepReceipt({
      taskId: "task-1", planHash: structuredPlanHash(plan()), stepId: "a", attempt: 1,
      inputHash: "d".repeat(64), producer: producer(), error: "failed",
      startedAt: "2026-09-14T00:00:00Z", completedAt: "2026-09-14T00:00:01Z",
    })), /read-only.*could not be validated/);
    assert.equal(readFileSync(file, "utf8"), "{damaged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("semantically malformed receipt histories fail closed across every trusted field", () => {
  const p = plan();
  const valid = success(p, "a", 1, JSON.stringify({
    summary: "A", claims: [{ key: "count", value: "10", sourceRefs: ["S1"] }],
  }));
  const mutations: Array<[string, (receipt: any) => void]> = [
    ["result id", (receipt) => { receipt.result.id = "step-result:" + "f".repeat(32); }],
    ["output hash", (receipt) => { receipt.result.outputHash = "f".repeat(64); }],
    ["claim canonical", (receipt) => { receipt.result.claims[0].canonicalValue = "11"; }],
    ["claim source", (receipt) => { receipt.result.claims[0].sourceRefs = ["artifact:fake"]; }],
    ["evidence flags", (receipt) => { receipt.result.evidenceRefs[0].factVerified = true; }],
    ["producer tools", (receipt) => { receipt.result.producer.tools = "on"; }],
    ["timestamps", (receipt) => { receipt.result.completedAt = "2026-09-13T23:59:59.000Z"; }],
    ["derived identity", (receipt) => { receipt.result.derivedFrom = ["step-result:" + "e".repeat(32)]; }],
    ["unknown field", (receipt) => { receipt.result.permission = "write"; }],
  ];
  for (const [name, mutate] of mutations) {
    const dir = mkdtempSync(join(tmpdir(), "structured-handoff-semantic-"));
    try {
      const file = join(dir, "receipts.json");
      const malformed = structuredClone(valid) as any; mutate(malformed);
      const source = JSON.stringify({ version: 1, receipts: [malformed] });
      writeFileSync(file, source, "utf8");
      const store = new FileStepReceiptStore(file);
      assert.throws(() => store.assertHealthy(), /read-only.*could not be validated/, name);
      assert.throws(() => store.append(valid), /read-only.*could not be validated/, name);
      assert.equal(readFileSync(file, "utf8"), source, name);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("merge context is bounded, delimited, and discloses truncation without deleting originals", () => {
  const p = plan();
  const a = success(p, "a", 1, JSON.stringify({
    summary: "long",
    claims: Array.from({ length: 20 }, (_, index) => ({ key: `key-${index}`, value: "x".repeat(500), sourceRefs: ["S1"] })),
  }));
  const b = success(p, "b", 1, JSON.stringify({ summary: "B", claims: [] }), {
    allowedEvidence: stepResultEvidence([a.result]), derivedFrom: [a.result.id],
  });
  const merged = mergeStepReceipts(p, [a, b], ["a", "b"]);
  const context = renderStructuredMergeContext(merged, 4_000);
  assert.ok(context.length < 6_000);
  assert.match(context, /structured_step_merge/);
  assert.match(context, /截断|truncated/);
  assert.equal(a.result.rawOutput?.length, JSON.stringify({
    summary: "long",
    claims: Array.from({ length: 20 }, (_, index) => ({ key: `key-${index}`, value: "x".repeat(500), sourceRefs: ["S1"] })),
  }).length);
});
