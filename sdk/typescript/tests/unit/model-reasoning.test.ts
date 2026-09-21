import assert from "node:assert/strict";
import test from "node:test";
import { effectiveReasoningEffort, resolveReasoningEffort, resolveReasoningPreference, supportedReasoningEfforts } from "../../examples/companion/model-reasoning.js";
import { makeConnectionAgentModel, resolveLLM } from "../../examples/companion/llm.js";
import { usesOpenAIResponses, type CompanionModelConnection } from "../../examples/companion/model-connection.js";

const connection: CompanionModelConnection = { provider: "openai", protocol: "openai-compatible", model: "gpt-6-astra", baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-only" };
test("supported efforts are model/protocol specific, auto omits overrides, invalid choices fail closed", () => {
  assert.deepEqual(supportedReasoningEfforts(connection, connection.model), ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(supportedReasoningEfforts(connection, "gpt-5.6-luna")[0], "none");
  assert.equal(resolveReasoningEffort(connection, connection.model, "auto"), undefined);
  assert.equal(resolveReasoningEffort(connection, connection.model, undefined), undefined);
  for (const value of ["none", "ultra", "", null, { effort: "low" }]) assert.throws(() => resolveReasoningEffort(connection, connection.model, value));
  assert.throws(() => resolveReasoningEffort({ ...connection, provider: "custom" }, connection.model, "high"));
  assert.throws(() => resolveReasoningEffort(connection, "unknown", "high"));
  const zhipu: CompanionModelConnection = { provider: "zhipu", protocol: "openai-compatible", model: "glm-5.3", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "fixture-only" };
  assert.deepEqual(supportedReasoningEfforts(zhipu, zhipu.model), ["low", "high", "max"]);
  assert.equal(resolveReasoningEffort(zhipu, zhipu.model, "high"), "high");
  assert.throws(() => resolveReasoningEffort(zhipu, zhipu.model, "medium"));
});

test("request, scene and system reasoning preferences have one strict precedence order", () => {
  assert.equal(resolveReasoningPreference(connection, connection.model, { request: "low", scene: "medium", system: "high" }), "low");
  assert.equal(resolveReasoningPreference(connection, connection.model, { scene: "medium", system: "high" }), "medium");
  assert.equal(resolveReasoningPreference(connection, connection.model, { system: "high" }), "high");
  assert.equal(resolveReasoningPreference(connection, connection.model, { request: "auto", scene: "high", system: "medium" }), undefined);
  assert.throws(() => resolveReasoningPreference(connection, connection.model, { scene: "none", system: "high" }));
});

test("model adapters forward exact efforts on Responses and Chat Completions without budget changes", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return new Response(JSON.stringify(String(url).endsWith("/responses")
      ? { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }] }
      : { choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } });
  };
  try {
    // 走哪条通道由路由函数说，测试不再复述一份型号表；gpt-4o 保住 Chat Completions 一侧的覆盖。
    for (const id of ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-4o"]) {
      const responses = usesOpenAIResponses({ ...connection, model: id });
      for (const effort of [...supportedReasoningEfforts(connection, id), undefined]) {
        const model = makeConnectionAgentModel({ connection, model: id, maxTokens: 100, stream: false, temperature: 0, reasoningEffort: effort });
        await model.complete({ messages: [{ role: "user", content: "synthetic" }], tools: [], maxOutputTokens: 80, signal: new AbortController().signal });
        const body = requests.at(-1);
        assert.equal(body.model, id);
        assert.equal(responses ? body.reasoning?.effort : body.reasoning_effort, effort);
        assert.equal(responses ? body.max_output_tokens : body.max_completion_tokens, 80);
        assert.equal(body.tools, undefined);
      }
    }
    const llm = resolveLLM(connection);
    await llm.chat("system", "synthetic", connection.model, 100, { sessionId: "qa", userId: "qa", personaId: "qa", instruction: "synthetic", scope: "qa", memoryScopes: [], mode: "chat", toolMode: "off", reasoningEffort: "high" });
    assert.equal(requests.at(-1).reasoning.effort, "high");
  } finally { globalThis.fetch = original; }
});

const zhipuThinking: CompanionModelConnection = { provider: "zhipu", protocol: "openai-compatible", model: "glm-5.3", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "fixture-only" };

test("auto effort becomes the lowest supported level only for thinking-enabled models", () => {
  assert.equal(effectiveReasoningEffort(zhipuThinking, "glm-5.3", undefined), "low");
  assert.equal(effectiveReasoningEffort(zhipuThinking, "glm-5.3-flash", undefined), "low");
  assert.equal(effectiveReasoningEffort(zhipuThinking, "glm-5.3", "max"), "max", "an explicit choice is never lowered");
  assert.equal(effectiveReasoningEffort(zhipuThinking, "glm-4.5", undefined), undefined, "thinking-disabled families keep the provider default");
  assert.equal(effectiveReasoningEffort(connection, connection.model, undefined), undefined, "OpenAI models are untouched");
});

test("chat completions adapter bounds thinking on auto and names the cause when reasoning eats the whole budget", async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  let reply: () => Response = () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "正文" } }] }), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return reply(); };
  const request = { messages: [{ role: "user" as const, content: "synthetic" }], tools: [], maxOutputTokens: 80, signal: new AbortController().signal };
  try {
    await makeConnectionAgentModel({ connection: zhipuThinking, model: "glm-5.3", maxTokens: 100, stream: false, temperature: 0 }).complete(request);
    assert.equal(bodies.at(-1).reasoning_effort, "low");
    assert.deepEqual(bodies.at(-1).thinking, { type: "enabled" });
    await makeConnectionAgentModel({ connection: zhipuThinking, model: "glm-5.3", maxTokens: 100, stream: false, temperature: 0, reasoningEffort: "high" }).complete(request);
    assert.equal(bodies.at(-1).reasoning_effort, "high");
    await makeConnectionAgentModel({ connection: zhipuThinking, model: "glm-4.5", maxTokens: 100, stream: false, temperature: 0 }).complete(request);
    assert.equal(bodies.at(-1).reasoning_effort, undefined);

    reply = () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }], usage: { completion_tokens: 100 } }), { headers: { "content-type": "application/json" } });
    await assert.rejects(
      makeConnectionAgentModel({ connection: zhipuThinking, model: "glm-5.3", maxTokens: 100, stream: false, temperature: 0 }).complete(request),
      /思考强度/,
    );
    reply = () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }], usage: { completion_tokens: 100 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    await assert.rejects(
      makeConnectionAgentModel({ connection: zhipuThinking, model: "glm-5.3", maxTokens: 100, stream: true, temperature: 0 }).complete(request),
      /思考强度/,
    );
    // Truncated *after* visible text is still a usable (if cut) answer, not an error.
    reply = () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "前半段" } }] }), { headers: { "content-type": "application/json" } });
    const cut = await makeConnectionAgentModel({ connection: zhipuThinking, model: "glm-5.3", maxTokens: 100, stream: false, temperature: 0 }).complete(request);
    assert.equal(cut.text, "前半段");
  } finally { globalThis.fetch = original; }
});
