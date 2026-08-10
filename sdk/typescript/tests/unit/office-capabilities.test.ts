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
const server = readFileSync(join(__dirname, "..", "..", "examples", "companion", "server.ts"), "utf8");

test("每种可打开的格式都声明了真实能力", () => {
  const formats = OFFICE_FORMAT_CAPABILITIES.map((entry) => entry.format).sort();
  assert.deepEqual(formats, ["docx", "md", "pdf", "pptx", "txt", "xlsx"]);
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    assert.equal(entry.capabilityLabel, OFFICE_CAPABILITY_LABELS[entry.capability]);
    assert.ok(entry.summary.length > 0);
    assert.ok(entry.textViewLabel.length > 0);
  }
});

test("能力标注、文字视图与保存位置三者必须自洽", () => {
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    // "可编辑"与"能覆盖原文件"是两件事，必须分开表达，不能互相冒充。
    assert.equal(entry.sourceWritable, entry.savesTo === "original", `${entry.format} 的 sourceWritable 与 savesTo 不一致`);
    assert.equal(entry.textView === "edit", entry.capability === "edit", `${entry.format} 的文字视图与能力标注不一致`);
    if (entry.capability === "edit") assert.notEqual(entry.savesTo, "none", `${entry.format} 标为可编辑却没有保存去处`);
  }
});

test("需要转换的格式一律不写回原文件", () => {
  for (const entry of OFFICE_FORMAT_CAPABILITIES) {
    assert.equal(entry.convertsToMarkdown, entry.capability === "convert", `${entry.format} 的转换标记与能力标注不一致`);
    if (!entry.convertsToMarkdown) continue;
    // 转换出来的是 Markdown，写回原文件会把 .docx 写成 Markdown 文本。
    assert.equal(entry.sourceWritable, false, `${entry.format} 转换后不该能写回原文件`);
    assert.equal(entry.copyOnly, false);
    assert.equal(entry.canSaveCopy, false);
    assert.match(entry.summary, /转成 Markdown/, `${entry.format} 的说明必须点明会先转换`);
    assert.match(entry.summary, /原文件保留/, `${entry.format} 的说明必须点明原文件不被改写`);
    assert.ok(entry.limitations.length >= 2, `${entry.format} 必须列出转换会丢什么`);
    assert.ok(
      entry.limitations.some((item) => item.includes("每次转换都会列出")),
      `${entry.format} 必须说明每份文件都会给出具体的丢失清单`,
    );
  }
});

test("只有 TXT 与 Markdown 直接编辑并写回原文件", () => {
  for (const format of ["txt", "md"]) {
    const entry = officeCapabilityOf(format);
    assert.equal(entry?.capability, "edit");
    assert.equal(entry?.savesTo, "original");
    assert.equal(entry?.convertsToMarkdown, false);
  }
  for (const format of ["docx", "pptx", "xlsx", "pdf"]) {
    assert.equal(officeCapabilityOf(format)?.capability, "convert", `${format} 应标为需转换`);
  }
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

test("上传后统一转成 Markdown，转换损失显示给用户", () => {
  assert.match(server, /convertOfficeToMarkdown/);
  assert.match(server, /conversion,/, "extract 接口要把转换结果一起返回");
  assert.match(officeJs, /const conversion = response\.conversion/);
  assert.match(officeJs, /conversionNotes/);
  // 转换来的文档不能写回原文件
  assert.match(officeJs, /importedDocument\.sourceWritable = !converted/);
  assert.match(officeJs, /convertedFrom/);
});

test("原格式编辑已退出产品，界面与接口都不再提供", () => {
  const retiredUi = [/renderDocxWorkspace/, /renderPptxWorkspace/, /data-docx-index/, /data-pptx-key/, /writeBackDocx/, /writeBackPptx/];
  for (const pattern of retiredUi) {
    assert.doesNotMatch(officeJs, pattern, `office-workbench.js 仍残留已退出的原格式编辑：${pattern}`);
  }
  const retiredRoutes = ["docx-blocks", "docx-save", "docx-copy", "pptx-blocks", "pptx-save", "structured-copy"];
  for (const route of retiredRoutes) {
    assert.doesNotMatch(server, new RegExp(`/api/files/session/${route}`), `server.ts 仍暴露已退出的接口：${route}`);
  }
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
});
