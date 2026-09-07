import { readAppHtml } from "../fixtures/render-app-page.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appRoute } from "../../examples/companion/app-navigation.js";

const root = join(__dirname, "..", "..", "examples", "companion");
const web = join(root, "web");
const readWeb = (name: string) => name.endsWith(".html") ? readAppHtml(name) : readFileSync(join(web, name), "utf8");

test("应用不再包含项目开发入口或开发引擎接口", () => {
  const server = readFileSync(join(root, "server.ts"), "utf8");
  const catalog = readWeb(join("assets", "capability-center.js"));
  for (const file of ["index.html", "capabilities.html", "office.html", "work.html", "settings.html"]) {
    assert.doesNotMatch(readWeb(file), /href="\/develop"|project-development|\/api\/development/);
  }
  assert.doesNotMatch(catalog, /project-development|\/api\/development/);
  assert.doesNotMatch(server, /project-development|\/api\/development/);
});

test("设置中心仅保留模型、连接与本机数据", () => {
  const server = readFileSync(join(root, "server.ts"), "utf8");
  const client = readFileSync(join(root, "client", "src", "ClownfishClient.cs"), "utf8");
  const html = readWeb("settings.html");
  const script = readWeb(join("assets", "settings-center.js"));
  assert.equal(appRoute("/settings")?.file, "settings.html");
  assert.match(server, /renderAppPage/);
  assert.match(html, /data-section="models"/);
  assert.doesNotMatch(html, /data-section="development"/);
  assert.match(html, /data-section="connections"/);
  assert.match(html, /data-section="privacy"/);
  assert.match(html, /data-section="storage"/);
  assert.doesNotMatch(html, /data-panel="development"|开发引擎|\/api\/development/);
  assert.match(html, /id="serverStorageFields"/);
  assert.match(script, /\/api\/llm-config/);
  assert.match(client, /EnvironmentVariables\["NODE_USE_ENV_PROXY"\] = "1"/);
  assert.match(server, /无法连接模型服务。请确认网络或代理已启动后重试。/);
  assert.match(server, /API Key 无效，或该 Key 没有访问所选模型的权限。/);
  assert.doesNotMatch(html, /development-models\.css/);
  assert.match(script, /\/api\/platform\/connector\/test/);
  assert.match(script, /\/api\/agent\/extension\/validate/);
  assert.match(html, /id="capabilityRuntimeList"/);
  assert.match(script, /\/api\/capabilities\/registry/);
  assert.match(script, /由产品流程承接/);
  assert.match(script, /\/api\/runtime/);
  assert.match(script, /state\.manifest\?\.version/);
  assert.match(script, /PRIVACY\.md/);
  assert.match(script, /数据何时离开本机/);
  assert.match(script, /`\/api\/data-sync\/\$\{operation\}`/);
  assert.match(script, /storageOperation\("push"\)/);
  assert.match(script, /id=\"retainedOutputList\"/);
  assert.match(script, /\/api\/capabilities\/retained-artifact\/delete/);
  assert.match(server, /\/api\/capabilities\/retained-artifact\/delete/);
});

test("任务页不再展示任务记录与分支弹窗", () => {
  const chat = readWeb("index.html");
  assert.doesNotMatch(chat, /id="topChat"|id="topDrop"|id="conversationmodal"|>任务与分支</);
  assert.match(chat, /id="taskModelSelect"/);
  assert.match(chat, /id="heroModelSelect"/);
  assert.doesNotMatch(chat, /select.hidden = !taskMode/);
  assert.match(chat, /node\.config = \{ \.\.\.\(node\.config \|\| \{\}\), model: requested \}/);
  assert.match(chat, /\/api\/llm-model\/check/);
  assert.match(chat, /\.\.\.conversationRequestOptions\(key\)/);
});

test("模型设置会获取并展示多个可选模型", () => {
  const html = readWeb("settings.html");
  const script = readWeb(join("assets", "settings-center.js"));
  const server = readFileSync(join(root, "server.ts"), "utf8");
  assert.match(html, /id="modelCatalog"/);
  assert.match(html, /id="modelSelectionMode"/);
  assert.match(html, /不读取聊天记录/);
  assert.match(script, /state\.models/);
  assert.match(server, /fetchCompanionModelCatalog/);
  assert.match(server, /selectCheckedCompanionModel\(next, nextCatalog, mode\)/);
  assert.doesNotMatch(server, /model: nextCatalog\[0\]!\.id/);
});

test("窄屏任务页收起会话列表并保留一级导航", () => {
  const chat = readWeb("index.html");
  assert.match(chat, /@media\(max-width:720px\)\{[\s\S]*#sessionPane\{display:none\}/);
  assert.match(chat, /#sidebar\{position:fixed;inset:0 auto 0 0;width:52px;height:100vh/);
  assert.match(chat, /#main\{width:100%;height:100vh;min-height:0\}/);
});

test("所有主页面都进入独立设置中心", () => {
  for (const file of ["capabilities.html", "office.html", "work.html"]) {
    assert.match(readWeb(file), /href="\/settings"/);
    assert.doesNotMatch(readWeb(file), /href="\/#settings"/);
  }
  const chat = readWeb("index.html");
  assert.match(chat, /id="settingsbtn"[^>]*data-wb-path="\/settings"/);
  assert.match(chat, /window\.location\.href = "\/settings"/);
});

test("桌面端所有页面使用同一套左栏起点与按钮尺寸", () => {
  const css = readWeb(join("assets", "app-navigation-labels.css"));
  assert.match(css, /--app-rail-reserved: calc\(var\(--app-rail-left\) \+ var\(--app-rail-shell\) \+ 14px\)/);
  assert.match(css, /--app-rail-shell: var\(--cf-rail-width, 76px\)/);
  assert.match(css, /--app-brand-size: 46px/);
  assert.match(css, /--app-nav-width: 60px/);
  assert.match(css, /--app-nav-height: 54px/);
  assert.match(css, /--app-icon-size: 20px/);
});
