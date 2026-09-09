import assert from "node:assert/strict";
import test from "node:test";
import { resolveReasoningEffort, supportedReasoningEfforts } from "../../examples/companion/model-reasoning.js";
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
