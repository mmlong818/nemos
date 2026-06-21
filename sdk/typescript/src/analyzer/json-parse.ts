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
    throw new Error(
      `[nemos] LLM 输出不是合法 JSON: ${
        e instanceof Error ? e.message : String(e)
      }\n片段: ${cleaned.slice(0, 240)}`,
    );
  }
  const o = obj as { archival?: RawArchival; derived?: RawDerived[] };
  return {
    archival: o.archival || {},
    derived: Array.isArray(o.derived) ? o.derived : [],
  };
}

export function parseCheckJson(raw: string): ParsedCheck {
  const cleaned = stripFence(raw);
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `[nemos] Check pass JSON 解析失败: ${
        e instanceof Error ? e.message : String(e)
      }\n片段: ${cleaned.slice(0, 240)}`,
    );
  }
  const o = obj as { derived?: RawDerived[]; stats?: VerificationStats };
  return {
    derived: Array.isArray(o.derived) ? o.derived : [],
    stats: o.stats,
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
  return out;
}

/** 宽松检查 ISO 8601 day / month / full datetime。 */
export function isValidIsoLike(s: string): boolean {
  return /^\d{4}(-\d{2})?(-\d{2})?(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
    s,
  );
}
