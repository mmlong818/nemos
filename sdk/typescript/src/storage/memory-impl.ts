// storage/memory-impl.ts — Storage 的纯内存实现（仅测试用）

import {
  LAYERS,
  type IngestStatus,
  type Layer,
  type Memory,
} from "../types.js";
import type { DecayCandidate, IngestQueueRow, SearchFilter, Storage } from "./types.js";
import { cosineSimLocal } from "./row-mapper.js";

export class InMemoryStorage implements Storage {
  private readonly data = new Map<string, Memory>(); // key: tenant|user|layer|id
  private readonly embeddings = new Map<
    string,
    { vec: Float32Array; modelId: string; layer: Layer; scope: string }
  >();
  // v0.3：队列内存表
  private readonly queue = new Map<string, IngestQueueRow>();

  private key(t: string, u: string, layer: Layer, id: string): string {
    return `${t}|${u}|${layer}|${id}`;
  }

  insert(tenantId: string, userId: string, m: Memory): Memory {
    // archival 自动 protected（hard rule）
    if (m.layer === "archival") {
      m.archival_protected = true;
    }
    this.data.set(this.key(tenantId, userId, m.layer, m.id), m);
    return m;
  }

  insertEmbedding(
    tenantId: string,
    userId: string,
    layer: Layer,
    recordId: string,
    embedding: Float32Array,
    modelId: string,
  ): void {
    const mem = this.data.get(this.key(tenantId, userId, layer, recordId));
    if (!mem) return;
    this.embeddings.set(`${tenantId}|${userId}|${layer}|${recordId}`, {
      vec: embedding,
      modelId,
      layer,
      scope: mem.scope,
    });
  }

  list(
    tenantId: string,
    userId: string,
    layer: Layer,
    opts: { scope?: string; limit?: number; offset?: number } = {},
  ): Memory[] {
    const prefix = `${tenantId}|${userId}|${layer}|`;
    const arr: Memory[] = [];
    for (const [k, v] of this.data) {
      if (!k.startsWith(prefix)) continue;
      if (opts.scope && v.scope !== opts.scope) continue;
      arr.push(v);
    }
    arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 100;
    return arr.slice(offset, offset + limit);
  }

  listAll(tenantId: string, userId: string): Memory[] {
    const out: Memory[] = [];
    for (const layer of LAYERS) {
      out.push(...this.list(tenantId, userId, layer, { limit: 100000 }));
    }
    return out;
  }

  get(tenantId: string, userId: string, layer: Layer, id: string): Memory | null {
    return this.data.get(this.key(tenantId, userId, layer, id)) ?? null;
  }

  searchFts(
    tenantId: string,
    userId: string,
    query: string,
    layers: Layer[],
    scope: string | string[] | undefined,
    topK: number,
    filter: SearchFilter = {},
  ): Memory[] {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    const scopeSet = Array.isArray(scope) && scope.length > 0 ? new Set(scope) : null;
    const singleScope = typeof scope === "string" ? scope : undefined;
    const scored: Array<{ memory: Memory; hits: number }> = [];
    for (const layer of layers) {
      const all = this.list(tenantId, userId, layer, {
        scope: scopeSet ? undefined : singleScope,
        limit: 10000,
      });
      for (const m of all) {
        if (scopeSet && !scopeSet.has(m.scope)) continue;
        if (filter.sensitiveOnly) {
          if (!m.sensitive) continue;
        } else if (!filter.includeSensitive && m.sensitive) {
          continue;
        }
        if (!filter.includeCold && m.cold) continue;
        const lc = m.content.toLowerCase();
        let hits = 0;
        for (const t of tokens) {
          if (lc.includes(t)) hits++;
        }
        if (hits > 0) scored.push({ memory: m, hits });
      }
    }
    scored.sort((a, b) => b.hits - a.hits);
    return scored.slice(0, topK).map((s) => s.memory);
  }

  searchEmbedding(
    tenantId: string,
    userId: string,
    queryVec: Float32Array,
    layers: Layer[],
    scope: string | string[] | undefined,
    topK: number,
    filter: SearchFilter = {},
  ): Array<{ memory: Memory; score: number }> {
    const prefix = `${tenantId}|${userId}|`;
    const layerSet = new Set(layers);
    const scopeSet = Array.isArray(scope) && scope.length > 0 ? new Set(scope) : null;
    const singleScope = typeof scope === "string" ? scope : undefined;
    const scored: Array<{ key: string; score: number; layer: Layer; id: string }> = [];
    for (const [k, v] of this.embeddings) {
      if (!k.startsWith(prefix)) continue;
      if (!layerSet.has(v.layer)) continue;
      if (scopeSet && !scopeSet.has(v.scope)) continue;
      if (singleScope && v.scope !== singleScope) continue;
      const score = cosineSimLocal(queryVec, v.vec);
      const id = k.split("|").pop() as string;
      scored.push({ key: k, score, layer: v.layer, id });
    }
    scored.sort((a, b) => b.score - a.score);
    const out: Array<{ memory: Memory; score: number }> = [];
    for (const s of scored) {
      if (out.length >= topK) break;
      const mem = this.get(tenantId, userId, s.layer, s.id);
      if (!mem) continue;
      if (filter.sensitiveOnly && !mem.sensitive) continue;
      if (!filter.sensitiveOnly && !filter.includeSensitive && mem.sensitive) continue;
      if (!filter.includeCold && mem.cold) continue;
      out.push({ memory: mem, score: s.score });
    }
    return out;
  }

  delete(tenantId: string, userId: string, layer: Layer, id: string): void {
    if (layer === "archival") {
      throw new Error("[mnemos] archival 不允许直接 delete（spec I3）");
    }
    this.data.delete(this.key(tenantId, userId, layer, id));
    this.embeddings.delete(`${tenantId}|${userId}|${layer}|${id}`);
  }

  stats(tenantId: string, userId: string): {
    total: number;
    by_layer: Record<Layer, number>;
    by_scope: Record<string, number>;
  } {
    const byLayer: Record<Layer, number> = {
      archival: 0,
      episodic: 0,
      semantic: 0,
      personal_semantic: 0,
      procedural: 0,
    };
    const byScope: Record<string, number> = {};
    let total = 0;
    for (const layer of LAYERS) {
      const arr = this.list(tenantId, userId, layer, { limit: 100000 });
      byLayer[layer] = arr.length;
      total += arr.length;
      for (const m of arr) {
        byScope[m.scope] = (byScope[m.scope] || 0) + 1;
      }
    }
    return { total, by_layer: byLayer, by_scope: byScope };
  }

  // v0.3 新增 ----------------------------------------------------------------
  findById(tenantId: string, userId: string, id: string): Memory | null {
    for (const layer of LAYERS) {
      const m = this.get(tenantId, userId, layer, id);
      if (m) return m;
    }
    return null;
  }

  updateEntities(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    entities: string[],
  ): void {
    const m = this.data.get(this.key(tenantId, userId, layer, id));
    if (!m) return;
    m.entities = entities.length > 0 ? [...entities] : undefined;
  }

  updateRelated(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    related: string[],
  ): void {
    const m = this.data.get(this.key(tenantId, userId, layer, id));
    if (!m) return;
    m.related = related.length > 0 ? [...related] : undefined;
  }

  findByEntity(
    tenantId: string,
    userId: string,
    entity: string,
    opts: { scope?: string; topK?: number; excludeId?: string } = {},
  ): Memory[] {
    const topK = opts.topK ?? 20;
    const needle = entity.toLowerCase().trim();
    if (!needle) return [];
    const out: Memory[] = [];
    const prefix = `${tenantId}|${userId}|`;
    for (const [k, m] of this.data) {
      if (!k.startsWith(prefix)) continue;
      if (opts.excludeId && m.id === opts.excludeId) continue;
      if (opts.scope && m.scope !== opts.scope) continue;
      if (!m.entities) continue;
      const matched = m.entities.some((e) => e.toLowerCase() === needle);
      if (matched) {
        out.push(m);
        if (out.length >= topK) break;
      }
    }
    return out;
  }

  enqueueIngest(
    row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count">,
  ): IngestQueueRow {
    const full: IngestQueueRow = {
      ...row,
      updated_at: row.created_at,
      completed_at: null,
      derived_count: null,
    };
    this.queue.set(row.id, full);
    return full;
  }

  getQueueRow(id: string): IngestQueueRow | null {
    return this.queue.get(id) ?? null;
  }

  takeNextQueued(): IngestQueueRow | null {
    const arr: IngestQueueRow[] = [];
    for (const r of this.queue.values()) {
      if (r.status === "queued") arr.push(r);
    }
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return arr[0] ?? null;
  }

  updateQueueStatus(
    id: string,
    patch: {
      status?: IngestStatus;
      attempts?: number;
      last_error?: string | null;
      completed_at?: string | null;
      derived_count?: number | null;
    },
  ): void {
    const r = this.queue.get(id);
    if (!r) return;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.attempts !== undefined) r.attempts = patch.attempts;
    if (patch.last_error !== undefined) r.last_error = patch.last_error;
    if (patch.completed_at !== undefined) r.completed_at = patch.completed_at;
    if (patch.derived_count !== undefined) r.derived_count = patch.derived_count;
    r.updated_at = new Date().toISOString();
  }

  resetStaleAnalyzing(): number {
    let n = 0;
    for (const r of this.queue.values()) {
      if (r.status === "analyzing") {
        r.status = "queued";
        r.updated_at = new Date().toISOString();
        n++;
      }
    }
    return n;
  }

  listPendingByUser(tenantId: string, userId: string): IngestQueueRow[] {
    const arr: IngestQueueRow[] = [];
    for (const r of this.queue.values()) {
      if (r.tenant_id !== tenantId || r.user_id !== userId) continue;
      if (r.status === "queued" || r.status === "analyzing" || r.status === "failed") {
        arr.push(r);
      }
    }
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return arr;
  }

  // v0.4 新增 ----------------------------------------------------------------
  touchAccess(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    nextStability: number,
  ): void {
    if (layer === "archival") return;
    const m = this.data.get(this.key(tenantId, userId, layer, id));
    if (!m) return;
    if (m.archival_protected) return;
    m.last_accessed = new Date().toISOString();
    m.access_count = (m.access_count ?? 0) + 1;
    m.stability = nextStability;
  }

  listDecayCandidates(limit = 500): DecayCandidate[] {
    const out: DecayCandidate[] = [];
    for (const m of this.data.values()) {
      if (m.layer === "archival") continue;
      if (m.archival_protected) continue;
      const parts = this.findKeyFor(m);
      if (!parts) continue;
      out.push({
        id: m.id,
        layer: m.layer,
        tenant_id: parts.tenant,
        user_id: parts.user,
        last_accessed: m.last_accessed,
        access_count: m.access_count ?? 0,
        stability: m.stability,
        sensitive: m.sensitive ? 1 : 0,
        cold: m.cold ? 1 : 0,
        cold_at: m.cold_at ?? null,
        archival_protected: 0,
      });
    }
    out.sort((a, b) => a.last_accessed.localeCompare(b.last_accessed));
    return out.slice(0, limit);
  }

  private findKeyFor(m: Memory): { tenant: string; user: string } | null {
    for (const [k, v] of this.data) {
      if (v === m) {
        const parts = k.split("|");
        return { tenant: parts[0]!, user: parts[1]! };
      }
    }
    return null;
  }

  markCold(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    coldAt: string,
  ): void {
    if (layer === "archival") return;
    const m = this.data.get(this.key(tenantId, userId, layer, id));
    if (!m || m.archival_protected) return;
    m.cold = true;
    m.cold_at = coldAt;
  }

  clearCold(tenantId: string, userId: string, layer: Layer, id: string): void {
    if (layer === "archival") return;
    const m = this.data.get(this.key(tenantId, userId, layer, id));
    if (!m) return;
    m.cold = false;
    m.cold_at = undefined;
  }

  updateDecayMeta(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    retrievability: number,
    lastDecayAt: string,
  ): void {
    if (layer === "archival") return;
    const m = this.data.get(this.key(tenantId, userId, layer, id));
    if (!m) return;
    m.retrievability = retrievability;
    m.last_decay_at = lastDecayAt;
  }

  listColdByUser(tenantId: string, userId: string): Memory[] {
    const out: Memory[] = [];
    const prefix = `${tenantId}|${userId}|`;
    for (const [k, m] of this.data) {
      if (!k.startsWith(prefix)) continue;
      if (m.layer === "archival") continue;
      if (m.cold) out.push(m);
    }
    out.sort((a, b) => (b.cold_at ?? "").localeCompare(a.cold_at ?? ""));
    return out;
  }

  countEpisodicSinceLastReflect(
    tenantId: string,
    userId: string,
    sinceIso: string | null,
  ): number {
    let n = 0;
    const prefix = `${tenantId}|${userId}|episodic|`;
    for (const [k, m] of this.data) {
      if (!k.startsWith(prefix)) continue;
      if (sinceIso && m.created_at <= sinceIso) continue;
      n++;
    }
    return n;
  }

  listRecentEpisodic(tenantId: string, userId: string, limit: number): Memory[] {
    return this.list(tenantId, userId, "episodic", { limit });
  }

  listPersonalSemantic(tenantId: string, userId: string): Memory[] {
    return this.list(tenantId, userId, "personal_semantic", { limit: 200 });
  }

  close(): void {
    this.data.clear();
    this.embeddings.clear();
    this.queue.clear();
  }
}
