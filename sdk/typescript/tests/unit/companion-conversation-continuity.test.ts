import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const companionRoot = join(__dirname, "..", "..", "examples", "companion");
const chatHtml = readFileSync(join(companionRoot, "web", "index.html"), "utf8");
const officeHtml = readFileSync(join(companionRoot, "web", "office.html"), "utf8");
const officeJs = readFileSync(join(companionRoot, "web", "assets", "office-workbench.js"), "utf8");

test("每个对话独立保存未发送草稿并在切换后恢复", () => {
  assert.match(chatHtml, /clownfish-conversation-drafts-v20260813b/);
  assert.match(chatHtml, /function saveConversationDraft/);
  assert.match(chatHtml, /function restoreConversationDraft/);
  assert.match(chatHtml, /saveConversationDraft\(\);[\s\S]{0,100}tree\.activeId = id/);
  assert.match(chatHtml, /#txt"\)\.addEventListener\("input", saveConversationDraft\)/);
});

test("历史搜索覆盖全部对话分支并跳回准确消息", () => {
  assert.match(chatHtml, /function historyConversationSources/);
  assert.match(chatHtml, /Object\.values\(tree\.nodes\)/);
  assert.match(chatHtml, /data-conversation-id/);
  assert.match(chatHtml, /data-message-id/);
  assert.match(chatHtml, /function scrollToHistoryMessage/);
  assert.match(chatHtml, /scrollIntoView/);
});

test("文件选段会携带位置、原文、整份材料和统一文件编号进入任务", () => {
  assert.match(officeHtml, /id="selectionContext"/);
  assert.match(officeJs, /function captureEditorSelection/);
  assert.match(officeJs, /第 \$\{startLine\}/);
  assert.match(officeJs, /source: "office"/);
  assert.match(officeJs, /fileRecordId: current\.fileRecordId/);
  assert.match(officeJs, /同时保留整份文件作为背景/);
});
