import assert from "node:assert/strict";
import test from "node:test";
import { makeConnectionAgentModel } from "../../examples/companion/llm.js";
import { syncRuntimeConnectionChecks, type CompanionModelCheck, type CompanionModelConnection } from "../../examples/companion/model-connection.js";

const revision = "639c6f11-9733-4532-907c-1371253c313b";
function check(tools: CompanionModelCheck["tools"]): CompanionModelCheck {
  return { connectionRevision: revision, transport: "openai-chat-completions", checkedAt: new Date().toISOString(), chat: "passed", streaming: "passed", tools, detail: "fixture" };
}
function connection(tools: CompanionModelCheck["tools"], extra: Partial<CompanionModelConnection> = {}): CompanionModelConnection {
  return {
    provider: "custom", protocol: "openai-compatible", model: "fixture-model", baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-only",
    connectionRevision: revision, enabledModels: ["fixture-model"], modelChecks: { "fixture-model": check(tools) }, ...extra,
  };
}

test("an explicit check that passes tools is visible to the running adapter without a restart", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } });
  const runtime = connection("failed");
  const tool = { definition: { name: "noop", description: "fixture", inputSchema: { type: "object", properties: {} } }, execute: async () => ({ content: "" }) } as any;
  const request = { messages: [{ role: "user" as const, content: "synthetic" }], tools: [tool], maxOutputTokens: 20, signal: new AbortController().signal };
  try {
    // The same runtime object is what resolveLLM closes over; the adapter is rebuilt per call and reads its checks.
    await assert.rejects(async () => makeConnectionAgentModel({ connection: runtime, model: "fixture-model", maxTokens: 50, stream: false, temperature: 0 }).complete(request), /工具调用检查未通过/);
    const saved = connection("passed", { enabledModels: ["fixture-model", "second"], registeredModels: ["second"] });
    assert.equal(syncRuntimeConnectionChecks(runtime, saved), true);
    assert.deepEqual(runtime.enabledModels, ["fixture-model", "second"]);
    assert.deepEqual(runtime.registeredModels, ["second"]);
    assert.notEqual(runtime.modelChecks, saved.modelChecks, "the runtime keeps its own copy");
    const result = await makeConnectionAgentModel({ connection: runtime, model: "fixture-model", maxTokens: 50, stream: false, temperature: 0 }).complete(request);
    assert.equal(result.text, "ok");
  } finally { globalThis.fetch = original; }
});

test("a saved connection whose credentials changed does not overwrite the runtime snapshot", () => {
  const runtime = connection("failed");
  const rotated = connection("passed", { connectionRevision: "0f1e2d3c4b5a69788796a5b4c3d2e1f0" });
  assert.equal(syncRuntimeConnectionChecks(runtime, rotated), false);
  assert.equal(runtime.modelChecks?.["fixture-model"].tools, "failed");
  assert.equal(syncRuntimeConnectionChecks(undefined, rotated), false, "offline runtime has nothing to sync into");
  assert.equal(syncRuntimeConnectionChecks(runtime, { ...rotated, connectionRevision: undefined }), false, "legacy connections without a revision stay untouched");
});
