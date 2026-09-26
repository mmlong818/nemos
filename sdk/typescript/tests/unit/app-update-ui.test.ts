import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { renderAppPage } from "../../examples/companion/app-navigation.js";

const root = join(process.cwd(), "examples", "companion");
const script = readFileSync(join(root, "web", "assets", "app-update.js"), "utf8");
const center = readFileSync(join(root, "web", "assets", "settings-center.js"), "utf8");
const privacy = readFileSync(join(process.cwd(), "..", "..", "PRIVACY.md"), "utf8");

test("每个应用页面都带上侧栏的版本、反馈与更新提醒", () => {
  const html = renderAppPage(readFileSync(join(root, "web", "matters.html"), "utf8"), "/matters");
  assert.match(html, /<script src="\/assets\/app-update\.js" defer><\/script>/);
});

test("侧栏先问再查：询问卡片说明会访问什么，新版本链接与文字都经过转义", () => {
  assert.match(script, /if \(state\.enabled === null\)/);
  assert.match(script, /会访问 GitHub 读取最新版本号，不发送任何个人数据。/);
  assert.match(script, /data-update-enable="true">提醒我<\/button><button type="button" data-update-enable="false">不用<\/button>/);
  assert.match(script, /else if \(state\.available && state\.latest\)/);
  assert.match(script, /href="\$\{escapeHtml\(state\.latest\.url\)\}"/);
  assert.match(script, /新版本 \$\{escapeHtml\(state\.latest\.version\)\} 可以更新/);
  assert.match(script, /const FEEDBACK_URL = "https:\/\/github\.com\/mmlong818\/nemos\/issues\/new\/choose";/);
  assert.match(script, /小丑鱼 \$\{escapeHtml\(state\.current\)\}/, "报问题时能看到版本号");
});

test("设置 → 数据与隐私 可以随时开关，并如实写明会访问 GitHub", () => {
  assert.match(center, /<div class="privacy-row" id="appUpdateRow">/);
  assert.match(center, /开启“检查新版本”后，会定期向 GitHub 读取最新版本号/);
  assert.match(center, /api\("\/api\/app-update", \{ method: "POST", body: JSON\.stringify\(\{ enabled: button\.dataset\.appUpdateToggle === "true" \}\) \}\)/);
  assert.match(center, /window\.dispatchEvent\(new CustomEvent\("clownfish:app-update", \{ detail: update \}\)\)/, "同步侧栏");
  assert.match(privacy, /\*\*检查新版本\*\*：用户同意后，每 12 小时最多一次向 GitHub 读取/);
});
