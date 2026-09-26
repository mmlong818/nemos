import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// 以全新数据目录走查新用户首次使用时发现的问题：引导后无处输入、没连模型却没有任何说明、
// 不知道去哪申请 Key、填错 Key 只看到 HTTP 状态码。
const root = join(process.cwd(), "examples", "companion");
const index = readFileSync(join(root, "web", "index.html"), "utf8");
const settings = readFileSync(join(root, "web", "settings.html"), "utf8");
const center = readFileSync(join(root, "web", "assets", "settings-center.js"), "utf8");
const server = readFileSync(join(root, "server.ts"), "utf8");

test("首次引导逐条播放欢迎语时底部输入框立即恢复", () => {
  const start = index.indexOf("function addRow(side, who, text, opts = {}) {");
  assert.ok(start > 0);
  const body = index.slice(start, index.indexOf("const row = document.createElement", start));
  assert.match(body, /if \(empty\) \$\("#composer"\)\?\.classList\.remove\("hero-mode"\);/);
});

test("没连模型时聊天输入框上方常驻说明与去处，连上后隐藏", () => {
  const notice = index.indexOf('id="modelMissingNotice"');
  assert.ok(notice > 0 && notice < index.indexOf('id="composer"'), "提示在输入框之前");
  assert.match(index, /id="modelMissingNotice"[^>]*hidden/, "默认隐藏，拿到状态后才显示，避免已连接用户闪一下");
  assert.match(index, /<a class="model-missing-action" href="\/settings">去连接<\/a>/);
  assert.match(index, /function syncModelMissingNotice\(live\) \{[\s\S]*?notice\.hidden = Boolean\(live\);/);
  assert.match(index, /\$\("#llm"\)\.textContent = [^\n]*\n\s*syncModelMissingNotice\(s\.live\);/, "页面加载时同步");
  assert.match(index, /function renderModelConnectionStatus\(state, hydrateForm = false\) \{\n\s*modelConnectionState = state;\n\s*syncModelMissingNotice\(state\.live\);/, "聊天页里保存连接后同步");
});

test("首次引导弹窗使用主题色，不再是独立的紫色", () => {
  const css = index.slice(index.indexOf(".onboard-box {"), index.indexOf("#onboardStart {"));
  assert.ok(css.length > 100);
  assert.doesNotMatch(css, /#211543|#75688f|#38275d|#8a7ca8|139,92,246|#f8f2ff/);
});

test("服务账号卡片告诉新用户去哪申请 Key，外链交给系统浏览器", () => {
  for (const url of ["https://platform.openai.com/api-keys", "https://bigmodel.cn/usercenter/proj-mgmt/apikeys"]) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    assert.match(settings, new RegExp(`<a class="model-key-help" href="${escaped}" target="_blank" rel="noopener noreferrer">`));
  }
  assert.match(settings, /国内网络可直接使用/);
});

test("一个服务都没连时，正在使用不摆无用按钮，能力表只留一句去处", () => {
  assert.match(center, /for \(const id of \["#modelNowChange", "#modelQuickRecheck"\]\) \{ const button = \$\(id\); if \(button\) button\.hidden = empty; \}/);
  assert.match(center, /const visiblePurposes = \(center\.connections \|\| \[\]\)\.length \?/);
  assert.match(center, /model-capabilities-empty/);
  assert.doesNotMatch(center, /请先显式测试一个候选/);
});

test("一键配置把能识别的模型与网络错误翻译成可照做的说明", () => {
  assert.match(server, /function explainQuickSetupFailure\(stage: ModelConnectionFailureStage\) \{[\s\S]*?if \(companionModelFailureDiagnostic\(error\)\) throw new Error\(modelConnectionUserMessage\(error, stage\)\);\n\s*throw error;/);
  assert.match(server, /verify: \(target\) => verifyQuickSetupTarget\(target\)\.catch\(explainQuickSetupFailure\("probe"\)\)/);
  assert.match(server, /discover: \(provider, connectionId\) => discoverQuickSetupTargets\(provider, connectionId\)\.catch\(explainQuickSetupFailure\("catalog"\)\)/);
  assert.match(server, /HTTP 401）。请到服务商后台重新复制完整的 Key 再粘贴。/);
});
