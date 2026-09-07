import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("完整模型流程：自动筛选、手动锁定、失败保留、目录兼容、任务切换和重启", { timeout: 90_000 }, async () => {
  const h = await startModelHarness();
  const request = async (path: string, body?: unknown, expected = 200) => {
    const response = await fetch(h.base + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as any;
    assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const config = { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual" };
  const saved = () => readFileSync(join(h.dir, "llm-key.dpapi.json"), "utf8");
  try {
    const auto = await request("/api/llm-config", { ...config, selectionMode: "auto" });
    assert.equal(auto.model, "ready"); assert.equal(auto.check.tools, "passed");
    assert.equal(auto.modelChecks.unavailable.chat, "failed"); assert.equal(auto.modelChecks["chat-only"].tools, "failed");
    assert.equal(auto.dailyChatModel, "ready"); assert.equal(auto.selectionMode, "auto");
    const manual = await request("/api/llm-config", { ...config, selectionMode: "manual" });
    assert.equal(manual.model, "manual"); assert.equal(manual.selectionMode, "manual");
    const before = saved();
    const failed = await request("/api/llm-config", { ...config, model: "bad-model", selectionMode: "manual" }, 400);
    assert.match(failed.error, /未改用其他模型/); assert.equal(saved(), before);
    const checked = await request("/api/llm-model/check", { model: "ready" });
    assert.equal(checked.ok, true); assert.equal(checked.model, "manual"); assert.equal(checked.checkedModel, "ready");
    const checkFailure = await request("/api/llm-model/check", { model: "unavailable" });
    assert.equal(checkFailure.ok, false); assert.equal(checkFailure.model, "manual");
    // Passed probes are reused: switching back to an already verified model sends no model requests.
    const requestsBefore = h.requests.length;
    const cachedCheck = await request("/api/llm-model/check", { model: "ready" });
    assert.equal(cachedCheck.ok, true); assert.equal(cachedCheck.cached, true); assert.equal(cachedCheck.checked.tools, "passed");
    assert.equal(h.requests.length, requestsBefore);
    const forced = await request("/api/llm-model/check", { model: "ready", force: true });
    assert.equal(forced.ok, true); assert.notEqual(forced.cached, true); assert.ok(h.requests.length > requestsBefore);
    const failedAgain = await request("/api/llm-model/check", { model: "unavailable" });
    assert.notEqual(failedAgain.cached, true);
    const chat = { text: "ROUTE_MODEL_CHECK", target: { kind: "persona", id: "clownfish" }, sessionId: "routing-check", workMode: "task", model: "ready", toolMode: "off" };
    await request("/api/chat", chat);
    const route = h.requests.filter((item) => item.body?.messages?.some((message: any) => String(message.content).includes("ROUTE_MODEL_CHECK")));
    assert.ok(route.some((item) => item.body.model === "ready"));
    const ability = await request("/api/capabilities/ability", { personaId: "clownfish", name: "模型回归文稿", goal: "输出简短的 Markdown 结果", defaultFormat: "md" });
    await request("/api/capabilities/task", { personaId: "clownfish", capabilityId: ability.ability.id, title: "模型回归任务", instruction: "CAPABILITY_ROUTE_CHECK 输出简短的 Markdown 结果", format: "md", schedule: { mode: "manual" }, enabled: true });
    const taskReply = await request("/api/chat", { ...chat, text: "执行模型回归任务" });
    assert.ok(taskReply.replies[0].artifact);
    const artifactRequests = h.requests.filter((item) => item.body?.messages?.some((message: any) => String(message.content).includes("CAPABILITY_ROUTE_CHECK")));
    assert.ok(artifactRequests.length > 0);
    assert.ok(artifactRequests.every((item) => item.body.model === "ready" && !item.body.tools));
    const beforeInvalid = h.requests.length;
    const invalid = await fetch(h.base + "/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...chat, model: "removed-model" }) });
    assert.match(await invalid.text(), /不会自动改用其他型号/); assert.equal(h.requests.length, beforeInvalid);
    await h.restart();
    const restored = await request("/api/llm");
    assert.equal(restored.model, "manual"); assert.equal(restored.selectionMode, "manual"); assert.equal(restored.modelChecks.ready.tools, "passed");
    const noCatalog = await request("/api/llm-config", { ...config, baseUrl: h.modelBase + "/no-catalog", selectionMode: "manual" });
    assert.equal(noCatalog.model, "manual"); assert.equal(noCatalog.modelsFetchedAt, null); assert.match(noCatalog.catalogWarning, /未提供模型目录/);
    assert.deepEqual(Object.keys(noCatalog.modelChecks), ["manual"]);
    const noCatalogSaved = saved();
    await request("/api/llm-config", { ...config, baseUrl: h.modelBase + "/no-catalog", selectionMode: "auto" }, 400);
    assert.equal(saved(), noCatalogSaved);
    h.state.status = 429;
    const quota = await request("/api/llm-config", { ...config, selectionMode: "auto" }, 400);
    assert.match(quota.error, /额度/); assert.equal(saved(), noCatalogSaved); h.state.status = 0;
    // A credential change invalidates old checks, but manual selection remains exact.
    const withKey = await request("/api/llm-config", { ...config, key: "fake-model-key", selectionMode: "manual" });
    assert.equal(withKey.model, "manual"); assert.deepEqual(Object.keys(withKey.modelChecks), ["manual"]);
    assert.doesNotMatch(JSON.stringify(withKey), /fake-model-key/); assert.doesNotMatch(saved(), /fake-model-key/);
    const keySaved = saved();
    const badKey = await request("/api/llm-config", { ...config, key: "bad-fixture-key", selectionMode: "manual" }, 400);
    assert.match(badKey.error, /Key/); assert.equal(saved(), keySaved);
    assert.doesNotMatch(JSON.stringify(badKey), /private-provider-body/);
    const offset = h.requests.length;
    await request("/api/llm-config", { ...config, baseUrl: h.modelBase + "/other", selectionMode: "manual" });
    assert.ok(h.requests.slice(offset).every((item) => !item.authorization));
    h.state.delayMs = 50;
    const count = h.requests.length;
    const pendingSave = request("/api/llm-config", { ...config, baseUrl: h.modelBase + "/other", selectionMode: "manual" });
    while (h.requests.length === count) await new Promise((done) => setTimeout(done, 10));
    const busy = await request("/api/llm-config", { offline: true }, 409);
    assert.match(busy.error, /正在检查或保存模型/);
    assert.equal((await pendingSave).model, "manual");
    assert.equal((await request("/api/llm")).live, true);
  } finally { await h.stop(); }
});

test("Astra 模型在完整服务中以 Responses 检查、保存和重启，旧失败结果不会直接放行", { timeout: 90_000 }, async () => {
  const h = await startModelHarness();
  try {
    const save = await fetch(h.base + "/api/llm-config", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", baseUrl: h.modelBase + "/v1", model: "gpt-6-astra", key: "fake-fixture-key", selectionMode: "manual" }) });
    const result = await save.json() as any;
    assert.equal(save.status, 200, JSON.stringify(result));
    assert.equal(result.model, "gpt-6-astra"); assert.equal(result.check.tools, "passed");
    const probes = h.requests.filter((item) => item.body?.model === "gpt-6-astra");
    assert.equal(probes.length, 4);
    assert.ok(probes.every((item) => item.url === "/v1/responses" && item.body.store === false));
    assert.equal(probes[3]?.body.input.at(-1)?.type, "function_call_output");
    await h.restart();
    const restored = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.equal(restored.model, "gpt-6-astra"); assert.equal(restored.modelChecks["gpt-6-astra"].tools, "passed");
    assert.doesNotMatch(readFileSync(join(h.dir, "llm-key.dpapi.json"), "utf8"), /fake-fixture-key/);
  } finally { await h.stop(); }
});
