import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentUserActionGateway,
  type AgentRunEvent,
  type AgentRunInput,
  type AgentRunObserver,
} from "../../src/agent/index.js";

test("explicit user actions use the audited write-tool gateway without a second prompt", async () => {
  const events: AgentRunEvent[] = [];
  const startedRuns: AgentRunInput[] = [];
  let executions = 0;
  const observer: AgentRunObserver = {
    onStart: (input) => { startedRuns.push(input); },
    onEvent: (_runId, event) => { events.push(event); },
  };
  const gateway = new AgentUserActionGateway(observer);

  const result = await gateway.execute({
    name: "capability_task_delete",
    description: "Delete a task selected in the local client",
    arguments: { taskId: "task-1" },
    metadata: { personaId: "clownfish" },
    execute: async () => {
      executions++;
      return { deletedId: "task-1" };
    },
    summarizeResult: (value) => ({ ok: true, deletedId: value.deletedId }),
  });

  assert.equal(executions, 1);
  assert.equal(result.value.deletedId, "task-1");
  assert.match(result.runId, /^user-action-/);
  assert.equal(result.sessionId, "companion:management");
  const started = startedRuns[0];
  assert.equal(started?.runId, result.runId);
  assert.equal(started?.sessionId, result.sessionId);
  assert.equal(started?.metadata?.actor, "user");
  assert.equal(started?.metadata?.origin, "local-client");
  assert.equal(started?.metadata?.action, "capability_task_delete");
  assert.ok(events.some((event) => event.type === "tool_authorization" && event.allowed));
  assert.ok(events.some((event) => event.type === "tool_end" && !event.result.isError));
  assert.ok(events.some((event) => event.type === "run_end" && event.reason === "completed"));
});

test("explicit user action failures become failed runs and preserve the original error", async () => {
  const failures: Error[] = [];
  const observer: AgentRunObserver = {
    onError: (_runId, error) => { failures.push(error); },
  };
  const gateway = new AgentUserActionGateway(observer);

  await assert.rejects(
    gateway.execute({
      name: "skill_upgrade",
      description: "Upgrade a selected Skill",
      arguments: { skillId: "missing" },
      execute: async () => {
        throw new Error("skill not found");
      },
    }),
    /skill not found/,
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.message, "skill not found");
});
