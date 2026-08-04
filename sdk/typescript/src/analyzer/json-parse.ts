// analyzer/json-parse.ts — LLM 输出 JSON 容错解析

import type { Memory, MemoryArousal, MemorySource, MemorySurprise, Perspective, VerificationStats } from "../types.js";

export interface RawArchival {
  arousal?: Partial<MemoryArousal>;
  surprise?: Partial<MemorySurprise>;
}

export interface RawDerived {
  layer?: string;
  content?: string;
  type?: string;
  source?: Partial<MemorySource>;
  arousal?: Partial<MemoryArousal>;
  surprise?: Partial<MemorySurprise>;
  event_at?: string;
  sensitive?: boolean;
  // v0.7.1：LLM 只能提交候选；claim key 与规范化值由客户端确定性生成。
  subject?: string;
  predicate?: string;
  object?: unknown;
  context_dimensions?: Record<string, string>;
  utterance_mode?: "literal" | "roleplay" | "hypothetical" | "quoted" | "joke" | "uncertain";
  specificity?: "global" | "contextual" | "temporary";
  trust_tier?: number;
  valid_from?: string;
  // v0.3 merge 输出可能带这两个字段（LLM 自填）；客户端会用 perspectives 数组重算
  perspectives?: string[];
  perspectives_conflict?: boolean;
}

export interface RawDerivedWithSource extends RawDerived {
  from_perspective: Perspective;
}

export interface ParsedAnalyze {
  archival: RawArchival;
  derived: RawDerived[];
}

export interface ParsedCheck {
  derived: RawDerived[];
  stats?: VerificationStats;
}

export class AnalyzeJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeJsonParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRawDerived(value: unknown): value is RawDerived {
  return isRecord(value) && typeof value.content === "string" && value.content.trim().length > 0;
}

function stripFence(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return s;
}

export function parseAnalyzeJson(raw: string): ParsedAnalyze {
  const cleaned = stripFence(raw);
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new AnalyzeJsonParseError(
      `[nemos] LLM 输出不是合法 JSON: ${
        e instanceof Error ? e.message : String(e)
      }\n片段: ${cleaned.slice(0, 240)}`,
    );
  }
  const o = isRecord(obj) ? obj : {};
  return {
    archival: isRecord(o.archival) ? o.archival as RawArchival : {},
    derived: Array.isArray(o.derived) ? o.derived.filter(isRawDerived) : [],
  };
}

export function parseCheckJson(raw: string): ParsedCheck {
  const cleaned = stripFence(raw);
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new AnalyzeJsonParseError(
      `[nemos] Check pass JSON 解析失败: ${
        e instanceof Error ? e.message : String(e)
      }\n片段: ${cleaned.slice(0, 240)}`,
    );
  }
  const o = isRecord(obj) ? obj : {};
  return {
    derived: Array.isArray(o.derived) ? o.derived.filter(isRawDerived) : [],
    stats: isRecord(o.stats) ? o.stats as unknown as VerificationStats : undefined,
  };
}

export function stripForCheck(m: Memory): RawDerived {
  const out: RawDerived = {
    layer: m.layer,
    content: m.content,
    type: m.type,
    source: m.source,
    arousal: m.arousal,
    surprise: m.surprise,
  };
  if (m.event_at) out.event_at = m.event_at;
  if (m.sensitive) out.sensitive = m.sensitive;
  if (m.subject_id) out.subject = m.subject_id;
  if (m.predicate) out.predicate = m.predicate;
  if (m.object_json !== undefined) out.object = m.object_json;
  if (m.context_dimensions) out.context_dimensions = m.context_dimensions;
  if (m.utterance_mode) out.utterance_mode = m.utterance_mode;
  if (m.specificity) out.specificity = m.specificity;
  if (m.trust_tier) out.trust_tier = m.trust_tier;
  if (m.valid_at) out.valid_from = m.valid_at;
  return out;
}

/** 宽松检查 ISO 8601 day / month / full datetime。 */
export function isValidIsoLike(s: string): boolean {
  return /^\d{4}(-\d{2})?(-\d{2})?(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
    s,
  );
}
