// utils/chunking.ts — 长内容切段（v0.2）
//
// 按 markdown 章节（## / ###）→ 段落（双 \n）→ 句子（中英文标点）三级 fallback。
// 段间保留 overlap 字符确保语义不切断。

export interface ChunkOptions {
  /** 单段最大字符数（默认 8000） */
  maxChars?: number;
  /** 段间重叠字符数（默认 200） */
  overlap?: number;
}

const DEFAULT_MAX = 8000;
const DEFAULT_OVERLAP = 200;

/**
 * 把长内容切成多段。每段尽量 ≤ maxChars。
 * 若总长 ≤ maxChars，直接返回单元素数组。
 */
export function chunkContent(content: string, opts: ChunkOptions = {}): string[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX;
  const overlap = Math.min(opts.overlap ?? DEFAULT_OVERLAP, Math.floor(maxChars / 4));

  if (content.length <= maxChars) return [content];

  // 一级：按 markdown 章节展开为 segments
  let segments = splitMarkdownSections(content);

  // 二级：若任何 segment > maxChars，按段落展开
  segments = segments.flatMap((s) => (s.length > maxChars ? splitParagraphs(s) : [s]));

  // 三级：若仍 > maxChars，按句子
  segments = segments.flatMap((s) => (s.length > maxChars ? splitSentences(s) : [s]));

  // 极端：单句仍 > maxChars，硬切
  segments = segments.flatMap((s) => (s.length > maxChars ? hardChunks(s, maxChars) : [s]));

  return packSegments(segments, maxChars, overlap);
}

// ============================================================================
// 切分原语
// ============================================================================

function splitMarkdownSections(text: string): string[] {
  const lines = text.split("\n");
  const parts: string[] = [];
  let buf: string[] = [];
  const headingRe = /^#{1,6} /;
  for (const line of lines) {
    if (headingRe.test(line) && buf.length > 0) {
      parts.push(buf.join("\n"));
      buf = [];
    }
    buf.push(line);
  }
  if (buf.length > 0) parts.push(buf.join("\n"));
  return parts.length > 1 ? parts : [text];
}

function splitParagraphs(text: string): string[] {
  const parts = text.split(/\n{2,}/);
  return parts.length > 1 ? parts : [text];
}

function splitSentences(text: string): string[] {
  // 中英文句号 / 问号 / 感叹号 / 分号 都算句界。保留标点。
  const parts = text.split(/(?<=[。！？!?；;])\s*/);
  return parts.filter((s) => s.length > 0);
}

function hardChunks(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}

// ============================================================================
// 打包：按 maxChars 装段
// ============================================================================

function packSegments(
  segments: string[],
  maxChars: number,
  overlap: number,
): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const seg of segments) {
    if (cur.length === 0) {
      cur = seg;
      continue;
    }
    if (cur.length + seg.length + 1 <= maxChars) {
      cur += "\n" + seg;
    } else {
      chunks.push(cur);
      // overlap：把上段尾巴贴到下段头
      const tail = overlap > 0 && cur.length > overlap ? cur.slice(-overlap) : "";
      cur = tail.length > 0 ? tail + "\n" + seg : seg;
    }
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks.filter((c) => c.trim().length > 0);
}
