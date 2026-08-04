import assert from "node:assert/strict";
import test from "node:test";

import { AgentOrchestrator, type AgentSubtaskRunInput } from "../../src/agent/index.js";

test("runs independent subtasks in parallel and shares only dependency artifact references", async () => {
  let active = 0;
  let maxActive = 0;
  const inputs: AgentSubtaskRunInput[] = [];
  const orchestrator = new AgentOrchestrator(async (input) => {
    inputs.push(input);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active--;
    return {
      summary: `done:${input.task.id}`,
      artifactRefs: [`artifact:${input.task.id}`],
      output: "private subtask history is not shared",
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, modelCalls: 1 },
      cost: {
        breakdowns: [{ currency: "CNY", inputAmount: 0.01, outputAmount: 0.02, totalAmount: 0.03 }],
        pricedRuns: 1,
        unpricedRuns: 0,
        estimated: true,
        pricingDate: "2026-08-02",
      },
    };
  }, { maxParallel: 2 });

  const result = await orchestrator.run({
    sessionId: "parent",
    objective: "research and synthesize",
    tasks: [
      { id: "research", title: "Research", instruction: "research" },
      { id: "verify", title: "Verify", instruction: "verify" },
      { id: "write", title: "Write", instruction: "write", dependsOn: ["research", "verify"] },
    ],
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 6, totalTokens: 36, modelCalls: 3 });
  assert.equal(result.cost?.breakdowns[0]?.totalAmount, 0.09);
  assert.equal(result.cost?.pricedRuns, 3);
  assert.equal(result.quality.status, "passed");
  assert.equal(result.quality.score, 100);
  assert.equal(maxActive, 2);
  assert.equal(new Set(inputs.map((input) => input.sessionId)).size, 3);
  assert.equal(inputs[0]?.budget.maxTotalTokens, 24_000);
  assert.deepEqual(inputs.find((input) => input.task.id === "research")?.sharedArtifactRefs, []);
  assert.deepEqual(
    inputs.find((input) => input.task.id === "write")?.sharedArtifactRefs.sort(),
    ["artifact:research", "artifact:verify"],
  );
  assert.equal("messages" in (inputs.find((input) => input.task.id === "write") ?? {}), false);
});

test("isolates a failed subtask and skips only its dependants", async () => {
  const orchestrator = new AgentOrchestrator(async (input) => {
    if (input.task.id === "bad") throw new Error("source unavailable");
    return { summary: `done:${input.task.id}`, artifactRefs: [`artifact:${input.task.id}`] };
  });

  const result = await orchestrator.run({
    sessionId: "partial",
    objective: "mixed work",
    tasks: [
      { id: "good", title: "Good", instruction: "good" },
      { id: "bad", title: "Bad", instruction: "bad" },
      { id: "blocked", title: "Blocked", instruction: "blocked", dependsOn: ["bad"] },
    ],
  });

  assert.equal(result.status, "partial");
  assert.equal(result.tasks.find((item) => item.id === "good")?.status, "succeeded");
  assert.equal(result.tasks.find((item) => item.id === "bad")?.status, "failed");
  assert.equal(result.tasks.find((item) => item.id === "blocked")?.status, "skipped");
  assert.equal(result.quality.status, "needs_review");
  assert.deepEqual(result.artifactRefs, ["artifact:good"]);
});

test("rejects cycles, unknown dependencies, and plans over the subtask limit", async () => {
  const orchestrator = new AgentOrchestrator(async () => ({ summary: "done" }), { maxSubtasks: 2 });
  await assert.rejects(() => orchestrator.run({
    sessionId: "cycle",
    objective: "cycle",
    tasks: [
      { id: "a", title: "A", instruction: "a", dependsOn: ["b"] },
      { id: "b", title: "B", instruction: "b", dependsOn: ["a"] },
    ],
  }), /cannot make progress/);
  await assert.rejects(() => orchestrator.run({
    sessionId: "unknown",
    objective: "unknown",
    tasks: [{ id: "a", title: "A", instruction: "a", dependsOn: ["missing"] }],
  }), /unknown dependency/);
  await assert.rejects(() => orchestrator.run({
    sessionId: "large",
    objective: "large",
    tasks: [
      { id: "a", title: "A", instruction: "a" },
      { id: "b", title: "B", instruction: "b" },
      { id: "c", title: "C", instruction: "c" },
    ],
  }), /subtask limit/);
});

test("cancellation does not call a custom summarizer with an aborted signal", async () => {
  let summarized = false;
  const orchestrator = new AgentOrchestrator(async () => ({ summary: "done" }), {
    summarize: async () => {
      summarized = true;
      return "summary";
    },
  });
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));

  const result = await orchestrator.run({
    sessionId: "cancelled",
    objective: "cancel safely",
    tasks: [{ id: "task", title: "Task", instruction: "work" }],
  }, { signal: controller.signal });

  assert.equal(result.status, "cancelled");
  assert.equal(result.tasks[0]?.status, "cancelled");
  assert.equal(summarized, false);
});
