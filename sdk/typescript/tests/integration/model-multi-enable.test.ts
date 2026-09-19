import assert from "node:assert/strict";
import test from "node:test";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";

test("one credential enables several independently checked models and preserves routing across restart", { timeout: 120_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const post = async (path: string, body: unknown, expected = 200) => {
    const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as any;
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  const fixed = (connectionId: string, modelId: string) => ({ mode: "fixed", ref: { connectionId, modelId, capability: "chat" } });
  try {
    const saved = await post("/api/llm-connection/save", { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual", key: "shared-fixture-key" });
    const connectionId = saved.savedConnectionId;
    await post("/api/llm-model/catalog", { connectionId });
    await post("/api/llm-model/enabled", { connectionId, models: ["manual", "ready", "chat-only", "unavailable"], enabled: true });
    const checked = await post("/api/llm-model/check-batch", { connectionId, models: ["manual", "ready", "chat-only", "unavailable"] });
    assert.equal(checked.concurrency, 2);
    assert.deepEqual(checked.results.filter((item: any) => item.ok).map((item: any) => item.modelId).sort(), ["chat-only", "manual", "ready"]);
    assert.equal(checked.results.find((item: any) => item.modelId === "unavailable").check.chat, "failed");
    assert.deepEqual(checked.resourceCenter.connections.find((item: any) => item.id === connectionId).enabledModels.sort(), ["chat-only", "manual", "ready", "unavailable"]);

    await post("/api/llm-routing", { scope: "system", capability: "chat", assignment: fixed(connectionId, "manual") });
    for (const [scene, modelId] of Object.entries({ assistant_chat: "chat-only", task_workspace: "ready", pantheon: "manual", distillation: "ready" })) {
      await post("/api/llm-routing", { scope: "scene", scene, capability: "chat", assignment: fixed(connectionId, modelId) });
    }
    const blocked = await post("/api/llm-model/enabled", { connectionId, models: ["ready"], enabled: false }, 409);
    assert.equal(blocked.code, "model_in_use");
    assert.deepEqual(blocked.references.map((item: any) => item.reference).sort(), ["任务工作区 · chat", "思维蒸馏 · chat"]);

    const providerRequestsBeforeAdd = h.requests.length;
    const manual = await post("/api/llm-model/register-enable", { connectionId, model: "outside-manual-id" });
    assert.equal(h.requests.length, providerRequestsBeforeAdd, "adding and enabling a manual ID must make zero provider calls");
    const manualConnection = manual.resourceCenter.connections.find((item: any) => item.id === connectionId);
    assert.ok(manualConnection.registeredModels.includes("outside-manual-id"));
    assert.ok(manualConnection.enabledModels.includes("outside-manual-id"));
    const manualCheck = await post("/api/llm-model/check-batch", { connectionId, models: ["outside-manual-id"] });
    assert.equal(manualCheck.results[0].ok, true);
    const oldEndpoint = await post("/api/llm-model/favorite", { connectionId, model: "legacy" }, 410);
    assert.equal(oldEndpoint.migrateTo, "/api/llm-model/register-enable");
    const unknown = await post("/api/llm-model/check", { connectionId, candidateModel: "not-added-and-not-listed", force: true }, 400);
    assert.match(unknown.userMessage || unknown.error, /不属于当前连接/);
    const afterUnknown = await (await fetch(h.base + "/api/llm")).json() as any;
    const afterUnknownConnection = afterUnknown.resourceCenter.connections.find((item: any) => item.id === connectionId);
    assert.equal(afterUnknownConnection.registeredModels.includes("not-added-and-not-listed"), false);
    assert.equal(afterUnknownConnection.modelChecks["not-added-and-not-listed"], undefined);

    const beforeRestart = await (await fetch(h.base + "/api/llm")).json() as any;
    const enabledBefore = beforeRestart.resourceCenter.connections.find((item: any) => item.id === connectionId).enabledModels.slice().sort();
    await h.restart();
    const afterRestart = await (await fetch(h.base + "/api/llm")).json() as any;
    const restartedConnection = afterRestart.resourceCenter.connections.find((item: any) => item.id === connectionId);
    assert.deepEqual(restartedConnection.enabledModels.slice().sort(), enabledBefore);
    assert.ok(restartedConnection.registeredModels.includes("outside-manual-id"));
    assert.equal(afterRestart.resourceCenter.assignments.system.chat.ref.modelId, "manual");
    assert.equal(afterRestart.resourceCenter.assignments.scenes.assistant_chat.chat.ref.modelId, "chat-only");

    const spare = await post("/api/llm-connection/save", { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/other", model: "ready", selectionMode: "manual", key: "spare-fixture-key" });
    await post("/api/llm-model/catalog", { connectionId: spare.savedConnectionId });
    await post("/api/llm-model/check", { connectionId: spare.savedConnectionId, model: "ready", force: true, onboarding: true });
    const finalState = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.equal(finalState.resourceCenter.connections.find((item: any) => item.active)?.id, connectionId, "checking a spare connection must not steal the runtime default");
    assert.equal(finalState.resourceCenter.assignments.system.chat.ref.modelId, "manual");
  } finally { await h.stop(); }
});
