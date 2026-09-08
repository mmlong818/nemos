import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRuntime,
  type AgentModel,
  type AgentModelResponse,
  type AgentTool,
} from "../../src/agent/index.js";

function modelFrom(responses: AgentModelResponse[]): AgentModel {
  let index = 0;
  return {
    complete: async () => responses[index++] ?? { text: "done" },
  };
}

function tool(
  name: string,
  effect: "read" | "write",
  execute: AgentTool["execute"],
): AgentTool {
  return {
    definition: {
      name,
      description: name,
      inputSchema: { type: "object" },
      effect,
      timeoutMs: 1_000,
    },
    execute,
  };
}

test("runs a multi-round tool loop and preserves model call order", async () => {
  const runtime = new AgentRuntime(
    modelFrom([
      {
        text: "",
        toolCalls: [
          { id: "a", name: "read_a", arguments: {} },
          { id: "b", name: "read_b", arguments: {} },
        ],
        inputTokens: 100,
        outputTokens: 10,
      },
      { text: "final answer", inputTokens: 120, outputTokens: 20 },
    ]),
    [
      tool("read_a", "read", async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { content: "A" };
      }),
      tool("read_b", "read", async () => ({ content: "B" })),
    ],
  );

  const result = await runtime.run({ runId: "run-1", sessionId: "conversation-1", systemPrompt: "system", prompt: "go" });
  const toolMessages = result.messages.filter((message) => message.role === "tool");
  assert.equal(result.runId, "run-1");
  assert.equal(result.sessionId, "conversation-1");
  assert.equal(result.output, "final answer");
  assert.equal(result.rounds, 2);
  assert.deepEqual(result.usage, { inputTokens: 220, outputTokens: 30, totalTokens: 250, modelCalls: 2 });
  assert.deepEqual(toolMessages.map((message) => message.content), ["A", "B"]);
});

test("legacy text can complete without a file but an empty model turn is blocked", async () => {
  const text = await new AgentRuntime(modelFrom([{ text: "A complete answer" }]), []).run({
    sessionId: "legacy-text", systemPrompt: "system", prompt: "answer",
  });
  assert.equal(text.disposition.state, "completed");

  const empty = await new AgentRuntime(modelFrom([{ text: "" }]), []).run({
    sessionId: "legacy-empty", systemPrompt: "system", prompt: "answer",
  });
  assert.equal(empty.reason, "blocked");
  assert.equal(empty.disposition.state, "blocked");
});

test("explicit task protocol records waiting input without keyword inference", async () => {
  let calls = 0;
  const model: AgentModel = {
    complete: async (request) => {
      calls++;
      assert.equal(request.tools.some((item) => item.name === "finish_turn"), true);
      return calls === 1
        ? { text: "I need one choice." }
        : { text: "", toolCalls: [{ id: "finish", name: "finish_turn", arguments: { state: "waiting_input", question: "Which format should I use?" } }] };
    },
  };
  const result = await new AgentRuntime(model, [], { terminationProtocol: "explicit", maxRounds: 2 }).run({
    sessionId: "explicit-wait", systemPrompt: "system", prompt: "prepare it",
  });
  assert.equal(calls, 2);
  assert.equal(result.reason, "waiting_input");
  assert.deepEqual(result.disposition, { state: "waiting_input", question: "Which format should I use?" });
});

test("valid finish_turn is accepted at the token boundary without executing more business tools", async () => {
  let businessCalls = 0;
  const runtime = new AgentRuntime({
    complete: async () => ({
      text: "Final answer at the budget boundary.",
      toolCalls: [{ id: "finish", name: "finish_turn", arguments: { state: "completed" } }],
      inputTokens: 6,
      outputTokens: 4,
    }),
  }, [tool("write_more", "write", async () => { businessCalls++; return { content: "written" }; })], {
    terminationProtocol: "explicit",
    maxTotalTokens: 10,
  });
  const result = await runtime.run({ sessionId: "finish-at-budget", systemPrompt: "system", prompt: "go" });
  assert.equal(result.reason, "completed");
  assert.equal(result.disposition.state, "completed");
  assert.equal(businessCalls, 0);
});

test("mixed finish and business calls are all answered but no business action executes", async () => {
  let calls = 0;
  let executed = 0;
  const model: AgentModel = {
    complete: async (request) => {
      calls++;
      if (calls === 1) return {
        text: "",
        toolCalls: [
          { id: "write", name: "write_more", arguments: {} },
          { id: "finish", name: "finish_turn", arguments: { state: "completed" } },
        ],
      };
      assert.deepEqual(
        request.messages.filter((item) => item.role === "tool").map((item) => item.toolCallId),
        ["write", "finish"],
      );
      return { text: "", toolCalls: [{ id: "wait", name: "finish_turn", arguments: { state: "waiting_input", question: "Confirm?" } }] };
    },
  };
  const result = await new AgentRuntime(model, [tool("write_more", "write", async () => { executed++; return { content: "written" }; })], {
    terminationProtocol: "explicit", maxRounds: 2,
  }).run({ sessionId: "mixed-finish", systemPrompt: "system", prompt: "go" });
  assert.equal(executed, 0);
  assert.equal(result.disposition.state, "waiting_input");
});

test("cancellation after a model response wins over a completion declaration", async () => {
  const controller = new AbortController();
  const result = await new AgentRuntime({
    complete: async () => {
      controller.abort(new Error("user cancelled"));
      return { text: "Finished", toolCalls: [{ id: "finish", name: "finish_turn", arguments: { state: "completed" } }] };
    },
  }, [], { terminationProtocol: "explicit" }).run({
    sessionId: "cancel-wins", systemPrompt: "system", prompt: "go", signal: controller.signal,
  });
  assert.equal(result.reason, "cancelled");
  assert.equal(result.disposition.state, "cancelled");
});

test("an authorized failed write is recorded as attempted while a denied write is not", async () => {
  const responses: AgentModelResponse[] = [
    { text: "", toolCalls: [{ id: "write-1", name: "write_remote", arguments: {} }] },
    { text: "", toolCalls: [{ id: "finish-1", name: "finish_turn", arguments: { state: "blocked", blocker: "Write outcome is unknown" } }] },
  ];
  const attempted = await new AgentRuntime(
    modelFrom(responses),
    [tool("write_remote", "write", async () => { throw new Error("connection ended"); })],
    { terminationProtocol: "explicit", authorizeTool: async () => ({ allowed: true }) },
  ).run({ sessionId: "attempted-write", systemPrompt: "system", prompt: "write" });
  assert.equal(attempted.disposition.state, "blocked");
  assert.equal(attempted.disposition.state === "blocked" && attempted.disposition.evidence?.[0]?.kind, "tool_attempt");

  const denied = await new AgentRuntime(
    modelFrom(responses),
    [tool("write_remote", "write", async () => ({ content: "should not run" }))],
    { terminationProtocol: "explicit", authorizeTool: async () => ({ allowed: false, reason: "not approved" }) },
  ).run({ sessionId: "denied-write", systemPrompt: "system", prompt: "write" });
  assert.equal(denied.disposition.state === "blocked" ? denied.disposition.evidence : undefined, undefined);
});

test("cancelling an in-flight write preserves its attempted-write evidence", async () => {
  const controller = new AbortController();
  const runtime = new AgentRuntime(
    modelFrom([{ text: "", toolCalls: [{ id: "write-cancel", name: "write_remote", arguments: {} }] }]),
    [tool("write_remote", "write", async () => {
      controller.abort(new Error("cancelled while writing"));
      throw new Error("write outcome unknown");
    })],
    { terminationProtocol: "explicit", authorizeTool: async () => ({ allowed: true }) },
  );
  const result = await runtime.run({ sessionId: "cancelled-write", systemPrompt: "system", prompt: "write", signal: controller.signal });
  assert.equal(result.disposition.state, "cancelled");
  assert.equal(result.disposition.state === "cancelled" && result.disposition.evidence?.[0]?.kind, "tool_attempt");
});

test("serializes a turn containing a write tool", async () => {
  let active = 0;
  let maxActive = 0;
  const tracked = async (label: string): Promise<{ content: string }> => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return { content: label };
  };
  const runtime = new AgentRuntime(
    modelFrom([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "read", arguments: {} },
          { id: "2", name: "write", arguments: {} },
          { id: "3", name: "read", arguments: {} },
        ],
      },
      { text: "ok" },
    ]),
    [
      tool("read", "read", async () => tracked("read")),
      tool("write", "write", async () => tracked("write")),
    ],
    { authorizeTool: async () => ({ allowed: true }) },
  );

  await runtime.run({ sessionId: "s2", systemPrompt: "system", prompt: "go" });
  assert.equal(maxActive, 1);
});

test("stops three identical tool-call rounds", async () => {
  const repeated = {
    text: "",
    toolCalls: [{ id: "same", name: "read", arguments: { q: "x" } }],
  };
  const runtime = new AgentRuntime(
    modelFrom([repeated, repeated, repeated, { text: "should not run" }]),
    [tool("read", "read", async () => ({ content: "x" }))],
  );

  const result = await runtime.run({ sessionId: "s3", systemPrompt: "system", prompt: "go" });
  assert.equal(result.reason, "repeated_tool_call");
  assert.equal(result.rounds, 3);
});

test("replaces oversized history with a bounded context handoff", async () => {
  let handoffCalls = 0;
  const runtime = new AgentRuntime(modelFrom([{ text: "done" }]), [], {
    handoffThresholdChars: 20,
    createHandoff: async () => {
      handoffCalls++;
      return "summary";
    },
  });

  const result = await runtime.run({
    sessionId: "s4",
    systemPrompt: "system",
    history: [{ role: "user", content: "a".repeat(30) }],
    prompt: "latest",
  });
  assert.equal(handoffCalls, 1);
  assert.equal(result.handoffs, 1);
  assert.equal(result.messages[1]?.content, "[Context Handoff]\nsummary");
});

test("stops advertising tools after the configured tool rounds", async () => {
  const advertised: number[] = [];
  const model: AgentModel = {
    complete: async ({ tools }) => {
      advertised.push(tools.length);
      return advertised.length === 1
        ? { text: "", toolCalls: [{ id: "1", name: "read", arguments: {} }] }
        : { text: "done" };
    },
  };
  const runtime = new AgentRuntime(
    model,
    [tool("read", "read", async () => ({ content: "x" }))],
    { maxToolRounds: 1 },
  );

  await runtime.run({ sessionId: "s5", systemPrompt: "system", prompt: "go" });
  assert.deepEqual(advertised, [1, 0]);
});

test("returns a cancelled result when the active model request is aborted", async () => {
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const model: AgentModel = {
    complete: ({ signal }) => new Promise((_resolve, reject) => {
      markStarted?.();
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  };
  const controller = new AbortController();
  const runtime = new AgentRuntime(model, []);
  const pending = runtime.run({
    sessionId: "s6",
    systemPrompt: "system",
    prompt: "go",
    signal: controller.signal,
  });
  await started;
  controller.abort();

  const result = await pending;
  assert.equal(result.reason, "cancelled");
  assert.equal(result.rounds, 0);
});

test("rejects invalid tool arguments before the tool executes", async () => {
  let executions = 0;
  const strictTool: AgentTool = {
    definition: {
      name: "strict_read",
      description: "strict",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
      effect: "read",
    },
    execute: async () => {
      executions++;
      return { content: "unexpected" };
    },
  };
  const runtime = new AgentRuntime(
    modelFrom([
      { text: "", toolCalls: [{ id: "1", name: "strict_read", arguments: { extra: true } }] },
      { text: "handled" },
    ]),
    [strictTool],
  );

  const result = await runtime.run({ sessionId: "s7", systemPrompt: "system", prompt: "go" });
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.equal(executions, 0);
  assert.match(toolMessage?.content ?? "", /query is required/);
  assert.match(toolMessage?.content ?? "", /extra is not allowed/);
});

test("fails closed when tool input validation throws", async () => {
  let executions = 0;
  let authorizations = 0;
  const brokenSchema: Record<string, unknown> = {};
  Object.defineProperty(brokenSchema, "type", {
    enumerable: true,
    get: () => { throw new Error("validator unavailable"); },
  });
  const writeTool: AgentTool = {
    definition: {
      name: "dangerous_write",
      description: "write",
      inputSchema: brokenSchema,
      effect: "write",
    },
    execute: async () => {
      executions++;
      return { content: "unexpected" };
    },
  };
  const runtime = new AgentRuntime(
    modelFrom([
      { text: "", toolCalls: [{ id: "1", name: "dangerous_write", arguments: {} }] },
      { text: "handled" },
    ]),
    [writeTool],
    { authorizeTool: async () => { authorizations++; return { allowed: true }; } },
  );

  const result = await runtime.run({ sessionId: "validation-failure", systemPrompt: "system", prompt: "go" });
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.equal(executions, 0);
  assert.equal(authorizations, 0);
  assert.match(toolMessage?.content ?? "", /validation failed: validator unavailable/);
});
test("denies write tools unless an authorization handler explicitly allows them", async () => {
  let executions = 0;
  const events: string[] = [];
  const runtime = new AgentRuntime(
    modelFrom([
      { text: "", toolCalls: [{ id: "write-1", name: "write", arguments: {} }] },
      { text: "write was not performed" },
    ]),
    [tool("write", "write", async () => {
      executions++;
      return { content: "unexpected" };
    })],
  );

  const result = await runtime.run({
    sessionId: "s8",
    systemPrompt: "system",
    prompt: "go",
    metadata: { userId: "user-a" },
    onEvent: (event) => events.push(event.type),
  });

  assert.equal(executions, 0);
  assert.equal(result.output, "write was not performed");
  assert.ok(events.includes("tool_authorization"));
  assert.match(
    result.messages.find((message) => message.role === "tool")?.content ?? "",
    /authorization denied/,
  );
});

test("resumes a pending tool checkpoint without repeating the completed model round", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  let starts = 0;
  let resumes = 0;
  const runtime = new AgentRuntime(
    {
      complete: async ({ messages }) => {
        modelCalls++;
        assert.equal(messages.at(-1)?.role, "tool");
        return { text: "recovered answer" };
      },
    },
    [tool("write", "write", async () => {
      toolCalls++;
      return { content: "write completed" };
    })],
    { authorizeTool: async () => ({ allowed: true }) },
  );

  const result = await runtime.run({
    sessionId: "resume-write",
    systemPrompt: "system",
    prompt: "create it",
    resume: {
      phase: "after_model",
      round: 1,
      nextRound: 1,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "create it" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "write-1", name: "write", arguments: {} }],
        },
      ],
      handoffs: 0,
      previousToolCallSignature: "write:{}",
      repeatedToolCallCount: 1,
      pendingToolCalls: [{ id: "write-1", name: "write", arguments: {} }],
    },
    observer: {
      onStart: () => { starts++; },
      onResume: () => { resumes++; },
    },
  });

  assert.equal(starts, 0);
  assert.equal(resumes, 1);
  assert.equal(modelCalls, 1);
  assert.equal(toolCalls, 1);
  assert.equal(result.output, "recovered answer");
  assert.equal(result.rounds, 2);
});
test("stops before side effects when a run exhausts its hard token budget", async () => {
  let executions = 0;
  let requestedOutputBudget: number | undefined;
  const events: string[] = [];
  const runtime = new AgentRuntime({
    complete: async (request) => {
      requestedOutputBudget = request.maxOutputTokens;
      return {
        text: "",
        toolCalls: [{ id: "write-budget", name: "write", arguments: {} }],
        inputTokens: 80,
        outputTokens: 20,
      };
    },
  }, [tool("write", "write", async () => {
    executions++;
    return { content: "written" };
  })], {
    maxTotalTokens: 100,
    authorizeTool: async () => ({ allowed: true }),
  });

  const result = await runtime.run({
    runId: "budget-run",
    sessionId: "budget-session",
    systemPrompt: "system",
    prompt: "go",
    onEvent: (event) => events.push(event.type),
  });

  assert.equal(requestedOutputBudget, 100);
  assert.equal(result.reason, "token_budget_exhausted");
  assert.equal(result.usage.totalTokens, 100);
  assert.equal(executions, 0);
  assert.equal(events.includes("token_budget_exhausted"), true);
});

test("destructive tool failure stops later destructive operations in the same run", async () => {
  let executions = 0;
  const destructive: AgentTool = {
    definition: {
      name: "delete_workspace_item",
      description: "delete an item",
      inputSchema: { type: "object" },
      effect: "write",
      risk: "destructive",
    },
    execute: async () => {
      executions++;
      return { content: "delete failed", isError: true };
    },
  };
  const runtime = new AgentRuntime(
    modelFrom([
      { text: "", toolCalls: [{ id: "delete-1", name: destructive.definition.name, arguments: {} }] },
      { text: "", toolCalls: [{ id: "delete-2", name: destructive.definition.name, arguments: {} }] },
      { text: "stopped safely" },
    ]),
    [destructive],
    { authorizeTool: async () => ({ allowed: true }) },
  );

  const result = await runtime.run({ sessionId: "destructive-stop", systemPrompt: "system", prompt: "delete" });
  const toolMessages = result.messages.filter((message) => message.role === "tool");
  assert.equal(executions, 1);
  assert.match(toolMessages[0]?.content ?? "", /delete failed/);
  assert.match(toolMessages[1]?.content ?? "", /destructive operation blocked after failure/);
});

test("destructive failure stop survives a persisted resume checkpoint", async () => {
  let executions = 0;
  let authorizations = 0;
  const destructive: AgentTool = {
    definition: {
      name: "remove_remote_data",
      description: "remove data",
      inputSchema: { type: "object" },
      effect: "write",
      risk: "destructive",
    },
    execute: async () => {
      executions++;
      return { content: "unexpected" };
    },
  };
  const runtime = new AgentRuntime(modelFrom([{ text: "review required" }]), [destructive], {
    authorizeTool: async () => { authorizations++; return { allowed: true }; },
  });

  const result = await runtime.run({
    sessionId: "destructive-resume",
    systemPrompt: "system",
    prompt: "continue",
    resume: {
      phase: "after_model",
      round: 1,
      nextRound: 1,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "continue" },
        { role: "assistant", content: "", toolCalls: [{ id: "remove-1", name: destructive.definition.name, arguments: {} }] },
      ],
      handoffs: 0,
      previousToolCallSignature: "remove_remote_data:{}",
      repeatedToolCallCount: 1,
      pendingToolCalls: [{ id: "remove-1", name: destructive.definition.name, arguments: {} }],
      destructiveFailureStopped: true,
    },
  });

  assert.equal(executions, 0);
  assert.equal(authorizations, 0);
  assert.match(result.messages.find((message) => message.role === "tool")?.content ?? "", /destructive operation blocked after failure/);
});
