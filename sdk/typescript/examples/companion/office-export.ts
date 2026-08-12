import { PassThrough } from "node:stream";
import { existsSync } from "node:fs";

import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

import { UserFacingError } from "./office-errors.js";
import { validateOfficeFile, type OfficeValidationFormat, type ValidationReceipt } from "./office-validation.js";

const PDFDocument = require("pdfkit") as new (options?: Record<string, unknown>) => {
  pipe(stream: NodeJS.WritableStream): void;
  font(source: string): unknown;
  fontSize(size: number): { text(value: string, options?: Record<string, unknown>): unknown };
  text(value: string, options?: Record<string, unknown>): unknown;
  moveDown(size?: number): unknown;
  addPage(): unknown;
  end(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

export type OfficeExportFormat = "docx" | "pptx" | "xlsx" | "pdf" | "html" | "md";

export interface OfficeExportBlock {
  title: string;
  text: string;
}

export interface OfficeExportInput {
  name: string;
  format: OfficeExportFormat;
  blocks: OfficeExportBlock[];
}

export interface OfficeExportResult {
  data: Buffer;
  filename: string;
  contentType: string;
  warnings: string[];
  validation?: ValidationReceipt;
}

export async function exportOfficeDocument(input: OfficeExportInput): Promise<OfficeExportResult> {
  const name = safeName(input.name || "办公文稿");
  const blocks = normalizeBlocks(input.blocks);
  const warnings = validateLayout(blocks, input.format);
  if (input.format === "docx") return checked(result(await createDocx(blocks), name, input.format, warnings), "docx");
  if (input.format === "pptx") return checked(result(await createPptx(name, blocks), name, input.format, warnings), "pptx");
  if (input.format === "xlsx") return checked(result(await createXlsx(blocks), name, input.format, warnings), "xlsx");
  if (input.format === "pdf") return checked(result(await createPdf(name, blocks), name, input.format, warnings), "pdf");
  if (input.format === "html") return result(Buffer.from(createHtml(name, blocks), "utf8"), name, input.format, warnings);
  return checked(result(Buffer.from(createMarkdown(name, blocks), "utf8"), name, "md", warnings), "md");
}

/** 生成的文件先过结构检查再交出去；不合格就报错，不给用户一个打不开的文件。 */
async function checked(value: OfficeExportResult, format: OfficeValidationFormat): Promise<OfficeExportResult> {
  const validation = await validateOfficeFile(format, value.data);
  if (!validation.passed) {
    const failed = validation.checks.filter((check) => !check.passed).map((check) => (check.detail ? `${check.name}：${check.detail}` : check.name));
    throw new UserFacingError(`生成的 ${format.toUpperCase()} 没有通过结构检查：${failed.join("；")}`);
  }
  return { ...value, validation };
}

function normalizeBlocks(value: OfficeExportBlock[]): OfficeExportBlock[] {
  const blocks = Array.isArray(value) ? value.slice(0, 200).map((block, index) => ({
    title: String(block?.title || `第 ${index + 1} 部分`).trim().slice(0, 160),
    text: String(block?.text || "").replace(/\r\n/g, "\n").slice(0, 120_000),
  })) : [];
  return blocks.length ? blocks : [{ title: "正文", text: "" }];
}

function validateLayout(blocks: OfficeExportBlock[], format: OfficeExportFormat): string[] {
  const warnings: string[] = [];
  if (format === "pptx") {
    blocks.forEach((block, index) => {
      const lines = block.text.split(/\n+/).filter(Boolean);
      if (block.title.length > 34 || block.text.length > 620 || lines.length > 9) {
        warnings.push(`第 ${index + 1} 页内容较多，已自动缩小字号；建议导出后复核版面。`);
      }
    });
  }
  if (format === "xlsx" && blocks.length > 30) warnings.push("工作表超过 30 个，已仅导出前 30 个部分。");
  return warnings;
}

async function createDocx(blocks: OfficeExportBlock[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="34"/><w:color w:val="8F2F59"/></w:rPr></w:style></w:styles>`);
  const body = blocks.map((block) => {
    const title = blocks.length === 1 && /^(正文|Markdown)$/.test(block.title)
      ? ""
      : `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${xml(block.title)}</w:t></w:r></w:p>`;
    const paragraphs = block.text.split(/\n/).map((line) => `<w:p><w:r><w:t xml:space="preserve">${xml(line || " ")}</w:t></w:r></w:p>`).join("");
    return title + paragraphs;
  }).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function createPptx(name: string, blocks: OfficeExportBlock[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "小丑鱼";
  pptx.company = "小丑鱼";
  pptx.title = name;
  pptx.subject = "小丑鱼办公文件";
  pptx.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei" };
  blocks.forEach((block, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: "F8F4ED" };
    slide.addShape(pptx.ShapeType.line, { x: .72, y: .58, w: .46, h: 0, line: { color: "B33F72", width: 3 } });
    slide.addText(block.title || `第 ${index + 1} 页`, { x: .78, y: .9, w: 11.25, h: .72, fontSize: 26, bold: true, color: "20221F", margin: .02, fit: "shrink" });
    const lines = block.text.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 12);
    slide.addText(lines.map((line) => ({ text: line.replace(/^[-*•]\s*/, ""), options: { bullet: { indent: 16 }, breakLine: true } })), { x: .92, y: 1.92, w: 11.0, h: 4.78, fontSize: block.text.length > 620 ? 14 : 18, color: "4E504A", breakLine: false, margin: .04, paraSpaceAfter: 12, valign: "top", fit: "shrink" });
    slide.addText(String(index + 1).padStart(2, "0"), { x: 11.7, y: 7.04, w: .6, h: .2, fontSize: 9, color: "85887F", align: "right", margin: 0 });
  });
  return Buffer.from(await pptx.write({ outputType: "nodebuffer", compression: true }) as Buffer);
}

async function createXlsx(blocks: OfficeExportBlock[]): Promise<Buffer> {
  const sheets = blocks.slice(0, 30);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.title.slice(0, 31) || `工作表${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`);
  sheets.forEach((sheet, sheetIndex) => {
    const rows = parseSheetRows(sheet);
    const rowXml = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join("")}</row>`).join("");
    zip.file(`xl/worksheets/sheet${sheetIndex + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rowXml}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function parseSheetRows(block: OfficeExportBlock): string[][] {
  const lines = block.text.split(/\n/).filter((line) => line.length > 0);
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : lines.some((line) => line.includes(",")) ? "," : null;
  const rows = delimiter ? lines.map((line) => line.split(delimiter).slice(0, 80)) : lines.map((line) => [line]);
  return rows.length ? rows.slice(0, 10_000) : [[block.title]];
}

async function createPdf(name: string, blocks: OfficeExportBlock[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 54, info: { Title: name, Author: "小丑鱼" } });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
  doc.pipe(stream);
  const font = chineseFont();
  if (font) doc.font(font);
  doc.fontSize(24).text(name, { align: "left" });
  doc.moveDown(.8);
  blocks.forEach((block, index) => {
    if (index > 0) doc.addPage();
    doc.fontSize(18).text(block.title || `第 ${index + 1} 部分`);
    doc.moveDown(.6);
    doc.fontSize(11).text(block.text || "（空白）", { lineGap: 5, align: "left" });
  });
  doc.end();
  return finished;
}

function chineseFont(): string | undefined {
  const candidates = ["C:\\Windows\\Fonts\\simhei.ttf", "C:\\Windows\\Fonts\\simsunb.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"];
  return candidates.find((file) => existsSync(file));
}

function createHtml(name: string, blocks: OfficeExportBlock[]): string {
  const sections = blocks.map((block, index) => `<section><span>${String(index + 1).padStart(2, "0")}</span><h2>${html(block.title)}</h2>${block.text.split(/\n{2,}/).map((paragraph) => `<p>${html(paragraph).replace(/\n/g, "<br>")}</p>`).join("")}</section>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(name)}</title><style>:root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#20221f;background:#f4f0e8}*{box-sizing:border-box}body{margin:0}.bar{position:sticky;top:0;padding:12px 24px;border-bottom:1px solid #ddd7cd;background:#fffdf8}.bar button{float:right;border:1px solid #c9c1b5;border-radius:6px;background:#fff;padding:7px 12px}.wrap{width:min(860px,calc(100% - 32px));margin:auto;padding:64px 0}.wrap>h1{font-size:44px;line-height:1.1;margin:0 0 44px}section{position:relative;padding:28px 32px;margin:18px 0;border:1px solid #ddd7cd;border-radius:12px;background:#fffdf8}section>span{color:#8f2f59;font-size:11px}h2{margin:8px 0 18px;font-size:24px}p{white-space:normal;line-height:1.75;color:#555850}@media print{.bar{display:none}.wrap{width:100%;padding:0}section{break-inside:avoid;border-color:#aaa}}</style></head><body><div class="bar">小丑鱼办公结果<button onclick="print()">打印 / 导出 PDF</button></div><main class="wrap"><h1>${html(name)}</h1>${sections}</main></body></html>`;
}

function createMarkdown(name: string, blocks: OfficeExportBlock[]): string {
  return `# ${name}\n\n${blocks.map((block) => `## ${block.title}\n\n${block.text}`).join("\n\n")}`.trim() + "\n";
}

function result(data: Buffer, name: string, format: OfficeExportFormat, warnings: string[]): OfficeExportResult {
  const types: Record<OfficeExportFormat, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
    html: "text/html; charset=utf-8",
    md: "text/markdown; charset=utf-8",
  };
  return { data, filename: `${name}.${format}`, contentType: types[format], warnings };
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 72) || "办公文稿";
}

function columnName(index: number): string {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function html(value: string): string {
  return xml(value);
}
