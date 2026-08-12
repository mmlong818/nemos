import type { OfficeFileKind } from "./office-file-parser.js";

export type StructuredBlockKind = "heading" | "paragraph" | "list" | "table" | "quote" | "code" | "placeholder";

export interface StructuredDocumentBlock {
  id: string;
  kind: StructuredBlockKind;
  text: string;
  level?: number;
  ordered?: boolean;
  rows?: string[][];
  source: { startLine: number; endLine: number };
}

export interface StructuredDocument {
  schema: "clownfish.document.v1";
  sourceFormat: OfficeFileKind;
  blocks: StructuredDocumentBlock[];
}

/**
 * 飞书式可编辑副本的最小模型。原文件继续由文件会话保管；这里仅保存
 * 可编辑结构和来源行号，不承担 Office 排版引擎的职责。
 */
export function markdownToStructuredDocument(sourceFormat: OfficeFileKind, markdown: string): StructuredDocument {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks: StructuredDocumentBlock[] = [];
  let index = 0;
  let sequence = 0;

  const append = (block: Omit<StructuredDocumentBlock, "id">): void => {
    blocks.push({ id: `block-${++sequence}`, ...block });
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      append({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim(), source: { startLine: index + 1, endLine: index + 1 } });
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const start = index;
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? "")) content.push(lines[index++] ?? "");
      if (index < lines.length) index += 1;
      append({ kind: "code", text: content.join("\n"), source: { startLine: start + 1, endLine: index } });
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1] ?? "")) {
      const start = index;
      const rows = [parseTableRow(line)];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? "")) rows.push(parseTableRow(lines[index++] ?? ""));
      append({ kind: "table", text: rows.map((row) => row.join(" | ")).join("\n"), rows, source: { startLine: start + 1, endLine: index } });
      continue;
    }

    const list = line.match(/^\s*(-|\*|\d+\.)\s+(.+)$/);
    if (list) {
      const start = index;
      const ordered = /\d+\./.test(list[1]!);
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] ?? "").match(/^\s*(-|\*|\d+\.)\s+(.+)$/);
        if (!match || /\d+\./.test(match[1]!) !== ordered) break;
        items.push(match[2]!.trim());
        index += 1;
      }
      append({ kind: "list", ordered, text: items.join("\n"), source: { startLine: start + 1, endLine: index } });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const start = index;
      const values: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) values.push((lines[index++] ?? "").replace(/^>\s?/, ""));
      append({ kind: "quote", text: values.join("\n"), source: { startLine: start + 1, endLine: index } });
      continue;
    }

    const start = index;
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() && !startsStructuredBlock(lines, index)) paragraph.push((lines[index++] ?? "").trim());
    if (!paragraph.length) paragraph.push((lines[index++] ?? "").trim());
    append({ kind: /^［.*］$/.test(paragraph.join("")) ? "placeholder" : "paragraph", text: paragraph.join("\n"), source: { startLine: start + 1, endLine: index } });
  }

  return { schema: "clownfish.document.v1", sourceFormat, blocks };
}

function startsStructuredBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return /^(#{1,6})\s+|^```|^\s*(-|\*|\d+\.)\s+|^>\s?/.test(line)
    || (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1] ?? ""));
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableDivider(line: string): boolean {
  return /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}
