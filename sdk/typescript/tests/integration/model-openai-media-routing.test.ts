import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";

test("official OpenAI media assignments save and survive restart while scene media stays rejected", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const post = async (path: string, body: unknown, expected = 200) => {
    const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as any;
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  try {
    const saved = await post("/api/llm-connection/save", { provider: "openai", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", selectionMode: "manual", key: "fake-routing-only" });
    const connectionId = saved.savedConnectionId as string;
    const models = { vision: "gpt-5.4", speech_to_text: "gpt-transcribe", text_to_speech: "gpt-4o-mini-tts", image_generation: "gpt-image-2.5-flare" } as const;
    await h.restart(() => {
      const file = join(h.dir, "llm-key.dpapi.json");
      const vault = JSON.parse(readFileSync(file, "utf8"));
      const record = vault.connections.find((item: any) => item.id === connectionId);
      record.enabledModels = Object.values(models);
      record.capabilityChecks = Object.fromEntries(Object.entries(models).map(([capability, modelId]) => [`${capability}:${modelId}`, {
        connectionRevision: record.connectionRevision, modelId, capability, checkedAt: new Date().toISOString(), status: "passed", detail: "fake explicit probe",
      }]));
      writeFileSync(file, JSON.stringify(vault, null, 2));
    });
    for (const [capability, modelId] of Object.entries(models)) {
      const state = await post("/api/llm-routing", { scope: "system", capability, assignment: { mode: "fixed", ref: { connectionId, modelId, capability } } });
      assert.equal(state.resourceCenter.assignments.system[capability].ref.modelId, modelId);
    }
    const scene = await post("/api/llm-routing", { scope: "scene", scene: "assistant_chat", capability: "vision", assignment: { mode: "fixed", ref: { connectionId, modelId: models.vision, capability: "vision" } } }, 400);
    assert.match(scene.userMessage || scene.error, /只支持单独覆盖文字模型/);
    await h.restart();
    const after = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.equal(after.resourceCenter.connections.length, 1);
    assert.equal(after.resourceCenter.connections[0].id, connectionId);
    assert.equal(after.resourceCenter.connections[0].active, false);
    assert.equal(after.resourceCenter.connections[0].hasKey, true);
    for (const [capability, modelId] of Object.entries(models)) assert.equal(after.resourceCenter.assignments.system[capability].ref.modelId, modelId);
  } finally { await h.stop(); }
});
