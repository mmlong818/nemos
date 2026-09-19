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
  assert.match(html, /保存并完成配置/);
  assert.match(html, /每个 Key 验证一次连接/);
  assert.match(html, /<details class="model-resource-section model-legacy-settings"/);
  assert.match(html, /高级设置与手工覆盖/);
  assert.ok(html.indexOf("modelQuickOpenAIKey") < html.indexOf("modelLegacySettings"));
  assert.match(script, /\/api\/model-quick-setup/);
  assert.match(script, /activeRequestId/);
  assert.doesNotMatch(script, /sourceUrl|资料来源|收藏|手动登记/);
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
  assert.match(openaiBlock, /model\("gpt-5\.4"/);
  assert.doesNotMatch(openaiBlock, /gpt-6-astra|gpt-5\.6-(?:sol|terra|luna)/);
  assert.doesNotMatch(picker, /gpt-6-astra|gpt-5\.6-(?:sol|terra|luna)/);
});
