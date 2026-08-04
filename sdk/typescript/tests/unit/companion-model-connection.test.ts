import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTool } from "../../src/index.js";
import { resolveLLM } from "../../examples/companion/llm.js";
import {
  modelConnectionEndpoint,
  normalizeCompanionModelConnection,
} from "../../examples/companion/model-connection.js";

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
    const output = await llm.chat("你是助手。", "保存这条笔记", undefined, undefined, { instruction: "保存这条笔记" });
    assert.equal(output, "已经记住。");
    assert.equal(toolRuns, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
