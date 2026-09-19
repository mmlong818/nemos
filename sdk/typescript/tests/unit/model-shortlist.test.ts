import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const read = (name: string) => readFileSync(`examples/companion/web/${name}`, "utf8");
const browser: any = {};
runInNewContext(read("assets/model-shortlist.js"), { window: browser });
const shortlist = browser.ClownfishModelShortlist;
const ids = (items: any[]) => Array.from(items, item => item.id);
const model = "gpt-6-astra";
const recommended = [model, "gpt-5.6-terra", "gpt-5.6-luna"];
const checkedAt = new Date().toISOString();
const fixture = () => ({
  live: true, model, provider: "openai", connectionRevision: "revision-1", catalogConnectionRevision: "revision-1",
  registeredModels: ["my-private-model", "gpt-5.6-terra", "registered-four", "registered-five"],
  models: recommended.map(id => ({ id })),
  rawModels: [...recommended, "image-special", ...Array.from({ length: 83 }, (_, i) => `old-model-${i}`)].map(id => ({ id })),
  modelChecks: Object.fromEntries(recommended.map(id => [id, { chat: "passed", tools: "failed", connectionRevision: "revision-1", checkedAt }])),
});

test("provider catalog stays separate from registered models and verified daily candidates", () => {
  const state = fixture();
  const before = JSON.stringify(state);
  assert.deepEqual(ids(shortlist.shortlist(state)), [model, "gpt-5.6-terra", "gpt-5.6-luna"]);
  assert.equal(JSON.stringify(state), before);
  assert.equal(shortlist.catalog(state).length, 3);
  assert.equal(shortlist.rawCatalog(state).length, 87);
  assert.deepEqual(ids(shortlist.taskModels(state)), ["gpt-5.6-terra", "gpt-5.6-luna"]);
  assert.equal(shortlist.shortlist(state).some((item:any)=>item.id === "old-model-0"), false);
});

test("failed connections are excluded; failed tools are not mislabeled as unavailable models", () => {
  const state = fixture();
  state.modelChecks["gpt-5.6-terra"].chat = "failed";
  assert.equal(ids(shortlist.shortlist(state)).includes("gpt-5.6-terra"), false, "失败型号不进入任务短名单");
  assert.equal(shortlist.checkLabel(state.modelChecks[model]), "仅文字已验证");
  assert.equal(shortlist.checkLabel(undefined), "未验证");
});

test("explicit default and manually added IDs remain visible even when unverified or absent from directory", () => {
  const state = { ...fixture(), model: "outside-default", registeredModels: ["outside-registered"], modelChecks: {} };
  assert.deepEqual(ids(shortlist.shortlist(state)), ["outside-default"]);
  assert.match(shortlist.label(shortlist.shortlist(state)[0], state), /旧引用/);
});

test("fixed conversations preserve old, missing, and fixed-default selections", () => {
  const state = fixture();
  assert.equal(shortlist.taskModels(state, "old-model-0").at(-1).pinned, true);
  assert.equal(shortlist.taskModels(state, "missing").at(-1).missing, true);
  assert.equal(ids(shortlist.taskModels(state, model)).filter(id => id === model).length, 1);
});

test("names only recommend a purpose and never hide a verified or registered model", () => {
  const names = ["local-main", "local-general", "local-audio", "local-codex", "local-2026-01-01", "local-preview", "unverified"];
  const state = { model: names[0], connectionRevision:"revision-2", catalogConnectionRevision:"revision-2", registeredModels:["unverified"], models: names.map(id => ({ id })), modelChecks: Object.fromEntries(names.slice(0, -1).map(id => [id, { chat: "passed", connectionRevision:"revision-2", checkedAt }])) };
  assert.deepEqual(ids(shortlist.shortlist(state)), [names[0], ...names.slice(1, -1)]);
  assert.match(shortlist.recommendation({id:"local-audio"}), /可能/);
});

test("stale catalog and checks stay visible but cannot qualify a model", () => {
  const state = fixture(); state.connectionRevision="new";
  assert.equal(shortlist.catalogState(state), "stale");
  assert.equal(shortlist.checkLabel(state.modelChecks[model], state), "检查已过期");
  assert.deepEqual(ids(shortlist.shortlist({...state,registeredModels:[]})), [model]);
});

test("empty and duplicate directories are safe", () => {
  assert.equal(shortlist.shortlist(null).length, 0);
  assert.deepEqual(ids(shortlist.catalog({ models: [null, {}, { id: "a" }, { id: "a" }] })), ["a"]);
});

test("actual task selector renders every added or verified candidate and preserves a fixed old model", () => {
  const source = read("index.html");
  const fn = source.slice(source.indexOf("function syncTaskModelSelector()"), source.indexOf("function setActiveWorkMode("));
  for (const selected of ["default", "old-model-0", model, "missing"]) {
    const elements: any = { "#taskModelSelect": {}, "#heroModelSelect": {} };
    runInNewContext(fn + "\nsyncTaskModelSelector();", {
      $: (id: string) => elements[id], state: { target: { id: "assistant" } }, APP_PERSONA_ID: "assistant",
      activeConversation: () => ({ config: { model: selected } }), modelConnectionState: fixture(),
      window: browser, changeTaskModel: () => assert.fail("must not trigger model checks"), esc: (s: any) => String(s),
    });
    for (const select of Object.values(elements) as any[]) {
      assert.equal(select.value, selected);
      assert.equal(select.hidden, false);
      assert.equal((select.innerHTML.match(/<option /g) || []).length, selected === "default" ? 3 : 4);
      assert.match(select.innerHTML, /仅文字已验证/);
    }
  }
});

test("settings picker shows the full provider directory without changing selection or making requests", () => {
  const source = read("assets/settings-center.js");
  const fn = source.slice(source.indexOf("function renderModelCatalog("), source.indexOf("function renderModel(state"));
  const attrs: any = {};
  const body: any = { appendChild: (element: any) => { element.parentElement = body; } };
  const elements: any = {
    "#modelCatalogSearch": { value: "old-model", focus() {} }, "#modelCatalogSummary": {}, "#modelCatalogHint": {},
    "#modelCatalogResults": {}, "#modelCatalogPanel": { hidden: true },
    "#modelCatalogToggle": {}, "#modelCatalogClose": {},
    "#modelChoiceOpen": { setAttribute: (key: string, value: string) => attrs[key] = value, focus() {} },
  };
  runInNewContext(fn + "\nrenderModelCatalog(modelState);", {
    window: browser, modelState: fixture(), $: (id: string) => elements[id], escapeHtml: (s: any) => String(s),
    modelCheckLabel: (check: any, state: any) => shortlist.checkLabel(check, state),
    document: { body },
    fetch: () => assert.fail("must not call APIs"),
  });
  const count = () => (elements["#modelCatalogResults"].innerHTML.match(/<article /g) || []).length;
  assert.equal(count(), 83);
  elements["#modelChoiceOpen"].onclick();
  assert.equal(elements["#modelCatalogPanel"].hidden, false);
  assert.equal(elements["#modelCatalogSearch"].value, "");
  assert.equal(count(), 87, "展开完整目录后无需再次搜索即可浏览账号目录与维护推荐");
  elements["#modelCatalogSearch"].value = "old-model";
  elements["#modelCatalogSearch"].oninput();
  assert.equal(count(), 83);
  assert.equal(attrs["aria-expanded"], "true");
});

test("settings directory summary exposes only safe declared capability metadata", () => {
  const source = read("assets/settings-center.js");
  const helper = source.slice(source.indexOf("function safeDirectorySummary("), source.indexOf("function renderModelCatalog("));
  const context: any = {
    item: { directory: { supportedActions: ["generateContent", "<unsafe>"], capabilities: ["vision"], modalities: ["text", "image"], contextTokens: 200000, outputTokens: 64000, pricing: { secret: "must-not-render" }, privateObject: { token: "must-not-render" } } },
  };
  runInNewContext(`${helper}\nresult = safeDirectorySummary(item);`, context);
  assert.match(context.result, /操作 generateContent/);
  assert.match(context.result, /能力 vision/);
  assert.match(context.result, /模态 text、image/);
  assert.match(context.result, /上下文 200,000 tokens/);
  assert.match(context.result, /输出 64,000 tokens/);
  assert.match(context.result, /目录声明，尚未验证/);
  assert.doesNotMatch(context.result, /unsafe|secret|must-not-render|pricing|privateObject/);
  assert.doesNotMatch(helper, /JSON\.stringify|\.pricing/);
});

test("a saved model absent from the current provider catalog is only replaced in the form", () => {
  const source = read("assets/settings-center.js");
  const helpers = source.slice(source.indexOf("function selectedCatalogModel"), source.indexOf("function syncModelChoice"));
  const render = source.slice(source.indexOf("function renderModel(state"), source.indexOf("async function loadModel"));
  const elements: any = {
    "#modelCurrentTitle": {}, "#modelCurrentDetail": {},
    "#modelDot": { classList: { toggle() {} } }, "#modelOffline": {}, "#modelCatalogToggle": {},
    "#modelCheckList": {}, "#modelProvider": {}, "#modelProtocol": {}, "#modelBaseUrl": {},
    "#modelName": { value: "" }, "#modelSelectionMode": {}, "#modelConnectionId": { value: "" },
    "#modelChoiceOpen": { querySelector: () => ({ textContent: "" }) },
  };
  const state = {
    live: true, provider: "zhipu", providerName: "智谱 GLM", protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "gpt-5.6-terra", selectionMode: "manual",
    models: [{ id: "glm-5.3" }, { id: "glm-5.2" }], modelChecks: {}, providers: [{ id: "zhipu", model: "glm-5.2" }],
  };
  let catalogRenders = 0;
  runInNewContext(helpers + render + "\nrenderModel(state, true);", {
    window: { ClownfishModelShortlist: shortlist }, state, $: (id: string) => elements[id],
    preset: (id: string) => id === "zhipu" ? { id, model: "glm-5.2" } : undefined,
    modelCheckLabel: () => "未验证", renderModelCatalog: () => { catalogRenders += 1; }, renderResourceCenter: () => {},
    updateModelHints: () => {}, syncModelChoice: () => {}, syncPolicyControlsFromServer: () => {}, captureModelUiState: () => ({}), restoreModelUiState: () => {}, escapeHtml: (value: unknown) => String(value),
  });
  assert.equal(elements["#modelName"].value, "gpt-5.6-terra", "已有固定引用不得被目录首项静默替换");
  assert.match(elements["#modelCurrentDetail"].textContent, /不在当前服务商目录.*不表示 API Key 失败.*保存后才会替换/);
  assert.equal(catalogRenders, 1);
  assert.equal(state.model, "gpt-5.6-terra", "rendering does not mutate the saved connection state");
});

test("changing provider clears the old model and enters explicit auto selection", () => {
  const source = read("assets/settings-center.js");
  const fn = source.slice(source.indexOf('$("#modelProvider").onchange'), source.indexOf('  $("#modelCatalogResults").onclick'));
  const elements: any = {
    "#modelProvider": { value: "zhipu" },
    "#modelProtocol": {}, "#modelBaseUrl": {}, "#modelName": { value: "gpt-5.6-terra" }, "#modelSelectionMode": {}, "#modelKey": {},
  };
  let synced = 0;
  runInNewContext(fn + '\nelements["#modelProvider"].onchange();', {
    $: (id: string) => elements[id], elements,
    modelState: { provider: "openai" },
    preset: (id: string) => id === "zhipu" ? { id, protocol: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.2" } : undefined,
    syncModelChoice: () => { synced += 1; }, updateModelHints: () => {},
  });
  assert.equal(elements["#modelProtocol"].value, "openai-compatible");
  assert.equal(elements["#modelBaseUrl"].value, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(elements["#modelName"].value, "");
  assert.equal(elements["#modelSelectionMode"].value, "auto");
  assert.equal(synced, 1);
});

test("settings sends every visible candidate to the server admission gate", async () => {
  const source = read("assets/settings-center.js");
  const fn = source.slice(source.indexOf("async function handleModelLibraryClick"), source.indexOf('  $("#modelCustomAdd").onclick'));
  const execute = async (id: string, catalogIds: string[], state: Record<string, unknown> = {}) => {
    const elements: any = { "#modelCatalogStatus": {}, "#modelCatalogResults": {} };
    const check: any = { dataset: { modelCheck: id }, disabled: false };
    const calls: any[] = [];
    const status = await runInNewContext(fn + '\n(async () => { await elements["#modelCatalogResults"].onclick({ target: { closest: (selector) => selector === "[data-model-check]" ? check : null } }); return elements["#modelCatalogStatus"].textContent; })();', {
      elements,
      check,
      $: (selector: string) => selector === "#modelCatalogResults" ? elements["#modelCatalogResults"] : elements[selector],
      modelState: { models: catalogIds.map((model) => ({ id: model })), ...state },
      window: { ClownfishModelShortlist: shortlist }, confirm: () => true, closeModelCatalog: () => {},
      renderModel: () => {}, restoreSelectedConnectionContext: () => {}, currentConnectionId: () => undefined, safeModelDiagnostic: (value: any) => value?.category === "parameter" ? "请求参数（HTTP 400）" : null,
      api: async (path: string, options: any) => { calls.push({ path, body: JSON.parse(options.body) }); return { checked: { detail: "文字回复检查未通过。", diagnostic: { category: "parameter", httpStatus: 400 } } }; },
    });
    return { calls, status };
  };
  const candidate = await execute("catalog-model", ["catalog-model"]);
  assert.deepEqual(candidate.calls, [{ path: "/api/llm-model/check", body: { candidateModel: "catalog-model", force: true } }]);
  assert.match(candidate.status, /文字回复检查未通过.*请求参数（HTTP 400）/);
  const registered = await execute("manual-model", ["catalog-model"], { registeredModels: ["manual-model"] });
  assert.deepEqual(registered.calls, [{ path: "/api/llm-model/check", body: { candidateModel: "manual-model", force: true } }]);
  const outsider = await execute("outside-model", ["catalog-model"]);
  assert.deepEqual(outsider.calls, [{ path: "/api/llm-model/check", body: { candidateModel: "outside-model", force: true } }]);
});

test("settings only renders a whitelisted diagnostic and never arbitrary provider text", () => {
  const source = read("assets/settings-center.js");
  const fn = source.slice(source.indexOf("function safeModelDiagnostic"), source.indexOf("function renderModelCatalog"));
  const value = runInNewContext(fn + '\n[safeModelDiagnostic({ category: "parameter", httpStatus: 400, requestId: "req_safe-7", providerCode: "1213" }), safeModelDiagnostic({ category: "parameter", httpStatus: 400, requestId: "secret body with spaces", providerCode: "provider secret" }), safeModelDiagnostic({ category: "unknown", body: "provider-secret" })];', {});
  assert.deepEqual(Array.from(value), ["请求参数（HTTP 400） · 错误代码 1213 · 请求 ID req_safe-7", "请求参数（HTTP 400）", null]);
  assert.doesNotMatch(JSON.stringify(value), /provider-secret|secret body/);
});

test("settings shows the safe catalog-refresh diagnostic without provider text", async () => {
  const source = read("assets/settings-center.js");
  const fn = source.slice(source.indexOf('$("#modelCatalogRefresh").onclick'), source.indexOf('  function showConnectSteps'));
  const elements: any = { "#modelCatalogRefresh": { disabled: false }, "#modelCatalogStatus": {} };
  const failure = Object.assign(new Error("模型目录刷新失败。"), {
    modelDiagnostic: "模型不可用（HTTP 404） · 请求 ID req_catalog-7",
  });
  await runInNewContext(fn + '\n(async () => { await elements["#modelCatalogRefresh"].onclick(); })();', {
    elements, $: (id: string) => elements[id], currentConnectionId: () => undefined, renderModel: () => {},
    api: async () => { throw failure; },
  });
  assert.equal(elements["#modelCatalogStatus"].textContent, "模型目录刷新失败。 模型不可用（HTTP 404） · 请求 ID req_catalog-7");
  assert.equal(elements["#modelCatalogRefresh"].disabled, false);
});

test("settings saves and discovers first while paid verification stays explicit", () => {
  const html = read("settings.html");
  const script = read("assets/settings-center.js");
  assert.match(script, /textContent = "保存并读取模型"/);
  assert.match(html, /id="modelConnectProgress"/);
  assert.match(html, /id="modelCapabilityAssignments"/);
  assert.match(html, /高级选择与诊断/);
  assert.match(script, /id="modelSaveOnly"/);
  assert.match(script, /id="modelConnectCancel"/);
  assert.match(script, /api\("\/api\/llm-connection\/save"/);
  assert.match(script, /api\("\/api\/llm-model\/catalog"/);
  assert.match(script, /id="modelTest"/);
  assert.match(script, /api\("\/api\/llm-model\/check"/);
  assert.match(script, /api\("\/api\/llm-routing"/);
  assert.match(script, /连接已经保存；已完成的步骤不会丢失/);
  assert.match(script, /目录可见不代表能力已验证/);
  assert.match(script, /系统没有创建任务或产生模型费用/);
  assert.match(script, /if \(activeOnboardingController\) return/);
  assert.match(script, /75_000/);
  assert.match(script, /let selectedConnectionId = null/);
  assert.match(script, /function restoreSelectedConnectionContext/);
  assert.match(script, /selectedConnectionId = item\.id/);
  assert.match(script, /restoreSelectedConnectionContext\(state, \{ hydrate: true \}\)/);
  assert.match(script, /connectionId: currentConnectionId\(\)/);
  assert.match(script, /shortlist\.rawCatalog/);
  assert.match(script, /不会影响推荐、默认型号或自动路由/);
  assert.match(script, /\$\("#modelKey"\)\.value = ""/);
  assert.doesNotMatch(script, /modelState\.(?:key|apiKey)/);
});

test("fixed routing stays visible for a read-only runtime snapshot and an offline historical reference", () => {
  const source = read("assets/settings-center.js");
  const fn = source.slice(source.indexOf("function resourceOption"), source.indexOf("function policyControlKey"))
    + source.slice(source.indexOf("function assignmentOptions"), source.indexOf("const effortLabels"));
  const selected = JSON.stringify(["connection-a", "old-model"]);
  const [running, offline] = runInNewContext(fn + `\n[
    assignmentOptions({ connections: [{ id: "connection-a", label: "主连接" }], resources: [{ connectionId: "connection-a", modelId: "old-model", capabilities: ["chat"], runtimeSnapshot: true, readOnly: true, evidence: { verified: true }, executionState: { chat: "available" } }] }, "chat", ${JSON.stringify(selected)}, true),
    assignmentOptions({ connections: [], resources: [] }, "chat", ${JSON.stringify(selected)}, true)
  ];`, { escapeHtml: (value: unknown) => String(value) });
  assert.match(running, /selected disabled>.*old-model.*当前仍在运行/);
  assert.doesNotMatch(running, /value="auto" selected/);
  assert.match(offline, /old-model · 已保存固定引用，当前未连接或不可用/);
  assert.match(offline, /selected disabled/);
});

test("both pages load the shared policy before its consumers", () => {
  for (const file of ["index.html", "settings.html"]) {
    const html = read(file);
    assert.equal((html.match(/src="\/assets\/model-shortlist.js"/g) || []).length, 1);
    assert.ok(html.indexOf('/assets/model-shortlist.js') < html.indexOf(file === "index.html" ? "function syncTaskModelSelector()" : '/assets/settings-center.js'));
  }
});

test("conversation requests preserve selected effort, use auto for unsupported choices, and keep execution budgets separate", () => {
  const html = read("index.html");
  const fn = html.slice(html.indexOf("function conversationRequestOptions(key)"), html.indexOf("function saveLogs()"));
  for (const effort of ["high", "none", undefined]) {
    const result = runInNewContext(fn + '\nconversationRequestOptions("qa");', {
      activeConversation: () => ({ id: "qa", config: { model: "default", reasoningEffort: effort, reasoning: "fast", toolMode: "off", workMode: "chat" } }),
      normalizeWorkMode: (mode: string) => mode,
      modelConnectionState: { model: "gpt-6-astra", reasoningEfforts: { "gpt-6-astra": ["low", "medium", "high"] } },
    });
    assert.equal(result.reasoningEffort, effort === "high" ? "high" : "auto");
    assert.equal(result.reasoning, "fast");
    assert.equal(result.toolMode, "off");
  }
});
