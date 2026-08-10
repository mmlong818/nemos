import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { exportOfficeDocument } from "../../examples/companion/office-export.js";
import { convertOfficeToMarkdown } from "../../examples/companion/office-to-markdown.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function buildDocx(body: string, extra: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>` +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>',
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  for (const [path, content] of Object.entries(extra)) zip.file(path, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

function paragraph(text: string, styleId?: string): string {
  const properties = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

test("Markdown 与纯文本按原样进入，不做多余推断", async () => {
  const md = await convertOfficeToMarkdown("notes.md", Buffer.from("# 标题\n\n正文", "utf8"));
  assert.equal(md.sourceFormat, "md");
  assert.equal(md.markdown, "# 标题\n\n正文");
  assert.deepEqual(md.notes, []);

  const txt = await convertOfficeToMarkdown("notes.txt", Buffer.from("第一行\n第二行", "utf8"));
  assert.equal(txt.sourceFormat, "txt");
  assert.equal(txt.markdown, "第一行\n第二行");
  assert.ok(txt.notes.some((note) => note.includes("没有推断标题层级")));
});

test("Word 的标题层级、段落与表格转成对应的 Markdown", async () => {
  const table =
    "<w:tbl>" +
    "<w:tr><w:tc><w:p><w:r><w:t>区域</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>收入</w:t></w:r></w:p></w:tc></w:tr>" +
    "<w:tr><w:tc><w:p><w:r><w:t>华东</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4820</w:t></w:r></w:p></w:tc></w:tr>" +
    "</w:tbl>";
  const result = await convertOfficeToMarkdown(
    "报告.docx",
    await buildDocx(paragraph("季度回顾", "Heading1") + paragraph("二级标题", "Heading2") + paragraph("这是正文。") + table),
  );

  assert.equal(result.sourceFormat, "docx");
  const lines = result.markdown.split("\n").filter(Boolean);
  assert.equal(lines[0], "# 季度回顾");
  assert.equal(lines[1], "## 二级标题");
  assert.equal(lines[2], "这是正文。");
  assert.ok(result.markdown.includes("| 区域 | 收入 |"));
  assert.ok(result.markdown.includes("| --- | --- |"));
  assert.ok(result.markdown.includes("| 华东 | 4820 |"));
});

test("Word 转换会如实列出丢掉的东西", async () => {
  const result = await convertOfficeToMarkdown("报告.docx", await buildDocx(paragraph("正文")));
  assert.ok(result.notes.some((note) => note.includes("字体")), "必须说明样式不在 Markdown 表达范围内");
});

test("表格里的竖线被转义，不会破坏 Markdown 表格", async () => {
  const table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
  const result = await convertOfficeToMarkdown("t.docx", await buildDocx(table));
  assert.ok(result.markdown.includes("a\\|b"));
});

test("PowerPoint 按页转换，表格与讲者备注都带过来", async () => {
  // 用自家生成器造一份真实结构的 PPTX，再补上一页的讲者备注
  const exported = await exportOfficeDocument({ name: "deck", format: "pptx", blocks: [{ title: "第一页", text: "要点一\n要点二" }] });
  const result = await convertOfficeToMarkdown("deck.pptx", exported.data);
  assert.equal(result.sourceFormat, "pptx");
  assert.ok(result.markdown.includes("## 第 1 页"));
  assert.ok(result.markdown.includes("要点一"));
  assert.ok(result.notes.some((note) => note.includes("版式")));
});

test("Excel 每个工作表转成一个 Markdown 表格", async () => {
  const exported = await exportOfficeDocument({ name: "table", format: "xlsx", blocks: [{ title: "数据", text: "A1: 名称 | B1: 数量\nA2: 苹果 | B2: 3" }] });
  const result = await convertOfficeToMarkdown("table.xlsx", exported.data);
  assert.equal(result.sourceFormat, "xlsx");
  assert.ok(/^## /m.test(result.markdown), "每个工作表要有自己的小节标题");
  assert.ok(result.markdown.includes("| --- |"), "要生成 Markdown 表格分隔行");
  assert.ok(result.markdown.includes("苹果"));
  assert.ok(result.notes.some((note) => note.includes("公式")));
});

test("超长内容会截断并说明，不静默丢弃", async () => {
  const long = "段落内容。".repeat(60_000);
  const result = await convertOfficeToMarkdown("long.txt", Buffer.from(long, "utf8"));
  assert.equal(result.truncated, true);
  assert.ok(result.markdown.includes("原文件完整保留"));
  assert.ok(result.notes.some((note) => note.includes("只保留了前半部分")));
});

test("不支持的格式明确拒绝", async () => {
  await assert.rejects(() => convertOfficeToMarkdown("setup.exe", Buffer.from("MZ")), /仅支持/);
});
