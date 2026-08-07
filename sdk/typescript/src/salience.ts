// salience.ts - deterministic, explainable long-term admission metadata.

import type {
  EvidenceCoverageState,
  Layer,
  Memory,
  MemorySalience,
} from "./types.js";

export const SALIENCE_ALGORITHM_VERSION = 1;
export const LONG_TERM_SALIENCE_THRESHOLD = 0.55;

const LAYER_BASE: Record<Layer, number> = {
  archival: 0.20,
  episodic: 0.30,
  semantic: 0.42,
  personal_semantic: 0.62,
  procedural: 0.58,
};

const MILESTONE_PATTERN =
  /\b(?:first|successfully|completed|achiev(?:ed|ement)|received|commendation|certification|certified|award(?:ed)?|won|promotion|promoted|offered|joined|cast as|opening night|rare|milestone|graduated|launched|published|signed up|masterclass|(?:baking|sustainable).{0,40}workshop|workshop.{0,40}(?:baking|sustainable)|memorize .{0,30} lines|final rehearsal|discovered|found a new .{1,60} (?:works|helped)|original parts|competition|professional gear|specialized equipment|climbing shoes|improved my performance)\b/i;
const MILESTONE_PATTERN_ZH =
  /第一次|成功|完成|成就|表彰|认证|获奖|晋升|录取|加入|主演|首演|稀有|里程碑|毕业|发布|报名|大师课|烘焙工作坊|可持续.{0,20}工作坊|背.{0,10}台词|最终彩排|发现了有效|比赛|专业装备/;

export interface EvidenceCoverage {
  state: EvidenceCoverageState;
  count: number;
}

export function deriveEvidenceCoverage(memory: Memory): EvidenceCoverage {
  if (memory.layer === "archival" && memory.source.authoritative) {
    return { state: "direct", count: 1 };
  }

  const evidenceIds = new Set<string>();
  for (const sourceId of memory.source_event_ids ?? []) evidenceIds.add(sourceId);
  if (memory.archival_ref) evidenceIds.add(memory.archival_ref);
  for (const sourceId of memory.consolidated_from ?? []) evidenceIds.add(sourceId);

  if (evidenceIds.size >= 2) return { state: "corroborated", count: evidenceIds.size };
  if (evidenceIds.size === 1) return { state: "supported", count: 1 };
  return { state: "unverified", count: 0 };
}

export function computeMemorySalience(
  memory: Memory,
  coverage: EvidenceCoverage = deriveEvidenceCoverage(memory),
): MemorySalience {
  let score = LAYER_BASE[memory.layer];
  const signals = new Set<string>(["layer:" + memory.layer]);

  if (memory.claim_key) {
    score += 0.20;
    signals.add("structured_claim");
  }
  if (memory.source.authoritative) {
    score += 0.08;
    signals.add("authoritative_source");
  }

  if (coverage.state === "direct") {
    score += 0.04;
    signals.add("direct_evidence");
  } else if (coverage.state === "supported") {
    score += 0.08;
    signals.add("supported_evidence");
  } else if (coverage.state === "corroborated") {
    score += 0.12;
    signals.add("corroborated_evidence");
  }

  if (memory.arousal.value > 0) {
    score += Math.min(0.16, memory.arousal.value * 0.16);
    signals.add("arousal");
  }
  if (memory.surprise.value > 0) {
    score += Math.min(0.16, memory.surprise.value * 0.16);
    signals.add("surprise");
  }
  if (MILESTONE_PATTERN.test(memory.content) || MILESTONE_PATTERN_ZH.test(memory.content)) {
    score += 0.26;
    signals.add("milestone_language");
  }
  if (memory.specificity === "temporary") {
    score -= 0.15;
    signals.add("temporary");
  }

  return {
    score: roundScore(score),
    signals: [...signals].sort(),
    algorithm_version: SALIENCE_ALGORITHM_VERSION,
    computed_at: new Date().toISOString(),
  };
}

export function ensureMemoryQualityMetadata(memory: Memory): Memory {
  const coverage = deriveEvidenceCoverage(memory);
  const coverageChanged =
    memory.evidence_coverage !== coverage.state ||
    memory.evidence_count !== coverage.count;
  memory.evidence_coverage = coverage.state;
  memory.evidence_count = coverage.count;
  const promotion = determinePromotion(memory, coverage);
  memory.promotion_state = promotion.state;
  memory.promotion_reason = promotion.reason;
  if (
    coverageChanged ||
    !memory.salience ||
    memory.salience.algorithm_version !== SALIENCE_ALGORITHM_VERSION
  ) {
    memory.salience = computeMemorySalience(memory, coverage);
  }
  return memory;
}

export function determinePromotion(
  memory: Memory,
  coverage: EvidenceCoverage = deriveEvidenceCoverage(memory),
): { state: "candidate" | "promoted"; reason: string } {
  if (memory.layer === "archival") return { state: "promoted", reason: "authoritative_source_event" };
  if (memory.source.origin === "clownfish-memory-ui") return { state: "promoted", reason: "explicit_user_preference" };
  const isHedgedInference = memory.source.kind === "derived" && /(?:可能|也许|或许|似乎|大概|推测|不确定|可能指|may\b|might\b|perhaps\b|possibly\b)/i.test(memory.content);
  if (coverage.state === "corroborated") {
    if (isHedgedInference) return { state: "candidate", reason: "hedged_inference" };
    return { state: "promoted", reason: "independent_evidence" };
  }

  const inferredConfidence = memory.source.confidence;
  const isInference = inferredConfidence === "medium" || inferredConfidence === "conflict";
  const isTransient = memory.specificity === "temporary";
  const isNonLiteral = !!memory.utterance_mode && memory.utterance_mode !== "literal";
  const isEmotionSignal = memory.layer === "episodic" && (
    memory.source.origin.includes("emotion") ||
    memory.source.perspectives?.includes("emotion")
  );
  if (isNonLiteral) return { state: "candidate", reason: "non_literal_utterance" };
  if (isTransient) return { state: "candidate", reason: "temporary_fact" };
  if (isInference) return { state: "candidate", reason: "low_confidence_inference" };
  if (isEmotionSignal) return { state: "candidate", reason: "single_emotion_signal" };
  if (isHedgedInference) return { state: "candidate", reason: "hedged_inference" };
  const structured = !!memory.claim_key && !!memory.predicate && !!memory.subject_id;
  if (!structured) return { state: "candidate", reason: "unstructured_derivation" };
  if (coverage.state === "unverified") return { state: "candidate", reason: "missing_source_evidence" };
  return { state: "promoted", reason: "literal_supported_fact" };
}
export function hasDurableSalience(memory: Memory): boolean {
  const quality = ensureMemoryQualityMetadata(memory);
  return quality.salience!.score >= LONG_TERM_SALIENCE_THRESHOLD;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
}
