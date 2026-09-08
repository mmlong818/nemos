import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const read = (file: string) => readFileSync(`examples/companion/web/assets/${file}`, "utf8");
const browser: any = {};
runInNewContext(read("workflow-catalog.js"), { window: browser });
const catalog = browser.ClownfishWorkflowCatalog;
const script = read("capability-center.js");

test("17 个原能力分为 13 个内置流程 Bot 与 4 个工具，无重复、遗漏或权限提升", () => {
  assert.equal(catalog.workflows.length, 13);
  assert.equal(catalog.tools.length, 4);
  assert.deepEqual(new Set([...catalog.workflows, ...catalog.tools].map((item: any) => item.id)), new Set(catalog.capabilities.map((item: any) => item.id)));
  for (const bot of catalog.workflows) {
    const capability = catalog.capabilities.find((item: any) => item.id === bot.id);
    assert.equal(bot.backendId, capability.backendId);
    assert.equal(bot.format, capability.format);
    assert.equal(bot.href, `/capabilities?bot=${bot.id}`);
    assert.equal(bot.editable, false);
  }
  assert.equal(catalog.resolve("../settings"), undefined);
  assert.equal(catalog.resolve("translate"), undefined);
});

for (const bot of catalog.workflows) test(`${bot.name} 提交仍使用原执行器、材料、交付格式与关闭记忆选项`, async () => {
  let submitted: any;
  const elements: any = {
    "#goalInput": { value: "" }, "#instructionInput": { value: "整理合成资料" },
    "#startTask": {}, "#formatSelect": { value: bot.format }, "#memoryToggle": { checked: false },
  };
  const source = script.slice(script.indexOf("async function startTask()"), script.indexOf("function jobTitle("));
  const context: any = {
    window: { ClownfishPendingMaterials: { prepare: async (items: unknown[]) => items } },
    selectedCapability: () => bot, isQuickTool: () => false, isAvailable: () => true,
    $: (selector: string) => elements[selector], showToast: () => {}, renderExecutionState: () => {},
    state: { materials: [{ name: "S1.txt", text: "仅合成资料" }], handoffChain: [], handoffConversation: [], continuationTaskId: "", parentJobId: "" },
    crypto: { randomUUID: () => "isolated-test" },
    api: async (path: string, options: any) => { submitted = { path, body: JSON.parse(options.body) }; throw new Error("停止在请求边界，不运行用户任务"); },
  };
  await runInNewContext(source + "\nstartTask();", context);
  assert.equal(submitted.path, "/api/agent/job");
  assert.equal(submitted.body.kind, "capability-adhoc");
  assert.equal(submitted.body.capabilityId, bot.backendId);
  assert.equal(submitted.body.format, bot.format);
  assert.equal(submitted.body.memoryMode, "off");
  assert.match(submitted.body.instruction, /整理合成资料[\s\S]*S1.txt[\s\S]*仅合成资料/);
  assert.equal(submitted.body.conversationKey, "");
});

test("Bot 深链接只打开白名单流程，不启动、导入、覆盖草稿或调用模型", async () => {
  for (const id of ["meeting", "presentation", "../settings", "translate"]) {
    const actions: string[] = [];
    const context: any = {
      URLSearchParams, location: { search: `?bot=${encodeURIComponent(id)}`, hash: "" },
      HANDOFF_KEY: "test", sessionStorage: { removeItem() {} }, state: {},
      window: { ClownfishWorkflowCatalog: catalog, setInterval() { return 1; } },
      document: { addEventListener() {} },
      selectCapability: (chosen: string) => actions.push(`select:${chosen}`),
      openCapability: (goal: string) => actions.push(`open:${goal}`),
      showToast: () => actions.push("invalid"),
    };
    for (const fn of ["renderStaticIcons", "migrateLegacyDraft", "bindEvents", "renderCatalog", "renderMaterials", "renderDraftList", "openView", "refreshData"]) context[fn] = () => {};
    await runInNewContext(script.slice(script.indexOf("async function init()")), context);
    assert.deepEqual(actions, catalog.resolve(id) ? [`select:${id}`, "open:"] : ["invalid"]);
  }
});

test("我的 Bot 与执行页共用目录，市场仅展示明确移入的本机条目", () => {
  assert.match(script, /ClownfishWorkflowCatalog\.tools\.map/);
  const market = read("assistant-team.js");
  assert.match(market, /ClownfishWorkflowCatalog\.workflows/);
  assert.match(market, /builtinBotList.*workflows\.map\(workflowCard\)/);
  assert.doesNotMatch(market, /function renderMarket|marketImport/);
  assert.match(market, /b\.marketListed\|\|b\.placement==='market'/);
  assert.match(market, /data-add-team/);
  const botsHtml = readFileSync("examples/companion/web/bots.html", "utf8");
  const marketPane = botsHtml.slice(botsHtml.indexOf('<section id="marketPane"'), botsHtml.indexOf('<footer class="personal-foot"'));
  assert.match(marketPane, /官方技能市场尚未开放/);
  assert.doesNotMatch(marketPane, /marketList|marketSearch|marketImport|data-workflow-bot/);
  for (const page of ["bots", "capabilities"]) {
    const html = readFileSync(`examples/companion/web/${page}.html`, "utf8");
    assert.match(html, /src="\/assets\/workflow-catalog.js"/);
  }
});
