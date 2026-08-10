import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  OFFICE_CAPABILITY_LABELS,
  OFFICE_FORMAT_CAPABILITIES,
  officeCapabilityBrowserScript,
  officeCapabilityOf,
} from "../../examples/companion/office-capabilities.js";

const webRoot = join(__dirname, "..", "..", "examples", "companion", "web");
const officeHtml = readFileSync(join(webRoot, "office.html"), "utf8");
const officeJs = readFileSync(join(webRoot, "assets", "office-workbench.js"), "utf8");

test("每种可打开的格式都声明了真实能力", () => {
  const formats = OFFICE_FORMAT_CAPABILITIES.map((entry) => entry.format).sort();
  assert.deepEqual(formats, ["docx", "md", "pdf", "pptx", "txt", "xlsx"]);
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    assert.equal(entry.capabilityLabel, OFFICE_CAPABILITY_LABELS[entry.capability]);
    assert.ok(entry.summary.length > 0);
  }
});

test("能力标注、文字视图与保存位置三者必须自洽", () => {
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    // "可编辑"与"能覆盖原文件"是两件事，必须分开表达，不能互相冒充。
    assert.equal(entry.sourceWritable, entry.savesTo === "original", `${entry.format} 的 sourceWritable 与 savesTo 不一致`);
    assert.equal(entry.textView === "edit", entry.capability === "edit", `${entry.format} 的文字视图与能力标注不一致`);
    if (entry.capability === "edit") {
      assert.notEqual(entry.savesTo, "none", `${entry.format} 标为可编辑却没有保存去处`);
    }
    assert.ok(entry.textViewLabel.length > 0, `${entry.format} 缺少文字视图标签`);
  }
});

test("标为可编辑的格式必须有实机保真证据，否则只能是仅查看", () => {
  // 有 Word 实机验证的：TXT/MD 直接写回，DOCX 段落补丁另存新文件。
  assert.equal(officeCapabilityOf("txt")?.savesTo, "original");
  assert.equal(officeCapabilityOf("md")?.savesTo, "original");
  const docx = officeCapabilityOf("docx");
  assert.equal(docx?.capability, "edit");
  assert.equal(docx?.savesTo, "copy");
  assert.equal(docx?.sourceWritable, false, "DOCX 还不能覆盖原文件");
  assert.match(docx?.limitations[0] || "", /不会覆盖/, "第一条限制必须先讲清不覆盖原文件");
  // 仍走已冻结的有损路径，因此不能标为可编辑。
  for (const format of ["pptx", "xlsx", "pdf"]) {
    assert.equal(officeCapabilityOf(format)?.capability, "view", `${format} 不应标为可编辑`);
    assert.equal(officeCapabilityOf(format)?.sourceWritable, false);
  }
});

test("只生成副本的格式必须写明会损失什么", () => {
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    if (!entry.copyOnly) continue;
    assert.ok(entry.limitations.length >= 2, `${entry.format} 缺少副本限制说明`);
    assert.match(entry.summary, /副本|新文件/, `${entry.format} 的说明必须点明结果存到别处`);
    assert.equal(entry.savesTo, "copy");
  }
  assert.equal(officeCapabilityOf("pdf")?.copyOnly, false);
  assert.equal(officeCapabilityOf("markdown")?.format, "md");
  assert.equal(officeCapabilityOf("exe"), null);
});

test("浏览器读到的是服务端同一张表", () => {
  const script = officeCapabilityBrowserScript();
  assert.match(script, /^window\.ClownfishOfficeCapabilities = Object\.freeze\(/);
  assert.doesNotMatch(script, /</);
  const payload = JSON.parse(script.replace(/^window\.ClownfishOfficeCapabilities = Object\.freeze\(/, "").replace(/\);\n$/, "").replace(/\\u003c/g, "<"));
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    assert.deepEqual(payload.capabilities[entry.format], entry);
  }
  assert.match(officeHtml, /<script src="\/assets\/office-capabilities\.js"><\/script>/);
  assert.match(officeJs, /window\.ClownfishOfficeCapabilities\?\.capabilities/);
});

test("文件页不再声称能无损修改 Office 文件", () => {
  const banned = [/应用到原格式/, /可写入原格式/, /版式与对象继续保留/, /编辑 Word/, /编辑页面/, /编辑表格/];
  for (const pattern of banned) {
    assert.doesNotMatch(officeHtml, pattern, `office.html 仍含虚假编辑表述：${pattern}`);
    assert.doesNotMatch(officeJs, pattern, `office-workbench.js 仍含虚假编辑表述：${pattern}`);
  }
  assert.match(officeHtml, /id="capabilityBadge"/);
  assert.match(officeJs, /querySelector\("#capabilityNote"\)/);
  assert.match(officeHtml, /id="capabilityNote"/);
  assert.match(officeJs, /function capabilityOf/);
  assert.match(officeJs, /badge\.dataset\.capability = capability\.capability/);
});

test("DOCX 文字修改按 docxIndex 定位，不按纯文本位置对齐", () => {
  assert.match(officeJs, /\/api\/files\/session\/docx-blocks\?id=/);
  assert.match(officeJs, /function renderDocxWorkspace/);
  assert.match(officeJs, /data-docx-index="\$\{block\.docxIndex\}"/);
  assert.match(officeJs, /block\.textEditable/);
  // 只把真正改过的段落送出
  assert.match(officeJs, /pending\.get\(block\.docxIndex\) !== block\.text/);
  // 外部改动后必须丢弃对不上的段落结构与未提交修改
  assert.match(officeJs, /docxBlocksByDocument\.delete\(current\.id\)/);
  assert.match(officeJs, /current\.docxEdits = \[\]/);
});
