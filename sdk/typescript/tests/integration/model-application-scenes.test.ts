import assert from "node:assert/strict";
import test from "node:test";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";
import { onboardModel } from "../helpers/onboard-model.js";

test("the four registered applications consume their own model override", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const post = async (path: string, body: unknown, expected = 200) => {
    const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json().catch(() => ({})) as any;
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  try {
    h.state.replyFor = (body) => String(body.messages?.[0]?.content).includes("思维方法编辑器")
      ? '{"applicableProblems":[],"corePrinciples":["仅用于路由验证"],"judgmentSteps":[],"counterexamplesAndLimits":[],"questioningStyle":[],"uncertaintyStatements":[]}'
      : "本地模拟回复：已完成场景路由验证。";
    const onboarded = await onboardModel(h.base, { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual" });
    const connectionId = onboarded.resourceCenter.connections.find((item: any) => item.active)?.id;
    assert.ok(connectionId);
    for (const model of ["chat-only", "ready"]) {
      const checked = await post("/api/llm-model/check", { connectionId, candidateModel: model, force: true, onboarding: true });
      assert.equal(checked.checked.chat, "passed");
    }
    const sceneModels = {
      assistant_chat: "chat-only",
      task_workspace: "ready",
      pantheon: "manual",
      distillation: "ready",
    } as const;
    for (const [scene, modelId] of Object.entries(sceneModels)) {
      await post("/api/llm-routing", { scope: "scene", scene, capability: "chat", assignment: { mode: "fixed", ref: { connectionId, modelId, capability: "chat" } } });
    }
    let state = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.deepEqual(state.resourceCenter.scenes.map((scene: any) => scene.id), ["assistant_chat", "task_workspace", "pantheon", "distillation"]);
    assert.ok(state.resourceCenter.scenes.every((scene: any) => scene.executionState === "wired" && scene.modelOverride && scene.reasoningOverride && scene.executionEntries.length));
    for (const [scene, modelId] of Object.entries(sceneModels)) assert.equal(state.resourceCenter.assignments.scenes[scene].chat.ref.modelId, modelId);

    const expectOutbound = async (model: string, action: () => Promise<unknown>) => {
      const before = h.requests.length;
      await action();
      assert.ok(h.requests.slice(before).some((request) => request.body?.model === model), `expected outbound model ${model}`);
    };
    await expectOutbound("chat-only", async () => {
      const response = await fetch(h.base + "/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: { kind: "persona", id: "clownfish" }, text: "助理场景模型验证", toolMode: "off", workMode: "chat" }) });
      const text = await response.text(); assert.equal(response.status, 200, text);
    });
    await expectOutbound("ready", async () => {
      const response = await fetch(h.base + "/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: { kind: "persona", id: "clownfish" }, text: "任务场景模型验证", toolMode: "off", workMode: "task" }) });
      const text = await response.text(); assert.equal(response.status, 200, text);
    });
    await expectOutbound("manual", async () => {
      const created = await post("/api/pantheon/session", { issue: "验证万神殿场景模型" }, 201);
      await post("/api/pantheon/session/advance", { sessionId: created.session.id });
    });
    await expectOutbound("ready", async () => {
      await post("/api/pantheon/distill", { displayName: "场景路由验证", kind: "framework", material: "这是一段仅用于隔离测试的合成材料。" }, 201);
    });

    await post("/api/llm-routing", { scope: "scene", scene: "assistant_chat", capability: "chat", assignment: { mode: "inherit" } });
    state = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.equal(state.resourceCenter.assignments.scenes.assistant_chat.chat, undefined);
    assert.equal(state.resourceCenter.assignments.scenes.task_workspace.chat.ref.modelId, "ready");
    assert.equal(state.resourceCenter.assignments.scenes.pantheon.chat.ref.modelId, "manual");
    assert.equal(state.resourceCenter.assignments.scenes.distillation.chat.ref.modelId, "ready");
  } finally { await h.stop(); }
});
