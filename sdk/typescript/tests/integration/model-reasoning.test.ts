import assert from "node:assert/strict";
import test from "node:test";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";

test("real isolated server forwards per-message effort for plain and streamed chat; rejects invalid efforts before calls", { timeout: 60_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const post = (path: string, body: unknown) => fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const config = await post("/api/llm-config", { provider: "openai", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "gpt-6-astra", key: "fake-fixture-key", selectionMode: "manual" });
    const configured: any = await config.json();
    assert.equal(config.status, 200, JSON.stringify(configured));
    assert.deepEqual(configured.reasoningEfforts["gpt-6-astra"], ["low", "medium", "high", "xhigh", "max"]);
    const readiness = await post("/api/llm-model/check", { model: "gpt-6-astra" });
    assert.equal(readiness.status, 200, await readiness.clone().text());
    assert.equal((await readiness.json() as any).checked.chat, "passed");
    for (const [path, effort] of [["/api/chat", "high"], ["/api/chat/stream", "low"], ["/api/chat", "auto"]]) {
      const marker = "SYNTHETIC_EFFORT_" + effort;
      const result = await post(path, { text: marker, target: { kind: "persona", id: "clownfish" }, sessionId: marker, model: "default", reasoningEffort: effort, toolMode: "off", memoryWriteMode: "off" });
      assert.equal(result.status, 200, await result.clone().text());
      await result.text();
      const calls = h.requests.filter(item => item.url.endsWith("/responses") && item.body?.input?.some((m: any) => String(m.content).includes(marker)));
      assert.ok(calls.length > 0);
      assert.ok(calls.some(item => item.body.reasoning?.effort === (effort === "auto" ? undefined : effort)));
    }
    // 判据是「这条文本有没有到过模型」，不是请求总数：后台活动（人格简介预热、例行任务
    // 调度、记忆整合）会让 h.requests.length 变动，用总数断言等于让它被无关活动挟持。
    // 这个测试就因此在 Windows 上偶发失败过一次（9 !== 8）——与 buzz-adoption 同一类错误。
    const invalidMarker = "SYNTHETIC_INVALID_EFFORT";
    const invalid = await post("/api/chat", { text: invalidMarker, target: { kind: "persona", id: "clownfish" }, reasoningEffort: "none" });
    assert.equal(invalid.status, 400);
    const leaked = h.requests.filter((item) => JSON.stringify(item.body ?? "").includes(invalidMarker));
    assert.equal(leaked.length, 0, "非法 effort 必须在调用模型之前被拒绝");
    const current: any = await (await fetch(h.base + "/api/llm")).json();
    assert.equal(current.model, "gpt-6-astra");
    assert.equal(current.reasoningEffort, undefined);
  } finally { await h.stop(); }
});
