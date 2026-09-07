import assert from "node:assert/strict";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("real isolated server forwards per-message effort for plain and streamed chat; rejects invalid efforts before calls", { timeout: 60_000 }, async () => {
  const h = await startModelHarness();
  const post = (path: string, body: unknown) => fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const config = await post("/api/llm-config", { provider: "openai", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "gpt-6-astra", key: "fake-fixture-key", selectionMode: "manual" });
    const configured: any = await config.json();
    assert.equal(config.status, 200, JSON.stringify(configured));
    assert.deepEqual(configured.reasoningEfforts["gpt-6-astra"], ["low", "medium", "high", "xhigh", "max"]);
    for (const [path, effort] of [["/api/chat", "high"], ["/api/chat/stream", "low"], ["/api/chat", "auto"]]) {
      const marker = "SYNTHETIC_EFFORT_" + effort;
      const result = await post(path, { text: marker, target: { kind: "persona", id: "clownfish" }, sessionId: marker, model: "default", reasoningEffort: effort, toolMode: "off", memoryWriteMode: "off" });
      assert.equal(result.status, 200, await result.clone().text());
      await result.text();
      const calls = h.requests.filter(item => item.url.endsWith("/responses") && item.body?.input?.some((m: any) => String(m.content).includes(marker)));
      assert.ok(calls.length > 0);
      assert.ok(calls.some(item => item.body.reasoning?.effort === (effort === "auto" ? undefined : effort)));
    }
    const before = h.requests.length;
    const invalid = await post("/api/chat", { text: "not sent", target: { kind: "persona", id: "clownfish" }, reasoningEffort: "none" });
    assert.equal(invalid.status, 400);
    assert.equal(h.requests.length, before);
    const current: any = await (await fetch(h.base + "/api/llm")).json();
    assert.equal(current.model, "gpt-6-astra");
    assert.equal(current.reasoningEffort, undefined);
  } finally { await h.stop(); }
});
