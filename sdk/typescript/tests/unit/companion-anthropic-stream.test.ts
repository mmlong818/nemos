import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentRuntime, type AgentTool } from "../../src/agent/index.js";
import { makeAnthropicMessagesAgentModel, readAnthropicMessageStream } from "../../examples/companion/anthropic-messages.js";
import { makeConnectionAgentModel } from "../../examples/companion/llm.js";
import { FileLlmCallLedger } from "../../examples/companion/llm-call-ledger.js";
import { ensureConnectionRevision, normalizeCompanionModelConnection } from "../../examples/companion/model-connection.js";

const start = { type: "message_start", message: { type: "message", id: "msg-fixture", role: "assistant", content: [], model: "claude-fixture", stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, cache_creation_input_tokens: 3, cache_read_input_tokens: 4, output_tokens: 1 } } };
const event = (type: string, data: Record<string, unknown> = { type }) => `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const finish = (reason = "end_turn", outputTokens = 4) => event("message_delta", { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: outputTokens } }) + event("message_stop");

function streamed(text: string, cuts: number[] = []): Response {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const cut of cuts) { chunks.push(bytes.slice(offset, cut)); offset = cut; }
  chunks.push(bytes.slice(offset));
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function textStream(value: string): Response {
  return streamed(event("message_start", start)
    + event("ping")
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
    + event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: value.slice(0, 2) } })
    + event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: value.slice(2) } })
    + event("content_block_stop", { type: "content_block_stop", index: 0 })
    + finish("end_turn", 4), [1, 7, 41, 109]);
}

function toolStream(): Response {
  return streamed(event("message_start", start)
    + event("future_safe_event", { type: "future_safe_event", extra: true })
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "read_fixture", input: {} } })
    + event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"value\":" } })
    + event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "7}" } })
    + event("content_block_stop", { type: "content_block_stop", index: 0 })
    + finish("tool_use", 6), [3, 63, 151, 277]);
}

test("Anthropic SSE parser handles fragmented CRLF, multiline data, ping, text deltas, usage and finish", async () => {
  const multiLineDelta = "event: content_block_delta\r\ndata: {\"type\":\"content_block_delta\",\r\ndata: \"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"好\"}}\r\n\r\n";
  const response = streamed(event("message_start", start)
    + event("ping")
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "你" } })
    + multiLineDelta
    + event("content_block_stop", { type: "content_block_stop", index: 0 })
    + finish("end_turn", 9), [2, 5, 17, 83, 190]);
  const deltas: string[] = [];
  const result = await readAnthropicMessageStream(response, (delta) => deltas.push(delta));
  assert.deepEqual(deltas, ["你", "好"]);
  assert.deepEqual(result, { text: "你好", toolCalls: [], stopReason: "end_turn", inputTokens: 18, outputTokens: 9 });
});

test("Anthropic SSE parser assembles tool JSON by block and ignores unknown future top-level events", async () => {
  const result = await readAnthropicMessageStream(toolStream());
  assert.equal(result.text, "");
  assert.deepEqual(result.toolCalls, [{ id: "tool-1", name: "read_fixture", arguments: { value: 7 } }]);
  assert.equal(result.stopReason, "tool_use");
  assert.equal(result.inputTokens, 18);
  assert.equal(result.outputTokens, 6);
});

test("Anthropic SSE completes ordered text and tool blocks in one message", async () => {
  const mixed = event("message_start", start)
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "先" } })
    + event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "查" } })
    + event("content_block_stop", { type: "content_block_stop", index: 0 })
    + event("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-mixed", name: "lookup", input: {} } })
    + event("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"id":' } })
    + event("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "9}" } })
    + event("content_block_stop", { type: "content_block_stop", index: 1 })
    + finish("tool_use", 7);
  const deltas: string[] = [];
  const result = await readAnthropicMessageStream(streamed(mixed), (delta) => deltas.push(delta));
  assert.equal(result.text, "先查"); assert.deepEqual(deltas, ["先", "查"]);
  assert.deepEqual(result.toolCalls, [{ id: "tool-mixed", name: "lookup", arguments: { id: 9 } }]);
});

test("known Anthropic events fail closed on provider error, invalid sequence, incomplete JSON and early EOF", async () => {
  const secret = "provider-secret-body";
  await assert.rejects(readAnthropicMessageStream(streamed(event("message_start", start) + event("error", { type: "error", error: { message: secret } }))), (error: unknown) => {
    assert.ok(error instanceof Error); assert.match(error.message, /事件流返回错误/); assert.doesNotMatch(error.message, new RegExp(secret)); return true;
  });
  await assert.rejects(readAnthropicMessageStream(streamed(event("content_block_stop", { type: "content_block_stop", index: 0 }))), /事件顺序无效/);
  const skippedIndex = event("message_start", start) + event("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  await assert.rejects(readAnthropicMessageStream(streamed(skippedIndex)), /content_block_start 无效/);
  const overlappingBlocks = event("message_start", start)
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
    + event("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  await assert.rejects(readAnthropicMessageStream(streamed(overlappingBlocks)), /content_block_start 无效/);
  const deltaBeforeBlockStop = event("message_start", start)
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "x" } })
    + finish();
  await assert.rejects(readAnthropicMessageStream(streamed(deltaBeforeBlockStop)), /message_delta 无效/);
  await assert.rejects(readAnthropicMessageStream(streamed(event("message_start", start) + event("message_stop"))), /message_stop 提前到达/);
  const unsupportedDelta = event("message_start", start)
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
    + event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "future_delta", value: secret } });
  await assert.rejects(readAnthropicMessageStream(streamed(unsupportedDelta)), (error: unknown) => {
    assert.ok(error instanceof Error); assert.match(error.message, /增量类型未启用/); assert.doesNotMatch(error.message, new RegExp(secret)); return true;
  });
  const incomplete = event("message_start", start)
    + event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "read_fixture", input: {} } })
    + event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"value\":" } })
    + event("content_block_stop", { type: "content_block_stop", index: 0 }) + finish("tool_use", 2);
  await assert.rejects(readAnthropicMessageStream(streamed(incomplete)), /不是完整 JSON/);
  await assert.rejects(readAnthropicMessageStream(streamed(event("message_start", start))), /提前断开/);
});

test("Anthropic streaming adapter requests SSE and drives the existing AgentRuntime tool round trip", async () => {
  const original = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; bodies.push(body);
    assert.equal(body.stream, true);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "fixture-key"); assert.equal(headers.Authorization, undefined);
    return bodies.length === 1 ? toolStream() : textStream("完成");
  };
  const tool: AgentTool = {
    definition: { name: "read_fixture", description: "fixture", inputSchema: { type: "object" }, effect: "read" },
    execute: async (args) => ({ content: `result-${args.value}` }),
  };
  try {
    const model = makeAnthropicMessagesAgentModel({
      connection: normalizeCompanionModelConnection({ provider: "anthropic", apiKey: "fixture-key", model: "claude-fixture" }),
      model: "claude-fixture", maxTokens: 100, temperature: 0, stream: true,
    });
    const deltas: string[] = [];
    const result = await new AgentRuntime(model, [tool]).run({ sessionId: "anthropic-stream", systemPrompt: "system", prompt: "run", onTextDelta: (delta) => deltas.push(delta) });
    assert.equal(result.output, "完成");
    assert.equal(result.rounds, 2);
    assert.deepEqual(deltas, ["完成"]);
    assert.equal(bodies.length, 2);
    assert.equal((bodies[0].tools as Array<Record<string, unknown>>)[0].name, "read_fixture");
    const followup = bodies[1].messages as Array<{ role: string; content: unknown }>;
    assert.ok(followup.some((message) => message.role === "user" && Array.isArray(message.content)
      && (message.content as Array<{ type?: string; content?: string }>).some((item) => item.type === "tool_result" && item.content === "result-7")));
  } finally { globalThis.fetch = original; }
});

test("Anthropic non-stream fallback remains JSON and abort propagates without a retry", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      requests++;
      const body = JSON.parse(String(init?.body)); assert.equal(body.stream, undefined);
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-api-key"], "fixture-key"); assert.equal(headers.Authorization, undefined);
      return Response.json({ content: [{ type: "text", text: "buffered" }], stop_reason: "end_turn", usage: { input_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4, output_tokens: 1 } });
    };
    const options = { connection: normalizeCompanionModelConnection({ provider: "anthropic", apiKey: "fixture-key", model: "fixture" }), model: "fixture", maxTokens: 20, temperature: 0 };
    const deltas: string[] = [];
    const result = await makeAnthropicMessagesAgentModel({ ...options, stream: false }).complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal, onTextDelta: (delta) => deltas.push(delta) });
    assert.equal(result.text, "buffered"); assert.equal(result.inputTokens, 9); assert.deepEqual(deltas, ["buffered"]);

    globalThis.fetch = (_url, init) => { requests++; return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })); };
    const controller = new AbortController();
    const pending = makeAnthropicMessagesAgentModel({ ...options, stream: true }).complete({ messages: [], tools: [], signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; }
});

test("abort after receiving an Anthropic SSE response propagates and always cancels and releases its reader", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let cancelled = false, released = false, notifyReading!: () => void;
  const reading = new Promise<void>((resolve) => { notifyReading = resolve; });
  const first = new TextEncoder().encode(event("message_start", start));
  let reads = 0;
  const reader = {
    read: async () => {
      if (reads++ === 0) return { done: false, value: first };
      notifyReading();
      return new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new DOMException("aborted-after-response", "AbortError")), { once: true }));
    },
    cancel: async () => { cancelled = true; },
    releaseLock: () => { released = true; },
  };
  const response = { ok: true, headers: new Headers({ "content-type": "text/event-stream" }), body: { getReader: () => reader } } as unknown as Response;
  try {
    globalThis.fetch = async () => response;
    const model = makeAnthropicMessagesAgentModel({ connection: normalizeCompanionModelConnection({ provider: "anthropic", apiKey: "fixture-key", model: "fixture" }), model: "fixture", maxTokens: 20, temperature: 0, stream: true });
    const pending = model.complete({ messages: [], tools: [], signal: controller.signal });
    await reading; controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError" && error.message === "aborted-after-response");
    assert.equal(cancelled, true); assert.equal(released, true);
  } finally { globalThis.fetch = original; }
});

test("Anthropic cache usage reaches AgentRuntime and the existing call ledger", async () => {
  const original = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "anthropic-ledger-"));
  try {
    globalThis.fetch = async () => textStream("done");
    const ledger = new FileLlmCallLedger(join(dir, "calls.json"));
    const model = makeConnectionAgentModel({
      connection: normalizeCompanionModelConnection({ provider: "anthropic", apiKey: "fixture-key", model: "fixture" }),
      model: "fixture", maxTokens: 20, temperature: 0, stream: true, runId: "task-cache", purpose: "task_turn", ledger,
    });
    const result = await new AgentRuntime(model, []).run({ runId: "task-cache", sessionId: "cache", systemPrompt: "system", prompt: "go" });
    assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 4, totalTokens: 22, modelCalls: 1 });
    assert.deepEqual(ledger.list({ runId: "task-cache" })[0]?.usage, { reported: true, inputTokens: 18, outputTokens: 4, totalTokens: 22 });
  } finally { globalThis.fetch = original; rmSync(dir, { recursive: true, force: true }); }
});

test("legacy Anthropic buffered readiness remains on JSON until an explicit recheck", async () => {
  const original = globalThis.fetch;
  const connection = ensureConnectionRevision(normalizeCompanionModelConnection({ provider: "anthropic", apiKey: "fixture-key", model: "fixture" }));
  connection.modelChecks = { fixture: {
    connectionRevision: connection.connectionRevision, checkedAt: new Date().toISOString(), transport: "anthropic-messages",
    chat: "passed", streaming: "buffered", tools: "passed", detail: "legacy fixture",
  } };
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); assert.equal(body.stream, undefined);
      return Response.json({ content: [{ type: "text", text: "legacy-json" }], stop_reason: "end_turn" });
    };
    const result = await makeConnectionAgentModel({ connection, model: "fixture", maxTokens: 20, temperature: 0, stream: true })
      .complete({ messages: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal });
    assert.equal(result.text, "legacy-json");
  } finally { globalThis.fetch = original; }
});
