import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRuntime } from "../../src/agent/runtime.js";
import { FileAgentRunStore } from "../../src/agent/run-store.js";
import type { AgentTool, AgentMessage, AgentRunCheckpoint } from "../../src/agent/types.js";
import { makeConnectionAgentModel } from "../../examples/companion/llm.js";
import { normalizeCompanionModelConnection, usesOpenAIResponses } from "../../examples/companion/model-connection.js";
import { checkCompanionModel } from "../../examples/companion/model-readiness.js";

const connection = normalizeCompanionModelConnection({ provider: "openai", model: "gpt-6-astra", apiKey: "fixture-key" });
const tool: AgentTool = { definition: { name: "clownfish_connection_probe", description: "synthetic", effect: "read",
  inputSchema: { type: "object", properties: { value: { type: "integer" } }, required: ["value"] } },
  execute: async () => ({ content: "synthetic-receipt" }) };
const reasoning = { type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-fixture" };
const call = { type: "function_call", id: "fc_fixture", call_id: "call_fixture", name: tool.definition.name, arguments: '{"value":7}', status: "completed" };
const message = (text: string) => ({ type: "message", id: "msg_fixture", role: "assistant", status: "completed", phase: "final_answer", content: [{ type: "output_text", text, annotations: [] }] });
const response = (output: any[]) => ({ status: "completed", output, usage: { input_tokens: 10, output_tokens: 5 } });
const model = (stream = false) => makeConnectionAgentModel({ connection, model: connection.model, stream, maxTokens: 1024, temperature: 0 });
async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch; globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}
function eventStream(events: any[], terminalNewline = true): Response {
  const bytes = new TextEncoder().encode(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}`).join("\r\n\r\n") + (terminalNewline ? "\r\n\r\n" : ""));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    // Deliberately split CRLF, JSON and multi-byte Chinese text across chunks.
    controller.enqueue(bytes.slice(offset, offset += Math.min(7, bytes.length - offset)));
  } }), { headers: { "content-type": "text/event-stream" } });
}
function reply(body: any): Response {
  const last = body.input.at(-1);
  const text = last.type === "function_call_output" ? last.output : "OK";
  const data = response(body.tools?.length && last.type !== "function_call_output" ? [reasoning, call] : [message(text)]);
  return body.stream ? eventStream([
    ...(body.tools?.length ? [{ type: "response.function_call_arguments.delta", delta: '{"value":' }] : [{ type: "response.output_text.delta", delta: text }]),
    { type: "response.completed", response: data },
  ]) : Response.json(data);
}

test("Astra and its snapshots route to Responses; unrelated providers and models do not change", () => {
  assert.equal(usesOpenAIResponses(connection), true);
  assert.equal(usesOpenAIResponses({ ...connection, model: "gpt-6-astra-2026-09-01" }), true);
  assert.equal(usesOpenAIResponses({ ...connection, model: "gpt-5.6-sol" }), false);
  assert.equal(usesOpenAIResponses({ ...connection, model: "gpt-6-astralis" }), false);
  assert.equal(usesOpenAIResponses({ ...connection, provider: "custom" }), false);
  assert.equal(normalizeCompanionModelConnection({ ...connection, baseUrl: "https://api.openai.com/v1/responses/" }).baseUrl, "https://api.openai.com/v1");
});

test("Responses maps token budget, optional tools and stateless privacy without changing model", async () => {
  await withFetch(async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6-astra"); assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 27); assert.equal(body.tools[0].strict, false);
    assert.deepEqual(body.tools[0].parameters, tool.definition.inputSchema);
    for (const key of ["temperature", "max_tokens", "max_completion_tokens", "previous_response_id"]) assert.equal(body[key], undefined);
    assert.equal(init?.redirect, "error");
    return reply(body);
  }, async () => {
    const result = await model().complete({ messages: [{ role: "user", content: "synthetic" }], tools: [tool.definition], maxOutputTokens: 27, signal: new AbortController().signal });
    assert.equal(result.toolCalls?.[0]?.arguments.value, 7);
    assert.equal(result.inputTokens, 10); assert.equal(result.outputTokens, 5);
  });
});

test("actual readiness runs four Responses calls and replays encrypted reasoning with exact tool receipt", async () => {
  const bodies: any[] = [];
  await withFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    if (bodies.length === 4) {
      assert.deepEqual(body.input[1], reasoning);
      assert.deepEqual(body.input[2], call);
      assert.equal(body.input.at(-1).type, "function_call_output");
      assert.equal(body.input.at(-1).call_id, "call_fixture");
    }
    return reply(body);
  }, async () => {
    const check = await checkCompanionModel(connection);
    assert.equal(check.chat, "passed"); assert.equal(check.streaming, "passed"); assert.equal(check.tools, "passed");
    assert.equal(bodies.length, 4); assert.ok(bodies.every((body) => body.max_output_tokens === 1024));
  });
});

test("AgentRuntime executes one harmless tool then returns its actual receipt with continuation state", async () => {
  let executed = 0; let requests = 0; let checkpoint: AgentRunCheckpoint | undefined;
  await withFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests++;
    if (requests === 2) assert.deepEqual(body.input.find((item: any) => item.type === "reasoning"), reasoning);
    return reply(body);
  }, async () => {
    const runtime = new AgentRuntime(model(), [{ ...tool, execute: async () => { executed++; return { content: "actual-receipt-42" }; } }], { maxRounds: 2, maxToolRounds: 1 });
    const result = await runtime.run({ sessionId: "fixture", systemPrompt: "fixture", prompt: "call synthetic",
      observer: { onCheckpoint: (_id, next) => { if (next.phase === "after_tools") checkpoint = structuredClone(next); } } });
    assert.equal(result.output, "actual-receipt-42"); assert.equal(result.reason, "completed");
    assert.equal(executed, 1); assert.equal(requests, 2); assert.equal(result.usage.totalTokens, 30);
    assert.equal(checkpoint?.messages.find((item) => item.role === "assistant")?.providerState?.format, "openai-responses");
    // A fresh adapter has no hidden mutable session state; checkpoint replay suffices.
    const resumed = await new AgentRuntime(model(), [], { maxRounds: 2 }).run({ sessionId: "fixture", systemPrompt: "fixture", prompt: "", resume: checkpoint });
    assert.equal(resumed.output, "actual-receipt-42"); assert.equal(executed, 1);
  });
});

test("Responses streaming uses terminal canonical output without duplicated deltas", async () => {
  const deltas: string[] = [];
  await withFetch(async () => eventStream([
    { type: "response.output_text.delta", delta: "你好" }, { type: "response.output_text.delta", delta: "世界" },
    { type: "response.completed", response: response([message("你好世界")]) },
  ], false), async () => {
    const result = await model(true).complete({ messages: [], tools: [], signal: new AbortController().signal, onTextDelta: (text) => deltas.push(text) });
    assert.equal(result.text, "你好世界"); assert.equal(deltas.join(""), "你好世界"); assert.equal(result.outputTokens, 5);
  });
});

test("provider state survives disk checkpoint reload and receives the same secret redaction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "responses-store-fixture-"));
  const path = join(dir, "runs.jsonl");
  try {
    const store = new FileAgentRunStore(path);
    await withFetch(async () => Response.json(response([reasoning, message("sk-fixtureSecret123456789")])), async () => {
      await new AgentRuntime(model(), []).run({ runId: "persisted", sessionId: "fixture", systemPrompt: "", prompt: "fixture", observer: store });
    });
    const raw = readFileSync(path, "utf8");
    assert.doesNotMatch(raw, /sk-fixtureSecret123456789/);
    assert.match(raw, /opaque-fixture/);
    assert.match(raw, /openai-responses/);
    store.onStart({ runId: "encoded", sessionId: "fixture", systemPrompt: "", prompt: "" }, [{
      role: "assistant", content: "", providerState: { format: "openai-responses", model: connection.model,
        endpoint: "https://api.openai.com/v1/responses", output: [{ ...call, arguments: JSON.stringify({ password: "secretEncodedPassword" }) }] },
    }]);
    assert.doesNotMatch(readFileSync(path, "utf8"), /secretEncodedPassword/);
    const reloaded = new FileAgentRunStore(path);
    assert.equal(reloaded.list().find((run) => run.runId === "persisted")?.status, "completed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const status of ["incomplete", "failed"]) test(`${status} Responses never executes a pending tool`, async () => {
  let executions = 0;
  await withFetch(async () => Response.json({ ...response([call]), status }), async () => {
    const runtime = new AgentRuntime(model(), [{ ...tool, execute: async () => { executions++; return { content: "bad" }; } }]);
    await assert.rejects(runtime.run({ sessionId: "fixture", systemPrompt: "", prompt: "fixture" }), /未.*完成/);
    assert.equal(executions, 0);
  });
});

test("truncated or error SSE is a failure, never a successful partial answer/tool", async () => {
  for (const events of [
    [{ type: "response.output_text.delta", delta: "partial" }],
    [{ type: "response.function_call_arguments.delta", delta: '{"value":7}' }],
    [{ type: "error", message: "sk-private-provider-fixture" }],
    [{ type: "response.incomplete", response: response([call]) }],
  ]) await withFetch(async () => eventStream(events), async () => {
    await assert.rejects(model(true).complete({ messages: [], tools: [tool.definition], signal: new AbortController().signal }), (error: Error) => {
      assert.doesNotMatch(error.message, /private-provider/); return true;
    });
  });
});

test("malformed arguments, duplicate IDs and unknown hosted tool output are rejected", async () => {
  for (const output of [[{ ...call, arguments: "{" }], [{ ...call, arguments: "[]" }], [call, call], [{ type: "web_search_call" }]]) {
    await withFetch(async () => Response.json(response(output)), async () => {
      await assert.rejects(model().complete({ messages: [], tools: [tool.definition], signal: new AbortController().signal }));
    });
  }
});

test("provider continuation is isolated to the exact endpoint and model", async () => {
  const assistant: AgentMessage = { role: "assistant", content: "public answer", toolCalls: [], providerState: {
    format: "openai-responses", model: "other-model", endpoint: "https://elsewhere.example/v1/responses", output: [reasoning],
  } };
  await withFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); assert.doesNotMatch(JSON.stringify(body), /opaque-fixture/);
    return Response.json(response([message("OK")]));
  }, async () => { await model().complete({ messages: [assistant], tools: [], signal: new AbortController().signal }); });
});

test("HTTP failures stay sanitized and retain the useful status in readiness detail", async () => {
  let count = 0;
  await withFetch(async (_url, init) => {
    count++;
    const body = JSON.parse(String(init?.body));
    return body.tools?.length ? new Response("sk-secret-provider-body", { status: 400 }) : reply(body);
  }, async () => {
    const check = await checkCompanionModel(connection);
    assert.equal(check.chat, "passed"); assert.equal(check.tools, "failed"); assert.match(check.detail, /HTTP 400/);
    assert.doesNotMatch(check.detail, /secret/); assert.equal(count, 3);
  });
});

test("aborting a response stream cancels it without accepting partial tool data", async () => {
  let cancelled = false;
  await withFetch(async (_url, init) => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
  }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } }), async () => {
    const controller = new AbortController();
    const pending = model(true).complete({ messages: [], tools: [], signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(pending, /Aborted/);
    // Errored streams do not call underlying cancel; reader cleanup must still settle.
    assert.equal(cancelled, false);
  });
});
