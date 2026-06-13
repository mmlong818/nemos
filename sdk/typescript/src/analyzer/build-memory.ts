// analyzer/build-memory.ts — RawArchival / RawDerived → Memory 构造
//
// 守住的硬约束：
// - archival.content 客户端强制 = trimmed（spec I3）
// - archival.source.authoritative = true 强制
// - 所有 derived.source.authoritative = false 强制
// - personal_semantic 拒绝 authoritative=true（spec I4） → 降级 episodic

import { SCHEMA_VERSION, type DerivedLayer, type Memory, type MemoryArousal, type MemorySource, type MemorySurprise, type Perspective, type ScenarioProfile } from "../types.js";
import { detectArousalSignals, estimateArousal, estimateSurprise } from "../utils/arousal.js";
import { newId, nowIso } from "../utils/id.js";
import { deriveConfidence } from "../perspectives.js";
import { isValidIsoLike, type RawArchival, type RawDerived } from "./json-parse.js";

export function buildArchival(
  trimmed: string,
  scope: string,
  rawArchival: RawArchival | undefined,
  originAgent: string | undefined,
  profile: ScenarioProfile | undefined,
  contentDate: string | undefined,
): Memory {
  const id = newId("archival");
  const now = nowIso();
  const arousal: MemoryArousal = {
    value:
      typeof rawArchival?.arousal?.value === "number"
        ? rawArchival.arousal.value
        : estimateArousal(trimmed),
    signal_sources:
      rawArchival?.arousal?.signal_sources || detectArousalSignals(trimmed),
  };
  const surprise: MemorySurprise = {
    value:
      typeof rawArchival?.surprise?.value === "number"
        ? rawArchival.surprise.value
        : 0,
    basis: rawArchival?.surprise?.basis || "raw input baseline",
  };
  const source: MemorySource = {
    authoritative: true,
    kind: "authoritative",
    origin: originAgent ? `user-upload:${originAgent}` : "user-upload",
    chain_depth: 0,
    extractor: "user_typed",
    origin_agent: originAgent,
  };
  const m: Memory = {
    id,
    layer: "archival",
    type: "user",
    scope,
    content: trimmed,
    source,
    arousal,
    surprise,
    ownership: { kind: "self", consent_status: "implicit" },
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 1.0,
    schema_version: SCHEMA_VERSION,
  };
  if (contentDate) m.event_at = contentDate;
  if (profile?.privacy?.sensitive) m.sensitive = true;
  if (profile?.name) m.scenario = profile.name;
  return m;
}

export function buildDerived(
  raw: RawDerived,
  scope: string,
  originAgent: string | undefined,
  archivalId: string,
  chainDepth: number,
  profile: ScenarioProfile | undefined,
): Memory {
  const layer = normalizeDerivedLayer(raw.layer);
  const content = (raw.content || "").trim();
  if (!content) throw new Error("[mnemos] derived 缺少 content");

  const now = nowIso();
  const source: MemorySource = {
    authoritative: false,
    kind: "derived",
    origin: raw.source?.origin || "llm-extract",
    chain_depth:
      typeof raw.source?.chain_depth === "number"
        ? Math.max(1, raw.source.chain_depth)
        : chainDepth,
    extractor: raw.source?.extractor || "llm_inference",
    origin_agent: originAgent,
  };
  if (raw.source?.pass_count !== undefined) source.pass_count = raw.source.pass_count;
  if (raw.source?.confidence) source.confidence = raw.source.confidence;

  const arousal: MemoryArousal = {
    value:
      typeof raw.arousal?.value === "number"
        ? raw.arousal.value
        : estimateArousal(content),
    signal_sources: raw.arousal?.signal_sources || detectArousalSignals(content),
  };
  const surprise: MemorySurprise = {
    value:
      typeof raw.surprise?.value === "number"
        ? raw.surprise.value
        : estimateSurprise(content),
    basis: raw.surprise?.basis || "llm-inferred",
  };

  // 硬约束兜底
  let finalLayer = layer;
  if (finalLayer === "personal_semantic" && source.authoritative === true) {
    finalLayer = "episodic";
  }

  const m: Memory = {
    id: newId(finalLayer),
    layer: finalLayer,
    type: (raw.type as Memory["type"]) || (finalLayer === "personal_semantic" ? "user" : "project"),
    scope,
    content,
    source,
    arousal,
    surprise,
    ownership: { kind: "self", consent_status: "implicit" },
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 1.0,
    schema_version: SCHEMA_VERSION,
    archival_ref: archivalId,
  };

  // v0.2 字段
  if (raw.event_at && isValidIsoLike(raw.event_at)) m.event_at = raw.event_at;
  // sensitive：profile.privacy.sensitive=true → 强制全标；否则尊重 LLM 输出
  const sensitive = profile?.privacy?.sensitive === true ? true : raw.sensitive === true;
  if (sensitive) m.sensitive = true;
  if (profile?.name) m.scenario = profile.name;

  return m;
}

/**
 * 多视角 merge 输出 → Memory。
 *
 * 关键差异 vs buildDerived：
 * - source.origin 固定 "llm-merged"，chain_depth=2
 * - perspectives / perspectives_conflict 字段写入 source（不信 LLM 自填的值，
 *   而是过滤为合法 Perspective 枚举值；空数组兜底为 ['fact']）
 * - confidence 由 deriveConfidence() 计算
 */
export function buildDerivedMultiPerspective(
  raw: RawDerived,
  scope: string,
  originAgent: string | undefined,
  archivalId: string,
  profile: ScenarioProfile | undefined,
): Memory {
  // 先借用 v0.2 buildDerived 处理 layer/arousal/surprise/event_at/sensitive
  const base = buildDerived(raw, scope, originAgent, archivalId, 2, profile);

  // 提取 perspectives（过滤为合法 enum）
  const VALID: Perspective[] = ["fact", "emotion", "method", "decision", "temporal"];
  const persp: Perspective[] = [];
  if (Array.isArray(raw.perspectives)) {
    for (const p of raw.perspectives) {
      if (typeof p === "string" && (VALID as string[]).includes(p)) {
        persp.push(p as Perspective);
      }
    }
  }
  // dedupe
  const seenP = new Set<string>();
  const finalPersp: Perspective[] = [];
  for (const p of persp) {
    if (seenP.has(p)) continue;
    seenP.add(p);
    finalPersp.push(p);
  }

  const conflict = raw.perspectives_conflict === true;
  const conf = deriveConfidence(finalPersp, conflict);

  base.source.origin = raw.source?.origin || "llm-merged";
  base.source.chain_depth = 2;
  base.source.confidence = conf;
  if (finalPersp.length > 0) base.source.perspectives = finalPersp;
  if (conflict) base.source.perspectives_conflict = true;
  return base;
}

export function applyExclude(
  derived: Memory[],
  profile: ScenarioProfile | undefined,
): Memory[] {
  const excludes = profile?.exclude?.layers;
  if (!excludes || excludes.length === 0) return derived;
  const set = new Set<DerivedLayer>(excludes);
  return derived.filter((m) => {
    if (m.layer === "archival") return true;
    return !set.has(m.layer as DerivedLayer);
  });
}

function normalizeDerivedLayer(raw: unknown): Memory["layer"] {
  const v = String(raw || "").toLowerCase();
  if (v === "episodic" || v === "semantic" || v === "personal_semantic" || v === "procedural") {
    return v;
  }
  return "semantic";
}
