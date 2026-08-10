import { createHash } from "node:crypto";
import JSZip from "jszip";

import { extractOfficeFile, type OfficeFileKind } from "./office-file-parser.js";

/**
 * 写盘前的结构校验。任何生成或改写出来的文件都要先通过这里，
 * 校验不过就不落盘——宁可让这次操作失败，也不给用户一个打开时报错的文件。
 */
export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ValidationReceipt {
  format: OfficeFileKind;
  byteLength: number;
  sha256: string;
  passed: boolean;
  checks: ValidationCheck[];
}

const REQUIRED_PARTS: Record<string, { exact: string[]; pattern?: RegExp; patternLabel?: string }> = {
  docx: { exact: ["[Content_Types].xml", "word/document.xml"] },
  pptx: { exact: ["[Content_Types].xml", "ppt/presentation.xml"], pattern: /^ppt\/slides\/slide\d+\.xml$/i, patternLabel: "至少一页幻灯片" },
  xlsx: { exact: ["[Content_Types].xml", "xl/workbook.xml"], pattern: /^xl\/worksheets\/sheet\d+\.xml$/i, patternLabel: "至少一个工作表" },
};

export async function validateOfficeFile(format: OfficeFileKind, data: Uint8Array): Promise<ValidationReceipt> {
  const checks: ValidationCheck[] = [];
  const buffer = Buffer.from(data);
  checks.push({ name: "文件非空", passed: buffer.byteLength > 0 });

  if (buffer.byteLength > 0) {
    if (format === "docx" || format === "pptx" || format === "xlsx") await checkZipPackage(format, buffer, checks);
    else if (format === "pdf") checkPdf(buffer, checks);
    else checkPlainText(buffer, checks);
    await checkReparse(format, buffer, checks);
  }

  return {
    format,
    byteLength: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function checkZipPackage(format: "docx" | "pptx" | "xlsx", data: Buffer, checks: ValidationCheck[]): Promise<void> {
  const signature = data.subarray(0, 4).toString("latin1");
  checks.push({ name: "包头是 ZIP", passed: signature === "PK", detail: signature === "PK" ? undefined : "文件开头不是 OOXML 包" });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (error) {
    checks.push({ name: "包可以解析", passed: false, detail: error instanceof Error ? error.message : String(error) });
    return;
  }
  checks.push({ name: "包可以解析", passed: true });

  const names = Object.keys(zip.files);
  const unsafe = names.filter((name) => name.includes("..") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.includes("\\"));
  checks.push({ name: "没有越界的包内路径", passed: unsafe.length === 0, detail: unsafe.length ? unsafe.slice(0, 3).join("、") : undefined });

  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  checks.push({ name: "没有重复部件", passed: duplicates.length === 0, detail: duplicates.length ? duplicates.slice(0, 3).join("、") : undefined });

  const required = REQUIRED_PARTS[format]!;
  const missing = required.exact.filter((part) => !zip.file(part));
  checks.push({ name: "必需部件齐全", passed: missing.length === 0, detail: missing.length ? `缺少 ${missing.join("、")}` : undefined });
  if (required.pattern) {
    const matched = names.filter((name) => required.pattern!.test(name));
    checks.push({ name: required.patternLabel!, passed: matched.length > 0 });
  }

  const xmlParts = names.filter((name) => name.toLowerCase().endsWith(".xml") || name.toLowerCase().endsWith(".rels"));
  const broken: string[] = [];
  for (const part of xmlParts) {
    const text = await zip.file(part)?.async("string");
    if (text === undefined) continue;
    const problem = xmlProblem(text);
    if (problem) broken.push(`${part}（${problem}）`);
  }
  checks.push({ name: "XML 部件结构完整", passed: broken.length === 0, detail: broken.length ? broken.slice(0, 3).join("；") : undefined });
}

function checkPdf(data: Buffer, checks: ValidationCheck[]): void {
  checks.push({ name: "包头是 PDF", passed: data.subarray(0, 5).toString("latin1") === "%PDF-" });
  checks.push({ name: "文件结尾完整", passed: data.subarray(-2048).toString("latin1").includes("%%EOF") });
}

function checkPlainText(data: Buffer, checks: ValidationCheck[]): void {
  checks.push({ name: "不含空字节", passed: !data.includes(0) });
}

async function checkReparse(format: OfficeFileKind, data: Buffer, checks: ValidationCheck[]): Promise<void> {
  try {
    await extractOfficeFile(`validation.${format}`, data);
    checks.push({ name: "可以重新读取", passed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 一份结构完整但确实没有文字的文件不算损坏。
    const empty = message.includes("没有可提取的文字内容");
    checks.push({ name: "可以重新读取", passed: empty, detail: empty ? "结构完整，但没有可提取的文字" : message });
  }
}

/**
 * 只做结构完整性判断：标签是否配对、是否被截断。
 * 目的是拦住文字级改写可能产生的破损 XML，不是替代完整的 XML 解析器。
 */
function xmlProblem(xml: string): string | null {
  const stack: string[] = [];
  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf("<", index);
    if (open < 0) break;
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0) return "注释未闭合";
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      if (end < 0) return "CDATA 未闭合";
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<?", open) || xml.startsWith("<!", open)) {
      const end = xml.indexOf(">", open + 2);
      if (end < 0) return "声明未闭合";
      index = end + 1;
      continue;
    }
    const close = findTagEnd(xml, open);
    if (close < 0) return "标签被截断";
    const body = xml.slice(open + 1, close);
    index = close + 1;
    if (body.endsWith("/")) continue;
    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      const expected = stack.pop();
      if (expected !== name) return `${name} 与 ${expected ?? "空"} 不配对`;
      continue;
    }
    stack.push(body.split(/[\s/>]/)[0] || "");
  }
  return stack.length ? `${stack[stack.length - 1]} 未闭合` : null;
}

function findTagEnd(xml: string, open: number): number {
  let quote = "";
  for (let index = open + 1; index < xml.length; index += 1) {
    const character = xml[index]!;
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}
