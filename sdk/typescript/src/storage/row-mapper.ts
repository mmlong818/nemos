// storage/row-mapper.ts — SQLite Row → Memory 反序列化 + 向量/查询工具函数

import {
  SCHEMA_VERSION,
  type Layer,
  type Memory,
  type MemoryArousal,
  type MemoryOwnership,
  type MemorySource,
  type MemorySurprise,
} from "../types.js";
import { ensureMemoryQualityMetadata } from "../salience.js";

export interface RowMemory {
  id: string;
  layer: string;
  type: string;
  scope: string;
  content: string;
  source_json: string;
  arousal_json: string;
  surprise_json: string;
  ownership_json: string;
  created_at: string;
  last_accessed: string;
  access_count: number;
  stability: number;
  schema_version: string;
  generation: number;
  archival_ref: string | null;
  related_json: string | null;
  corrects_json: string | null;
  corrected_by_json: string | null;
  supersedes: string | null;
  wrong_scope: string | null;
  wrong_behavior: string | null;
  embedding_model_id: string | null;
  event_at: string | null;
  sensitive: number | null;
  scenario: string | null;
  entities_json: string | null;
  difficulty: number | null;
  retrievability: number | null;
  last_decay_at: string | null;
  archival_protected: number | null;
  cold: number | null;
  cold_at: string | null;
  consolidated_from_json: string | null;
  consolidated_at: string | null;
  valid_at: string | null;
  invalid_at: string | null;
  expired_at: string | null;
  belief_state: string | null;
  data_subject_ids_json: string | null;
  subject_id: string | null;
  subject_resolution: string | null;
  predicate: string | null;
  context_dimensions_json: string | null;
  object_json: string | null;
  canonical_object_hash: string | null;
  claim_key: string | null;
  claim_key_version: number | null;
  normalizer_version: number | null;
  trust_tier: number | null;
  utterance_mode: string | null;
  specificity: string | null;
  source_event_ids_json: string | null;
  legacy_unstructured: number | null;
  salience_json: string | null;
  evidence_coverage: string | null;
  evidence_count: number | null;
}

export function rowToMemory(row: RowMemory): Memory {
  const m: Memory = {
    id: row.id,
    layer: row.layer as Layer,
    type: row.type as Memory["type"],
    scope: row.scope,
    content: row.content,
    source: JSON.parse(row.source_json) as MemorySource,
    arousal: JSON.parse(row.arousal_json) as MemoryArousal,
    surprise: JSON.parse(row.surprise_json) as MemorySurprise,
    ownership: JSON.parse(row.ownership_json) as MemoryOwnership,
    created_at: row.created_at,
    last_accessed: row.last_accessed,
    access_count: row.access_count,
    stability: row.stability,
    schema_version: row.schema_version || SCHEMA_VERSION,
    generation: row.layer === "archival" ? 0 : (row.generation ?? 1),
  };
  if (row.event_at) m.event_at = row.event_at;
  if (row.sensitive) m.sensitive = true;
  if (row.scenario) m.scenario = row.scenario;
  if (row.archival_ref) m.archival_ref = row.archival_ref;
  if (row.related_json) m.related = JSON.parse(row.related_json) as string[];
  if (row.corrects_json) m.corrects = JSON.parse(row.corrects_json) as string[];
  if (row.corrected_by_json) {
    m.corrected_by = JSON.parse(row.corrected_by_json) as string[];
  }
  if (row.supersedes) m.supersedes = row.supersedes;
  if (row.wrong_scope) m.wrong_scope = row.wrong_scope as Memory["wrong_scope"];
  if (row.wrong_behavior) m.wrong_behavior = row.wrong_behavior;
  if (row.embedding_model_id) m.embedding_model_id = row.embedding_model_id;
  if (row.entities_json) {
    try {
      const arr = JSON.parse(row.entities_json) as string[];
      if (Array.isArray(arr)) m.entities = arr;
    } catch {
      // ignore malformed
    }
  }
  // v0.4 字段
  if (typeof row.difficulty === "number") m.difficulty = row.difficulty;
  if (typeof row.retrievability === "number") m.retrievability = row.retrievability;
  if (row.last_decay_at) m.last_decay_at = row.last_decay_at;
  if (row.archival_protected) m.archival_protected = true;
  if (row.cold) {
    m.cold = true;
    if (row.cold_at) m.cold_at = row.cold_at;
  }
  if (row.consolidated_from_json) {
    try {
      const arr = JSON.parse(row.consolidated_from_json) as string[];
      if (Array.isArray(arr)) m.consolidated_from = arr;
    } catch {
      // ignore malformed
    }
  }
  if (row.consolidated_at) m.consolidated_at = row.consolidated_at;
  // v0.6（RFC 0007）双时间字段；belief_state 默认 'active' 视为缺省，不回填到对象。
  if (row.valid_at) m.valid_at = row.valid_at;
  if (row.invalid_at) m.invalid_at = row.invalid_at;
  if (row.expired_at) m.expired_at = row.expired_at;
  if (row.belief_state && row.belief_state !== "active") {
    m.belief_state = row.belief_state as Memory["belief_state"];
  }
  if (row.data_subject_ids_json) m.data_subject_ids = parseJsonArray(row.data_subject_ids_json);
  if (row.subject_id) m.subject_id = row.subject_id;
  if (row.subject_resolution) m.subject_resolution = row.subject_resolution as Memory["subject_resolution"];
  if (row.predicate) m.predicate = row.predicate;
  if (row.context_dimensions_json) m.context_dimensions = parseJsonObject(row.context_dimensions_json);
  if (row.object_json) {
    try { m.object_json = JSON.parse(row.object_json) as unknown; } catch { /* ignore malformed */ }
  }
  if (row.canonical_object_hash) m.canonical_object_hash = row.canonical_object_hash;
  if (row.claim_key) m.claim_key = row.claim_key;
  if (typeof row.claim_key_version === "number") m.claim_key_version = row.claim_key_version;
  if (typeof row.normalizer_version === "number") m.normalizer_version = row.normalizer_version;
  if (typeof row.trust_tier === "number") m.trust_tier = row.trust_tier;
  if (row.utterance_mode) m.utterance_mode = row.utterance_mode as Memory["utterance_mode"];
  if (row.specificity) m.specificity = row.specificity as Memory["specificity"];
  if (row.source_event_ids_json) m.source_event_ids = parseJsonArray(row.source_event_ids_json);
  if (row.legacy_unstructured) m.legacy_unstructured = true;
  if (row.salience_json) {
    try { m.salience = JSON.parse(row.salience_json) as Memory["salience"]; } catch { /* recompute below */ }
  }
  if (row.evidence_coverage) {
    m.evidence_coverage = row.evidence_coverage as Memory["evidence_coverage"];
  }
  if (typeof row.evidence_count === "number") m.evidence_count = row.evidence_count;
  return ensureMemoryQualityMetadata(m);
}

export function bufferToFloat32(buf: Buffer): Float32Array {
  // Buffer 可能不是 4 字节对齐 → 复制一份
  const ab = new ArrayBuffer(buf.byteLength);
  const view = new Uint8Array(ab);
  view.set(buf);
  return new Float32Array(ab);
}

export function cosineSimLocal(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) continue;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function sanitizeFtsQuery(q: string): string {
  // FTS5 MATCH 需要安全处理特殊字符。简化策略：split on whitespace + 用 "" 包裹
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`);
  if (tokens.length === 0) return "";
  return tokens.join(" OR ");
}
function parseJsonArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}
