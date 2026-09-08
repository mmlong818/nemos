import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTool } from "../../src/index.js";
import { resolveLLM } from "../../examples/companion/llm.js";
import {
  dailyChatModelForConnection,
  ensureConnectionRevision,
  fetchCompanionModelCatalog,
  isModelCheckEligible,
  modelConnectionEndpoint,
  normalizeCompanionModelConnection,
  selectCompanionConversationModel,
  withConnectionRevision,
} from "../../examples/companion/model-connection.js";

test("model catalog fetch uses provider authentication and puts the newest chat model first", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/models");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-key");
    return Response.json({ data: [
      { id: "gpt-5.5", created: 100 },
      { id: "text-embedding-4", created: 400 },
      { id: "gpt-5.7", created: 300 },
      { id: "gpt-5.6", created: 200 },
    ] });
  };
  try {
    const models = await fetchCompanionModelCatalog(normalizeCompanionModelConnection({
      provider: "openai",
      apiKey: "test-key",
    }));
  assert.deepEqual(models.map((item) => item.id), ["text-embedding-4", "gpt-5.7", "gpt-5.6", "gpt-5.5"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Anthropic model catalog uses its native headers and parses creation dates", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/models?limit=1000");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "anthropic-test-key");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    return Response.json({ data: [
      { id: "claude-old", created_at: "2025-01-01T00:00:00Z" },
      { id: "claude-new", created_at: "2026-01-01T00:00:00Z", display_name: "Claude New" },
    ] });
  };
  try {
    const models = await fetchCompanionModelCatalog(normalizeCompanionModelConnection({
      provider: "anthropic",
      apiKey: "anthropic-test-key",
    }));
    assert.equal(models[0]?.id, "claude-new");
    assert.equal(models[0]?.displayName, "Claude New");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("model connection applies provider presets and protects remote transport", () => {
  const connection = normalizeCompanionModelConnection({
    provider: "deepseek",
    apiKey: "test-key",
  });
  assert.equal(connection.protocol, "openai-compatible");
  assert.equal(connection.baseUrl, "https://api.deepseek.com");
  assert.equal(connection.model, "deepseek-v4-pro");
  assert.equal(modelConnectionEndpoint(connection), "https://api.deepseek.com/chat/completions");

  assert.throws(() => normalizeCompanionModelConnection({
    provider: "custom",
    baseUrl: "http://example.com/v1",
    model: "test-model",
  }), /远程 API 必须使用 HTTPS/);
  assert.throws(() => normalizeCompanionModelConnection({ provider: "unknown-provider" as never }), /不支持的模型服务商/);
});

test("connection revisions preserve favourites but never reuse checks after an endpoint or credential change", () => {
  const original = ensureConnectionRevision(normalizeCompanionModelConnection({
    provider: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "any/model:id", favoriteModels: ["any/model:id", "  pinned  ", "pinned"],
  }));
  const checked = {
    ...original,
    modelChecks: { "any/model:id": { connectionRevision: original.connectionRevision, checkedAt: new Date().toISOString(), chat: "passed" as const, streaming: "passed" as const, tools: "passed" as const, detail: "fixture" } },
  };
  assert.equal(isModelCheckEligible(checked, checked.modelChecks["any/model:id"]), true);
  const unchanged = withConnectionRevision(checked, checked);
  assert.equal(unchanged.connectionRevision, checked.connectionRevision);
  assert.equal(isModelCheckEligible(unchanged, unchanged.modelChecks?.["any/model:id"]), true);
  const checkedAt = Date.parse(checked.modelChecks["any/model:id"].checkedAt);
  assert.equal(isModelCheckEligible(unchanged, unchanged.modelChecks?.["any/model:id"], "chat", checkedAt + 7 * 24 * 60 * 60 * 1000), true);
  assert.equal(isModelCheckEligible(unchanged, unchanged.modelChecks?.["any/model:id"], "chat", checkedAt + 7 * 24 * 60 * 60 * 1000 + 1), false);
  const injected = withConnectionRevision({ ...checked, modelChecks: { "any/model:id": { ...checked.modelChecks["any/model:id"], connectionRevision: "00000000-0000-0000-0000-000000000000" } } }, checked);
  assert.deepEqual(injected.modelChecks, {});
  const changed = withConnectionRevision({ ...checked, baseUrl: "http://127.0.0.1:2345/v1" }, checked);
  assert.notEqual(changed.connectionRevision, checked.connectionRevision);
  assert.deepEqual(changed.favoriteModels, ["any/model:id", "pinned"]);
  assert.deepEqual(changed.modelChecks, {});
  const rotatedKey = withConnectionRevision(checked, checked, true);
  assert.notEqual(rotatedKey.connectionRevision, checked.connectionRevision);
  assert.deepEqual(rotatedKey.modelChecks, {});
});

test("daily conversations use provider chat models while experts and explicit overrides keep the main route", () => {
  const connection = normalizeCompanionModelConnection({ provider: "zhipu", apiKey: "test-key" });
  assert.equal(dailyChatModelForConnection(connection), "glm-5.2");
  assert.equal(selectCompanionConversationModel({
    connection,
    target: { kind: "persona", id: "clownfish" },
    expertPersonaIds: new Set(["product_advisor"]),
  }), "glm-5.2");
  assert.equal(selectCompanionConversationModel({
    connection,
    target: { kind: "persona", id: "clownfish" },
    instruction: "帮我分析这份报告并生成演示文稿",
  }), undefined);
  assert.equal(selectCompanionConversationModel({
    connection,
    target: { kind: "persona", id: "clownfish" },
    instruction: "今天还在加班，有点累",
  }), "glm-5.2");
  assert.equal(selectCompanionConversationModel({
    connection,
    target: { kind: "persona", id: "clownfish" },
    forceTaskModel: true,
  }), undefined);
  assert.equal(selectCompanionConversationModel({
    connection,
    target: { kind: "persona", id: "product_advisor" },
    expertPersonaIds: new Set(["product_advisor"]),
  }), undefined);
  assert.equal(selectCompanionConversationModel({
    connection,
    requestedModel: "glm-5.2",
    target: { kind: "persona", id: "clownfish" },
  }), "glm-5.2");
  assert.equal(selectCompanionConversationModel({
    connection,
    target: { kind: "group", id: "expert_group" },
  }), undefined);
});

test("custom OpenAI-compatible connection uses its configured endpoint", async () => {
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:1234/v1/chat/completions");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, undefined);
    return Response.json({ choices: [{ message: { content: "本地模型已连接。" } }] });
  };

  try {
    const llm = resolveLLM(normalizeCompanionModelConnection({
      provider: "custom",
      protocol: "openai-compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "local-model",
      apiKey: "",
    }));
    const output = await llm.chat("你是助手。", "你好");
    assert.equal(output, "本地模型已连接。");
    assert.equal(requestBody?.model, "local-model");
    assert.equal("thinking" in (requestBody ?? {}), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Anthropic connection keeps Companion tools available", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  let toolRuns = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://api.anthropic.com/v1/messages");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "anthropic-test-key");
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: unknown }> };
    if (calls === 1) {
      return Response.json({
        content: [{ type: "tool_use", id: "tool-1", name: "remember_note", input: { text: "记住" } }],
        stop_reason: "tool_use",
      });
    }
    assert.equal(body.messages.some((message) => message.role === "user" && Array.isArray(message.content)), true);
    return Response.json({ content: [{ type: "text", text: "已经记住。" }], stop_reason: "end_turn" });
  };

  const tool: AgentTool = {
    definition: {
      name: "remember_note",
      description: "保存一条笔记",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      effect: "read",
    },
    execute: async () => {
      toolRuns++;
      return { content: "保存成功" };
    },
  };

  try {
    const llm = resolveLLM(normalizeCompanionModelConnection({
      provider: "anthropic",
      apiKey: "anthropic-test-key",
      model: "claude-sonnet-5",
    }));
    llm.configureAgentTools(() => [tool]);
    const output = await llm.chat("你是助手。", "保存这条笔记", undefined, undefined, {
      sessionId: "conv:1on1:me:clownfish",
      userId: "me",
      personaId: "clownfish",
      instruction: "保存这条笔记",
      scope: "conv:1on1:me:clownfish",
      memoryScopes: ["conv:1on1:me:clownfish"],
      mode: "chat",
    });
    assert.equal(output, "已经记住。");
    assert.equal(toolRuns, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
