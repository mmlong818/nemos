import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";

test("模型保存不探测；显式检查、收藏、跨连接与重启严格按 revision 处理", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const request = async (path: string, body?: unknown, expected = 200) => {
    const response = await fetch(h.base + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as any;
    assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const config = { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual" };
  const savedPath = join(h.dir, "llm-key.dpapi.json");
  const saved = () => JSON.parse(readFileSync(savedPath, "utf8")) as any;
  const modelRequests = () => h.requests.filter((item) => item.body !== null).length;
  try {
    const beforeSave = modelRequests();
    const pending = await request("/api/llm-config", { ...config, selectionMode: "auto" });
    assert.equal(pending.model, "manual"); assert.equal(pending.selectionMode, "manual"); assert.equal(pending.check, null);
    assert.equal(modelRequests(), beforeSave, "saving or changing selection must not probe a model");
    assert.ok(pending.connectionRevision); assert.equal(saved().version, 4);
    assert.equal(saved().connectionRevision, pending.connectionRevision); assert.deepEqual(saved().modelChecks, {});

    const favourite = await request("/api/llm-model/favorite", { model: "not-in-catalog/yet", favorite: true });
    assert.deepEqual(favourite.favoriteModels, ["not-in-catalog/yet"]);
    assert.equal(modelRequests(), beforeSave, "favourites are preferences, never probes");

    const beforeCheck = modelRequests();
    const checked = await request("/api/llm-model/check", { model: "manual" });
    assert.equal(checked.ok, true); assert.equal(checked.checkedModel, "manual");
    assert.equal(checked.checked.chat, "passed"); assert.equal(checked.checked.tools, "passed");
    assert.equal(checked.checked.transport, "openai-chat-completions", "检查必须记下它实际走过的通道");
    assert.equal(modelRequests(), beforeCheck + 4, "one explicit check performs its four synthetic capability rounds");
    const unchanged = await request("/api/llm-config", config);
    assert.equal(unchanged.connectionRevision, checked.connectionRevision);
    assert.equal(modelRequests(), beforeCheck + 4, "re-saving an unchanged connection does not re-check");
    const cacheBefore = modelRequests();
    const cached = await request("/api/llm-model/check", { model: "manual" });
    assert.equal(cached.cached, true); assert.equal(modelRequests(), cacheBefore);
    const catalog = await request("/api/llm-model/catalog", {});
    assert.ok(catalog.models.some((item: { id: string }) => item.id === "manual"));
    assert.equal(modelRequests(), cacheBefore, "an explicit directory refresh is not a model inference probe");
    const failed = await request("/api/llm-model/check", { model: "unavailable" });
    assert.equal(failed.ok, false); assert.equal(failed.model, "manual", "a failed explicit check never changes the selected model");

    const route = await request("/api/chat", { text: "REVISION_ROUTE", target: { kind: "persona", id: "clownfish" }, sessionId: "revision-route", workMode: "task", model: "manual", toolMode: "off" });
    assert.ok(route.replies?.length);
    const persistedRevision = checked.connectionRevision;
    await h.restart();
    const restored = await request("/api/llm");
    assert.equal(restored.connectionRevision, persistedRevision);
    assert.equal(restored.modelChecks.manual.connectionRevision, persistedRevision);
    assert.equal(restored.check.tools, "passed");

    await h.restart(() => {
      const file = saved(); file.modelChecks.manual.connectionRevision = "00000000-0000-0000-0000-000000000000";
      writeFileSync(savedPath, JSON.stringify(file));
    });
    const forged = await request("/api/llm");
    assert.equal(forged.connectionRevision, persistedRevision); assert.equal(forged.modelChecks.manual, undefined);
    const beforeForgedRoute = modelRequests();
    const forgedRoute = await request("/api/chat", { text: "FORGED_MUST_NOT_CALL", target: { kind: "persona", id: "clownfish" }, sessionId: "forged-route", workMode: "task", model: "manual", toolMode: "off" }, 400);
    assert.match(forgedRoute.error, /尚未通过当前连接/);
    assert.equal(modelRequests(), beforeForgedRoute, "forged eligibility is rejected before provider HTTP");

    await request("/api/llm-model/check", { model: "manual" });
    await h.restart(() => {
      const file = saved(); file.modelChecks.manual.checkedAt = "2000-01-01T00:00:00.000Z";
      writeFileSync(savedPath, JSON.stringify(file));
    });
    const expired = await request("/api/llm");
    assert.equal(expired.modelChecks.manual.connectionRevision, persistedRevision);
    const beforeExpiredRoute = modelRequests();
    const expiredRoute = await request("/api/chat", { text: "EXPIRED_MUST_NOT_CALL", target: { kind: "persona", id: "clownfish" }, sessionId: "expired-route", workMode: "task", model: "manual", toolMode: "off" }, 400);
    assert.match(expiredRoute.error, /尚未通过当前连接/);
    assert.equal(modelRequests(), beforeExpiredRoute, "expired checks never silently re-probe or execute");

    const beforeSwitch = modelRequests();
    const switched = await request("/api/llm-config", { ...config, baseUrl: h.modelBase + "/other", model: "manual" });
    assert.notEqual(switched.connectionRevision, persistedRevision); assert.deepEqual(switched.modelChecks, {});
    assert.deepEqual(switched.favoriteModels, ["not-in-catalog/yet"]);
    assert.equal(modelRequests(), beforeSwitch, "endpoint switches invalidate locally without an implicit model request");
    assert.equal(switched.catalogStale, true);
  } finally { await h.stop(); }
});

test("Astra explicit check uses Responses, survives v4 restart, and remains credential-safe", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  try {
    const save = await fetch(h.base + "/api/llm-config", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", baseUrl: h.modelBase + "/v1", model: "gpt-6-astra", key: "fake-fixture-key", selectionMode: "manual" }) });
    const pending = await save.json() as any;
    assert.equal(save.status, 200, JSON.stringify(pending));
    assert.equal(h.requests.filter((item) => item.body !== null).length, 0, "saving must not issue a Responses request");
    const check = await (await fetch(h.base + "/api/llm-model/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-6-astra" }) })).json() as any;
    assert.equal(check.ok, true); assert.equal(check.checked.tools, "passed");
    const probes = h.requests.filter((item) => item.body?.model === "gpt-6-astra");
    assert.equal(probes.length, 4);
    assert.ok(probes.every((item) => item.url === "/v1/responses" && item.body.store === false));
    assert.equal(probes[3]?.body.input.at(-1)?.type, "function_call_output");
    const revision = check.connectionRevision;
    await h.restart();
    const restored = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.equal(restored.connectionRevision, revision);
    assert.equal(restored.modelChecks["gpt-6-astra"].connectionRevision, revision);
    assert.doesNotMatch(readFileSync(join(h.dir, "llm-key.dpapi.json"), "utf8"), /fake-fixture-key/);
  } finally { await h.stop(); }
});

test("v2/v3 连接文件的检查只在迁移这一次绑定，之后重启不再重铸 revision", { timeout: 90_000 }, async () => {
  const h = await startModelHarness();
  const savedPath = join(h.dir, "llm-key.dpapi.json");
  const saved = () => JSON.parse(readFileSync(savedPath, "utf8")) as any;
  const status = async () => await (await fetch(h.base + "/api/llm")).json() as any;
  try {
    // 旧版单连接文件：没有 connectionRevision，检查也没有任何绑定。没有 cipher 所以不需要 DPAPI。
    await h.restart(() => {
      writeFileSync(savedPath, JSON.stringify({
        version: 3, encryption: "windows-dpapi", provider: "custom", protocol: "openai-compatible",
        baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual",
        modelChecks: { manual: { checkedAt: new Date().toISOString(), chat: "passed", streaming: "passed", tools: "passed", detail: "legacy fixture" } },
        models: [{ id: "manual", created: 10 }], modelsFetchedAt: new Date().toISOString(),
      }, null, 2), "utf8");
    });

    const migrated = saved();
    assert.equal(migrated.version, 4, "迁移必须当场落成 v4，否则每次启动都会重新铸一个 revision 再盖一遍章");
    const revision = migrated.connectionRevision as string;
    assert.match(revision, /^[0-9a-f-]{36}$/);
    assert.equal(migrated.modelChecks.manual.connectionRevision, revision);
    assert.equal((await status()).connectionRevision, revision);

    await h.restart();
    assert.equal(saved().connectionRevision, revision, "重启不得重铸 revision");
    assert.equal(saved().modelChecks.manual.connectionRevision, revision);
    const second = await status();
    assert.equal(second.connectionRevision, revision);
    assert.equal(second.modelChecks.manual.chat, "passed", "迁移绑定过的检查在重启后应当保留");

    // v4 文件里挂一个外来 revision 的检查：迁移已经结束，它必须被丢弃而不是被洗白。
    await h.restart(() => {
      const file = saved();
      file.modelChecks = { manual: { ...file.modelChecks.manual, connectionRevision: "00000000-0000-0000-0000-000000000000" } };
      writeFileSync(savedPath, JSON.stringify(file, null, 2), "utf8");
    });
    assert.deepEqual((await status()).modelChecks, {}, "v4 文件里错配的检查不能在重启时变成有效");
    assert.equal((await status()).connectionRevision, revision);
  } finally { await h.stop(); }
});
