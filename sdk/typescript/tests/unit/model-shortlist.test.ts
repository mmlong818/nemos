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
  favoriteModels: ["my-private-model", "gpt-5.6-terra", "favorite-four", "favorite-five"],
  models: [...recommended, "image-special", ...Array.from({ length: 83 }, (_, i) => `old-model-${i}`)].map(id => ({ id })),
  modelChecks: Object.fromEntries(recommended.map(id => [id, { chat: "passed", tools: "failed", connectionRevision: "revision-1", checkedAt }])),
});

test("provider catalog stays separate from unlimited favorites and verified daily candidates", () => {
  const state = fixture();
  const before = JSON.stringify(state);
  assert.deepEqual(ids(shortlist.shortlist(state)), [model, "my-private-model", "gpt-5.6-terra", "favorite-four", "favorite-five", "gpt-5.6-luna"]);
  assert.equal(JSON.stringify(state), before);
  assert.equal(shortlist.catalog(state).length, 87);
  assert.deepEqual(ids(shortlist.taskModels(state)), ["my-private-model", "gpt-5.6-terra", "favorite-four", "favorite-five", "gpt-5.6-luna"]);
  assert.equal(shortlist.shortlist(state).some((item:any)=>item.id === "old-model-0"), false);
});

test("failed connections are excluded; failed tools are not mislabeled as unavailable models", () => {
  const state = fixture();
  state.modelChecks["gpt-5.6-terra"].chat = "failed";
  assert.ok(ids(shortlist.shortlist(state)).includes("gpt-5.6-terra"), "a failed favorite remains visible with its failure state");
  assert.equal(shortlist.checkLabel(state.modelChecks[model]), "仅文字已验证");
  assert.equal(shortlist.checkLabel(undefined), "未验证");
});

test("explicit default and manually added IDs remain visible even when unverified or absent from directory", () => {
  const state = { ...fixture(), model: "outside-default", favoriteModels: ["outside-favorite"], modelChecks: {} };
  assert.deepEqual(ids(shortlist.shortlist(state)), ["outside-default", "outside-favorite"]);
  assert.match(shortlist.label(shortlist.shortlist(state)[1], state), /用户添加.*未验证/);
});

test("fixed conversations preserve old, missing, and fixed-default selections", () => {
  const state = fixture();
  assert.equal(shortlist.taskModels(state, "old-model-0").at(-1).pinned, true);
  assert.equal(shortlist.taskModels(state, "missing").at(-1).missing, true);
  assert.equal(ids(shortlist.taskModels(state, model)).filter(id => id === model).length, 1);
});

test("names only recommend a purpose and never hide a verified or favorited model", () => {
  const names = ["local-main", "local-general", "local-audio", "local-codex", "local-2026-01-01", "local-preview", "unverified"];
  const state = { model: names[0], connectionRevision:"revision-2", catalogConnectionRevision:"revision-2", favoriteModels:["unverified"], models: names.map(id => ({ id })), modelChecks: Object.fromEntries(names.slice(0, -1).map(id => [id, { chat: "passed", connectionRevision:"revision-2", checkedAt }])) };
  assert.deepEqual(ids(shortlist.shortlist(state)), [names[0], "unverified", ...names.slice(1, -1)]);
  assert.match(shortlist.recommendation({id:"local-audio"}), /可能/);
});

test("stale catalog and checks stay visible but cannot qualify a model", () => {
  const state = fixture(); state.connectionRevision="new";
  assert.equal(shortlist.catalogState(state), "stale");
  assert.equal(shortlist.checkLabel(state.modelChecks[model], state), "检查已过期");
  assert.deepEqual(ids(shortlist.shortlist({...state,favoriteModels:[]})), [model]);
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
      assert.equal((select.innerHTML.match(/<option /g) || []).length, selected === "default" ? 6 : 7);
      assert.match(select.innerHTML, /仅文字已验证/);
    }
  }
});

test("search opens the full provider directory without changing selection or making requests", () => {
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
  elements["#modelCatalogToggle"].onclick();
  assert.equal(elements["#modelCatalogPanel"].hidden, false);
  assert.equal(elements["#modelCatalogSearch"].value, "");
  assert.equal(count(), 6);
  elements["#modelCatalogSearch"].value = "old-model";
  elements["#modelCatalogSearch"].oninput();
  assert.equal(count(), 83);
  assert.equal(attrs["aria-expanded"], "true");
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
