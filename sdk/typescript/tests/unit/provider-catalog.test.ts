import assert from "node:assert/strict";
import test from "node:test";
import { companionModelFailureDiagnostic, CompanionModelHttpError, normalizeCompanionModelConnection } from "../../examples/companion/model-connection.js";
import { discoverOfficialProviderCatalog, resolveOfficialProviderBaseUrl } from "../../examples/companion/provider-catalog-discovery.js";
import { PROVIDER_CATALOG, officialProviderEndpoint } from "../../examples/companion/provider-catalog.js";

test("provider catalog has unique ids, sources and no automatic paid probes", () => {
  assert.equal(PROVIDER_CATALOG.version, "2026-09-20.1");
  assert.equal(new Set(PROVIDER_CATALOG.providers.map((item) => item.providerId)).size, PROVIDER_CATALOG.providers.length);
  for (const provider of PROVIDER_CATALOG.providers) {
    assert.equal(provider.verificationPolicy.automaticPaidProbe, false);
    if (provider.providerId !== "custom") assert.ok(provider.sourceUrls.length > 0);
  }
  assert.equal(officialProviderEndpoint("openai", "https://api.openai.com/v1"), true);
  assert.equal(officialProviderEndpoint("openai", "https://gateway.example/v1"), false);
});

test("static and async-media discovery make zero HTTP requests", async () => {
  let requests = 0;
  const fakeFetch = async () => { requests += 1; throw new Error("must not request"); };
  const zhipu = normalizeCompanionModelConnection({ provider: "zhipu", model: "glm-5.3", apiKey: "secret", credentials: { apiKey: "secret" } });
  const staticResult = await discoverOfficialProviderCatalog(zhipu, undefined, fakeFetch);
  assert.equal(staticResult.source, "official-static");
  assert.equal(staticResult.authenticationChecked, false);
  const vidu = normalizeCompanionModelConnection({ provider: "vidu", model: "viduq3-pro", apiKey: "secret", credentials: { apiKey: "secret" } });
  const mediaResult = await discoverOfficialProviderCatalog(vidu, undefined, fakeFetch);
  assert.equal(mediaResult.source, "none");
  assert.equal(mediaResult.generationRequests, 0);
  assert.equal(requests, 0);
});

test("Gemini paginates, keeps actions, maps safe capabilities and merges duplicate ids", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const connection = normalizeCompanionModelConnection({ provider: "gemini", model: "gemini-3.8-flash", apiKey: "secret", credentials: { apiKey: "secret" } });
  const result = await discoverOfficialProviderCatalog(connection, undefined, async (url, init) => {
    seen.push({ url, init });
    const second = url.includes("pageToken=next-1");
    return new Response(JSON.stringify(second
      ? { models: [{ name: "models/gemini-3.8-flash", supportedActions: ["embedContent"] }, { name: "models/gemini-embedding-001", supportedActions: ["embedContent"], inputTokenLimit: 2048 }] }
      : { models: [{ name: "models/gemini-3.8-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["ignored"], supported_actions: ["generateContent", "unknownAction"], inputTokenLimit: 1000000, outputTokenLimit: 8192 }], nextPageToken: "next-1" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(result.models.map((item) => item.id), ["gemini-3.8-flash", "gemini-embedding-001"]);
  assert.deepEqual(result.models[0]?.directory?.supportedActions, ["generateContent", "unknownAction", "embedContent"]);
  assert.deepEqual(result.models[0]?.directory?.capabilities, ["chat", "embedding"]);
  assert.equal(result.models[0]?.directory?.contextTokens, 1000000);
  assert.equal(seen.length, 2);
  assert.equal((seen[0]?.init.headers as Record<string, string>)["x-goog-api-key"], "secret");
  assert.equal((seen[0]?.init.headers as Record<string, string>).Authorization, undefined);
});

test("Gemini rejects token loops, page overflow and a later failed page transactionally", async () => {
  const connection = normalizeCompanionModelConnection({ provider: "gemini", model: "gemini-3.8-flash", apiKey: "secret", credentials: { apiKey: "secret" } });
  await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => Response.json({ models: [{ name: "models/a" }], nextPageToken: "loop" })), /重复分页标记/);
  let pages = 0;
  await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => Response.json({ models: [{ name: `models/${++pages}` }], nextPageToken: `token-${pages}` })), /20 页安全上限/);
  let calls = 0;
  await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => ++calls === 1
    ? Response.json({ models: [{ name: "models/first" }], nextPageToken: "second" })
    : new Response("", { status: 429 })), (error: unknown) => error instanceof CompanionModelHttpError && error.status === 429);
  assert.equal(calls, 2);
});

test("Anthropic catalog uses x-api-key plus version and optional workspace", async () => {
  let headers: Record<string, string> = {};
  const connection = normalizeCompanionModelConnection({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "secret", credentials: { apiKey: "secret" }, providerSettings: { workspaceId: "workspace-a" } });
  await discoverOfficialProviderCatalog(connection, undefined, async (_url, init) => {
    headers = init.headers as Record<string, string>;
    return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5", capabilities: { vision: true, tools: true, disabled: false }, max_input_tokens: 200000, max_tokens: 64000 }] }), { status: 200 });
  });
  assert.equal(headers["x-api-key"], "secret");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers["anthropic-workspace-id"], "workspace-a");
});

test("Anthropic paginates with after_id, preserves headers and merges duplicate metadata", async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const connection = normalizeCompanionModelConnection({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "secret", credentials: { apiKey: "secret" }, providerSettings: { workspaceId: "workspace-a" } });
  const result = await discoverOfficialProviderCatalog(connection, undefined, async (url, init) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return Response.json(seen.length === 1
      ? { data: [{ id: "claude-sonnet-5", capabilities: { vision: true }, max_input_tokens: 200000 }], has_more: true, last_id: "cursor-1" }
      : { data: [{ id: "claude-sonnet-5", capabilities: { tools: true }, max_tokens: 64000 }, { id: "claude-haiku-4-5-20251001" }], has_more: false });
  });
  assert.equal(seen.length, 2);
  assert.match(seen[0]?.url || "", /\/v1\/models\?limit=1000$/);
  assert.match(seen[1]?.url || "", /[?&]after_id=cursor-1(?:&|$)/);
  for (const request of seen) {
    assert.equal(request.headers["x-api-key"], "secret");
    assert.equal(request.headers["anthropic-version"], "2023-06-01");
    assert.equal(request.headers["anthropic-workspace-id"], "workspace-a");
  }
  assert.deepEqual(result.models.map((item) => item.id), ["claude-sonnet-5", "claude-haiku-4-5-20251001"]);
  assert.deepEqual(result.models[0]?.directory?.capabilities, ["vision", "tools"]);
  assert.equal(result.models[0]?.directory?.contextTokens, 200000);
  assert.equal(result.models[0]?.directory?.outputTokens, 64000);
});

test("Anthropic stops on has_more false and rejects unsafe cursors and page overflow", async () => {
  const connection = normalizeCompanionModelConnection({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "secret", credentials: { apiKey: "secret" } });
  let singleCalls = 0;
  await discoverOfficialProviderCatalog(connection, undefined, async () => { singleCalls += 1; return Response.json({ data: [{ id: "one" }], has_more: false, last_id: "ignored" }); });
  assert.equal(singleCalls, 1);
  await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => Response.json({ data: [{ id: "one" }], has_more: true, last_id: "" })), /没有返回 last_id/);
  let loopCalls = 0;
  await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => Response.json({ data: [{ id: `row-${++loopCalls}` }], has_more: true, last_id: "same" })), /重复游标/);
  assert.equal(loopCalls, 2);
  let pages = 0;
  await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => Response.json({ data: [{ id: `row-${++pages}` }], has_more: true, last_id: `cursor-${pages}` })), /20 页安全上限/);
  assert.equal(pages, 20);
});

test("Anthropic later-page auth, quota and timeout failures remain transactional", async () => {
  const connection = normalizeCompanionModelConnection({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "secret", credentials: { apiKey: "secret" } });
  for (const status of [401, 429]) {
    let calls = 0;
    await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => ++calls === 1
      ? Response.json({ data: [{ id: "first" }], has_more: true, last_id: "next" })
      : new Response("", { status })), (error: unknown) => error instanceof CompanionModelHttpError && error.status === status);
    assert.equal(calls, 2);
  }
  let timeoutCalls = 0;
  await assert.rejects(discoverOfficialProviderCatalog(connection, undefined, async () => {
    timeoutCalls += 1;
    if (timeoutCalls === 1) return Response.json({ data: [{ id: "first" }], has_more: true, last_id: "next" });
    throw new DOMException("timeout", "AbortError");
  }), (error: unknown) => companionModelFailureDiagnostic(error)?.networkKind === "timeout");
  assert.equal(timeoutCalls, 2);
});

test("Claude retains safe capabilities and token limits without marking them verified", async () => {
  const connection = normalizeCompanionModelConnection({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "secret", credentials: { apiKey: "secret" } });
  const result = await discoverOfficialProviderCatalog(connection, undefined, async () => Response.json({ data: [{ id: "claude-sonnet-5", capabilities: { vision: true, tools: {} }, max_input_tokens: 200000, max_tokens: 64000 }] }));
  assert.deepEqual(result.models[0]?.directory?.capabilities, ["vision", "tools"]);
  assert.equal(result.models[0]?.directory?.contextTokens, 200000);
  assert.equal(result.models[0]?.directory?.outputTokens, 64000);
  assert.equal(result.authenticationChecked, true);
  assert.equal("verified" in (result.models[0] || {}), false);
});

test("OpenAI and MiniMax use Bearer model-list requests", async () => {
  for (const provider of ["openai", "minimax"] as const) {
    const connection = normalizeCompanionModelConnection({ provider, model: provider === "openai" ? "gpt-6-astra" : "MiniMax-M3", apiKey: "secret", credentials: { apiKey: "secret" } });
    let seenUrl = ""; let seenHeaders: Record<string, string> = {};
    await discoverOfficialProviderCatalog(connection, undefined, async (url, init) => { seenUrl = url; seenHeaders = init.headers as Record<string, string>; return Response.json({ data: [{ id: "visible-model" }] }); });
    assert.equal(seenHeaders.Authorization, "Bearer secret");
    assert.match(seenUrl, /\/models$/);
  }
});

test("Bailian paginates and preserves capabilities, modalities, pricing and context", async () => {
  const connection = normalizeCompanionModelConnection({ provider: "qwen", model: "qwen3.8-max", apiKey: "secret", credentials: { apiKey: "secret" }, providerSettings: { region: "singapore" } });
  let calls = 0;
  const result = await discoverOfficialProviderCatalog(connection, undefined, async () => {
    calls += 1;
    return Response.json(calls === 1
      ? { data: { models: [{ id: "qwen3.8-max", capabilities: ["text-generation"], modalities: ["text"], price: { input: "0.1" }, context_length: 1000000 }], has_more: true } }
      : { data: { models: [{ id: "wan3.0-video", capabilities: ["video-generation"], modalities: ["text", "video"] }], has_more: false } });
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.models[0]?.directory, { capabilities: ["text-generation"], modalities: ["text"], contextTokens: 1000000, pricing: { input: "0.1" } });
  assert.deepEqual(result.models[1]?.directory?.modalities, ["text", "video"]);
});

test("catalog errors stay classified and Bailian region/workspace fail before HTTP", async () => {
  const openai = normalizeCompanionModelConnection({ provider: "openai", model: "gpt-6-astra", apiKey: "secret", credentials: { apiKey: "secret" } });
  for (const status of [401, 403, 404, 429]) {
    await assert.rejects(discoverOfficialProviderCatalog(openai, undefined, async () => new Response("", { status })), (error: unknown) => error instanceof CompanionModelHttpError && error.status === status);
  }
  assert.deepEqual(companionModelFailureDiagnostic(new DOMException("timeout", "AbortError")), { category: "network", networkKind: "timeout" });
  assert.throws(() => resolveOfficialProviderBaseUrl({ provider: "qwen", baseUrl: "", providerSettings: { region: "unknown" } }), /不支持的百炼服务区域/);
  assert.throws(() => resolveOfficialProviderBaseUrl({ provider: "qwen", baseUrl: "", providerSettings: { region: "beijing-workspace" } }), /Workspace ID/);
});

test("Ark stores endpoint id separately and never mistakes the base model for it", async () => {
  const connection = normalizeCompanionModelConnection({ provider: "volcengine", model: "doubao-seed-2-0-lite-260215", apiKey: "secret", credentials: { apiKey: "secret" }, providerSettings: { endpointId: "ep-20260919" } });
  const result = await discoverOfficialProviderCatalog(connection, undefined, async () => { throw new Error("must not request"); });
  assert.deepEqual(result.models, [{ id: "ep-20260919", displayName: "接入点 ep-20260919" }]);
});
