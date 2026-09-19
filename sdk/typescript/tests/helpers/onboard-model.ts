import assert from "node:assert/strict";
export async function onboardModel(base: string, config: any): Promise<any> {
  const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const value = await response.json() as any; assert.equal(response.status, 200, `${path}: ${JSON.stringify(value)}`); return value; };
  const saved = await post("/api/llm-connection/save", config); const connectionId = saved.savedConnectionId;
  await post("/api/llm-model/catalog", { connectionId });
  await post("/api/llm-model/check", { connectionId, model: config.model, force: true, onboarding: true });
  return post("/api/llm-routing", { scope: "system", capability: "chat", assignment: { mode: "fixed", ref: { connectionId, modelId: config.model, capability: "chat" } } });
}
