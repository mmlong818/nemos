import assert from "node:assert/strict";
import test from "node:test";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";

test("deleting one service releases its assignments, keeps the other services when the active one goes, and goes offline after the last", { timeout: 120_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const post = async (path: string, body: unknown, expected = 200) => {
    const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as any;
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    return value;
  };
  const onboard = async (baseUrl: string, model: string, key: string) => {
    const saved = await post("/api/llm-connection/save", { provider: "custom", protocol: "openai-compatible", baseUrl, model, selectionMode: "manual", key });
    await post("/api/llm-model/catalog", { connectionId: saved.savedConnectionId });
    await post("/api/llm-model/check", { connectionId: saved.savedConnectionId, model, force: true, onboarding: true });
    return saved.savedConnectionId as string;
  };
  const fixed = (connectionId: string, modelId: string) => ({ mode: "fixed", ref: { connectionId, modelId, capability: "chat" } });
  try {
    const first = await onboard(h.modelBase + "/v1", "manual", "first-fixture-key");
    await post("/api/llm-routing", { scope: "system", capability: "chat", assignment: fixed(first, "manual") });
    const second = await onboard(h.modelBase + "/other", "ready", "second-fixture-key");
    const third = await onboard(h.modelBase + "/v1", "chat-only", "third-fixture-key");
    await post("/api/llm-routing", { scope: "scene", scene: "assistant_chat", capability: "chat", assignment: fixed(first, "manual") });

    await post("/api/llm-connection/delete", { connectionId: "no-such-id" }, 404);

    // 删一个备用服务：正在用的对话不动。
    const spareGone = await post("/api/llm-connection/delete", { connectionId: third });
    assert.deepEqual(spareGone.resourceCenter.connections.map((item: any) => item.id).sort(), [first, second].sort());
    assert.equal(spareGone.resourceCenter.connections.find((item: any) => item.active)?.id, first);
    assert.equal(spareGone.model, "manual");

    // 删正在对话的服务：固定分配退回自动。自定义端点不在维护目录里、不参与自动路由，
    // 所以这里走的是"挑不中就停在离线、其余服务保留"那一支；手动选一个型号即可恢复对话。
    const activeGone = await post("/api/llm-connection/delete", { connectionId: first });
    assert.deepEqual(activeGone.resourceCenter.connections.map((item: any) => item.id), [second]);
    assert.equal(activeGone.resourceCenter.assignments.system.chat.mode, "auto");
    assert.equal(activeGone.resourceCenter.assignments.scenes.assistant_chat?.chat, undefined);
    assert.equal(activeGone.live, false);
    const resumed = await post("/api/llm-routing", { scope: "system", capability: "chat", assignment: fixed(second, "ready") });
    assert.equal(resumed.live, true);
    assert.equal(resumed.model, "ready");
    assert.equal(resumed.resourceCenter.connections.find((item: any) => item.active)?.id, second);

    await h.restart();
    const restarted = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.deepEqual(restarted.resourceCenter.connections.map((item: any) => item.id), [second], "删除要落盘");

    // 删最后一个：进入离线，和“断开所有服务”一样。
    const lastGone = await post("/api/llm-connection/delete", { connectionId: second });
    assert.equal(lastGone.live, false);
    assert.equal(lastGone.resourceCenter.connections.length, 0);
  } finally { await h.stop(); }
});
