import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

// 用户：“模型与服务页面仔细整理清楚，哪些必须，哪些无用”。整理后主页面只有状态、服务账号、各项能力三块，
// 每件事一个入口；显示名只写型号（gpt-5.5 → gpt 5.5）。
const web = join(process.cwd(), "examples", "companion", "web");
const html = readFileSync(join(web, "settings.html"), "utf8");
const center = readFileSync(join(web, "assets", "settings-center.js"), "utf8");
const quick = readFileSync(join(web, "assets", "model-quick-setup.js"), "utf8");
const panel = html.slice(html.indexOf('data-panel="models"'), html.indexOf('data-panel="connections"'));
const advanced = panel.slice(panel.indexOf('id="modelLegacySettings"'));

test("主页面依次是状态、服务账号、各项能力，偶尔用的都在高级里", () => {
  const order = ['id="modelNow"', 'id="modelAccountList"', 'id="modelConnectPanel"', 'id="modelCapabilityAssignments"', 'id="modelLegacySettings"'].map((marker) => panel.indexOf(marker));
  assert.ok(order.every((index) => index > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(!advanced.includes('id="modelForm"'), "添加服务的表单在服务账号里，不在高级区");
  for (const id of ["modelOffline", "modelQuickReset", "modelProviderConnections", "modelCheckList"]) assert.ok(advanced.includes(`id="${id}"`), id);
  assert.match(panel, /<section class="model-resource-section" hidden>\s*<h3>推荐型号<\/h3>/, "推荐型号与下拉框、升级提示重复，只保留元素不显示");
  assert.match(panel, /id="modelConnectProgress"[^>]*\shidden\s*>/, "流程图不显示");
  assert.match(panel, /<div class="model-connect-panel" id="modelConnectPanel" hidden>/, "添加服务的表单平时收起");
  assert.doesNotMatch(center, /model-library-steps|复选并启用/, "模型库不再有三步说明");
});

function extract(start: string, end: string): string {
  const from = center.indexOf(start);
  const to = center.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return center.slice(from, to);
}

test("下拉框只写型号；同一型号来自两个服务时才补服务名；智谱不显示内部地址", () => {
  const source = extract("const PROVIDER_SHORT_NAMES", "function policyControlKey") + extract("function assignmentOptions", "const effortLabels");
  const api = runInNewContext(`${source}\n({ modelDisplayName, connectionDisplayName, assignmentOptions });`, { escapeHtml: (value: unknown) => String(value) });
  assert.equal(api.modelDisplayName("gpt-5.5"), "gpt 5.5");
  assert.equal(api.modelDisplayName("gpt-image-2.5-sunburst"), "gpt image 2.5 sunburst");
  assert.equal(api.connectionDisplayName({ provider: "zhipu", label: "zhipu · https://open.bigmodel.cn/api/paas/v4" }), "智谱");
  assert.equal(api.connectionDisplayName({ provider: "openai", label: "OpenAI" }), "OpenAI");
  const verified = (connectionId: string, modelId: string) => ({ connectionId, modelId, capabilities: ["chat"], evidence: { verified: true }, executionState: { chat: "available" } });
  const connections = [{ id: "a", provider: "openai", label: "OpenAI" }, { id: "b", provider: "zhipu", label: "zhipu · https://open.bigmodel.cn/api/paas/v4" }, { id: "c", provider: "custom", label: "公司网关" }];
  const options = api.assignmentOptions({ connections, resources: [verified("a", "gpt-5.5"), verified("b", "glm-5.3"), verified("c", "gpt-5.5")] }, "chat", "auto", true, { autoLabel: "自动（当前 gpt 5.5）" });
  assert.match(options, />自动（当前 gpt 5.5）</);
  assert.match(options, />glm 5\.3</, "只有一个来源时不带服务名");
  assert.match(options, />gpt 5\.5 · OpenAI</);
  assert.match(options, />gpt 5\.5 · 公司网关</, "同名型号补上服务名区分");
});

test("服务账号每行写明用于哪些能力，没分到的写备用；OpenAI/智谱已连上时收起快速卡片", () => {
  const accounts = extract("function renderAccounts(center)", "function openConnectPanel()");
  assert.match(accounts, /用于：\$\{used\.length \? escapeHtml\(used\.join\("、"\)\) : "备用"\}/);
  assert.match(accounts, /\.sort\(\(left, right\) => usedCount\(right\) - usedCount\(left\)\)/, "正在用的服务排前面");
  assert.match(accounts, /const show = !connected\(card\.dataset\.quickProvider\) \|\| rekeyProvider === card\.dataset\.quickProvider;/);
  assert.match(center, /if \(provider === "openai" \|\| provider === "zhipu"\) \{\n\s*rekeyProvider = provider;/, "换 Key 就地展开对应卡片");
});

test("修掉的矛盾：旧结论不残留、目录误报、媒体型号显示未验证", () => {
  assert.match(quick, /status\.textContent = ranThisPage \? snapshot\?\.message \|\| "" : "";/, "上一次配置的结论只在本页操作后显示");
  const missing = extract("function savedModelMissingFromCatalog(state)", "function syncModelChoice()");
  const check = runInNewContext(`${missing}\nsavedModelMissingFromCatalog;`, { window: { ClownfishModelShortlist: { catalog: () => [{ id: "gpt-5.4" }] } } });
  const state = (rawModels: unknown[]) => ({ live: true, model: "gpt-5.5", resourceCenter: { connections: [{ active: true, rawModels, enabledModels: [] }] } });
  assert.equal(check(state([{ id: "gpt-5.5" }])), false, "账号目录里有就不是缺失");
  assert.equal(check(state(["gpt-5.5"])), false);
  assert.equal(check(state([{ id: "gpt-5.4" }])), true);
  assert.match(center, /check\?\.chat === "passed" \|\| mediaVerified\(item\.id\) \? "已验证"/, "语音、图片、朗读型号按各自能力的检查算已验证");
});
