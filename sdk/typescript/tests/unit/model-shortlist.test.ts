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
const fixture = () => ({
  live: true, model, provider: "openai",
  models: [...recommended, ...Array.from({ length: 84 }, (_, i) => `old-model-${i}`)].map(id => ({ id })),
  modelChecks: Object.fromEntries(recommended.map(id => [id, { chat: "passed", tools: "failed" }])),
});

test("87 candidates become three common models without mutating provider metadata", () => {
  const state = fixture();
  const before = JSON.stringify(state);
  assert.deepEqual(ids(shortlist.shortlist(state)), recommended);
  assert.equal(JSON.stringify(state), before);
  assert.equal(shortlist.catalog(state).length, 87);
  assert.deepEqual(ids(shortlist.taskModels(state)), recommended.slice(1));
});

test("failed connections are excluded; failed tools are not mislabeled as unavailable models", () => {
  const state = fixture();
  state.modelChecks["gpt-5.6-terra"].chat = "failed";
  assert.deepEqual(ids(shortlist.shortlist(state)), [model, "gpt-5.6-luna"]);
  assert.equal(shortlist.checkLabel(state.modelChecks[model]), "仅文字已验证");
  assert.equal(shortlist.checkLabel(undefined), "未检查");
});

test("explicit default remains visible even if failed or absent from the directory", () => {
  const state = { ...fixture(), model: "my-private-model", modelChecks: { "my-private-model": { chat: "failed" } } };
  assert.equal(shortlist.shortlist(state)[0].id, "my-private-model");
  assert.equal(shortlist.shortlist(state).length, 3);
  assert.equal(shortlist.checkLabel(state.modelChecks["my-private-model"]), "连接检查未通过");
});

test("fixed conversations preserve old, missing, and fixed-default selections", () => {
  const state = fixture();
  assert.equal(shortlist.taskModels(state, "old-model-0").at(-1).pinned, true);
  assert.equal(shortlist.taskModels(state, "missing").at(-1).missing, true);
  assert.equal(ids(shortlist.taskModels(state, model)).filter(id => id === model).length, 1);
});

test("other providers retain checked general models, not snapshots or specialized models", () => {
  const names = ["local-main", "local-general", "local-audio", "local-codex", "local-2026-01-01", "local-preview", "unverified"];
  const state = { model: names[0], models: names.map(id => ({ id })), modelChecks: Object.fromEntries(names.slice(0, -1).map(id => [id, { chat: "passed" }])) };
  assert.deepEqual(ids(shortlist.shortlist(state)), names.slice(0, 2));
});

test("empty and duplicate directories are safe", () => {
  assert.equal(shortlist.shortlist(null).length, 0);
  assert.deepEqual(ids(shortlist.catalog({ models: [null, {}, { id: "a" }, { id: "a" }] })), ["a"]);
});

test("actual task selector renders only three options and preserves a fixed old model", () => {
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

test("advanced directory toggling does not submit, change input values, or reuse another provider", () => {
  const source = read("assets/settings-center.js");
  const fn = source.slice(source.indexOf("function renderModelCatalog("), source.indexOf("function renderModel(state"));
  const attrs: any = { "aria-pressed": "false" };
  const elements: any = {
    "#modelCatalog": {}, "#modelCatalogHint": {}, "#modelProvider": { value: "openai" },
    "#modelCatalogToggle": { getAttribute: (key: string) => attrs[key], setAttribute: (key: string, value: string) => attrs[key] = value },
  };
  runInNewContext(fn + "\nrenderModelCatalog(modelState);", {
    window: browser, modelState: fixture(), $: (id: string) => elements[id], escapeHtml: (s: any) => String(s),
    fetch: () => assert.fail("must not call APIs"),
  });
  const count = () => (elements["#modelCatalog"].innerHTML.match(/<option /g) || []).length;
  assert.equal(count(), 3);
  elements["#modelCatalogToggle"].onclick();
  assert.equal(count(), 87);
  elements["#modelCatalogToggle"].onclick();
  assert.equal(count(), 3);
  elements["#modelProvider"].value = "other";
  elements["#modelCatalogToggle"].onclick();
  assert.equal(attrs["aria-pressed"], "false");
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
