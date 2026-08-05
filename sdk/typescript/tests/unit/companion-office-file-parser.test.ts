import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractOfficeFile } from "../../examples/companion/office-file-parser.js";

async function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}

test("读取 DOCX 段落并保留正文顺序", async () => {
  const data = await zipOf({
    "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>项目背景</w:t></w:r></w:p><w:p><w:r><w:t>下一步行动</w:t></w:r></w:p></w:body></w:document>",
  });
  const result = await extractOfficeFile("brief.docx", data);
  assert.equal(result.kind, "docx");
  assert.match(result.text, /项目背景\n\n下一步行动/);
});

test("按页读取 PPTX 文字", async () => {
  const data = await zipOf({
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>第二页结论</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>第一页标题</a:t></a:r></a:p></p:sld>",
  });
  const result = await extractOfficeFile("deck.pptx", data);
  assert.equal(result.sections, 2);
  assert.ok(result.text.indexOf("第一页标题") < result.text.indexOf("第二页结论"));
});

test("读取 XLSX 工作表名称、共享字符串与数值", async () => {
  const data = await zipOf({
    "xl/workbook.xml": '<workbook><sheets><sheet name="预算" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>收入</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>120</v></c></row></sheetData></worksheet>',
  });
  const result = await extractOfficeFile("budget.xlsx", data);
  assert.match(result.text, /## 预算/);
  assert.match(result.text, /A1: 收入 \| B1: 120/);
});

test("读取 PDF 页面文字", async () => {
  const result = await extractOfficeFile("report.pdf", minimalPdf("Quarterly summary"));
  assert.equal(result.kind, "pdf");
  assert.equal(result.sections, 1);
  assert.match(result.text, /Quarterly summary/);
});

test("拒绝伪装成办公文件的未知格式", async () => {
  await assert.rejects(() => extractOfficeFile("notes.rtf", Buffer.from("hello")), /仅支持 DOCX、PPTX、XLSX 和 PDF/);
});
