import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { applyDocxTextEdits, readDocxText } from "../../examples/companion/office-docx-text-edit.js";
import { OfficeFileSessionStore } from "../../examples/companion/office-file-sessions.js";
import { applyStructuredOfficeEdit } from "../../examples/companion/office-structured-edit.js";
import { validateOfficeFile } from "../../examples/companion/office-validation.js";

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const PACKAGE_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

/** 第 0 段混排三种行内格式；第 1 段带未建模的 keepNext/tabs；随后是表格与 sectPr。 */
const MIXED_BODY =
  '<w:p><w:pPr><w:spacing w:line="360"/></w:pPr>' +
  '<w:r><w:t xml:space="preserve">开头普通 </w:t></w:r>' +
  '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">这段加粗 </w:t></w:r>' +
  '<w:r><w:rPr><w:color w:val="FF0000"/><w:sz w:val="32"/></w:rPr><w:t>这段红色大字</w:t></w:r>' +
  "</w:p>" +
  '<w:p><w:pPr><w:keepNext/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
  "<w:r><w:rPr><w:i/></w:rPr><w:t>第二段不动</w:t></w:r></w:p>" +
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';

async function buildDocx(body: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", PACKAGE_RELS);
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body +
      "</w:body></w:document>",
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function documentXmlOf(data: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  return (await zip.file("word/document.xml")?.async("string")) || "";
}

test("读取 DOCX 时区分可改文字的段落与只能透传的内容", async () => {
  const blocks = await readDocxText(await buildDocx(MIXED_BODY));
  const texts = blocks.map((block) => `${block.kind}:${block.textEditable}:${block.text}`);
  assert.deepEqual(texts.slice(0, 2), [
    "paragraph:true:开头普通 这段加粗 这段红色大字",
    "paragraph:true:第二段不动",
  ]);
  const table = blocks.find((block) => block.kind === "table");
  assert.ok(table, "表格应被识别为独立块");
  assert.equal(table.textEditable, false);
  // 标签只用小丑鱼自己的产品语言，尺寸保留
  assert.match(table.label || "", /^表格( \d+×\d+)?$/);
  assert.doesNotMatch(table.label || "", /Table|Image|Chart/);
});

test("改一个段落的文字，同段其他 run 的行内格式原样保留", async () => {
  const original = await buildDocx(MIXED_BODY);
  const result = await applyDocxTextEdits(original, [{ docxIndex: 0, text: "改写后的开头 这段加粗 这段红色大字" }]);
  assert.deepEqual(result.changed, [0]);
  assert.deepEqual(result.skipped, []);
  const xml = await documentXmlOf(result.data);
  assert.match(xml, /改写后的开头/);
  assert.doesNotMatch(xml, /开头普通/);
  // 未参与修改的 run 保留自己的格式
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>这段加粗/);
  assert.match(xml, /<w:color w:val="FF0000"\/><w:sz w:val="32"\/>/);
  // 段落自身的属性也不变
  assert.match(xml, /<w:pPr><w:spacing w:line="360"\/><\/w:pPr>/);
});

test("没有请求修改的段落、表格和 sectPr 字节不变", async () => {
  const original = await buildDocx(MIXED_BODY);
  const result = await applyDocxTextEdits(original, [{ docxIndex: 0, text: "只改第一段 这段加粗 这段红色大字" }]);
  const xml = await documentXmlOf(result.data);
  assert.match(xml, /<w:pPr><w:keepNext\/><w:tabs><w:tab w:val="left" w:pos="720"\/><\/w:tabs><\/w:pPr><w:r><w:rPr><w:i\/><\/w:rPr><w:t>第二段不动<\/w:t><\/w:r>/);
  assert.match(xml, /<w:tbl><w:tr><w:tc><w:p><w:r><w:t>单元格<\/w:t><\/w:r><\/w:p><\/w:tc><\/w:tr><\/w:tbl>/);
  assert.match(xml, /<w:sectPr><w:pgSz w:w="11906" w:h="16838"\/><\/w:sectPr>/);
});

test("文字没有变化时不产生改动", async () => {
  const original = await buildDocx(MIXED_BODY);
  const result = await applyDocxTextEdits(original, [{ docxIndex: 0, text: "开头普通 这段加粗 这段红色大字" }]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.skipped, []);
});

test("对非文字块请求修改时不动它并如实上报", async () => {
  // 只有图形、没有 w:t 锚点的段落
  const body = '<w:p><w:r><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml"/></w:pict></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';
  const original = await buildDocx(body);
  const result = await applyDocxTextEdits(original, [{ docxIndex: 0, text: "试图塞入文字" }]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.skipped, [0]);
  const xml = await documentXmlOf(result.data);
  assert.match(xml, /<v:rect/);
  assert.doesNotMatch(xml, /试图塞入文字/);
});

test("对表格请求修改也计入未改动，不会静默丢失", async () => {
  const original = await buildDocx(MIXED_BODY);
  const blocks = await readDocxText(original);
  const table = blocks.find((block) => block.kind === "table");
  assert.ok(table);
  const result = await applyDocxTextEdits(original, [{ docxIndex: table.docxIndex, text: "改表格" }]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.skipped, [table.docxIndex]);
  assert.match(await documentXmlOf(result.data), /<w:t>单元格<\/w:t>/);
});

test("修改结果通过结构检查", async () => {
  const original = await buildDocx(MIXED_BODY);
  const result = await applyDocxTextEdits(original, [{ docxIndex: 1, text: "第二段改了" }]);
  const receipt = await validateOfficeFile("docx", result.data);
  const failed = receipt.checks.filter((check) => !check.passed).map((check) => check.name);
  assert.deepEqual(failed, []);
});

test("会话层按 docxIndex 生成保真副本，原文件字节不变", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-docx-engine-"));
  try {
    const original = await buildDocx(MIXED_BODY);
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("季度汇报.docx", original);

    const blocks = await store.readDocxBlocks(created.id);
    assert.equal(blocks[0]?.textEditable, true);
    assert.ok(blocks.some((block) => block.kind === "table"));

    const result = await store.saveDocxTextCopy(created.id, created.contentHash, [
      { docxIndex: 0, text: "改写后的开头 这段加粗 这段红色大字" },
    ]);
    assert.deepEqual(result.changed, [0]);
    assert.equal(result.validation.passed, true);
    assert.match(result.copy.name, /文字副本/);
    assert.equal(readFileSync(created.file).equals(original), true, "打开的文件必须字节不变");

    const copyXml = await documentXmlOf(readFileSync(result.copy.file));
    assert.match(copyXml, /<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>这段加粗/);
    assert.match(copyXml, /<w:keepNext\/>/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("就地写回覆盖工作副本，改动前的版本仍可取回", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-docx-writeback-"));
  try {
    const original = await buildDocx(MIXED_BODY);
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("季度汇报.docx", original);

    const saved = await store.saveDocxTextEdits(created.id, created.contentHash, [
      { docxIndex: 0, text: "写回后的开头 这段加粗 这段红色大字" },
    ]);
    assert.deepEqual(saved.changed, [0]);
    assert.equal(saved.validation.passed, true);
    // 工作副本本身被覆盖
    assert.notEqual(saved.session.contentHash, created.contentHash);
    const nowXml = await documentXmlOf(readFileSync(created.file));
    assert.match(nowXml, /写回后的开头/);
    assert.match(nowXml, /<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>这段加粗/, "写回同样不能压平行内格式");

    // 改动前的字节仍在版本历史里
    const versions = store.history(created.id);
    assert.equal(versions[0]?.reason, "text-edit");
    const imported = versions.find((version) => version.reason === "imported");
    assert.ok(imported, "导入时的原始版本必须保留");
    assert.equal(imported.contentHash, created.contentHash);
    const restored = store.restore(created.id, imported.id, saved.session.contentHash);
    assert.equal(readFileSync(restored.file).equals(original), true, "应能完整回到改动前的字节");
    assert.equal(store.eventHistory(created.id).some((event) => event.type === "text-edit"), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("就地写回在格式检查不通过时不落盘", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-docx-writeback-guard-"));
  try {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>原内容</w:t></w:r></w:p>");
    const broken = await zip.generateAsync({ type: "nodebuffer" });
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("broken.docx", broken);
    await assert.rejects(
      () => store.saveDocxTextEdits(created.id, created.contentHash, [{ docxIndex: 0, text: "新内容" }]),
      /没有通过格式检查/,
    );
    assert.equal(readFileSync(created.file).equals(broken), true, "工作副本必须保持原样");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("会话层拒绝没有实际变化的请求，不产生空副本", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-docx-engine-noop-"));
  try {
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("报告.docx", await buildDocx(MIXED_BODY));
    await assert.rejects(
      () => store.saveDocxTextCopy(created.id, created.contentHash, [{ docxIndex: 0, text: "开头普通 这段加粗 这段红色大字" }]),
      /没有实际变化/,
    );
    assert.deepEqual(store.scan().map((session) => session.id), [created.id]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("非 Word 文件不走保真段落路径", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-docx-engine-guard-"));
  try {
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("notes.md", Buffer.from("content"));
    await assert.rejects(() => store.readDocxBlocks(created.id), /只有 Word 文件/);
    await assert.rejects(() => store.saveDocxTextCopy(created.id, created.contentHash, [{ docxIndex: 0, text: "x" }]), /只处理 Word 文件/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("对比已冻结的文字级替换：旧路径丢行内格式，新路径不丢", async () => {
  const original = await buildDocx(MIXED_BODY);

  const legacy = await applyStructuredOfficeEdit({
    kind: "docx",
    data: original,
    blocks: [{ title: "正文", text: "改写后的开头 这段加粗 这段红色大字" }],
    complete: false,
  });
  const legacyXml = await documentXmlOf(legacy.data);
  assert.doesNotMatch(legacyXml, /<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>这段加粗/, "旧路径本应丢掉加粗 run 的文字归属");

  const engine = await applyDocxTextEdits(original, [{ docxIndex: 0, text: "改写后的开头 这段加粗 这段红色大字" }]);
  const engineXml = await documentXmlOf(engine.data);
  assert.match(engineXml, /<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>这段加粗/);
  assert.match(engineXml, /<w:color w:val="FF0000"\/>/);
});
