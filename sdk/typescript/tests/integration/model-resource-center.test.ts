import assert from "node:assert/strict";
import test from "node:test";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";

const postTo = (base: string) => async (path: string, body: unknown, expected = 200) => {
  const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json() as any; assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`); return value;
};
async function onboard(post: ReturnType<typeof postTo>, body: any, activate = true) {
  const saved = await post("/api/llm-connection/save", body); const connectionId = saved.savedConnectionId;
  await post("/api/llm-model/catalog", { connectionId });
  const checked = await post("/api/llm-model/check", { connectionId, model: body.model, force: true, onboarding: true });
  assert.equal(checked.checked.chat, "passed");
  if (!activate) return { state: checked, connectionId };
  const state = await post("/api/llm-routing", { scope: "system", capability: "chat", assignment: { mode: "fixed", ref: { connectionId, modelId: body.model, capability: "chat" } } });
  return { state, connectionId };
}

test("new resource-center chain routes verified models and rejects cross-connection scene overrides", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness(); const post = postTo(h.base);
  try {
    const active = await onboard(post, { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual", key: "fixture-one" });
    await post("/api/llm-model/check", { connectionId: active.connectionId, candidateModel: "chat-only", force: true, onboarding: true });
    await post("/api/llm-routing", { scope: "scene", scene: "assistant_chat", capability: "chat", assignment: { mode: "fixed", ref: { connectionId: active.connectionId, modelId: "chat-only", capability: "chat" } } });
    const before = h.requests.length;
    const chat = await fetch(h.base + "/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: { kind: "persona", id: "clownfish" }, text: "一句话", toolMode: "off", workMode: "chat" }) });
    assert.equal(chat.status, 200, await chat.text()); assert.ok(h.requests.slice(before).some((item) => item.body?.model === "chat-only"));
    const spare = await onboard(post, { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/other", model: "ready", selectionMode: "manual", key: "fixture-two" }, false);
    const cross = await post("/api/llm-routing", { scope: "scene", scene: "task_workspace", capability: "chat", assignment: { mode: "fixed", ref: { connectionId: spare.connectionId, modelId: "ready", capability: "chat" } } }, 400);
    assert.match(cross.userMessage || cross.error, /只能选择当前连接|系统默认/);
  } finally { await h.stop(); }
});

test("unwired media fails closed and deprecated write routes stay closed", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness(); const post = postTo(h.base);
  try {
    await onboard(post, { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual", key: "fixture" });
    const before = h.requests.length;
    for (const [path, body] of [["/api/tts", { text: "测试" }], ["/api/chat", { text: "看图", image: "data:image/png;base64,AA==" }]] as const) {
      const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); assert.equal(response.status, 409);
    }
    assert.equal(h.requests.length, before);
    for (const endpoint of ["/api/llm-connect", "/api/llm-config", "/api/llm-key"]) {
      const result = await post(endpoint, { key: "must-not-save" }, 410); assert.equal(result.code, "deprecated_endpoint"); assert.doesNotMatch(JSON.stringify(result), /must-not-save/);
    }
    assert.equal(h.requests.length, before);
  } finally { await h.stop(); }
});

test("active edits remain staged until the verified revision is explicitly reactivated", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness(); const post = postTo(h.base);
  try {
    const active = await onboard(post, { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual", key: "old" });
    const edited = await post("/api/llm-connection/save", { connectionId: active.connectionId, provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/other", model: "ready", selectionMode: "manual", key: "new" });
    assert.equal(edited.activationRequired, true); assert.equal(edited.model, "manual"); assert.equal(edited.resourceCenter.connections.some((item: any) => item.active), false);
    assert.equal(edited.resourceCenter.resources.some((item: any) => item.runtimeSnapshot && item.readOnly), true);
    await post("/api/llm-model/catalog", { connectionId: active.connectionId });
    await post("/api/llm-model/check", { connectionId: active.connectionId, model: "ready", force: true, onboarding: true });
    const enabled = await post("/api/llm-routing", { scope: "system", capability: "chat", assignment: { mode: "fixed", ref: { connectionId: active.connectionId, modelId: "ready", capability: "chat" } } });
    assert.equal(enabled.model, "ready"); assert.equal(enabled.resourceCenter.assignments.system.chat.ref.connectionId, active.connectionId);
    assert.equal(enabled.resourceCenter.resources.some((item: any) => item.runtimeSnapshot), false);
  } finally { await h.stop(); }
});
