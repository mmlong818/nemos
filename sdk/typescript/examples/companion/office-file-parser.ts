import { posix } from "node:path";
import JSZip from "jszip";

export const MAX_OFFICE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 120_000;

export type OfficeFileKind = "docx" | "pptx" | "xlsx" | "pdf";

export interface OfficeFileExtraction {
  kind: OfficeFileKind;
  text: string;
  characters: number;
  sections: number;
  truncated: boolean;
}

function extensionOf(fileName: string): OfficeFileKind | null {
  const extension = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension === "docx" || extension === "pptx" || extension === "xlsx" || extension === "pdf"
    ? extension
    : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeText(value: string): string {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function textNodes(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? ""));
}

function paragraphText(xml: string, paragraphTag: string, textTag: string): string[] {
  const pattern = new RegExp(`<${paragraphTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${paragraphTag}>`, "gi");
  return [...xml.matchAll(pattern)]
    .map((match) => textNodes(match[1] ?? "", textTag).join("").trim())
    .filter(Boolean);
}

async function zipEntryText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  return entry ? entry.async("string") : "";
}

async function extractDocx(data: Uint8Array): Promise<{ text: string; sections: number }> {
  const zip = await JSZip.loadAsync(data);
  const xml = await zipEntryText(zip, "word/document.xml");
  if (!xml) throw new Error("这个 Word 文件缺少正文，可能已经损坏");
  const paragraphs = paragraphText(xml, "w:p", "w:t");
  return { text: paragraphs.join("\n\n"), sections: paragraphs.length };
}

function numberedPath(path: string): number {
  return Number(path.match(/(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

async function extractPptx(data: Uint8Array): Promise<{ text: string; sections: number }> {
  const zip = await JSZip.loadAsync(data);
  const slides = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => numberedPath(left) - numberedPath(right));
  if (!slides.length) throw new Error("这个演示文稿没有可读取的页面");
  const pages: string[] = [];
  for (let index = 0; index < slides.length; index += 1) {
    const xml = await zipEntryText(zip, slides[index]!);
    const paragraphs = paragraphText(xml, "a:p", "a:t");
    const content = paragraphs.length ? paragraphs.join("\n") : textNodes(xml, "a:t").join("\n");
    pages.push(`## 第 ${index + 1} 页\n${content || "（无文字）"}`);
  }
  return { text: pages.join("\n\n"), sections: slides.length };
}

function attribute(xmlTag: string, name: string): string {
  const match = xmlTag.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXml(match?.[1] ?? match?.[2] ?? "");
}

function worksheetRelationships(xml: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target) result.set(id, posix.normalize(posix.join("xl", target.replace(/^\//, ""))));
  }
  return result;
}

function workbookSheets(xml: string, relationships: Map<string, string>): Array<{ name: string; path: string }> {
  const sheets: Array<{ name: string; path: string }> = [];
  for (const match of xml.matchAll(/<sheet\b[^>]*>/gi)) {
    const path = relationships.get(attribute(match[0], "r:id"));
    if (path) sheets.push({ name: attribute(match[0], "name") || `工作表 ${sheets.length + 1}`, path });
  }
  return sheets;
}

function cellValue(cellXml: string, cellTag: string, sharedStrings: string[]): string {
  const type = attribute(cellTag, "t");
  if (type === "inlineStr") return textNodes(cellXml, "t").join("");
  const raw = decodeXml(cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "");
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw;
  return raw;
}

function worksheetText(xml: string, sharedStrings: string[]): string {
  const rows: string[] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/(<c\b[^>]*>)([\s\S]*?)<\/c>/gi)) {
      const reference = attribute(cellMatch[1] ?? "", "r");
      const value = cellValue(cellMatch[2] ?? "", cellMatch[1] ?? "", sharedStrings).trim();
      if (value) cells.push(reference ? `${reference}: ${value}` : value);
    }
    if (cells.length) rows.push(cells.join(" | "));
  }
  return rows.join("\n");
}

async function extractXlsx(data: Uint8Array): Promise<{ text: string; sections: number }> {
  const zip = await JSZip.loadAsync(data);
  const sharedXml = await zipEntryText(zip, "xl/sharedStrings.xml");
  const sharedStrings = sharedXml
    ? [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map((match) => textNodes(match[1] ?? "", "t").join(""))
    : [];
  const workbookXml = await zipEntryText(zip, "xl/workbook.xml");
  const relsXml = await zipEntryText(zip, "xl/_rels/workbook.xml.rels");
  let sheets = workbookSheets(workbookXml, worksheetRelationships(relsXml));
  if (!sheets.length) {
    sheets = Object.keys(zip.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort((left, right) => numberedPath(left) - numberedPath(right))
      .map((path, index) => ({ name: `工作表 ${index + 1}`, path }));
  }
  if (!sheets.length) throw new Error("这个表格没有可读取的工作表");
  const output: string[] = [];
  for (const sheet of sheets) {
    const xml = await zipEntryText(zip, sheet.path);
    output.push(`## ${sheet.name}\n${worksheetText(xml, sharedStrings) || "（无可读取内容）"}`);
  }
  return { text: output.join("\n\n"), sections: sheets.length };
}

async function extractPdf(data: Uint8Array): Promise<{ text: string; sections: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(data), isEvalSupported: false, useWorkerFetch: false });
  const document = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += `${line ? " " : ""}${item.str}`;
        if (item.hasEOL) {
          if (line.trim()) lines.push(line.trim());
          line = "";
        }
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(`## 第 ${pageNumber} 页\n${lines.join("\n") || "（无可提取文字，可能是扫描件）"}`);
    }
    return { text: pages.join("\n\n"), sections: document.numPages };
  } finally {
    await document.destroy();
  }
}

export async function extractOfficeFile(fileName: string, data: Uint8Array): Promise<OfficeFileExtraction> {
  const kind = extensionOf(fileName);
  if (!kind) throw new Error("仅支持 DOCX、PPTX、XLSX 和 PDF 文件");
  if (!data.byteLength) throw new Error("文件内容为空");
  if (data.byteLength > MAX_OFFICE_FILE_BYTES) throw new Error("单个办公文件不能超过 8 MB");

  let extracted: { text: string; sections: number };
  try {
    if (kind === "docx") extracted = await extractDocx(data);
    else if (kind === "pptx") extracted = await extractPptx(data);
    else if (kind === "xlsx") extracted = await extractXlsx(data);
    else extracted = await extractPdf(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^这个|^仅支持|^文件|^单个/.test(message)) throw error;
    throw new Error(`无法读取这个 ${kind.toUpperCase()} 文件，请确认文件没有损坏或加密`);
  }

  const normalized = normalizeText(extracted.text);
  if (!normalized) throw new Error("文件中没有可提取的文字内容");
  const truncated = normalized.length > MAX_EXTRACTED_CHARACTERS;
  const text = truncated
    ? `${normalized.slice(0, MAX_EXTRACTED_CHARACTERS)}\n\n[内容较长，已保留前 ${MAX_EXTRACTED_CHARACTERS.toLocaleString("zh-CN")} 个字符]`
    : normalized;
  return { kind, text, characters: text.length, sections: extracted.sections, truncated };
}
