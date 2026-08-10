import { parseDocx, saveDocx, type Block, type SaveBlock } from "./vendor/docx-engine/dist/index.js";
import { patchParagraphTexts } from "./vendor/docx-engine/dist/text-patch.js";

/**
 * DOCX 文字修改：原文件是事实源，修改是窄范围补丁。
 *
 * 与已冻结的 office-structured-edit 的区别是本质性的：
 * 那边按位置重写全部 <w:t> 并把一个段落的多个 run 合并成一个，行内格式必然丢失；
 * 这里逐块定位，只有调用方明确给了新文字的段落才动，且只替换该段落 <w:t> 中
 * 与原文不同的部分，其余 run 的字节原样保留。表格、图片、图表、页眉页脚、
 * 批注、修订和 sectPr 都作为原始块透传。
 *
 * 无法安全打补丁的段落（没有 w:t 锚点、结构超出补丁能力）会被跳过并上报，
 * 不回退到有损重建——宁可少改一段，也不悄悄破坏格式。
 */

const TEXT_BLOCK_TYPES = new Set<Block["type"]>(["paragraph", "heading", "listItem"]);

export type DocxBlockKind = "paragraph" | "heading" | "listItem" | "table" | "image" | "other";

export interface DocxTextBlock {
  docxIndex: number;
  kind: DocxBlockKind;
  /** 段落类块的纯文本；非文字块为空字符串 */
  text: string;
  /** 能否用文字补丁修改 */
  textEditable: boolean;
  /** 非文字块给用户看的说明，例如"表格""图片" */
  label?: string;
}

export interface DocxTextEdit {
  docxIndex: number;
  text: string;
}

export interface DocxTextEditResult {
  data: Buffer;
  /** 实际写入了新文字的块 */
  changed: number[];
  /**
   * 请求修改但没有改动的块：不是文字段落（表格、图片、图形），
   * 或没有可锚定的 w:t。调用方必须如实告知用户，不能当成已改。
   */
  skipped: number[];
}

export async function readDocxText(data: Uint8Array): Promise<DocxTextBlock[]> {
  const parsed = await parseDocx(data);
  return parsed.blocks.filter((block) => !block.hidden).map(describe);
}

export async function applyDocxTextEdits(data: Uint8Array, edits: DocxTextEdit[]): Promise<DocxTextEditResult> {
  const parsed = await parseDocx(data);
  const requested = new Map<number, string>();
  for (const edit of edits) {
    if (Number.isInteger(edit.docxIndex)) requested.set(edit.docxIndex, String(edit.text ?? ""));
  }

  const changed: number[] = [];
  const skipped: number[] = [];
  const finalBlocks: SaveBlock[] = [];

  for (const block of parsed.blocks) {
    if (block.hidden) continue;
    const docxIndex = block.docxIndex;
    if (docxIndex === null) continue;
    const next = requested.get(docxIndex);
    if (next === undefined) {
      finalBlocks.push({ kind: "original", docxIndex });
      continue;
    }
    if (!TEXT_BLOCK_TYPES.has(block.type) || !block.originalXml) {
      // 调用方要求改一个不是文字段落的块（表格、图片、图形等）：不动它，但要如实上报。
      skipped.push(docxIndex);
      finalBlocks.push({ kind: "original", docxIndex });
      continue;
    }
    if (next === plainTextOf(block)) {
      finalBlocks.push({ kind: "original", docxIndex });
      continue;
    }
    const patched = patchParagraphTexts(block.originalXml, next);
    if (patched === null) {
      skipped.push(docxIndex);
      finalBlocks.push({ kind: "original", docxIndex });
      continue;
    }
    changed.push(docxIndex);
    finalBlocks.push({ kind: "xml", xml: patched, docxIndex });
  }

  const saved = await saveDocx(parsed, finalBlocks);
  return { data: Buffer.from(saved), changed, skipped };
}

function describe(block: Block): DocxTextBlock {
  const kind = blockKind(block);
  const isText = TEXT_BLOCK_TYPES.has(block.type);
  return {
    docxIndex: block.docxIndex ?? -1,
    kind,
    text: isText ? plainTextOf(block) : "",
    textEditable: isText && Boolean(block.originalXml && block.originalXml.includes("<w:t")),
    label: isText ? undefined : localizedLabel(block, kind),
  };
}

/** 引擎给的标签是英文（如 "Table 3×4"），界面只说小丑鱼自己的产品语言。 */
function localizedLabel(block: Block, kind: DocxBlockKind): string {
  const upstream = String(block.label || "").trim();
  const size = upstream.match(/(\d+\s*[×x]\s*\d+)/)?.[1]?.replace(/\s*[×x]\s*/, "×");
  const base = defaultLabel(kind);
  return size ? `${base} ${size}` : base;
}

function blockKind(block: Block): DocxBlockKind {
  if (block.type === "paragraph" || block.type === "heading" || block.type === "listItem") return block.type;
  if (block.type === "table") return "table";
  if (block.type === "image") return "image";
  return "other";
}

function defaultLabel(kind: DocxBlockKind): string {
  if (kind === "table") return "表格";
  if (kind === "image") return "图片";
  return "图形或嵌入内容";
}

function plainTextOf(block: Block): string {
  return (block.runs || []).map((run) => run.text).join("");
}
