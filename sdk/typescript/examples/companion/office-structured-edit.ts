import JSZip from "jszip";

/**
 * 已冻结：这是文字级的 OOXML 替换，不是 Office 编辑内核。
 *
 * 它按位置重写 `<w:t>` / `<a:t>` 并把一个段落内的多个 run 合并成一个，
 * 因此改动过的段落会丢失行内格式；页眉页脚、批注、修订、图表和母版都不在覆盖范围内。
 * 结果只允许通过 `OfficeFileSessionStore.saveStructuredCopy` 生成新文件，
 * 绝不覆盖用户打开的那个文件。
 *
 * 不要在这里继续扩写格式支持。真正的编辑能力由独立的编辑内核承担，
 * 界面能力声明以 `office-capabilities.ts` 为准。
 */

export type StructuredOfficeKind = "docx" | "pptx" | "xlsx";

export interface StructuredOfficeBlock {
  title: string;
  text: string;
}

export interface StructuredSpreadsheetCell {
  sheetIndex: number;
  address: string;
  value: string;
}

export interface StructuredOfficeEditInput {
  kind: StructuredOfficeKind;
  data: Uint8Array;
  blocks: StructuredOfficeBlock[];
  cells?: StructuredSpreadsheetCell[];
  complete?: boolean;
}

export interface StructuredOfficeEditResult {
  data: Buffer;
  changedParts: string[];
  warnings: string[];
}

export async function applyStructuredOfficeEdit(input: StructuredOfficeEditInput): Promise<StructuredOfficeEditResult> {
  if (!input.data.byteLength) throw new Error("文件内容为空");
  const zip = await JSZip.loadAsync(input.data);
  const changedParts: string[] = [];
  const warnings: string[] = [];
  if (input.kind === "docx") await editDocx(zip, input.blocks, Boolean(input.complete), changedParts, warnings);
  else if (input.kind === "pptx") await editPptx(zip, input.blocks, Boolean(input.complete), changedParts, warnings);
  else await editXlsx(zip, input.blocks, input.cells || [], changedParts, warnings);
  if (!changedParts.length) throw new Error("没有找到可以修改的结构化内容");
  return { data: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), changedParts, warnings };
}

async function editDocx(zip: JSZip, blocks: StructuredOfficeBlock[], complete: boolean, changedParts: string[], warnings: string[]): Promise<void> {
  const path = "word/document.xml";
  const original = await zip.file(path)?.async("string");
  if (!original) throw new Error("这个 Word 文件缺少正文");
  const requested = blocks.flatMap((block) => splitParagraphs(block.text)).slice(0, 20_000);
  let cursor = 0;
  let paragraphCount = 0;
  let edited = original.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi, (paragraph) => {
    paragraphCount += 1;
    if (!/<w:t\b[^>]*>[\s\S]*?<\/w:t>/i.test(paragraph)) return paragraph;
    if (cursor >= requested.length && !complete) return paragraph;
    const next = requested[cursor++] ?? "";
    return replaceTextElements(paragraph, "w:t", next, "w:r");
  });
  if (!paragraphCount) throw new Error("这个 Word 文件没有可编辑段落");
  if (cursor < requested.length) {
    const additions = requested.slice(cursor).map((text) => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`).join("");
    edited = edited.includes("<w:sectPr") ? edited.replace(/<w:sectPr\b/, `${additions}<w:sectPr`) : edited.replace(/<\/w:body>/i, `${additions}</w:body>`);
    warnings.push(`新增的 ${requested.length - cursor} 个段落使用正文样式，原有段落格式保持不变。`);
  }
  zip.file(path, edited);
  changedParts.push(path);
}

async function editPptx(zip: JSZip, blocks: StructuredOfficeBlock[], complete: boolean, changedParts: string[], warnings: string[]): Promise<void> {
  const paths = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path)).sort(numericPath);
  if (!paths.length) throw new Error("这个演示文稿没有可编辑页面");
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    const original = await zip.file(path)?.async("string");
    if (!original) continue;
    if (!blocks[index] && !complete) continue;
    const lines = String(blocks[index]?.text || "").split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 500);
    let cursor = 0;
    let count = 0;
    let edited = original.replace(/(<a:t\b[^>]*>)([\s\S]*?)(<\/a:t>)/gi, (_match, open: string, _value: string, close: string) => {
      count += 1;
      if (cursor >= lines.length && !complete) return `${open}${_value}${close}`;
      return `${open}${xml(lines[cursor++] || "")}${close}`;
    });
    if (!count) continue;
    if (cursor < lines.length) {
      const additions = lines.slice(cursor).map((line) => `<a:r><a:rPr lang="zh-CN"/><a:t>${xml(line)}</a:t></a:r>`).join("");
      edited = edited.replace(/<\/a:p>/i, `${additions}</a:p>`);
      warnings.push(`第 ${index + 1} 页新增文字沿用所在文本框的段落格式。`);
    }
    zip.file(path, edited);
    changedParts.push(path);
  }
  if (blocks.length !== paths.length) warnings.push("当前编辑保留原有页面数量；增删页面请导出为新的 PowerPoint。");
}

async function editXlsx(zip: JSZip, blocks: StructuredOfficeBlock[], explicitCells: StructuredSpreadsheetCell[], changedParts: string[], warnings: string[]): Promise<void> {
  const paths = Object.keys(zip.files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path)).sort(numericPath);
  if (!paths.length) throw new Error("这个表格没有可编辑工作表");
  const bySheet = new Map<number, Map<string, string>>();
  for (let index = 0; index < paths.length; index += 1) bySheet.set(index, parseCells(blocks[index]?.text || ""));
  for (const cell of explicitCells.slice(0, 20_000)) {
    const address = normalizeCellAddress(cell.address);
    if (!address || !Number.isInteger(cell.sheetIndex) || cell.sheetIndex < 0 || cell.sheetIndex >= paths.length) continue;
    bySheet.get(cell.sheetIndex)!.set(address, String(cell.value ?? "").slice(0, 32_000));
  }
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    const original = await zip.file(path)?.async("string");
    if (!original) continue;
    const cells = bySheet.get(index)!;
    if (!cells.size) continue;
    let edited = original;
    const handled = new Set<string>();
    edited = edited.replace(/(<c\b[^>]*\br=(?:"([A-Z]+\d+)"|'([A-Z]+\d+)')[^>]*>)([\s\S]*?)(<\/c>)/gi, (match, open: string, doubleAddress: string, singleAddress: string, _inner: string, close: string) => {
      const address = normalizeCellAddress(doubleAddress || singleAddress);
      if (!address || !cells.has(address)) return match;
      handled.add(address);
      const value = cells.get(address)!;
      return `${cellOpen(open, value)}${cellContent(value)}${close}`;
    });
    for (const [address, value] of cells) {
      if (handled.has(address)) continue;
      edited = appendCell(edited, address, value);
    }
    zip.file(path, edited);
    changedParts.push(path);
  }
  warnings.push("原有单元格样式保持不变；以 = 开头的内容会保存为公式。新增单元格使用工作簿默认样式。");
}

function splitParagraphs(value: string): string[] {
  const normalized = String(value || "").replace(/\r/g, "");
  const parts = normalized.split(/\n\s*\n/).map((item) => item.trimEnd());
  return parts.length ? parts : [""];
}

function replaceTextElements(container: string, textTag: string, value: string, runTag: string): string {
  let used = false;
  const replaced = container.replace(new RegExp(`(<${textTag}\\b[^>]*>)([\\s\\S]*?)(<\\/${textTag}>)`, "gi"), (_match, open: string, _old: string, close: string) => {
    const text = used ? "" : value;
    used = true;
    return `${open}${xml(text)}${close}`;
  });
  return used ? replaced : replaced.replace(new RegExp(`</${container.startsWith("<w:p") ? "w:p" : "a:p"}>`, "i"), `<${runTag}><${textTag} xml:space="preserve">${xml(value)}</${textTag}></${runTag}>$&`);
}

function parseCells(text: string): Map<string, string> {
  const cells = new Map<string, string>();
  for (const match of String(text || "").matchAll(/(?:^|\|)\s*([A-Z]{1,3}\d{1,7})\s*:\s*([^|\n]*)/gim)) {
    const address = normalizeCellAddress(match[1]);
    if (address) cells.set(address, String(match[2] || "").trim());
  }
  return cells;
}

function normalizeCellAddress(value: string): string {
  const address = String(value || "").trim().toUpperCase();
  return /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address) ? address : "";
}

function cellOpen(open: string, value: string): string {
  const withoutType = open.replace(/\s+t=(?:"[^"]*"|'[^']*')/i, "");
  return value.startsWith("=") ? withoutType : withoutType.replace(/>$/, ' t="inlineStr">');
}

function cellContent(value: string): string {
  return value.startsWith("=") ? `<f>${xml(value.slice(1))}</f><v></v>` : `<is><t xml:space="preserve">${xml(value)}</t></is>`;
}

function appendCell(worksheet: string, address: string, value: string): string {
  const rowNumber = Number(address.match(/\d+$/)?.[0] || 0);
  const cell = `<c r="${address}"${value.startsWith("=") ? "" : ' t="inlineStr"'}>${cellContent(value)}</c>`;
  const rowPattern = new RegExp(`(<row\\b[^>]*\\br=(?:"${rowNumber}"|'${rowNumber}')[^>]*>)([\\s\\S]*?)(</row>)`, "i");
  if (rowPattern.test(worksheet)) return worksheet.replace(rowPattern, `$1$2${cell}$3`);
  const row = `<row r="${rowNumber}">${cell}</row>`;
  return worksheet.replace(/<\/sheetData>/i, `${row}</sheetData>`);
}

function numericPath(left: string, right: string): number {
  return Number(left.match(/(\d+)\.xml$/)?.[1] || 0) - Number(right.match(/(\d+)\.xml$/)?.[1] || 0);
}

function xml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
