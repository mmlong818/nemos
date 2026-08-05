import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { exportOfficeDocument } from "../../examples/companion/office-export.js";

const blocks = [
  { title: "执行摘要", text: "结论先行\n保留原始事实" },
  { title: "数据", text: "项目\t数值\n完成\t82\n待办\t18" },
];

test("办公工作台生成真实 DOCX、XLSX、PPTX 和 PDF 文件", async () => {
  const docx = await exportOfficeDocument({ name: "季度汇报", format: "docx", blocks });
  const docxZip = await JSZip.loadAsync(docx.data);
  assert.ok(docxZip.file("word/document.xml"));
  assert.match(await docxZip.file("word/document.xml")!.async("string"), /执行摘要/);

  const xlsx = await exportOfficeDocument({ name: "季度汇报", format: "xlsx", blocks });
  const xlsxZip = await JSZip.loadAsync(xlsx.data);
  assert.ok(xlsxZip.file("xl/workbook.xml"));
  assert.ok(xlsxZip.file("xl/worksheets/sheet1.xml"));

  const pptx = await exportOfficeDocument({ name: "季度汇报", format: "pptx", blocks });
  const pptxZip = await JSZip.loadAsync(pptx.data);
  assert.ok(pptxZip.file("ppt/slides/slide1.xml"));

  const pdf = await exportOfficeDocument({ name: "季度汇报", format: "pdf", blocks });
  assert.equal(pdf.data.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.data.length > 1_000);
});

test("演示导出会给过量内容返回版面复核提示", async () => {
  const output = await exportOfficeDocument({
    name: "过长演示",
    format: "pptx",
    blocks: [{ title: "这是一个明显过长且需要复核的演示页面标题，因为它超过合理长度", text: "内容".repeat(400) }],
  });
  assert.ok(output.warnings.some((warning) => warning.includes("复核版面")));
});
