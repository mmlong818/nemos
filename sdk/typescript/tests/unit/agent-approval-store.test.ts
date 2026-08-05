import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AgentRuntime,
  FileAgentApprovalStore,
  type AgentModel,
  type AgentTool,
  type AgentToolAuthorizationInput,
} from "../../src/agent/index.js";

function writeInput(signal = new AbortController().signal, runId = "approval-run"): AgentToolAuthorizationInput {
  return {
    runId,
    sessionId: "approval-session",
    call: { id: "write-1", name: "save_file", arguments: { path: "report.md", apiKey: "sk-1234567890abcdef" } },
    tool: {
      name: "save_file",
      description: "Save a report",
      inputSchema: { type: "object" },
      effect: "write",
    },
    metadata: { userId: "user-a", personaId: "clownfish" },
    signal,
  };
}

async function waitForPending(store: FileAgentApprovalStore): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const item = store.list({ status: "pending" })[0];
    if (item) return item.id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("approval was not created");
}

test("pauses a write tool until its durable approval is allowed once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-approval-"));
  try {
    const file = join(dir, "approvals.json");
    const events: string[] = [];
    const store = new FileAgentApprovalStore(file, {
      onChange: (event) => events.push(event.action),
    });
    let modelCalls = 0;
    let executions = 0;
    const model: AgentModel = {
      complete: async () => ++modelCalls === 1
        ? { text: "", toolCalls: [{ id: "write-1", name: "save_file", arguments: { path: "report.md", apiKey: "sk-1234567890abcdef" } }] }
        : { text: "saved" },
    };
    const tool: AgentTool = {
      definition: {
        name: "save_file",
        description: "Save a report",
        inputSchema: { type: "object" },
        effect: "write",
      },
      execute: async () => {
        executions++;
        return { content: "ok" };
      },
    };
    const run = new AgentRuntime(model, [tool], {
      authorizeTool: (input) => store.authorize(input),
    }).run({
      runId: "approval-run",
      sessionId: "approval-session",
      systemPrompt: "system",
      prompt: "save it",
      metadata: { userId: "user-a", personaId: "clownfish" },
    });

    const approvalId = await waitForPending(store);
    assert.equal(executions, 0);
    assert.equal(store.get(approvalId)?.active, true);
    store.decide(approvalId, true);

    const result = await run;
    assert.equal(result.output, "saved");
    assert.equal(executions, 1);
    assert.equal(store.get(approvalId)?.status, "consumed");
    assert.deepEqual(events, ["requested", "approved", "consumed"]);
    assert.doesNotMatch(readFileSync(file, "utf8"), /Bearer |sk-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persists an approved decision for the matching interrupted call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-approval-resume-"));
  const controller = new AbortController();
  try {
    const file = join(dir, "approvals.json");
    const first = new FileAgentApprovalStore(file);
    void first.authorize(writeInput(controller.signal));
    const approvalId = await waitForPending(first);

    const afterRestart = new FileAgentApprovalStore(file);
    afterRestart.decide(approvalId, true);
    const resumed = new FileAgentApprovalStore(file);
    const decision = await resumed.authorize(writeInput());

    assert.equal(decision.allowed, true);
    assert.equal(decision.approvalId, approvalId);
    assert.equal(resumed.get(approvalId)?.status, "consumed");
  } finally {
    controller.abort();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps approval decisions isolated between runs in the same session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-approval-run-isolation-"));
  const first = new AbortController();
  const second = new AbortController();
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"));
    void store.authorize(writeInput(first.signal, "run-one"));
    void store.authorize(writeInput(second.signal, "run-two"));

    for (let attempt = 0; attempt < 50 && store.list({ status: "pending" }).length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const pending = store.list({ status: "pending" });
    assert.equal(pending.length, 2);
    assert.deepEqual(new Set(pending.map((item) => item.sessionId)), new Set(["approval-session"]));
    assert.deepEqual(new Set(pending.map((item) => item.runId)), new Set(["run-one", "run-two"]));
    assert.equal(new Set(pending.map((item) => item.fingerprint)).size, 2);
  } finally {
    first.abort();
    second.abort();
    rmSync(dir, { recursive: true, force: true });
  }
});