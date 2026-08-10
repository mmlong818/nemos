import { extractOfficeFile, type OfficeFileKind } from "./office-file-parser.js";
import { UserFacingError } from "./office-errors.js";
import { parseDocx, type Block, type TableModel } from "./vendor/docx-engine/dist/index.js";
import { getSlideNotes, openPptx, type Slide, type SlideElement, type TableElement as PptxTableElement, type TextElement } from "./vendor/pptx-engine/dist/index.js";

/**
 * 把上传的文档统一转成 Markdown 之后再处理。
 *
 * 这是明确的产品取舍：Markdown 是唯一我们能真正完整编辑的格式，
 * 所以所有格式都先落到它上面，而不是为每种格式各做一套原格式编辑。
 * 代价是转换会丢掉原格式的呈现（表格样式与合并单元格、页眉页脚、
 * 批注修订、幻灯片版式等）——因此每次转换都必须把丢了什么如实列出来，
 * 并且原文件继续保留、可随时下载，转换结果只是派生的工作文档。
 */
export interface MarkdownConversion {
  sourceFormat: OfficeFileKind;
  markdown: string;
  /** 这次转换丢掉或降级了什么。必须展示给用户，不能只写在文档里。 */
  notes: string[];
  truncated: boolean;
}

const MAX_MARKDOWN_CHARACTERS = 200_000;

export async function convertOfficeToMarkdown(fileName: string, data: Uint8Array): Promise<MarkdownConversion> {
  const kind = formatOf(fileName);
  if (kind === "md") return finish(kind, decodeText(data), []);
  if (kind === "txt") return finish(kind, decodeText(data), ["纯文本按原样作为 Markdown 正文，没有推断标题层级。"]);
  if (kind === "docx") return finish(kind, ...(await docxToMarkdown(data)));
  if (kind === "pptx") return finish(kind, ...(await pptxToMarkdown(data)));
  if (kind === "xlsx") return finish(kind, ...(await xlsxToMarkdown(fileName, data)));
  return finish(kind, ...(await pdfToMarkdown(fileName, data)));
}

function formatOf(fileName: string): OfficeFileKind {
  const extension = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "markdown") return "md";
  if (extension === "docx" || extension === "pptx" || extension === "xlsx" || extension === "pdf" || extension === "txt" || extension === "md") return extension;
  throw new UserFacingError("仅支持 DOCX、PPTX、XLSX、PDF、TXT 和 Markdown 文件");
}

function finish(sourceFormat: OfficeFileKind, markdown: string, notes: string[]): MarkdownConversion {
  const normalized = markdown.replace(/\r/g, "").replace(/\n{4,}/g, "\n\n\n").trim();
  const truncated = normalized.length > MAX_MARKDOWN_CHARACTERS;
  return {
    sourceFormat,
    markdown: truncated
      ? `${normalized.slice(0, MAX_MARKDOWN_CHARACTERS)}\n\n> 内容较长，已保留前 ${MAX_MARKDOWN_CHARACTERS.toLocaleString("zh-CN")} 个字符。原文件完整保留，可以下载。`
      : normalized,
    notes: truncated ? [...notes, "内容超出单文档上限，Markdown 只保留了前半部分。"] : notes,
    truncated,
  };
}

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("gb18030").decode(data);
  }
}

// ── DOCX ──────────────────────────────────────────────────────────────

async function docxToMarkdown(data: Uint8Array): Promise<[string, string[]]> {
  const parsed = await parseDocx(data);
  const notes: string[] = [];
  const lines: string[] = [];
  let imageCount = 0;
  let passthroughCount = 0;

  for (const block of parsed.blocks) {
    if (block.hidden) continue;
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, Number(block.level || 1)));
      lines.push(`${"#".repeat(level)} ${plainText(block)}`, "");
      continue;
    }
    if (block.type === "listItem") {
      const depth = Math.max(0, Number(block.list?.ilvl || 0));
      const marker = block.list?.kind === "ordered" ? "1." : "-";
      lines.push(`${"  ".repeat(depth)}${marker} ${plainText(block)}`);
      continue;
    }
    if (block.type === "table" && block.table) {
      lines.push("", ...tableToMarkdown(block.table, notes), "");
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
  }

  if (imageCount) notes.push(`${imageCount} 张图片没有转成 Markdown，只留了位置说明；图片本身仍在原文件里。`);
  if (passthroughCount) notes.push(`${passthroughCount} 处图形或嵌入对象无法用 Markdown 表达，已跳过。`);
  if (parsed.comments.length) notes.push(`${parsed.comments.length} 条批注没有带过来。`);
  if (parsed.footnotes.length || parsed.endnotes.length) notes.push(`${parsed.footnotes.length + parsed.endnotes.length} 条脚注或尾注没有带过来。`);
  if (parsed.headerText || parsed.footerText) notes.push("页眉页脚没有带过来。");
  notes.push("字符与段落样式（字体、字号、颜色、对齐）不在 Markdown 的表达范围内。");
  return [lines.join("\n"), notes];
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
  const extracted = await extractOfficeFile(fileName, data);
  return [
    extracted.text,
    [
      "PDF 只提取了文字，版式、图片、表格线和表单都没有带过来。",
      "扫描件没有可提取的文字时会是空白，需要先做 OCR。",
    ],
  ];
}
