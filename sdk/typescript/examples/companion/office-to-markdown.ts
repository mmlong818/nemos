import { readDocumentAsMarkdown } from "./document-markdown-reader.js";
import { extractOfficeFile, officeFileKindOf, type OfficeFileKind } from "./office-file-parser.js";
import { UserFacingError } from "./office-errors.js";
import { computeListMarkers, parseDocx, type Block, type TableModel } from "./vendor/docx-engine/dist/index.js";
import { getSlideNotes, openPptx, type Slide, type SlideElement, type TableElement as PptxTableElement, type TextElement } from "./vendor/pptx-engine/dist/index.js";
import { isNativeCapabilityId, parseNativeCapabilityPayload } from "./native-capability-contracts.js";
import { renderNativeCapabilityMarkdown } from "./native-capability-renderer.js";
import { markdownToStructuredDocument, type ParagraphAlignment, type StructuredDocument } from "./structured-document.js";

/**
 * 把上传文件转换成结构化可编辑副本；Markdown 保留为兼容交换表示。
 * 原文件继续保留、可随时下载，转换结果不会覆盖原件。
 */
export interface MarkdownConversion {
  sourceFormat: OfficeFileKind;
  markdown: string;
  /** 这次转换丢掉或降级了什么。必须展示给用户，不能只写在文档里。 */
  notes: string[];
  truncated: boolean;
  /** 转换后的可编辑副本。Markdown 仍作为兼容交换格式。 */
  document: StructuredDocument;
}

const MAX_MARKDOWN_CHARACTERS = 200_000;

export async function convertOfficeToMarkdown(fileName: string, data: Uint8Array): Promise<MarkdownConversion> {
  const kind = formatOf(fileName);
  if (kind === "md") return finish(kind, decodeText(data), []);
  if (kind === "txt") return finish(kind, decodeText(data), ["纯文本按原样作为 Markdown 正文，没有推断标题层级。"]);
  if (kind === "docx") {
    const [markdown, notes, alignments, document] = await docxToMarkdown(data);
    const conversion = finish(kind, markdown, notes, alignments);
    conversion.document = document;
    return conversion;
  }
  if (kind === "pptx") return finish(kind, ...(await pptxToMarkdown(data)));
  if (kind === "xlsx") return finish(kind, ...(await xlsxToMarkdown(fileName, data)));
  if (kind === "pdf") return finish(kind, ...(await pdfToMarkdown(fileName, data)));
  return finish(kind, await readDocumentAsMarkdown(fileName, data), conversionNotes(kind));
}

function formatOf(fileName: string): OfficeFileKind {
  const kind = officeFileKindOf(fileName);
  if (kind) return kind;
  throw new UserFacingError("仅支持常见文档、演示文稿、表格、PDF、EPUB、TXT 和 Markdown 文件");
}

function conversionNotes(kind: OfficeFileKind): string[] {
  const common = ["每次转换都会列出这一份具体发生变化的内容；原文件仍完整保留。"];
  if (["doc", "docm", "odt", "rtf", "epub"].includes(kind)) {
    return [
      "正文、标题、列表和表格会尽量转成 Markdown；复杂排版、宏、批注与嵌入对象可能无法保留。",
      "字体、字号、分页、页眉页脚等视觉呈现不在 Markdown 的表达范围内。",
      ...common,
    ];
  }
  if (["ppt", "pps", "pot", "pptm", "ppsx", "ppsm", "odp"].includes(kind)) {
    return [
      "页面文字、列表和表格会转成 Markdown；版式、母版、动画、宏与媒体对象不保证保留。",
      "工作副本用于处理内容，不等同于原演示文稿的逐页视觉还原。",
      ...common,
    ];
  }
  return [
    "单元格内容会转成 Markdown 表格；公式、样式、图表、宏和数据验证可能降级或不保留。",
    "工作副本用于处理数据内容，不等同于原表格的完整计算与排版环境。",
    ...common,
  ];
}

function finish(sourceFormat: OfficeFileKind, markdown: string, notes: string[], alignments: Array<{ text: string; alignment: ParagraphAlignment }> = []): MarkdownConversion {
  const repaired = repairLegacyStructuredResult(markdown);
  const normalized = repaired.markdown.replace(/\r/g, "").replace(/\n{4,}/g, "\n\n\n").trim();
  const completeNotes = repaired.repaired ? [...notes, "检测到旧版结构化结果，已转换成可读正文；内部数据不会作为正文显示。"] : notes;
  const truncated = normalized.length > MAX_MARKDOWN_CHARACTERS;
  const renderedMarkdown = truncated
    ? `${normalized.slice(0, MAX_MARKDOWN_CHARACTERS)}\n\n> 内容较长，已保留前 ${MAX_MARKDOWN_CHARACTERS.toLocaleString("zh-CN")} 个字符。原文件完整保留，可以下载。`
    : normalized;
  const document = markdownToStructuredDocument(sourceFormat, renderedMarkdown);
  const unused = [...alignments];
  for (const block of document.blocks) {
    const matchIndex = unused.findIndex((hint) => hint.text.trim() === block.text.trim());
    if (matchIndex < 0) continue;
    block.alignment = unused[matchIndex]!.alignment;
    unused.splice(matchIndex, 1);
  }
  return {
    sourceFormat,
    markdown: renderedMarkdown,
    notes: truncated ? [...completeNotes, "内容超出单文档上限，Markdown 只保留了前半部分。"] : completeNotes,
    truncated,
    document,
  };
}

function repairLegacyStructuredResult(markdown: string): { markdown: string; repaired: boolean } {
  const candidate = markdown.trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return { markdown, repaired: false };
  try {
    const parsed = JSON.parse(candidate) as { kind?: unknown };
    const kind = typeof parsed.kind === "string" ? parsed.kind : "";
    if (!isNativeCapabilityId(kind)) return { markdown, repaired: false };
    const payload = parseNativeCapabilityPayload(kind, candidate);
    return { markdown: renderNativeCapabilityMarkdown(payload), repaired: true };
  } catch {
    return { markdown, repaired: false };
  }
}

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("gb18030").decode(data);
  }
}

// ── DOCX ──────────────────────────────────────────────────────────────

async function docxToMarkdown(data: Uint8Array): Promise<[string, string[], Array<{ text: string; alignment: ParagraphAlignment }>, StructuredDocument]> {
  const parsed = await parseDocx(data);
  const notes: string[] = [];
  const lines: string[] = [];
  let imageCount = 0;
  let passthroughCount = 0;
  const alignments: Array<{ text: string; alignment: ParagraphAlignment }> = [];
  const listBlocks = parsed.blocks.filter((block) => block.type === "listItem" && !block.hidden);
  const listMarkers = computeListMarkers(listBlocks.map((block) => ({ numId: block.list?.numId || null, ilvl: block.list?.ilvl || 0 })), parsed.numbering);
  let listIndex = 0;
  let sourceLine = 0;
  const structuredBlocks: StructuredDocument["blocks"] = [];

  for (const block of parsed.blocks) {
    if (block.hidden) continue;
    const blockText = plainText(block);
    const exactText = (block.runs || []).map((run) => run.text).join("").replace(/\r/g, "");
    const alignment = block.format?.align === "distribute" ? "justify" : block.format?.align;
    if (blockText && alignment && ["left", "center", "right", "justify"].includes(alignment)) {
      alignments.push({ text: blockText, alignment: alignment as ParagraphAlignment });
    }
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, Number(block.level || 1)));
      if (exactText) lines.push(`${"#".repeat(level)} ${plainText(block)}`, "");
      else lines.push("");
      structuredBlocks.push({ id: `block-${structuredBlocks.length + 1}`, kind: exactText ? "heading" : "paragraph", level: exactText ? level : undefined, text: exactText, alignment: normalizedAlignment(block.format?.align), indentLeft: block.format?.indentLeft, indentFirstLine: block.format?.indentFirstLine, preserveWhitespace: true, source: { startLine: ++sourceLine, endLine: sourceLine } });
      continue;
    }
    if (block.type === "listItem") {
      const depth = Math.max(0, Number(block.list?.ilvl || 0));
      const marker = block.list?.kind === "ordered" ? "1." : "-";
      lines.push(`${"  ".repeat(depth)}${marker} ${plainText(block)}`);
      structuredBlocks.push({ id: `block-${structuredBlocks.length + 1}`, kind: "list", ordered: block.list?.kind === "ordered", text: exactText, listMarker: listMarkers[listIndex++] || (block.list?.kind === "ordered" ? "1." : "•"), listLevel: depth, alignment: normalizedAlignment(block.format?.align), indentLeft: block.format?.indentLeft, indentFirstLine: block.format?.indentFirstLine, preserveWhitespace: true, source: { startLine: ++sourceLine, endLine: sourceLine } });
      continue;
    }
    if (block.type === "table" && block.table) {
      lines.push("", ...tableToMarkdown(block.table, notes), "");
      const rows = block.table.rows.map((row) => row.map((cell) => (cell.paras || []).join("\n")));
      structuredBlocks.push({ id: `block-${structuredBlocks.length + 1}`, kind: "table", text: rows.map((row) => row.join(" | ")).join("\n"), rows, source: { startLine: ++sourceLine, endLine: sourceLine } });
      continue;
    }
    if (block.type === "image") {
      imageCount += 1;
      lines.push(`> ［原文件中的图片 ${imageCount}${block.label ? `：${block.label}` : ""}］`, "");
      continue;
    }
    if (block.type === "passthrough") {
      passthroughCount += 1;
      continue;
    }
    const text = plainText(block);
    if (text) lines.push(text, "");
    else lines.push("");
    if (block.type === "paragraph") structuredBlocks.push({ id: `block-${structuredBlocks.length + 1}`, kind: "paragraph", text: exactText, alignment: normalizedAlignment(block.format?.align), indentLeft: block.format?.indentLeft, indentFirstLine: block.format?.indentFirstLine, preserveWhitespace: true, source: { startLine: ++sourceLine, endLine: sourceLine } });
  }

  if (imageCount) notes.push(`${imageCount} 张图片没有转成 Markdown，只留了位置说明；图片本身仍在原文件里。`);
  if (passthroughCount) notes.push(`${passthroughCount} 处图形或嵌入对象无法用 Markdown 表达，已跳过。`);
  if (parsed.comments.length) notes.push(`${parsed.comments.length} 条批注没有带过来。`);
  if (parsed.footnotes.length || parsed.endnotes.length) notes.push(`${parsed.footnotes.length + parsed.endnotes.length} 条脚注或尾注没有带过来。`);
  if (parsed.headerText || parsed.footerText) notes.push("页眉页脚没有带过来。");
  notes.push("字体、字号和颜色等字符样式可能降级；段落对齐会在可编辑副本中保留。");
  return [lines.join("\n"), notes, alignments, { schema: "clownfish.document.v1", sourceFormat: "docx", blocks: structuredBlocks }];
}

function normalizedAlignment(value: string | undefined): ParagraphAlignment {
  return value === "center" || value === "right" ? value : value === "justify" || value === "distribute" ? "justify" : "left";
}

function plainText(block: Block): string {
  return (block.runs || []).map((run) => run.text).join("").trim();
}

function tableToMarkdown(table: TableModel, notes: string[]): string[] {
  return gridToMarkdown(table.rows.map((row) => row.map((cell) => (cell.paras || []).join(" ").replace(/\s+/g, " ").trim())), notes);
}

function gridToMarkdown(rows: string[][], notes: string[]): string[] {
  if (!rows.length) return [];
  const width = Math.max(...rows.map((row) => row.length));
  if (!width) return [];
  if (rows.some((row) => row.length !== width)) {
    notes.push("表格存在合并单元格，转成 Markdown 后按普通网格展开。");
  }
  const pad = (row: string[]) => Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? ""));
  const [header, ...body] = rows;
  return [
    `| ${pad(header!).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ];
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

// ── PPTX ──────────────────────────────────────────────────────────────

async function pptxToMarkdown(data: Uint8Array): Promise<[string, string[]]> {
  const opened = await openPptx(data);
  const notes: string[] = [];
  const lines: string[] = [];
  let mediaCount = 0;
  let notesCount = 0;

  opened.deck.slides.forEach((slide: Slide, index: number) => {
    lines.push(`## 第 ${index + 1} 页`, "");
    let wrote = false;
    slide.elements.forEach((element: SlideElement) => {
      if (element.type === "text" || element.type === "shape") {
        const paragraphs = (element as TextElement).text?.paragraphs || [];
        for (const paragraph of paragraphs) {
          const text = paragraph.runs.map((run) => run.text).join("").replace(/\n/g, " ").trim();
          if (!text) continue;
          lines.push(text, "");
          wrote = true;
        }
        return;
      }
      if (element.type === "table") {
        const rows = ((element as PptxTableElement).rows || []).map((row) => row.map((cell) => (cell.text?.paragraphs || [])
          .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()));
        const table = gridToMarkdown(rows, notes);
        if (table.length) { lines.push(...table, ""); wrote = true; }
        return;
      }
      if (element.type === "picture" || element.type === "chart") { mediaCount += 1; return; }
    });
    // 讲者备注是内容而不是呈现，带过来而不是丢掉。
    const speakerNotes = getSlideNotes(opened.archive, slide.path).trim();
    if (speakerNotes) {
      notesCount += 1;
      lines.push("> **讲者备注**", ...speakerNotes.split(/\n+/).map((line) => `> ${line.trim()}`), "");
      wrote = true;
    }
    if (!wrote) lines.push("_（本页没有文字）_", "");
  });

  if (mediaCount) notes.push(`${mediaCount} 个图片或图表没有带过来。`);
  if (notesCount) notes.push(`${notesCount} 页的讲者备注已作为引用块带过来。`);
  notes.push("版式、母版、主题和动画不在 Markdown 的表达范围内。");
  return [lines.join("\n"), notes];
}

// ── XLSX ──────────────────────────────────────────────────────────────

async function xlsxToMarkdown(fileName: string, data: Uint8Array): Promise<[string, string[]]> {
  // 复用已有的表格读取：它每行输出 "A1: 值 | B1: 值"，地址明确，可稳定还原成网格。
  const extracted = await extractOfficeFile(fileName, data);
  const lines: string[] = [];
  const notes = [
    "单元格样式、条件格式、数据验证和图表没有带过来。",
    "公式只保留计算结果，不保留公式本身。",
  ];
  for (const section of extracted.text.split(/\n(?=## )/)) {
    const [title, ...rest] = section.split("\n");
    lines.push(title!.startsWith("## ") ? title! : `## ${title}`, "");
    const grid = rest.map((row) => row.split(" | ").map((cell) => cell.replace(/^[A-Z]{1,3}\d+:\s*/, "").trim())).filter((row) => row.some(Boolean));
    if (!grid.length) { lines.push("_（本工作表没有可读取内容）_", ""); continue; }
    const width = Math.max(...grid.map((row) => row.length));
    const pad = (row: string[]) => Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? ""));
    const [header, ...body] = grid;
    lines.push(
      `| ${pad(header!).join(" | ")} |`,
      `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
      ...body.map((row) => `| ${pad(row).join(" | ")} |`),
      "",
    );
  }
  return [lines.join("\n"), notes];
}

// ── PDF ───────────────────────────────────────────────────────────────

async function pdfToMarkdown(fileName: string, data: Uint8Array): Promise<[string, string[]]> {
  const markdown = await readDocumentAsMarkdown(fileName, data);
  return [
    markdown,
    [
      "PDF 已转换为 Markdown 编辑副本；固定版式、图片位置、表格线和表单不会等同于原 PDF。",
      "扫描件没有可提取的文字时会是空白，需要先做 OCR。",
    ],
  ];
}
