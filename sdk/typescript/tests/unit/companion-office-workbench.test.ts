import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const companionRoot = join(__dirname, "..", "..", "examples", "companion");
const webRoot = join(companionRoot, "web");
const officeHtml = readFileSync(join(webRoot, "office.html"), "utf8");
const officeJs = readFileSync(join(webRoot, "assets", "office-workbench.js"), "utf8");
const officeSourceJs = readFileSync(join(webRoot, "assets", "office-source-preview.js"), "utf8");
const officeCss = readFileSync(join(webRoot, "assets", "office-workbench.css"), "utf8");
const capabilityHtml = readFileSync(join(webRoot, "capabilities.html"), "utf8");
const chatHtml = readFileSync(join(webRoot, "index.html"), "utf8");
const server = readFileSync(join(companionRoot, "server.ts"), "utf8");

test("办公文件工作台拥有独立入口且三个主界面导航一致", () => {
  assert.match(server, /url === "\/office"/);
  assert.match(chatHtml, /id="railOffice"[^>]+aria-label="办公文件"/);
  assert.match(chatHtml, /window\.location\.href = "\/office"/);
  assert.match(capabilityHtml, /href="\/office"[^>]+aria-label="办公文件"/);
  assert.match(officeHtml, /class="is-current" href="\/office"/);
});

test("工作台真实读取四类办公文件并明确保护原文件", () => {
  assert.match(officeHtml, /\.docx,\.pptx,\.xlsx,\.pdf/);
  assert.match(officeJs, /\/api\/files\/extract/);
  assert.match(officeJs, /办公文件不能超过 8 MB/);
  assert.match(officeHtml, /原文件不会被覆盖/);
  assert.match(officeJs, /原文件未改动/);
});

test("工作台提供本机自动保存、版本比较与页内处理", () => {
  assert.match(officeJs, /clownfish-office-workbench-v1/);
  assert.match(officeJs, /function saveVersion/);
  assert.match(officeJs, /function compareVersion/);
  assert.match(officeJs, /function restoreVersion/);
  assert.match(officeJs, /function startOfficeTask/);
  assert.match(officeJs, /\/api\/agent\/job/);
  assert.match(officeJs, /\/api\/capabilities\/artifact\/preview/);
  assert.doesNotMatch(officeJs, /sessionStorage|capability-handoff|location\.href\s*=\s*"\/capabilities"/);
});

test("原文件保存在本机并提供格式化预览", () => {
  assert.match(officeHtml, /office-source-preview\.js/);
  assert.match(officeHtml, /data-document-view="source"/);
  assert.match(officeSourceJs, /indexedDB\.open/);
  assert.match(officeSourceJs, /URL\.createObjectURL/);
  assert.match(officeSourceJs, /source-pdf-frame/);
  assert.match(officeSourceJs, /renderSlides|renderWorkbook|renderDocument/);
});

test("工作台遵守小丑鱼视觉与无障碍基线", () => {
  assert.match(officeHtml, /aria-live="polite"/);
  assert.match(officeHtml, /label[^>]+for="assistantPrompt"/);
  assert.match(officeCss, /:focus-visible/);
  assert.match(officeCss, /@media \(max-width: 720px\)/);
  assert.match(officeCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(officeCss, /transition:\s*all/i);
});

test("新建文件和打开文件位于最近文件列表上方", () => {
  const actionsAt = officeHtml.indexOf('class="file-panel-actions"');
  const recentFilesAt = officeHtml.indexOf('id="recentFiles"');
  assert.ok(actionsAt >= 0);
  assert.ok(recentFilesAt > actionsAt);
  assert.match(officeHtml.slice(actionsAt, recentFilesAt), /id="newDocument"[\s\S]+id="officeFileInput"/);
  assert.doesNotMatch(officeHtml, /class="topbar-actions"/);
});

test("文件页保持操作连续，不暴露内部页面结构", () => {
  assert.match(officeHtml, /id="startOfficeTask"[^>]*>开始处理<\/button>/);
  assert.match(officeHtml, /id="processingResultFrame"/);
  assert.doesNotMatch(officeHtml, /带入能力页|继续到能力页/);
  assert.match(officeHtml, /<details class="version-card">/);
  assert.match(officeCss, /white-space:\s*nowrap/);
});

test("移动端文件列表支持遮罩和键盘关闭", () => {
  assert.match(officeHtml, /id="filePanelBackdrop"/);
  assert.match(officeJs, /event\.key === "Escape"/);
  assert.match(officeCss, /\.file-panel\.is-open \+ \.file-panel-backdrop/);
});

test("工作台只呈现小丑鱼自己的产品语言", () => {
  const combined = [officeHtml, officeJs, officeCss].join("\n");
  assert.match(combined, /小丑鱼/);
  assert.doesNotMatch(combined, /参考项目|外部仓库|第三方产品/);
});
