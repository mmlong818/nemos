import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  appendCurrentUiEvidence,
  currentUiEvidencePacket,
  needsCurrentUiEvidence,
} from "../../examples/companion/ui-evidence.js";

const webDir = join(__dirname, "..", "..", "examples", "companion", "web");

test("界面评审任务会收到当前服务页面的真实源码证据包", () => {
  const packet = currentUiEvidencePacket(webDir);
  assert.match(packet, /当前界面证据包/);
  assert.match(packet, /\/capabilities/);
  assert.match(packet, /\/office/);
  assert.match(packet, /\/tasks/);
  assert.match(packet, /打开文件/);
  assert.match(packet, /源码 [a-f0-9]{12}/);
  assert.match(packet, /不得断言存在或不存在/);
});

test("只给界面类任务附加证据，普通文稿任务保持原指令", () => {
  assert.equal(needsCurrentUiEvidence("检查文件页面的打开和下载流程"), true);
  assert.equal(needsCurrentUiEvidence("整理一份年度总结"), false);
  assert.equal(appendCurrentUiEvidence("整理一份年度总结", webDir), "整理一份年度总结");
  assert.match(appendCurrentUiEvidence("评审当前 UI", webDir), /当前界面证据包/);
});
