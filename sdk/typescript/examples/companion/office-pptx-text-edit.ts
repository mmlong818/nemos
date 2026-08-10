import { openPptx, savePptx, type Slide, type SlideElement, type TextElement } from "./vendor/pptx-engine/dist/index.js";

/**
 * PPTX 文字修改：原文件是事实源，修改是窄范围补丁。
 *
 * 引擎按位置把模型里的 run 与原始 XML 的 <a:r>/<a:br> 一一对齐后原位替换，
 * 只有标脏的元素会被重写，同一页的其他元素与其他页面保持原字节。
 * 这与已冻结的 office-structured-edit 有本质区别：那边按出现顺序重写整页
 * 全部 <a:t>，会把分行、占位符归属和行内格式合并掉。
 *
 * 为了保证不打乱行内格式，这里只接受"改动落在单个 run 内"的编辑：
 * 比对新旧文字的公共前后缀，差异段必须完整落在一个 run 里才写入，
 * 否则跳过并上报。段落里只有一个 run 时（实际最常见）没有任何限制。
 */

/** 软换行哨兵：引擎把 <a:br/> 解析为 text 为 "\n" 的 run，不能当普通文字改。 */
const SOFT_BREAK = "\n";

export type PptxBlockKind = "text" | "table" | "picture" | "chart" | "group" | "other";

export interface PptxTextBlock {
  slideIndex: number;
  elementIndex: number;
  paragraphIndex: number;
  kind: PptxBlockKind;
  text: string;
  textEditable: boolean;
  /** 非文字块给用户看的说明 */
  label?: string;
}

export interface PptxTextEdit {
  slideIndex: number;
  elementIndex: number;
  paragraphIndex: number;
  text: string;
}

export interface PptxTextEditResult {
  data: Buffer;
  changed: string[];
  /** 请求修改但没有改动的位置，调用方必须如实告知用户 */
  skipped: string[];
}

export function pptxBlockKey(edit: { slideIndex: number; elementIndex: number; paragraphIndex: number }): string {
  return `${edit.slideIndex}:${edit.elementIndex}:${edit.paragraphIndex}`;
}

export async function readPptxText(data: Uint8Array): Promise<PptxTextBlock[]> {
  const opened = await openPptx(data);
  const blocks: PptxTextBlock[] = [];
  opened.deck.slides.forEach((slide: Slide, slideIndex: number) => {
    slide.elements.forEach((element: SlideElement, elementIndex: number) => {
      const kind = blockKind(element);
      const paragraphs = textParagraphsOf(element);
      if (!paragraphs) {
        blocks.push({ slideIndex, elementIndex, paragraphIndex: 0, kind, text: "", textEditable: false, label: labelOf(kind) });
        return;
      }
      paragraphs.forEach((runs, paragraphIndex) => {
        blocks.push({
          slideIndex,
          elementIndex,
          paragraphIndex,
          kind,
          text: runs.map((run) => run.text).join(""),
          textEditable: runs.some((run) => run.text !== SOFT_BREAK),
        });
      });
    });
  });
  return blocks;
}

export async function applyPptxTextEdits(data: Uint8Array, edits: PptxTextEdit[]): Promise<PptxTextEditResult> {
  const opened = await openPptx(data);
  const requested = new Map<string, string>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.slideIndex) || !Number.isInteger(edit.elementIndex) || !Number.isInteger(edit.paragraphIndex)) continue;
    requested.set(pptxBlockKey(edit), String(edit.text ?? ""));
  }

  const changed: string[] = [];
  const skipped: string[] = [];

  opened.deck.slides.forEach((slide: Slide, slideIndex: number) => {
    slide.elements.forEach((element: SlideElement, elementIndex: number) => {
      const paragraphs = textParagraphsOf(element);
      let elementChanged = false;
      const prefix = `${slideIndex}:${elementIndex}:`;
      const keysForElement = [...requested.keys()].filter((key) => key.startsWith(prefix));
      if (!keysForElement.length) return;
      if (!paragraphs) {
        // 请求改一个不是文字的元素（表格、图片、图表）：不动它，但要上报。
        keysForElement.forEach((key) => skipped.push(key));
        return;
      }
      for (const key of keysForElement) {
        const paragraphIndex = Number(key.slice(prefix.length));
        const runs = paragraphs[paragraphIndex];
        const next = requested.get(key)!;
        if (!runs) { skipped.push(key); continue; }
        const applied = applyToRuns(runs, next);
        if (applied === "unchanged") continue;
        if (applied === "unsafe") { skipped.push(key); continue; }
        changed.push(key);
        elementChanged = true;
      }
      if (elementChanged) (element as TextElement).dirty = true;
    });
  });

  const saved = await savePptx(opened);
  return { data: Buffer.from(saved), changed, skipped };
}

type ApplyOutcome = "changed" | "unchanged" | "unsafe";

/**
 * 把新文字写回这一段的 run 上。只有差异段完整落在单个可改 run 内才写入，
 * 从而保证其余 run 的文字与格式一字不动。
 */
function applyToRuns(runs: Array<{ text: string }>, next: string): ApplyOutcome {
  const current = runs.map((run) => run.text).join("");
  if (current === next) return "unchanged";

  let prefix = 0;
  while (prefix < current.length && prefix < next.length && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;

  const changeStart = prefix;
  const changeEnd = current.length - suffix;
  const replacement = next.slice(prefix, next.length - suffix);

  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    // 差异段必须完整落在这个 run 内（空替换时端点相等也算落在其中）
    if (changeStart < runStart || changeEnd > runEnd) continue;
    if (run.text === SOFT_BREAK) return "unsafe";
    run.text = run.text.slice(0, changeStart - runStart) + replacement + run.text.slice(changeEnd - runStart);
    return "changed";
  }
  return "unsafe";
}

function textParagraphsOf(element: SlideElement): Array<Array<{ text: string }>> | null {
  if (element.type !== "text" && element.type !== "shape") return null;
  const paragraphs = (element as TextElement).text?.paragraphs;
  if (!paragraphs?.length) return null;
  return paragraphs.map((paragraph) => paragraph.runs);
}

function blockKind(element: SlideElement): PptxBlockKind {
  if (element.type === "text" || element.type === "shape") return "text";
  if (element.type === "table") return "table";
  if (element.type === "picture") return "picture";
  if (element.type === "chart") return "chart";
  if (element.type === "group") return "group";
  return "other";
}

function labelOf(kind: PptxBlockKind): string {
  if (kind === "table") return "表格";
  if (kind === "picture") return "图片";
  if (kind === "chart") return "图表";
  if (kind === "group") return "组合对象";
  return "其他内容";
}
