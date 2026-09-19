import assert from "node:assert/strict";
import test from "node:test";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";

test("split onboarding preserves default ownership for first, spare, and edited-active connections", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const post = async (path: string, body: unknown, expected = 200) => {
    const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as any;
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  const prepare = async (body: any) => {
    const saved = await post("/api/llm-connection/save", body);
    const id = saved.savedConnectionId;
    const catalog = await post("/api/llm-model/catalog", { connectionId: id });
    const checked = await post("/api/llm-model/check", { connectionId: id, model: body.model, force: true, onboarding: true });
    assert.equal(checked.checked.chat, "passed");
    return { id, saved, catalog, checked };
  };
  const activate = (connectionId: string, modelId: string) => post("/api/llm-routing", {
    scope: "system", capability: "chat", assignment: { mode: "fixed", ref: { connectionId, modelId, capability: "chat" } },
  });
  try {
    const first = await prepare({ provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual", key: "first-fixture" });
    assert.equal(first.saved.live, false);
    const firstActive = await activate(first.id, "manual");
    assert.equal(firstActive.model, "manual");
    assert.equal(firstActive.resourceCenter.connections.find((item: any) => item.active)?.id, first.id);

    const spare = await prepare({ provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/other", model: "ready", selectionMode: "manual", key: "spare-fixture" });
    assert.equal(spare.checked.model, "manual", "checking a spare must not steal the runtime default");
    assert.equal(spare.checked.resourceCenter.connections.find((item: any) => item.active)?.id, first.id);
    assert.equal(spare.checked.resourceCenter.assignments.system.chat.ref.connectionId, first.id);

    const edited = await post("/api/llm-connection/save", { connectionId: first.id, provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/other", model: "ready", selectionMode: "manual", key: "edited-fixture" });
    assert.equal(edited.activationRequired, true);
    assert.equal(edited.resourceCenter.assignments.system.chat.ref.connectionId, first.id);
    await post("/api/llm-model/catalog", { connectionId: first.id });
    const editCheck = await post("/api/llm-model/check", { connectionId: first.id, model: "ready", force: true, onboarding: true });
    assert.equal(editCheck.checked.chat, "passed");
    const reactivated = await activate(first.id, "ready");
    assert.equal(reactivated.model, "ready");
    assert.equal(reactivated.resourceCenter.connections.find((item: any) => item.active)?.id, first.id);
    assert.equal(reactivated.resourceCenter.assignments.system.chat.ref.connectionId, first.id);
    assert.equal(reactivated.resourceCenter.assignments.system.chat.ref.modelId, "ready");
    assert.equal(h.requests.filter((item) => item.body?.model === "manual").length, 1);
    assert.equal(h.requests.filter((item) => item.body?.model === "ready").length, 2, "spare and edited-active each probe one model once");

    const legacy = await post("/api/llm-connect", { key: "must-not-run" }, 410);
    assert.equal(legacy.code, "deprecated_endpoint");
    assert.doesNotMatch(JSON.stringify(legacy), /must-not-run/);
  } finally { await h.stop(); }
});

test("split onboarding failures keep the encrypted connection and never switch the default", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const post = async (path: string, body: unknown, expected = 200) => {
    const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as any;
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  try {
    const saved = await post("/api/llm-connection/save", { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual", key: "bad-fixture-key" });
    const authFailure = await post("/api/llm-model/catalog", { connectionId: saved.savedConnectionId }, 400);
    assert.equal(authFailure.resourceCenter.connections.some((item: any) => item.id === saved.savedConnectionId), true);
    assert.equal(authFailure.live, false);
    assert.equal(h.requests.filter((item) => item.body !== null).length, 0, "authentication failure must not proceed to a completion probe");
    assert.doesNotMatch(JSON.stringify(authFailure), /bad-fixture-key|credentialCiphers|"cipher"\s*:/);

    const missing = await post("/api/llm-connection/save", { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/no-catalog", model: "manual", selectionMode: "manual", key: "saved-fixture" });
    const directoryFailure = await post("/api/llm-model/catalog", { connectionId: missing.savedConnectionId }, 400);
    assert.equal(directoryFailure.resourceCenter.connections.some((item: any) => item.id === missing.savedConnectionId), true);
    assert.equal(directoryFailure.live, false);
  } finally { await h.stop(); }
});
