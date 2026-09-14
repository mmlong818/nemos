import assert from "node:assert/strict";
import test from "node:test";
import { makeConnectionAgentModel } from "../../examples/companion/llm.js";
import { checkCompanionModel, checkSingleCompanionModel, selectCheckedCompanionModel } from "../../examples/companion/model-readiness.js";
import { CompanionModelHttpError, dailyChatModelForConnection, ensureConnectionRevision, fetchCompanionModelCatalog, normalizeCompanionModelConnection,
  sortCompanionModels, type CompanionModelCheck } from "../../examples/companion/model-connection.js";

const connection = ensureConnectionRevision(normalizeCompanionModelConnection({ provider: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "chosen" }));
const passed: CompanionModelCheck = { connectionRevision: connection.connectionRevision, checkedAt: "2026-09-06T00:00:00Z", chat: "passed", streaming: "passed", tools: "passed", detail: "fixture" };
async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

function compatibleReply(body: any, invalidArgs = false): Response {
  const last = body.messages.at(-1);
  const call = { id: "probe-call", type: "function", function: { name: "clownfish_connection_probe", arguments: invalidArgs ? "invalid-json" : '{"value":7}' } };
  const content = last.role === "tool" ? last.content : "OK";
  if (body.stream) {
    // Tool names and JSON arguments are fragmented like actual SSE responses.
    const deltas = body.tools?.length ? [
      { tool_calls: [{ index: 0, id: call.id, function: { name: "clownfish_connection_", arguments: invalidArgs ? "invalid-" : '{"value":' } }] },
      { tool_calls: [{ index: 0, function: { name: "probe", arguments: invalidArgs ? "json" : "7}" } }] },
    ] : [{ content: content.slice(0, 2) }, { content: content.slice(2) }];
    return new Response(deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\r\n\r\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }
  return Response.json({ choices: [{ message: body.tools?.length ? { content: "", tool_calls: [call] } : { content } }] });
}

test("checks actual text, fragmented streaming tools and the synthetic result round trip", async () => {
  const requests: any[] = [];
  await withFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return compatibleReply(body);
  }, async () => {
    const result = await checkCompanionModel(connection);
    assert.equal(result.chat, "passed"); assert.equal(result.streaming, "passed"); assert.equal(result.tools, "passed");
    assert.equal(requests.length, 4);
    assert.equal(requests[0].stream, undefined);
    assert.equal(requests[1].stream, true);
    assert.equal(requests[2].tools[0].function.name, "clownfish_connection_probe");
    assert.match(requests[3].messages.at(-1).content, /^probe-/);
    assert.ok(requests.every((body) => body.max_tokens === 512 && body.model === "chosen"));
  });
});

test("a JSON-only gateway falls back to buffered output and still checks tools", async () => {
  await withFetch(async (_url, init) => compatibleReply({ ...JSON.parse(String(init?.body)), stream: false }), async () => {
    const check = await checkCompanionModel(connection);
    assert.equal(check.streaming, "failed"); assert.equal(check.tools, "passed");
    const output: string[] = [];
    const model = makeConnectionAgentModel({ connection: { ...connection, modelChecks: { chosen: check } }, model: "chosen", stream: true, temperature: 0, maxTokens: 30 });
    await model.complete({ messages: [{ role: "user", content: "hello" }], tools: [], signal: new AbortController().signal, onTextDelta: (text) => output.push(text) });
    assert.deepEqual(output, ["OK"]);
  });
});

test("malformed function arguments are not counted as working tools", async () => {
  await withFetch(async (_url, init) => compatibleReply(JSON.parse(String(init?.body)), true), async () => {
    const check = await checkCompanionModel(connection);
    assert.equal(check.chat, "passed"); assert.equal(check.tools, "failed");
    const model = makeConnectionAgentModel({ connection: { ...connection, modelChecks: { chosen: check } }, model: "chosen", stream: false, temperature: 0, maxTokens: 30 });
    assert.throws(() => model.complete({ messages: [], tools: [{ name: "actual_tool", description: "", inputSchema: {} }], signal: new AbortController().signal }), /工具调用检查未通过/);
  });
});

test("inventing a final receipt does not pass the tool round trip", async () => {
  await withFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.messages.at(-1).role === "tool") body.messages.at(-1).content = "made-up-success";
    return compatibleReply(body);
  }, async () => { assert.equal((await checkCompanionModel(connection)).tools, "failed"); });
});

test("Anthropic native SSE and message/tool-result format are checked together", async () => {
  let count = 0;
  await withFetch(async (url, init) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    assert.equal((init?.headers as any)["x-api-key"], "fixture-key");
    const body = JSON.parse(String(init?.body)); count++;
    const last = body.messages.at(-1);
    const reply = Array.isArray(last.content) ? last.content[0].content : "OK";
    if (!body.stream) return Response.json({ content: [{ type: "text", text: reply }], stop_reason: "end_turn" });
    const tool = Boolean(body.tools?.length) && !Array.isArray(last.content);
    const block = tool
      ? { type: "tool_use", id: "probe-call", name: "clownfish_connection_probe", input: {} }
      : { type: "text", text: "" };
    const delta = tool
      ? { type: "input_json_delta", partial_json: '{"value":7}' }
      : { type: "text_delta", text: reply };
    const stopReason = tool ? "tool_use" : "end_turn";
    const sse = [
      { type: "message_start", message: { type: "message", id: `msg-${count}`, role: "assistant", content: [], model: "chosen", stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: block },
      { type: "content_block_delta", index: 0, delta },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ].map((item) => `event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`).join("");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  }, async () => {
    const check = await checkCompanionModel(normalizeCompanionModelConnection({ provider: "anthropic", apiKey: "fixture-key", model: "chosen" }));
    assert.equal(check.tools, "passed"); assert.equal(check.streaming, "passed"); assert.equal(count, 4);
  });
});

test("Anthropic JSON-only gateway is recorded as streaming failed and tools fall back without a paid retry", async () => {
  const streams: boolean[] = [];
  await withFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); streams.push(Boolean(body.stream));
    const last = body.messages.at(-1);
    if (body.tools?.length && !Array.isArray(last.content)) {
      return Response.json({ content: [{ type: "tool_use", id: "probe-call", name: "clownfish_connection_probe", input: { value: 7 } }], stop_reason: "tool_use" });
    }
    return Response.json({ content: [{ type: "text", text: Array.isArray(last.content) ? last.content[0].content : "OK" }], stop_reason: "end_turn" });
  }, async () => {
    const check = await checkCompanionModel(normalizeCompanionModelConnection({ provider: "anthropic", apiKey: "fixture-key", model: "chosen" }));
    assert.equal(check.chat, "passed"); assert.equal(check.streaming, "failed"); assert.equal(check.tools, "passed");
    assert.deepEqual(streams, [false, true, false, false]);
  });
});

for (const status of [401, 429, 503]) test(`HTTP ${status} stops automatic model retries and does not expose provider body`, async () => {
  let count = 0;
  await withFetch(async () => { count++; return new Response("fixture-secret-should-not-escape", { status }); }, async () => {
    await assert.rejects(checkSingleCompanionModel(connection, "first"), (error: unknown) => {
      assert.ok(error instanceof CompanionModelHttpError);
      assert.equal(error.status, status); assert.doesNotMatch(error.message, /secret/); return true;
    });
    assert.equal(count, 1);
  });
});

test("timeout cancels the in-flight probe without modifying the connection", async () => {
  await withFetch((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }), async () => {
    await assert.rejects(checkCompanionModel(connection, 10), /检查超时/);
    assert.equal(connection.modelChecks, undefined);
  });
});

test("automatic selection is local-only and never substitutes the user's model", async () => {
  let probes = 0;
  const checked = {
    ...connection,
    modelChecks: {
      ready: { ...passed, tools: "passed" as const },
      chat: { ...passed, tools: "failed" as const },
      locked: { ...passed, chat: "failed" as const },
    },
  };
  const result = await selectCheckedCompanionModel(checked, [{ id: "ready", created: 1 }, { id: "chat", created: 2 }, { id: "locked", created: 3 }], "auto", async () => {
    probes++; return passed;
  });
  assert.equal(probes, 0); assert.equal(result.model, "chosen"); assert.equal(result.selectionMode, "auto");
});

test("unknown or expired candidates remain selected but pending without a network probe", async () => {
  let probes = 0;
  const result = await selectCheckedCompanionModel(connection, [{ id: "newer", created: 999 }], "manual", async () => {
    probes++; return passed;
  });
  assert.equal(probes, 0); assert.equal(result.model, "chosen"); assert.equal(result.selectionMode, "manual");
});

test("only an explicit single-model check invokes its probe and binds the current revision", async () => {
  let probes = 0;
  const result = await checkSingleCompanionModel(connection, "manual/any-id", async (candidate) => {
    probes++; assert.equal(candidate.model, "manual/any-id"); return { ...passed, connectionRevision: undefined };
  });
  assert.equal(probes, 1); assert.equal(result.connectionRevision, connection.connectionRevision);
});

test("a revision-bound model rejects unverified chat and tools before any provider request", () => {
  const unverified = ensureConnectionRevision(normalizeCompanionModelConnection({ provider: "custom", baseUrl: "http://127.0.0.1:1234/v1", model: "pending" }));
  const model = makeConnectionAgentModel({ connection: unverified, model: "pending", stream: false, temperature: 0, maxTokens: 30 });
  // The assertion is intentionally synchronous: authorization fails before the
  // scheduler/adaptor can issue HTTP, not because a mocked provider says no.
  assert.throws(() => model.complete({ messages: [{ role: "user", content: "hello" }], tools: [], signal: new AbortController().signal }), /尚未通过此连接的文字回复检查/);
  assert.throws(() => model.complete({ messages: [{ role: "user", content: "hello" }], tools: [{ name: "read", description: "", inputSchema: {} }], signal: new AbortController().signal }), /尚未通过此连接的文字回复检查/);
});

test("endpoint normalization accepts pasted completions and IPv6 loopback without sending an empty bearer", async () => {
  const normalized = normalizeCompanionModelConnection({ provider: "custom", baseUrl: "http://[::1]:1234/v1/chat/completions/", model: "model" });
  assert.equal(normalized.baseUrl, "http://[::1]:1234/v1");
  await withFetch(async (url, init) => {
    assert.equal(String(url), "http://[::1]:1234/v1/models");
    assert.equal((init?.headers as any).Authorization, undefined);
    return Response.json({ data: [{ id: "model" }] });
  }, async () => { assert.equal((await fetchCompanionModelCatalog(normalized))[0].id, "model"); });
});

test("missing timestamps retain upstream ordering and daily chat stays on the chosen model", () => {
  assert.deepEqual(sortCompanionModels([{ id: "z" }, { id: "a" }]).map((item) => item.id), ["z", "a"]);
  assert.equal(dailyChatModelForConnection({ provider: "openai", model: "user-selected" }), "user-selected");
});
