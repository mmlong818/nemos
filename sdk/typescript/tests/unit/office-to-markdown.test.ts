import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { exportOfficeDocument } from "../../examples/companion/office-export.js";
import { convertOfficeToMarkdown, preservePdfLineBreaks } from "../../examples/companion/office-to-markdown.js";

test("PDF converts through AnyDoc into an editable Markdown copy", async () => {
  const exported = await exportOfficeDocument({
    name: "pdf-source",
    format: "pdf",
    blocks: [{ title: "Quarterly report", text: "Revenue increased" }],
  });
  const result = await convertOfficeToMarkdown("report.pdf", exported.data);
  assert.equal(result.sourceFormat, "pdf");
  assert.match(result.markdown, /Quarterly report|Revenue increased/);
  assert.ok(result.notes.some((note) => note.includes("Markdown 编辑副本")));
});

test("PDF 的视觉换行会成为 Markdown 硬换行", () => {
  const source = "第一行\n第二行\n\n## 标题\n\n- 列表项\n续行\n\n场景正文 【场景设计】：室内 △ 人物进门 张三（低声）：开始吧";
  const result = preservePdfLineBreaks(source);
  assert.match(result, /第一行  \n第二行/);
  assert.match(result, /- 列表项\n续行/);
  assert.match(result, /场景正文\n\n【场景设计】/);
  assert.match(result, /室内\n\n△ 人物进门\n\n张三（低声）：/);
});

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

function paragraph(text: string, styleId?: string, alignment?: "left" | "center" | "right" | "both"): string {
  const formatting = `${styleId ? `<w:pStyle w:val="${styleId}"/>` : ""}${alignment ? `<w:jc w:val="${alignment}"/>` : ""}`;
  const properties = formatting ? `<w:pPr>${formatting}</w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

test("Word 段落对齐会进入可编辑副本", async () => {
  const result = await convertOfficeToMarkdown("alignment.docx", await buildDocx(
    paragraph("居中标题", "Heading1", "center") + paragraph("右对齐正文", undefined, "right") + paragraph("两端对齐正文", undefined, "both"),
  ));
  assert.equal(result.document.blocks.find((block) => block.text === "居中标题")?.alignment, "center");
  assert.equal(result.document.blocks.find((block) => block.text === "右对齐正文")?.alignment, "right");
  assert.equal(result.document.blocks.find((block) => block.text === "两端对齐正文")?.alignment, "justify");
});

test("Word 空行、连续空格、缩进和段落编号进入可编辑副本", async () => {
  const listParagraph = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">编号内容</w:t></w:r></w:p>';
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const result = await convertOfficeToMarkdown("structure.docx", await buildDocx(
    paragraph("  保留前导和  连续空格") + paragraph("") + listParagraph,
    { "word/numbering.xml": numbering },
  ));
  assert.equal(result.document.blocks[0]?.text, "  保留前导和  连续空格");
  assert.equal(result.document.blocks[1]?.text, "");
  assert.equal(result.document.blocks[2]?.listMarker, "1.");
  assert.equal(result.document.blocks[2]?.indentLeft, 720);
});

async function buildOdt(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.file("content.xml", '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h text:outline-level="1">项目说明</text:h><text:p>正文内容</text:p></office:text></office:body></office:document-content>');
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function buildEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("OEBPS/content.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">book</dc:identifier><dc:title>示例书</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file("OEBPS/chapter.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章</h1><p>章节正文</p></body></html>');
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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

test("RTF 与 CSV 进入统一的 Markdown 工作副本", async () => {
  const richText = await convertOfficeToMarkdown(
    "说明.rtf",
    Buffer.from("{\\rtf1\\ansi First \\b important\\b0\\par Second}", "utf8"),
  );
  assert.equal(richText.sourceFormat, "rtf");
  assert.match(richText.markdown, /First \*\*important\*\*/);
  assert.ok(richText.notes.some((note) => note.includes("原文件")));

  const table = await convertOfficeToMarkdown("数据.csv", Buffer.from("name,count\napple,3", "utf8"));
  assert.equal(table.sourceFormat, "csv");
  assert.match(table.markdown, /\| apple \| 3 \|/);
  assert.ok(table.notes.some((note) => note.includes("公式")));
});

test("OpenDocument 与 EPUB 真实解析正文结构", async () => {
  const odt = await convertOfficeToMarkdown("说明.odt", await buildOdt());
  assert.equal(odt.sourceFormat, "odt");
  assert.match(odt.markdown, /^# 项目说明/m);
  assert.match(odt.markdown, /正文内容/);

  const epub = await convertOfficeToMarkdown("示例.epub", await buildEpub());
  assert.equal(epub.sourceFormat, "epub");
  assert.match(epub.markdown, /示例书/);
  assert.match(epub.markdown, /第一章/);
  assert.match(epub.markdown, /章节正文/);
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

test("旧版能力 JSON 会转换成可读正文，不再把内部结构显示给用户", async () => {
  const legacy = JSON.stringify({
    kind: "thinking-workbench",
    title: "是否调整文件工作流",
    summary: "先修复打开与导出反馈，再验证编辑体验。",
    data: {
      problem: "用户无法判断文件是否已成功处理",
      facts: ["打开和下载缺少持续状态"],
      assumptions: [{ text: "持续反馈能降低误操作", risk: "低" }],
      contradictions: [],
      options: [
        { name: "补充操作状态", upside: "结果清楚", downside: "需要占用少量空间", signal: "误操作下降" },
        { name: "只用短提示", upside: "改动小", downside: "容易错过", signal: "用户能复述结果" },
      ],
      experiments: [{ name: "文件操作走查", method: "完成打开和下载", cost: "低", successSignal: "全程知道当前状态" }],
      nextActions: ["修复状态反馈"],
    },
  });

  const result = await convertOfficeToMarkdown("旧版结果.txt", Buffer.from(legacy, "utf8"));
  assert.match(result.markdown, /^# 是否调整文件工作流/m);
  assert.match(result.markdown, /## 问题/);
  assert.doesNotMatch(result.markdown, /\{"kind":/);
  assert.ok(result.notes.some((note) => note.includes("内部数据不会作为正文显示")));
});
