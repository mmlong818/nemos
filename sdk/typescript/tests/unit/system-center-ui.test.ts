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
  assert.match(html, /id="workspacePath"/);
  assert.match(html, /id="accessMode"/);
  assert.match(script, /capabilityId: "project-development"/);
  assert.match(html, /id="dependencyMode"/);
  assert.match(script, /installDependencies:/);
  assert.match(script, /history\.replaceState\(null, "", `\/develop\?job=/);
  assert.match(html, /class="coding-sidebar"/);
  assert.match(html, /class="coding-transcript"/);
  assert.match(html, /class="coding-composer"/);
  assert.match(script, /\/api\/agent\/jobs\?limit=100/);
  assert.match(script, /setTimeout\(\(\) => loadJobs\(true\), 2200\)/);
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
  assert.match(script, /\/api\/platform\/connector\/test/);
  assert.match(script, /\/api\/agent\/extension\/validate/);
  assert.match(script, /\/api\/runtime/);
  assert.match(script, /`\/api\/data-sync\/\$\{operation\}`/);
  assert.match(script, /storageOperation\("push"\)/);
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
  assert.match(chat, /id="settingsbtn"[^>]*data-icon="settings"/);
  assert.match(chat, /window\.location\.href = "\/settings"/);
});

test("桌面端所有页面使用同一套左栏起点与按钮尺寸", () => {
  const css = readWeb(join("assets", "app-navigation-labels.css"));
  assert.match(css, /\.rail \{[^}]*width: 76px;[^}]*padding: 20px 8px 14px;[^}]*gap: 0;/s);
  assert.match(css, /\.rail > \.brand \{[^}]*width: 36px;[^}]*height: 36px;[^}]*margin: 0 auto 28px;/s);
  assert.match(css, /width: 60px;\s*height: 52px;/);
});
