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
  return m;
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
