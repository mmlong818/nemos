import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "examples", "companion");
const web = join(root, "web");
const readWeb = (name: string) => readFileSync(join(web, name), "utf8");

test("开发成为一级入口并启动真实开发任务", () => {
  const server = readFileSync(join(root, "server.ts"), "utf8");
  const html = readWeb("develop.html");
  const script = readWeb(join("assets", "develop-center.js"));
  for (const file of ["index.html", "capabilities.html", "office.html", "work.html"]) {
    assert.match(readWeb(file), /(?:href="\/develop"|id="railDev")/);
  }
  assert.match(server, /pathname === "\/develop"/);
  assert.match(server, /\/api\/development\/projects/);
  assert.match(html, /id="approvalPolicyTrigger"/);
  assert.match(html, /name="accessMode"/);
  assert.match(html, /name="accessModeChoice"/);
  assert.match(html, /name="approvalPolicy"/);
  assert.match(script, /capabilityId: "project-development"/);
  assert.match(html, /id="installDependencies"/);
  assert.match(script, /installDependencies:/);
  assert.match(script, /history\.replaceState\(null, "", `\/develop\?job=/);
  assert.match(html, /class="coding-sidebar task-workbench-sidebar"/);
  assert.match(html, /class="coding-transcript task-workbench-stage"/);
  assert.match(html, /class="coding-composer task-workbench-composer[^"]*"/);
  assert.match(script, /\/api\/agent\/jobs\?limit=500/);
  assert.match(script, /setTimeout\(\(\) => loadJobs\(true\), 2200\)/);
});

test("开发项目支持独立归档、恢复和安全删除", () => {
  const server = readFileSync(join(root, "server.ts"), "utf8");
  const develop = readWeb("develop.html");
  const archive = readWeb("develop-archive.html");
  const archiveScript = readWeb(join("assets", "develop-archive.js"));
  assert.match(server, /pathname === "\/develop\/archive"/);
  assert.match(server, /\/api\/development\/project\/archive/);
  assert.match(server, /\/api\/development\/project\/restore/);
  assert.match(server, /\/api\/development\/project\/delete/);
  assert.match(develop, /href="\/develop\/archive"/);
  assert.match(archive, /id="archiveProjectList"/);
  assert.match(archive, /id="deleteWorkspace"/);
  assert.match(archiveScript, /delete-archived-development-project/);
  assert.match(archiveScript, /只删除记录/);
  assert.match(archiveScript, /删除记录和目录/);
});

test("开发页把运行配置置顶，并把执行设置收进输入框", () => {
  const html = readWeb("develop.html");
  const script = readWeb(join("assets", "develop-center.js"));
  const server = readFileSync(join(root, "server.ts"), "utf8");
  assert.equal((html.match(/id="developForm"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="topbar-capabilities"/);
  assert.match(html, /id="workspaceLabel"/);
  assert.doesNotMatch(html, /id="executionSettingsToggle"/);
  assert.doesNotMatch(html, /id="executionSettingsPanel"/);
  assert.doesNotMatch(html, /class="development-starters"/);
  assert.match(html, /class="development-studio"/);
  assert.match(html, /class="development-activity"/);
  assert.doesNotMatch(html, /class="development-inspector"/);
  assert.match(html, /class="development-control-bar"/);
  assert.match(html, /class="development-execution-controls"/);
  assert.doesNotMatch(html, /data-development-intent=/);
  assert.match(html, /id="developmentModel"/);
  assert.match(html, /id="developmentReasoning"/);
  assert.match(html, /请求批准/);
  assert.match(html, /帮我批准/);
  assert.match(html, /完全控制/);
  assert.match(html, /选择更改权限/);
  assert.match(html, />只读</);
  assert.match(html, /role="listbox"/);
  assert.match(html, /role="option" data-approval-policy="request" aria-selected="true"/);
  assert.match(html, /role="option" data-approval-policy="auto" aria-selected="false"/);
  assert.match(html, /role="option" data-approval-policy="full" aria-selected="false" hidden/);
  assert.match(script, /function openApprovalPolicyMenu/);
  assert.match(script, /engineApprovalPolicies/);
  assert.match(script, /fullControlConfirmed/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(html, /id="developmentEngine"/);
  assert.match(html, /id="developmentEngineTrigger"/);
  assert.match(html, /id="developmentEngineDialog"/);
  assert.match(html, /id="developmentEngineList"/);
  assert.match(html, /id="developmentEngineUpdateNotice"/);
  assert.match(html, /id="developmentEngineUpdateDialog"/);
  assert.match(html, /id="developmentEngineRiskDialog"/);
  assert.match(html, /Pi Agent（默认）/);
  assert.match(html, /DeepSeek Harness/);
  assert.match(html, /Kilo Code/);
  assert.match(html, /OpenCode/);
  assert.match(html, /Codex/);
  assert.match(html, /自动装依赖/);
  assert.match(html, />开始任务</);
  assert.match(script, /api\("\/api\/development\/projects"\)/);
  assert.match(script, /api\("\/api\/agent\/job\/cancel"/);
  assert.match(html, /id="developmentProcess"/);
  assert.match(script, /function renderProcessPanel\(job\)/);
  assert.match(script, /job\.checkpoints/);
  assert.match(script, /document\.body\.dataset\.developmentEngine = value/);
  assert.match(script, /result\.development\?\.enginePlugins/);
  assert.match(script, /function renderDevelopmentEnginePicker/);
  assert.match(script, /data-development-engine-option/);
  assert.match(script, /function renderDevelopmentEngineUpdates/);
  assert.match(script, /api\("\/api\/development\/engine-updates\/upgrade"/);
  assert.match(script, /if \(presence\) presence\.textContent/);
  assert.match(script, /model: developmentModelValue\(\)/);
  assert.match(script, /\/api\/development\/model-connections/);
  assert.match(script, /engineProfile\.mode === "inherit"/);
  assert.match(script, /reasoning: developmentReasoningValue\(\)/);
  assert.match(script, /function openDevelopmentJob\(jobId\)/);
  assert.match(script, /requestedJobId !== activeJobId/);
  assert.match(script, /projectName\(workspace\).*statusLabel/);
  assert.match(script, /function developmentThreads\(jobs = developmentHistory\)/);
  assert.match(script, /parentJobId: continuation\.parentJobId/);
  assert.match(script, /continuationTaskId: continuation\.continuationTaskId/);
  assert.match(script, /正在继续当前项目/);
  assert.match(server, /\["queued", "running"\]\.includes\(parentJob\.status\)/);
  assert.doesNotMatch(script, /workspaceDialog|recentPaths/);
});

test("设置中心统一模型、开发、连接与本机数据", () => {
  const server = readFileSync(join(root, "server.ts"), "utf8");
  const html = readWeb("settings.html");
  const script = readWeb(join("assets", "settings-center.js"));
  assert.match(server, /pathname === "\/settings"/);
  assert.match(html, /data-section="models"/);
  assert.match(html, /data-section="development"/);
  assert.match(html, /data-section="connections"/);
  assert.match(html, /data-section="privacy"/);
  assert.match(html, /data-section="storage"/);
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  assert.match(html, /id="serverStorageFields"/);
  assert.match(script, /\/api\/llm-config/);
  assert.match(html, /development-models\.css/);
  assert.match(script, /id=\"developmentModelConnections\"/);
  assert.match(script, /继承默认模型/);
  assert.match(script, /\/api\/development\/model-connections/);
  assert.match(server, /DEVELOPMENT_MODEL_CONNECTIONS_FILE/);
  assert.match(server, /developmentModelConnection\(developmentEngine\)/);
  assert.match(script, /\/api\/platform\/connector\/test/);
  assert.match(script, /\/api\/agent\/extension\/validate/);
  assert.match(html, /id="capabilityRuntimeList"/);
  assert.match(script, /\/api\/capabilities\/registry/);
  assert.match(script, /由产品流程承接/);
  assert.match(script, /\/api\/runtime/);
  assert.match(script, /`\/api\/data-sync\/\$\{operation\}`/);
  assert.match(script, /storageOperation\("push"\)/);
  assert.match(script, /id=\"retainedOutputList\"/);
  assert.match(script, /\/api\/capabilities\/retained-artifact\/delete/);
  assert.match(server, /\/api\/capabilities\/retained-artifact\/delete/);
});

test("任务页不再展示任务记录与分支弹窗", () => {
  const chat = readWeb("index.html");
  assert.doesNotMatch(chat, /id="topChat"|id="topDrop"|id="conversationmodal"|>任务与分支</);
});

test("窄屏任务页收起会话列表并保留一级导航", () => {
  const chat = readWeb("index.html");
  assert.match(chat, /@media\(max-width:720px\)\{[\s\S]*#sessionPane\{display:none\}/);
  assert.match(chat, /#sidebar\{position:fixed;inset:0 auto 0 0;width:52px;height:100vh/);
  assert.match(chat, /#main\{width:100%;height:100vh;min-height:0\}/);
});

test("所有主页面都进入独立设置中心", () => {
  for (const file of ["capabilities.html", "office.html", "work.html", "develop.html"]) {
    assert.match(readWeb(file), /href="\/settings"/);
    assert.doesNotMatch(readWeb(file), /href="\/#settings"/);
  }
  const chat = readWeb("index.html");
  assert.match(chat, /id="settingsbtn"[^>]*data-app-icon="settings"/);
  assert.match(chat, /window\.location\.href = "\/settings"/);
});

test("桌面端所有页面使用同一套左栏起点与按钮尺寸", () => {
  const css = readWeb(join("assets", "app-navigation-labels.css"));
  assert.match(css, /--app-rail-reserved: 100px/);
  assert.match(css, /--app-rail-shell: 72px/);
  assert.match(css, /--app-brand-size: 46px/);
  assert.match(css, /--app-nav-width: 60px/);
  assert.match(css, /--app-nav-height: 54px/);
  assert.match(css, /--app-icon-size: 20px/);
});
