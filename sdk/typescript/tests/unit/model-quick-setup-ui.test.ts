import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd(), "examples", "companion");
const html = readFileSync(join(root, "web", "settings.html"), "utf8");
const script = readFileSync(join(root, "web", "assets", "model-quick-setup.js"), "utf8");
const picker = readFileSync(join(root, "web", "assets", "model-picker.js"), "utf8");
const server = readFileSync(join(root, "server.ts"), "utf8");
const catalog = readFileSync(join(root, "provider-catalog.ts"), "utf8");

test("普通模型设置只要求 OpenAI 与智谱两个 Key 并把手工模型库折叠到高级区", () => {
  assert.match(html, /id="modelQuickOpenAIKey"/);
  assert.match(html, /id="modelQuickZhipuKey"/);
  assert.match(html, /id="modelQuickSubmit" type="button">保存并验证</);
  assert.match(html, /每个 Key 验证一次连接/);
  assert.match(html, /<details class="model-resource-section model-legacy-settings"/);
  assert.match(html, /高级：启用更多型号、恢复推荐、离线模式与诊断/);
  assert.ok(html.indexOf("modelQuickOpenAIKey") < html.indexOf("modelLegacySettings"));
});

// 用户反馈"模型与服务界面非常难用"：两套配置入口、能力状态散在四处、当前用的是哪个模型要进高级区才看得到。
test("模型与服务页顺序：正在使用 → 服务账号 → 各项能力 → 高级；能力表不再藏在高级区", () => {
  const order = ["modelNow", "modelQuickSetupTitle", "modelCapabilityAssignments", "modelLegacySettings"].map((id) => html.indexOf(`id="${id}"`));
  assert.ok(order.every((index) => index > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "四块按顺序排列");
  const advanced = html.slice(html.indexOf('id="modelLegacySettings"'));
  assert.ok(!advanced.includes('id="modelCapabilityAssignments"'), "能力表在高级区之外");
  assert.ok(!advanced.includes('id="modelStatus"'), "保存结果显示在能力表旁边，不在折叠区里");
  assert.ok(html.slice(html.indexOf('id="modelNow"'), html.indexOf('id="modelQuickSetupTitle"')).includes('id="modelQuickRecheck"'), "重新检查放在正在使用里");
  assert.ok(advanced.includes('id="modelQuickRetry"') && advanced.includes('id="modelQuickReset"'), "重新检测、恢复系统推荐收进高级");
  assert.equal((html.match(/id="modelQuickResults"[^>]*hidden/g) || []).length, 1, "一键配置结果不再和能力表重复显示");
  const center = readFileSync(join(root, "web", "assets", "settings-center.js"), "utf8");
  assert.match(center, /function renderModelNow\(state, center\)/);
  assert.doesNotMatch(center, /textContent = "用途设置"/, "不再把能力表标题改回旧名字");
  assert.doesNotMatch(center, /系统会自动筛选、验证并配置推荐模型/, "页头说明以 settings.html 为准，不再被脚本改回旧文案");
  assert.match(center, /const visiblePurposes = \(center\.connections \|\| \[\]\)\.length \? NOW_CAPABILITIES\.filter\(\(capability\) => capabilityOffered\(center, capability\)\) : \[\];/, "没接通的能力不出现在能力表");
  assert.match(center, /NOW_CAPABILITIES\.filter\(\(capability\) => capabilityOffered\(center, capability\)\)\.map/, "也不出现在正在使用");
  assert.match(center, /<details class="model-capability-probe-group"\$\{route\?\.selected \? "" : " open"\}>/, "候选型号测试默认收起，没有可用模型时才展开");
  assert.match(script, /\/api\/model-quick-setup/);
  assert.match(script, /activeRequestId/);
  assert.doesNotMatch(script, /sourceUrl|资料来源|收藏|手动登记/);
});

test("对话型号被取代时，设置页先测试替代型号、通过后才固定到对话", () => {
  const center = readFileSync(join(root, "web", "assets", "settings-center.js"), "utf8");
  assert.match(server, /upgrades: \{ chat: chatUpgrade && chatPick \? \{ \.\.\.chatUpgrade, connectionId: chatPick\.connectionId \} : null \}/);
  assert.match(center, /\$\{modelUpgradeHint\(center\.upgrades\?\.chat\)\}/);
  const handler = center.slice(center.indexOf('closest?.("[data-model-upgrade]")'), center.indexOf('// "正在使用"：每项能力此刻实际走哪个模型'));
  const check = handler.indexOf('api("/api/llm-model/check"'), gate = handler.indexOf('result.checked?.chat !== "passed"'), assign = handler.indexOf('api("/api/llm-routing"');
  assert.ok(check > 0 && gate > check && assign > gate, "先测试、检查通过，再改分配");
  assert.match(handler, /candidateModel: modelId, force: true/);
  assert.match(handler, /可能产生少量费用/);
});

test("自动配置由单一后端接口编排且不会回显密钥", () => {
  assert.match(server, /POST" && url === "\/api\/model-quick-setup/);
  assert.match(server, /ModelQuickSetupCoordinator/);
  assert.match(server, /runModelQuickSetup/);
  assert.match(server, /writeSavedLLMVault/);
  assert.doesNotMatch(script, /console\.(?:log|debug).*key/i);
});

test("OpenAI 公开推荐目录不再混入 Codex 内部模型名", () => {
  const openaiBlock = catalog.slice(catalog.indexOf('providerId: "openai"'), catalog.indexOf('providerId: "anthropic"'));
  assert.match(openaiBlock, /model\("gpt-5\.5", \["chat", "vision"\], OPENAI_MODELS, \{ recommended: true \}\)/);
  assert.doesNotMatch(openaiBlock, /gpt-6-astra|gpt-5\.6-(?:sol|terra|luna)/);
  assert.doesNotMatch(picker, /gpt-6-astra|gpt-5\.6-(?:sol|terra|luna)/);
});
