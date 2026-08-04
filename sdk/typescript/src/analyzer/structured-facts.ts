import type { IngestResult, Memory, ScenarioProfile } from "../types.js";
import { applyExclude, buildDerived } from "./build-memory.js";
import type { RawDerived } from "./json-parse.js";

const MAX_STRUCTURED_FACTS = 128;

/**
 * Preserve Markdown table row/column relationships as deterministic facts.
 * The archival remains the source of truth; these rows are only retrieval aids.
 */
export function appendStructuredFacts(
  result: IngestResult,
  content: string,
  scope: string,
  originAgent: string | undefined,
  profile: ScenarioProfile | undefined,
): IngestResult {
  const extracted = extractMarkdownTableFacts(content)
    .map((raw) => buildDerived(raw, scope, originAgent, result.archival.id, 1, profile));
  if (extracted.length === 0) return result;

  const seen = new Set(result.derived.map(memoryKey));
  const merged = [...result.derived];
  for (const memory of extracted) {
    const key = memoryKey(memory);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(memory);
  }
  return {
    ...result,
    derived: applyExclude(merged, profile),
  };
}

export function extractMarkdownTableFacts(content: string): RawDerived[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const facts: RawDerived[] = [];
  const seen = new Set<string>();

  for (let index = 0; index + 1 < lines.length && facts.length < MAX_STRUCTURED_FACTS; index++) {
    const headers = parseTableRow(lines[index]!);
    const separator = parseTableRow(lines[index + 1]!);
    if (!headers || !separator || headers.length < 2 || !isSeparatorRow(separator)) continue;

    const title = nearestTableTitle(lines, index);
    index += 2;
    while (index < lines.length && facts.length < MAX_STRUCTURED_FACTS) {
      const values = parseTableRow(lines[index]!);
      if (!values || isSeparatorRow(values)) break;
      const contentValue = formatTableFact(title, headers, values);
      const key = contentValue.toLowerCase();
      if (contentValue && !seen.has(key)) {
        seen.add(key);
        facts.push({
          layer: "semantic",
          content: contentValue,
          type: "reference",
          source: {
            authoritative: false,
            origin: "deterministic-structure",
            chain_depth: 1,
            extractor: "deterministic_normalizer",
          },
          arousal: { value: 0, signal_sources: [] },
          surprise: { value: 0, basis: "structured table row" },
        });
      }
      index++;
    }
    index--;
  }
  return facts;
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(cleanCell(current));
      current = "";
    } else {
      current += char;
    }
  }
  if (escaped) current += "\\";
  cells.push(cleanCell(current));
  return cells.length >= 2 ? cells : null;
}

function cleanCell(value: string): string {
  return value
    .trim()
    .replace(/^(\*\*|__)(.*)\1$/, "$2")
    .replace(/^`(.*)`$/, "$1")
    .trim();
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function nearestTableTitle(lines: string[], headerIndex: number): string {
  for (let index = headerIndex - 1; index >= 0 && index >= headerIndex - 3; index--) {
    const value = lines[index]!.trim();
    if (!value) continue;
    if (value.includes("|")) return "";
    return value
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(\*\*|__)(.*)\1$/, "$2")
      .replace(/:$/, "")
      .trim();
  }
  return "";
}

function formatTableFact(title: string, headers: string[], values: string[]): string {
  const width = Math.max(headers.length, values.length);
  const pairs: string[] = [];
  for (let index = 0; index < width; index++) {
    const header = headers[index]?.trim() || (index === 0 ? "row" : `column ${index + 1}`);
    const value = values[index]?.trim();
    if (!value) continue;
    pairs.push(`${header} = ${value}`);
  }
  if (pairs.length === 0) return "";
  return `${title ? `${title}: ` : "Table row: "}${pairs.join("; ")}`;
}

function memoryKey(memory: Memory): string {
  return `${memory.layer}:${memory.content.trim().toLowerCase()}`;
}
