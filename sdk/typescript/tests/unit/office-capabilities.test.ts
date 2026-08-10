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

test("只有能写回原文件的格式才标为可编辑", () => {
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    assert.equal(entry.capability === "edit", entry.sourceWritable, `${entry.format} 的能力标注与写回行为不一致`);
    assert.equal(entry.textView === "edit", entry.sourceWritable, `${entry.format} 的文字视图与写回行为不一致`);
  }
  assert.equal(officeCapabilityOf("txt")?.capability, "edit");
  assert.equal(officeCapabilityOf("md")?.capability, "edit");
  for (const format of ["docx", "pptx", "xlsx", "pdf"]) {
    const entry = officeCapabilityOf(format);
    assert.equal(entry?.capability, "view", `${format} 不应标为可编辑`);
    assert.equal(entry?.sourceWritable, false);
  }
});

test("只生成副本的格式必须写明会损失什么", () => {
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    if (!entry.copyOnly) continue;
    assert.ok(entry.limitations.length >= 2, `${entry.format} 缺少副本限制说明`);
    assert.match(entry.summary, /副本/);
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
  assert.match(officeHtml, /id="capabilityNote"/);
  assert.match(officeJs, /function capabilityOf/);
  assert.match(officeJs, /badge\.dataset\.capability = capability\.capability/);
});
