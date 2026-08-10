import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { exportOfficeDocument } from "../../examples/companion/office-export.js";
import { OfficeFileSessionStore } from "../../examples/companion/office-file-sessions.js";
import { validateOfficeFile } from "../../examples/companion/office-validation.js";

function checkOf(receipt: Awaited<ReturnType<typeof validateOfficeFile>>, name: string) {
  const check = receipt.checks.find((item) => item.name === name);
  assert.ok(check, `缺少检查项：${name}`);
  return check;
}

test("正常生成的 Office 文件通过全部结构检查", async () => {
  for (const format of ["docx", "pptx", "xlsx"] as const) {
    const exported = await exportOfficeDocument({ name: "样例", format, blocks: [{ title: "标题", text: "内容一\n\n内容二" }] });
    const receipt = await validateOfficeFile(format, exported.data);
    const failed = receipt.checks.filter((check) => !check.passed).map((check) => `${check.name}:${check.detail ?? ""}`);
    assert.deepEqual(failed, [], `${format} 未通过：${failed.join("；")}`);
    assert.equal(receipt.passed, true);
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  }
});

test("不是 ZIP 包的内容会被判为无法解析", async () => {
  const receipt = await validateOfficeFile("docx", Buffer.from("这不是一个 docx"));
  assert.equal(receipt.passed, false);
  assert.equal(checkOf(receipt, "包头是 ZIP").passed, false);
  assert.equal(checkOf(receipt, "包可以解析").passed, false);
});

test("缺少必需部件的包会被拦下", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/styles.xml", "<styles/>");
  const receipt = await validateOfficeFile("docx", await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(receipt.passed, false);
  const check = checkOf(receipt, "必需部件齐全");
  assert.equal(check.passed, false);
  assert.match(check.detail || "", /word\/document\.xml/);
});

test("破损的 XML 部件会被识别为结构不完整", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>内容</w:t></w:r></w:p>");
  const receipt = await validateOfficeFile("docx", await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(checkOf(receipt, "XML 部件结构完整").passed, false);
  assert.match(checkOf(receipt, "XML 部件结构完整").detail || "", /word\/document\.xml/);
});

test("包内越界路径会被拦下", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<w:document><w:body/></w:document>");
  zip.file("../escape.txt", "x");
  const receipt = await validateOfficeFile("docx", await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(checkOf(receipt, "没有越界的包内路径").passed, false);
});

test("XML 校验容忍注释、CDATA、自闭合与属性里的尖括号", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><!-- <w:p> 注释里的假标签 --><w:document><w:body><w:p w:rsidR="a>b"><w:br/><w:t><![CDATA[</w:t> 原样文本]]></w:t></w:p></w:body></w:document>',
  );
  const receipt = await validateOfficeFile("docx", await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(checkOf(receipt, "XML 部件结构完整").passed, true);
});

test("纯文本和 PDF 有各自的结构检查", async () => {
  const textReceipt = await validateOfficeFile("txt", Buffer.from("正常文本"));
  assert.equal(textReceipt.passed, true);
  const binaryReceipt = await validateOfficeFile("txt", Buffer.from([0x61, 0x00, 0x62]));
  assert.equal(checkOf(binaryReceipt, "不含空字节").passed, false);

  const brokenPdf = await validateOfficeFile("pdf", Buffer.from("不是 PDF"));
  assert.equal(checkOf(brokenPdf, "包头是 PDF").passed, false);
  assert.equal(checkOf(brokenPdf, "文件结尾完整").passed, false);
});

test("结构完整但没有文字的文件不算损坏", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<w:document><w:body><w:sectPr/></w:body></w:document>");
  const receipt = await validateOfficeFile("docx", await zip.generateAsync({ type: "nodebuffer" }));
  const reparse = checkOf(receipt, "可以重新读取");
  assert.equal(reparse.passed, true);
  assert.match(reparse.detail || "", /没有可提取的文字/);
});

test("副本没通过格式检查时不落盘，工作区不留半成品", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-office-validation-"));
  try {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>原内容</w:t></w:r></w:p>");
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("broken.docx", await zip.generateAsync({ type: "nodebuffer" }));
    await assert.rejects(
      () => store.saveStructuredCopy(created.id, created.contentHash, [{ title: "正文", text: "新内容" }]),
      /没有通过格式检查/,
    );
    assert.deepEqual(store.scan().map((session) => session.id), [created.id]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("生成导出文件时同样过结构检查并带回回执", async () => {
  const exported = await exportOfficeDocument({ name: "导出样例", format: "xlsx", blocks: [{ title: "数据", text: "A1: 名称 | B1: 数量" }] });
  assert.equal(exported.validation?.passed, true);
  assert.equal(exported.validation?.byteLength, exported.data.byteLength);
});

test("通过检查的副本会带回可复核的检查回执", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-office-receipt-"));
  try {
    const original = await exportOfficeDocument({ name: "报告", format: "docx", blocks: [{ title: "正文", text: "旧内容" }] });
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("报告.docx", original.data);
    const result = await store.saveStructuredCopy(created.id, created.contentHash, [{ title: "正文", text: "新内容" }]);
    assert.equal(result.validation.passed, true);
    assert.equal(result.validation.sha256, result.copy.contentHash);
    assert.equal(result.validation.byteLength, result.copy.byteLength);
    assert.ok(result.validation.checks.length >= 6);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
