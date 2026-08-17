import assert from "node:assert/strict";
import test from "node:test";

import type { AgentStoredRun, AgentTool, Nemos } from "../../src/index.js";
import type { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import { resolveLLM } from "../../examples/companion/llm.js";

test("companion chat uses AgentRuntime to execute web search and answer", async () => {
  const previousKey = process.env.ZHIPU_API_KEY;
  const previousModel = process.env.ZHIPU_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.ZHIPU_API_KEY = "test-key";
  process.env.ZHIPU_MODEL = "test-model";
  let chatCalls = 0;
  let searchCalls = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/web_search")) {
      searchCalls++;
      assert.equal(init?.signal instanceof AbortSignal, true);
      return Response.json({
        search_result: [{ title: "天气", content: "晴，25°C", link: "https://example.test/weather" }],
      });
    }
    if (url.endsWith("/chat/completions")) {
      chatCalls++;
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        tools?: unknown[];
        messages: Array<{ role: string; content?: string }>;
      };
      assert.equal(body.model, "test-model");
      assert.equal(Array.isArray(body.tools), true);
      if (chatCalls === 1) {
        return Response.json({
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: "search-1",
                function: { name: "web_search", arguments: "{\"query\":\"上海今天天气\"}" },
              }],
            },
          }],
        });
      }
      assert.equal(body.messages.some((message) => message.role === "tool"), true);
      return Response.json({ choices: [{ message: { content: "上海今天晴，约 25°C。" } }] });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  try {
    const llm = resolveLLM();
    const result = await llm.chat("你是助手。", "对方：帮我查一下上海今天天气");
    assert.equal(result, "上海今天晴，约 25°C。");
    assert.equal(chatCalls, 2);
    assert.equal(searchCalls, 1);
  } finally {
    if (previousKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ZHIPU_MODEL;
    else process.env.ZHIPU_MODEL = previousModel;
    globalThis.fetch = previousFetch;
  }
});

test("companion stream reuses AgentRuntime and emits tool status events", async () => {
  const previousKey = process.env.ZHIPU_API_KEY;
  const previousModel = process.env.ZHIPU_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.ZHIPU_API_KEY = "test-key";
  process.env.ZHIPU_MODEL = "test-model";
  let chatCalls = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/web_search")) {
      return Response.json({
        search_result: [{ title: "天气", content: "晴", link: "https://example.test/weather" }],
      });
    }
    if (url.endsWith("/chat/completions")) {
      chatCalls++;
      const events = chatCalls === 1
        ? [
            { choices: [{ delta: { tool_calls: [{
              index: 0,
              id: "search-1",
              function: { name: "web_search", arguments: "{\"query\":\"上海今天天气\"}" },
            }] } }] },
          ]
        : [
            { choices: [{ delta: { content: "上海今天" } }] },
            { choices: [{ delta: { content: "晴。" } }] },
          ];
      const sse = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  try {
    const llm = resolveLLM();
    assert.ok(llm.chatStream);
    const statuses: string[] = [];
    const tokens: string[] = [];
    const result = await llm.chatStream(
      "你是助手。",
      "对方：帮我查一下上海今天天气",
      { onStatus: (status) => statuses.push(status), onToken: (token) => tokens.push(token) },
    );
    assert.equal(result, "上海今天晴。");
    assert.deepEqual(tokens, ["上海今天", "晴。"]);
    assert.deepEqual(statuses, ["查询中", "整理中"]);
  } finally {
    if (previousKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ZHIPU_MODEL;
    else process.env.ZHIPU_MODEL = previousModel;
    globalThis.fetch = previousFetch;
  }
});

test("product layer can add request-scoped write tools and authorize them in Companion AgentRuntime", async () => {
  const previousKey = process.env.ZHIPU_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ZHIPU_API_KEY = "test-key";
  let chatCalls = 0;
  let toolCalls = 0;
  let authorizationCalls = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.endsWith("/chat/completions")) throw new Error(`unexpected URL: ${url}`);
    chatCalls++;
    const body = JSON.parse(String(init?.body)) as {
      tools?: Array<{ function?: { name?: string } }>;
      messages: Array<{ role: string }>;
    };
    assert.equal(body.tools?.some((tool) => tool.function?.name === "product_lookup"), true);
    if (chatCalls === 1) {
      return Response.json({
        choices: [{ message: { content: "", tool_calls: [{
          id: "product-1",
          function: { name: "product_lookup", arguments: "{\"id\":\"42\"}" },
        }] } }],
      });
    }
    assert.equal(body.messages.some((message) => message.role === "tool"), true);
    return Response.json({ choices: [{ message: { content: "工具已执行。" } }] });
  };

  try {
    const productTool: AgentTool = {
      definition: {
        name: "product_lookup",
        description: "lookup",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
        effect: "write",
      },
      execute: async () => {
        toolCalls++;
        return { content: "record 42" };
      },
    };
    const llm = resolveLLM();
    let receivedInstruction = "";
    let receivedPersonaId = "";
    let observedRunId = "";
    let observedSessionId = "";
    let observedSurface = "";
    llm.configureAgentObserver({ onStart: (input) => {
      observedRunId = input.runId ?? "";
      observedSessionId = input.sessionId;
      observedSurface = input.metadata?.surface ?? "";
    } });
    llm.configureAgentAuthorizer(async () => {
      authorizationCalls++;
      return { allowed: true };
    });
    llm.configureAgentTools((instruction, context) => {
      receivedInstruction = instruction;
      receivedPersonaId = context?.personaId ?? "";
      return [productTool];
    });
    const result = await llm.chat(
      "你是助手。",
      "包含历史的完整消息",
      undefined,
      undefined,
      {
        runId: "orchestration/task-a/run-1",
        sessionId: "conv:user-a:persona-a",
        userId: "user-a",
        personaId: "persona-a",
        instruction: "执行产品工具",
        scope: "conv:user-a:persona-a",
        memoryScopes: ["conv:user-a:persona-a"],
        mode: "chat",
        surface: "capability",
      },
    );
    assert.equal(result, "工具已执行。");
    assert.equal(toolCalls, 1);
    assert.equal(authorizationCalls, 1);
    assert.equal(receivedInstruction, "执行产品工具");
    assert.equal(receivedPersonaId, "persona-a");
    assert.equal(observedRunId, "orchestration/task-a/run-1");
    assert.equal(observedSessionId, "conv:user-a:persona-a");
    assert.equal(observedSurface, "capability");
  } finally {
    if (previousKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});

test("Companion rebuilds request tools and resumes a persisted Agent checkpoint", async () => {
  const previousKey = process.env.ZHIPU_API_KEY;
  const previousModel = process.env.ZHIPU_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.ZHIPU_API_KEY = "test-key";
  process.env.ZHIPU_MODEL = "test-model";
  let executions = 0;
  let resumes = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.endsWith("/chat/completions")) throw new Error("unexpected URL: " + url);
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string }> };
    assert.equal(body.messages.some((message) => message.role === "tool"), true);
    return Response.json({ choices: [{ message: { content: "恢复完成。" } }] });
  };

  try {
    const call = { id: "resume-product", name: "product_write", arguments: { id: "42" } };
    const checkpoint = {
      phase: "after_model" as const,
      round: 1,
      nextRound: 1,
      messages: [
        { role: "system" as const, content: "你是助手。" },
        { role: "user" as const, content: "执行产品工具" },
        { role: "assistant" as const, content: "", toolCalls: [call] },
      ],
      handoffs: 0,
      previousToolCallSignature: "product_write",
      repeatedToolCallCount: 1,
      pendingToolCalls: [call],
    };
    const run: AgentStoredRun = {
      runId: "persisted-agent-run",
      sessionId: "conv:1on1:user-a:persona-a",
      status: "interrupted",
      startedAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:01.000Z",
      resumeCount: 0,
      systemPrompt: "你是助手。",
      prompt: "执行产品工具",
      metadata: {
        userId: "user-a",
        personaId: "persona-a",
        scope: "conv:1on1:user-a:persona-a",
        mode: "chat",
        surface: "capability",
        memoryScopes: "[\"conv:1on1:user-a:persona-a\"]",
        model: "test-model",
        maxTokens: "800",
        maxRounds: "4",
        maxToolRounds: "2",
        maxOutputChars: "3200",
      },
      rounds: 1,
      handoffs: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0 },
      output: "",
      messages: checkpoint.messages,
      events: [],
    };
    const tool: AgentTool = {
      definition: {
        name: "product_write",
        description: "write product",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
        effect: "write",
      },
      execute: async () => {
        executions++;
        return { content: "record 42" };
      },
    };

    const llm = resolveLLM();
    llm.configureAgentTools((_instruction, context) => {
      assert.equal(context?.personaId, "persona-a");
      assert.deepEqual(context?.memoryScopes, ["conv:1on1:user-a:persona-a"]);
      assert.equal(context?.surface, "capability");
      return [tool];
    });
    llm.configureAgentAuthorizer(async () => ({ allowed: true }));
    llm.configureAgentObserver({ onResume: () => { resumes++; } });
    assert.ok(llm.resumeAgentRun);
    const output = await llm.resumeAgentRun(run, checkpoint);

    assert.equal(output, "恢复完成。");
    assert.equal(executions, 1);
    assert.equal(resumes, 1);
  } finally {
    if (previousKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ZHIPU_MODEL;
    else process.env.ZHIPU_MODEL = previousModel;
    globalThis.fetch = previousFetch;
  }
});
test("Skill installation uses the Companion approval gateway before changing local state", async () => {
  const previousKey = process.env.ZHIPU_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ZHIPU_API_KEY = "test-key";
  let chatCalls = 0;
  let approvals = 0;
  const installed: Array<Record<string, unknown>> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.endsWith("/chat/completions")) throw new Error("unexpected URL: " + url);
    chatCalls++;
    const body = JSON.parse(String(init?.body)) as {
      tools?: Array<{ function?: { name?: string } }>;
      messages: Array<{ role: string }>;
    };
    assert.equal(body.tools?.some((tool) => tool.function?.name === "skill_install"), true);
    if (chatCalls === 1) {
      return Response.json({
        choices: [{ message: { content: "", tool_calls: [{
          id: "skill-install-1",
          function: {
            name: "skill_install",
            arguments: JSON.stringify({
              sourceUrl: "https://example.test/SKILL.md",
              format: "md",
            }),
          },
        }] } }],
      });
    }
    assert.equal(body.messages.some((message) => message.role === "tool"), true);
    return Response.json({ choices: [{ message: { content: "Skill 已安装并可以使用。" } }] });
  };

  try {
    const capabilities = {
      installSkill: (input: Record<string, unknown>) => {
        installed.push(input);
        return {
          id: "skill-1",
          name: "Test Skill",
          description: "Test",
          defaultFormat: "md",
        };
      },
      snapshot: () => ({
        abilities: [],
        tasks: [],
        artifacts: [],
        skillAudit: { items: [{ abilityId: "skill-1", skillFile: "C:\\\\skills\\\\test\\\\SKILL.md" }] },
      }),
    };
    const llm = resolveLLM();
    llm.configureAgentTools(createCompanionAgentToolProvider({
      memory: () => ({} as Nemos),
      capabilities: () => capabilities as unknown as CapabilityRuntime,
      fetchSkillSource: async () => "# Test Skill\\n\\nDo the work.",
    }));
    llm.configureAgentAuthorizer(async (input) => {
      approvals++;
      assert.equal(input.call.name, "skill_install");
      assert.equal(installed.length, 0);
      return { allowed: true };
    });

    const output = await llm.chat(
      "你是小丑鱼。",
      "帮我安装这个 Skill：https://example.test/SKILL.md",
      undefined,
      undefined,
      {
        sessionId: "conv:1on1:user-a:clownfish",
        userId: "user-a",
        personaId: "clownfish",
        instruction: "帮我安装这个 Skill：https://example.test/SKILL.md",
        scope: "conv:1on1:user-a:clownfish",
        memoryScopes: ["conv:1on1:user-a:clownfish"],
        mode: "chat",
      },
    );

    assert.equal(output, "Skill 已安装并可以使用。");
    assert.equal(approvals, 1);
    assert.equal(installed.length, 1);
    assert.equal(installed[0]?.personaId, "clownfish");
  } finally {
    if (previousKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});
