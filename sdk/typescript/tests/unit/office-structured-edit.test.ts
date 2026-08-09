import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { exportOfficeDocument } from "../../examples/companion/office-export.js";
import { extractOfficeFile } from "../../examples/companion/office-file-parser.js";
import { applyStructuredOfficeEdit } from "../../examples/companion/office-structured-edit.js";

test("Word 结构化修改写入真实 DOCX 并保留未知包内容", async () => {
  const original = await exportOfficeDocument({ name: "report", format: "docx", blocks: [{ title: "正文", text: "旧内容" }] });
  const zip = await JSZip.loadAsync(original.data);
  zip.file("custom/preserved.bin", Buffer.from([1, 2, 3, 4]));
  const source = await zip.generateAsync({ type: "nodebuffer" });
  const edited = await applyStructuredOfficeEdit({ kind: "docx", data: source, blocks: [{ title: "正文", text: "新内容" }] });
  const extracted = await extractOfficeFile("report.docx", edited.data);
  const verified = await JSZip.loadAsync(edited.data);
  assert.match(extracted.text, /新内容/);
  assert.deepEqual(await verified.file("custom/preserved.bin")?.async("uint8array"), Uint8Array.from([1, 2, 3, 4]));
});

test("截断的 Word 工作副本不会清空未载入的后续段落", async () => {
  const original = await exportOfficeDocument({ name: "long-report", format: "docx", blocks: [{ title: "正文", text: "旧第一段\n旧第二段" }] });
  const partial = await applyStructuredOfficeEdit({ kind: "docx", data: original.data, blocks: [{ title: "正文", text: "新第一段" }], complete: false });
  const extracted = await extractOfficeFile("long-report.docx", partial.data);
  assert.match(extracted.text, /新第一段/);
  assert.match(extracted.text, /旧第二段/);
  const complete = await applyStructuredOfficeEdit({ kind: "docx", data: original.data, blocks: [{ title: "正文", text: "新第一段" }], complete: true });
  assert.doesNotMatch((await extractOfficeFile("long-report.docx", complete.data)).text, /旧第二段/);
});

test("PowerPoint 结构化修改按页面写入真实 PPTX", async () => {
  const original = await exportOfficeDocument({ name: "deck", format: "pptx", blocks: [{ title: "旧标题", text: "旧要点" }, { title: "第二页", text: "原内容" }] });
  const edited = await applyStructuredOfficeEdit({ kind: "pptx", data: original.data, blocks: [{ title: "第一页", text: "新标题\n新要点" }, { title: "第二页", text: "更新后的内容" }] });
  const extracted = await extractOfficeFile("deck.pptx", edited.data);
  assert.match(extracted.text, /新标题/);
  assert.match(extracted.text, /更新后的内容/);
  assert.equal(edited.changedParts.length, 2);
});

test("截断的 PowerPoint 工作副本保留未载入页面", async () => {
  const original = await exportOfficeDocument({ name: "deck", format: "pptx", blocks: [{ title: "第一页", text: "旧一" }, { title: "第二页", text: "必须保留" }] });
  const edited = await applyStructuredOfficeEdit({ kind: "pptx", data: original.data, blocks: [{ title: "第一页", text: "新一" }], complete: false });
  const extracted = await extractOfficeFile("deck.pptx", edited.data);
  assert.match(extracted.text, /新一/);
  assert.match(extracted.text, /必须保留/);
});

test("Excel 结构化修改支持单元格、清空和公式并保留样式属性", async () => {
  const original = await exportOfficeDocument({ name: "table", format: "xlsx", blocks: [{ title: "数据", text: "名称 | 数量\n苹果 | 2" }] });
  const edited = await applyStructuredOfficeEdit({
    kind: "xlsx",
    data: original.data,
    blocks: [{ title: "数据", text: "A1: 产品 | B1: 数量\nA2: 苹果 | B2: 3" }],
    cells: [{ sheetIndex: 0, address: "C2", value: "=B2*2" }, { sheetIndex: 0, address: "A2", value: "香蕉" }],
  });
  const zip = await JSZip.loadAsync(edited.data);
  const worksheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  assert.match(worksheet || "", /<c r="C2"><f>B2\*2<\/f><v><\/v><\/c>/);
  assert.match(worksheet || "", /<c r="A2" t="inlineStr"><is><t xml:space="preserve">香蕉<\/t><\/is><\/c>/);
  const extracted = await extractOfficeFile("table.xlsx", edited.data);
  assert.match(extracted.text, /A2: 香蕉/);
});
