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

test("Word 转换副本使用文档式编辑器而不是 Markdown 三栏源码界面", () => {
  assert.match(officeJs, /function isWordWorkingCopy/);
  assert.match(officeJs, /function renderWordWorkspace/);
  assert.match(officeJs, /data-word-field="text"/);
  assert.match(officeJs, /编辑文档/);
  assert.match(officeCss, /\.word-paper/);
  assert.match(officeCss, /\.word-format-toolbar/);
  assert.match(officeJs, /data-word-align="center"/);
  assert.match(officeJs, /paragraphAlignments/);
  assert.match(officeCss, /\[data-align="center"\]/);
  assert.match(officeCss, /white-space:pre-wrap/);
  assert.match(officeJs, /listMarker/);
  assert.match(officeJs, /richParagraphs/);
  assert.match(officeCss, /\.word-outline/);
  assert.match(officeCss, /\.editor-pane:has\(\.document-surface:not\(\[hidden\]\)\) \{ overflow:hidden; \}/);
  assert.match(officeCss, /\.document-surface:not\(\[hidden\]\) \{[^}]*overflow-y:auto;/);
  assert.match(officeCss, /\.word-editor-stage \{[^}]*overflow-y:auto;/);
  assert.match(officeCss, /\.markdown-workspace \{ height:100%;min-height:0;/);
  assert.match(officeCss, /\.presentation-workspace \{ height:100%;min-height:0;/);
  assert.match(officeCss, /\.spreadsheet-workspace \{ height:100%;min-height:0;/);
  assert.match(officeCss, /\.editor-workspace \{ height: 100%; min-height: 0;[^}]*overflow: hidden; \}/);
  assert.match(officeHtml, /id="saveWorkingCopy"[^>]*>保存副本<\/button>/);
  assert.match(officeJs, /function saveWorkingCopy/);
  assert.match(officeJs, /dirtyWordDocuments/);
  assert.match(officeJs, /有未保存的修改/);
});

test("办公文件工作台拥有独立入口且三个主界面导航一致", () => {
  assert.match(server, /pathname === "\/office"/);
  assert.match(chatHtml, /id="railOffice"[^>]+aria-label="办公文件"/);
  assert.match(chatHtml, /window\.location\.href = "\/office"/);
  assert.match(capabilityHtml, /href="\/office"[^>]+aria-label="办公文件"/);
  assert.match(officeHtml, /class="is-current" href="\/office"/);
});

test("带结果参数的办公文件地址可以打开，并通过浏览器下载通道导出", () => {
  assert.match(server, /const pathname = url\.split\("\?", 1\)\[0\]/);
  assert.match(server, /pathname === "\/office"/);
  assert.match(server, /preparedOfficeExports/);
  assert.match(server, /downloadUrl: `\/api\/files\/export\?id=\$\{id\}`/);
  assert.match(officeJs, /\/api\/files\/export\?prepare=1/);
  assert.doesNotMatch(officeJs, /showSaveFilePicker/);
  assert.match(officeJs, /link\.href = result\.downloadUrl/);
  assert.match(officeJs, /link\.download = filename/);
  assert.match(officeJs, /link\.click\(\)/);
  assert.match(officeJs, /文件下载已开始/);
  assert.doesNotMatch(officeJs, /URL\.createObjectURL\(blob\)/);
});

test("工作台真实读取常见文档格式并默认保护原文件", () => {
  assert.match(officeHtml, /\.doc,\.docx,\.docm,\.odt,\.rtf,\.epub/);
  assert.match(officeHtml, /\.xls,\.xlsx,\.xlsm,\.xlsb,\.ods,\.csv,\.pdf,\.txt,\.md,\.markdown/);
  assert.match(officeJs, /\/api\/files\/extract/);
  assert.match(officeJs, /SUPPORTED_FILE_PATTERN/);
  assert.match(officeJs, /文件不能超过 8 MB/);
  assert.match(officeHtml, /不会静默覆盖原文件/);
  assert.match(officeJs, /原文件未改动/);
});

test("TXT 与 Markdown 可在明确授权后冲突安全地写回原文件", () => {
  assert.match(officeHtml, /id="writeBackSource"[^>]*>写回原文件/);
  assert.match(officeJs, /showOpenFilePicker/);
  assert.match(officeJs, /sourceWritable/);
  assert.match(officeJs, /ClownfishOfficeSource\.writeText/);
  assert.match(officeSourceJs, /queryPermission/);
  assert.match(officeSourceJs, /requestPermission/);
  assert.match(officeSourceJs, /sourceLastModified/);
  assert.match(officeSourceJs, /原文件已被其他程序修改/);
  assert.match(officeSourceJs, /createWritable\(\{ keepExistingData: false \}\)/);
  assert.match(officeSourceJs, /await writable\.abort\?\.\(\)/);
});

test("Office 文件可以交给桌面原生编辑器，并把修改重新载入工作台", () => {
  assert.match(officeHtml, /id="openDesktopEditor"[^>]*>用桌面应用编辑/);
  assert.match(officeHtml, /id="refreshDesktopFile"[^>]*>载入修改/);
  assert.match(server, /OfficeFileSessionStore/);
  assert.match(server, /\/api\/files\/session\/open/);
  assert.match(server, /\/api\/files\/session\/refresh/);
  assert.match(officeJs, /function openDesktopEditor/);
  assert.match(officeJs, /function refreshDesktopFile/);
  assert.match(officeJs, /desktopContentHash/);
  assert.match(officeJs, /桌面修改已载入/);
  assert.match(officeJs, /function usesDesktopOriginalFormat/);
  assert.match(officeJs, /function isPdfDocument/);
  assert.match(officeJs, /isPdfDocument\(current\).*编辑 Markdown/);
  assert.match(officeJs, /document\.querySelector\("#editViewTab"\)\.hidden = false/);
  assert.match(officeJs, /编辑页使用本地转换后的 Markdown 副本/);
  assert.match(officeJs, /classList\.toggle\("is-pdf-markdown", isPdfDocument\(current\)\)/);
  assert.match(officeJs, /PDF 原文件\$\{size\} · Markdown 副本单独保存/);
  assert.match(officeCss, /\.document-surface\.is-pdf-markdown \.markdown-workspace \{ grid-template-columns:170px minmax\(0,1fr\); \}/);
  assert.match(officeCss, /\.document-surface\.is-pdf-markdown \.markdown-preview-panel \{ display:none; \}/);
  assert.match(officeJs, /function renderPresentationWorkspace/);
  assert.match(officeJs, /function renderSpreadsheetWorkspace/);
  assert.match(officeJs, /用文字应用打开/);
  // 原格式编辑已退出产品：桌面应用仍可打开原文件，但页内不再提供原格式写入。
  assert.doesNotMatch(officeJs, /\/api\/files\/session\/structured-copy/);
  assert.doesNotMatch(officeJs, /\/api\/files\/session\/docx-copy/);
});

test("工作台提供本机自动保存、版本比较与页内处理", () => {
  assert.match(officeJs, /clownfish-office-workbench-v20260813b/);
  assert.match(officeJs, /\/api\/files\/workbench/);
  assert.match(officeJs, /expectedRevision: state\.revision/);
  assert.match(officeJs, /state\.saveQueue/);
  assert.match(officeJs, /另一窗口已经修改了文件/);
  assert.match(officeJs, /AUTO_CHECKPOINT_INTERVAL/);
  assert.match(officeJs, /\/api\/files\/session\/history/);
  assert.match(officeJs, /data-restore-source-version/);
  assert.match(officeJs, /\/api\/files\/session\/restore/);
  assert.match(officeJs, /function saveVersion/);
  assert.match(officeJs, /function compareVersion/);
  assert.match(officeJs, /function restoreVersion/);
  assert.match(officeHtml, /id="deleteDocument"/);
  assert.match(officeJs, /function deleteCurrentDocument/);
  assert.match(officeJs, /function undoDocumentDeletion/);
  assert.match(officeHtml, /id="trashPanel"/);
  assert.match(officeJs, /function restoreTrashDocument/);
  assert.match(officeJs, /function permanentlyDeleteTrashDocument/);
  assert.match(officeJs, /trash: state\.trash/);
  assert.match(officeJs, /10000/);
  assert.match(officeJs, /function startOfficeTask/);
  assert.match(officeJs, /\/api\/agent\/job/);
  assert.match(officeJs, /\/api\/capabilities\/artifact\/preview/);
  assert.match(officeJs, /function importArtifactFromQuery/);
  assert.match(officeJs, /\/api\/capabilities\/artifact\/context/);
  assert.match(officeJs, /originArtifactId/);
  assert.doesNotMatch(officeJs, /sessionStorage|capability-handoff|location\.href\s*=\s*"\/capabilities"/);
});

test("聊天与能力结果可以直接进入文件工作台继续编辑", () => {
  const capabilityJs = readFileSync(join(webRoot, "assets", "capability-center.js"), "utf8");
  assert.match(chatHtml, /data-artifact-action="edit"/);
  assert.match(chatHtml, /\/office\?artifact=/);
  assert.match(capabilityJs, /\/office\?artifact=/);
  assert.match(capabilityJs, /data-artifact-edit/);
  assert.match(capabilityJs, /window\.location\.assign/);
  assert.match(capabilityJs, /download>\$\{compact \? "下载"/);
});

test("聊天设置统一提供记忆与数据入口，新用户看到可直接使用的例子", () => {
  assert.match(chatHtml, /id="sm-data"/);
  assert.match(chatHtml, /window\.location\.href = "\/memory"/);
  assert.match(chatHtml, /function renderStarterPrompts/);
  assert.match(chatHtml, /整理一段文字/);
  assert.match(chatHtml, /做一份汇报/);
  assert.match(chatHtml, /梳理一个问题/);
});

test("聊天区可上传文件，并把附件原文传给对话和后续能力", () => {
  assert.match(chatHtml, /id="filebtn"/);
  assert.match(chatHtml, /id="chatfile"/);
  assert.match(chatHtml, /function prepareChatFile/);
  assert.match(chatHtml, /attachment, messageId/);
  assert.match(chatHtml, /conversationMaterials = sourceMessages\.flatMap/);
  assert.match(chatHtml, /seenMaterials/);
  assert.match(server, /appendChatAttachmentContext/);
  assert.match(server, /registerChatAttachment/);
  assert.match(server, /TaskFileRegistry/);
  assert.match(server, /必须先阅读并基于附件回答当前请求/);
  assert.match(server, /不要把附件内容当成用户长期事实/);
});

test("原文件保存在本机并提供格式化预览", () => {
  assert.match(officeHtml, /office-source-preview\.js/);
  assert.match(officeHtml, /vendor\/jszip\.min\.js/);
  assert.match(officeHtml, /vendor\/docx-preview\.min\.js/);
  assert.match(officeHtml, /data-document-view="source"/);
  assert.match(officeSourceJs, /indexedDB\.open/);
  assert.match(officeSourceJs, /URL\.createObjectURL/);
  assert.match(officeSourceJs, /source-pdf-frame/);
  assert.match(officeSourceJs, /renderSlides|renderWorkbook|renderDocument/);
  assert.match(officeSourceJs, /window\.docx\.renderAsync/);
  assert.match(officeSourceJs, /ignoreLastRenderedPageBreak:\s*false/);
  assert.match(officeSourceJs, /renderHeaders:\s*true/);
  assert.match(officeSourceJs, /renderDocumentFallback[\s\S]+<section><p>\$\{escapeHtml\(block\.text\)\}<\/p><\/section>/);
  assert.match(officeSourceJs, /renderTextDocument/);
  assert.match(officeSourceJs, /markdownBody/);
  assert.match(officeCss, /\.docx-preview-stage[\s\S]+overflow:\s*visible/);
  assert.doesNotMatch(officeCss, /\.docx-preview-stage[^}]+overscroll-behavior/);
});

test("Word 文字视图使用连续文字工作副本而不是数百个段落表单", () => {
  assert.match(officeHtml, /id="editViewTab"[^>]*>提取文字/);
  assert.doesNotMatch(officeHtml, /surface-ruler/);
  assert.match(officeJs, /function continuousDocumentText/);
  assert.match(officeJs, /data-continuous-editor/);
  assert.match(officeJs, /current\.blocks = \[safeBlock/);
  assert.match(officeCss, /\.continuous-editor-heading/);
  assert.match(officeCss, /\.continuous-editor\s*\{/);
});

test("Markdown 提供目录、格式工具、实时预览并恢复编辑位置", () => {
  assert.match(officeJs, /class="markdown-workspace"/);
  assert.match(officeJs, /id="markdownOutline"/);
  assert.match(officeJs, /data-markdown-action="heading"/);
  assert.match(officeJs, /function updateMarkdownCompanions/);
  assert.match(officeJs, /editorScrollTop/);
  assert.match(officeSourceJs, /function renderMarkdown/);
  assert.match(officeSourceJs, /markdown-table-wrap/);
  assert.match(officeSourceJs, /loading="lazy"/);
  assert.match(officeCss, /grid-template-columns:\s*180px minmax\(340px, 1fr\) minmax\(340px, 1fr\)/);
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
  assert.match(officeJs, /const createdDocument = safeDocument/);
  assert.match(officeHtml, /data-new-document-kind="docx"/);
  assert.match(officeHtml, /data-new-document-kind="md"/);
  assert.match(officeHtml, /data-new-document-kind="txt"/);
  assert.match(officeJs, /function createBlankDocument\(kind = "docx"\)/);
  assert.doesNotMatch(officeJs, /\bconst document = safeDocument/);
});

test("文件打开和导出显示持续状态、成功结果与可重试错误", () => {
  assert.match(officeHtml, /id="operationBanner"[^>]+aria-live="polite"/);
  assert.match(officeHtml, /id="operationRetry"/);
  assert.match(officeJs, /function showOperation/);
  assert.match(officeJs, /正在读取并解析/);
  assert.match(officeJs, /建立可编辑工作副本/);
  assert.match(officeJs, /已生成并开始下载/);
  assert.match(officeJs, /打开失败：[\s\S]+officeFileInput/);
  assert.match(officeJs, /导出失败：[\s\S]+exportDraft/);
  assert.match(officeCss, /\.operation-banner\[data-state="error"\]/);
});

test("旧版结构化结果在本地工作副本中也会恢复成可读正文", () => {
  assert.match(officeJs, /function readableLegacyCapabilityText/);
  assert.match(officeJs, /LEGACY_CAPABILITY_KINDS/);
  assert.match(officeJs, /text: readableLegacyCapabilityText/);
  assert.match(officeJs, /编辑工作副本/);
});

test("点选最近文件只切换当前文件，不改变更新时间或列表顺序", () => {
  assert.match(officeJs, /function persistSelection\(\)/);
  assert.match(officeJs, /state\.selectedId = button\.dataset\.documentId;[\s\S]{0,180}persistSelection\(\)/);
  assert.doesNotMatch(officeJs, /state\.selectedId = button\.dataset\.documentId;[\s\S]{0,180}persistState\(/);
});

test("文件页保持操作连续，不暴露内部页面结构", () => {
  assert.match(officeHtml, /id="startOfficeTask"[^>]*>开始处理<\/button>/);
  assert.match(officeHtml, /id="processingResultFrame"/);
  assert.doesNotMatch(officeHtml, /带入能力页|继续到能力页/);
  assert.match(officeHtml, /id="openAssistantPanel"[^>]*>小丑鱼处理<\/button>/);
  assert.match(officeHtml, /id="openVersionPanel"[^>]*>版本<\/button>/);
  assert.match(officeHtml, /id="assistantPanel"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(officeJs, /function openAssistantPanel\(mode\)/);
  assert.match(officeCss, /\.assistant-panel\.is-open/);
  assert.match(officeCss, /grid-template-columns:\s*236px minmax\(460px, 1fr\);/);
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
  assert.doesNotMatch(combined, /参考项目|外部仓库|第三方产品|anydoc|firecrawl/i);
});

test("全新服务端不会被浏览器残留的旧文件缓存重新写入", () => {
  assert.match(officeJs, /服务端工作台是跨窗口的唯一真相/);
  assert.match(officeJs, /state\.documents = \[\];[\s\S]*state\.trash = \[\];[\s\S]*writeStoredState\(\);/);
  assert.doesNotMatch(officeJs, /if \(state\.documents\.length \|\| state\.trash\.length\) queueRemoteSave/);
});

test("删除、恢复和文件内任务状态都会同步到服务端", () => {
  assert.match(officeJs, /queueRemoteSave\("文件已移到垃圾桶"\)/);
  assert.match(officeJs, /queueRemoteSave\("文件已恢复"\)/);
  assert.match(officeJs, /queueRemoteSave\("文件已永久删除"\)/);
  assert.match(officeJs, /queueRemoteSave\("处理任务已建立"\)/);
  assert.match(officeJs, /queueRemoteSave\("处理进度已更新"\)/);
});
