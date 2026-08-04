// storage/memory-impl.ts — Storage 的纯内存实现（仅测试用）

import {
  GLOBAL_DOMAIN_ID,
  LAYERS,
  type ClaimIndexEntry,
  type Domain,
  type EventMetadata,
  type DomainAffinity,
  type IngestStatus,
  type Layer,
  LIFECYCLE_ALGORITHM_VERSION,
  type LifecycleStage,
  type LifecycleStageRecord,
  type Memory,
  type MemoryDomain,
  type MemoryOperation,
  type ProvenanceEdge,
  type IdentityOperation,
  type Prospective,
  type RecallTimeRange,
  type ReflectionState,
} from "../types.js";
import type {
  DecayCandidate,
  IngestQueueRow,
  ProspectivePatch,
  SearchFilter,
  Storage,
} from "./types.js";
import { cosineSimLocal } from "./row-mapper.js";
import { nowIso } from "../utils/id.js";
import { ensureMemoryQualityMetadata } from "../salience.js";

export class InMemoryStorage implements Storage {
  private readonly data = new Map<string, Memory>(); // key: tenant|user|layer|id
  private readonly embeddings = new Map<
    string,
    { vec: Float32Array; modelId: string; layer: Layer; scope: string }
  >();
  private readonly eventMetadata = new Map<string, EventMetadata>();
  private readonly eventSequences = new Map<string, number>();
  private readonly lifecycleStages = new Map<string, LifecycleStageRecord>();
  private readonly reflectionStates = new Map<string, ReflectionState>();
  private readonly claims = new Map<string, ClaimIndexEntry>();
  private readonly operations = new Map<string, MemoryOperation>();
  private readonly provenance = new Map<string, ProvenanceEdge>();
  private readonly identities = new Map<string, string>();
  private readonly identityOperations = new Map<string, IdentityOperation>();
  private readonly claimAliases = new Map<string, string>();  // v0.3：队列内存表
  private readonly queue = new Map<string, IngestQueueRow>();
  // v0.5：领域轴 + 前瞻
  private readonly domains = new Map<string, Domain>(); // key: t|u|id
  private readonly memDomains = new Map<string, MemoryDomain[]>(); // key: t|u|memoryId
  private readonly affinity = new Map<string, DomainAffinity>(); // key: t|u|a|b
  private readonly prospectives = new Map<string, Prospective>(); // key: t|u|id

  private key(t: string, u: string, layer: Layer, id: string): string {
    return `${t}|${u}|${layer}|${id}`;
  }

  /** 内存实现无回滚语义（仅测试用）；接口契约见 storage/types.ts。 */
  transaction<T>(fn: () => T): T {
    return fn();
  }

  insert(tenantId: string, userId: string, m: Memory): Memory {
    ensureMemoryQualityMetadata(m);
    // archival 自动 protected（hard rule）
    if (m.layer === "archival") {
      m.archival_protected = true;
    }
    // v0.6（RFC 0007）：derived 默认 valid_at=created_at；archival 不参与双时间。
    if (m.layer !== "archival" && m.valid_at === undefined) m.valid_at = m.created_at;
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
        // v0.6（RFC 0007/0008）：默认隐藏已失效记录
        if (!filter.includeInvalidated && m.belief_state && m.belief_state !== "active") continue;
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
      // v0.6：默认隐藏已失效记录
      if (!filter.includeInvalidated && mem.belief_state && mem.belief_state !== "active") continue;
      out.push({ memory: mem, score: s.score });
    }
    return out;
  }

  searchByTime(
    tenantId: string,
    userId: string,
    range: RecallTimeRange,
    layers: Layer[],
    scope: string | string[] | undefined,
    topK: number,
    filter: SearchFilter = {},
  ): Memory[] {
    const scopeSet = Array.isArray(scope) && scope.length > 0 ? new Set(scope) : null;
    const singleScope = typeof scope === "string" ? scope : undefined;
    const matches: Array<{ memory: Memory; timestamp: string }> = [];
    for (const layer of layers) {
      for (const memory of this.list(tenantId, userId, layer, { limit: 100000 })) {
        if (scopeSet && !scopeSet.has(memory.scope)) continue;
        if (singleScope && memory.scope !== singleScope) continue;
        if (filter.sensitiveOnly && !memory.sensitive) continue;
        if (!filter.sensitiveOnly && !filter.includeSensitive && memory.sensitive) continue;
        if (!filter.includeCold && memory.cold) continue;
        if (!filter.includeInvalidated && memory.belief_state && memory.belief_state !== "active") continue;
        const timestamp = memory.event_at ?? memory.valid_at ?? memory.created_at;
        if (range.from && timestamp < range.from) continue;
        if (range.to && timestamp > range.to) continue;
        matches.push({ memory, timestamp });
      }
    }
    matches.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return matches.slice(0, topK).map((item) => item.memory);
  }
  delete(tenantId: string, userId: string, layer: Layer, id: string): void {
    if (layer === "archival") {
      throw new Error("[nemos] archival 不允许直接 delete（spec I3）");
    }
    this.data.delete(this.key(tenantId, userId, layer, id));
    this.embeddings.delete(`${tenantId}|${userId}|${layer}|${id}`);
    for (const [key, entry] of this.claims) {
      if (entry.tenant_id === tenantId && entry.user_id === userId && entry.memory_id === id) this.claims.delete(key);
    }
    for (const [key, edge] of this.provenance) {
      if (edge.tenant_id === tenantId && edge.user_id === userId && (edge.source_id === id || edge.derived_id === id)) this.provenance.delete(key);
    }
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

  ensureEventMetadata(input: Omit<EventMetadata, "event_seq">): EventMetadata {
    const existing = this.eventMetadata.get(input.event_id);
    if (existing) return existing;
    const sequenceKey = `${input.tenant_id}|${input.user_id}|${input.space_id}`;
    const event_seq = (this.eventSequences.get(sequenceKey) ?? 0) + 1;
    this.eventSequences.set(sequenceKey, event_seq);
    const event = { ...input, event_seq };
    this.eventMetadata.set(input.event_id, event);
    return event;
  }
  getEventMetadata(eventId: string): EventMetadata | null {
    return this.eventMetadata.get(eventId) ?? null;
  }
  getLatestEventSeq(tenantId: string, userId: string, spaceId: string): number {
    return this.eventSequences.get(`${tenantId}|${userId}|${spaceId}`) ?? 0;
  }
  upsertLifecycleStage(record: LifecycleStageRecord): void {
    this.lifecycleStages.set(`${record.event_id}|${record.stage}|${record.algorithm_version}`, { ...record });
  }
  getLifecycleStage(eventId: string, stage: LifecycleStage, algorithmVersion: string): LifecycleStageRecord | null {
    return this.lifecycleStages.get(`${eventId}|${stage}|${algorithmVersion}`) ?? null;
  }
  listLifecycleStages(eventId: string): LifecycleStageRecord[] {
    return [...this.lifecycleStages.values()].filter((row) => row.event_id === eventId);
  }
  getReflectionState(tenantId: string, userId: string, spaceId: string): ReflectionState {
    const key = `${tenantId}|${userId}|${spaceId}`;
    return this.reflectionStates.get(key) ?? {
      tenant_id: tenantId, user_id: userId, space_id: spaceId, last_event_seq: 0,
      last_run_at: null, algorithm_version: LIFECYCLE_ALGORITHM_VERSION,
      lease_owner: null, lease_until: null, last_error: null,
    };
  }
  tryAcquireReflectionLease(tenantId: string, userId: string, spaceId: string, owner: string, leaseUntil: string, now: string): boolean {
    const state = this.getReflectionState(tenantId, userId, spaceId);
    if (state.lease_owner && state.lease_until && state.lease_until > now && state.lease_owner !== owner) return false;
    this.updateReflectionState({ ...state, lease_owner: owner, lease_until: leaseUntil });
    return true;
  }
  updateReflectionState(state: ReflectionState): void {
    this.reflectionStates.set(`${state.tenant_id}|${state.user_id}|${state.space_id}`, { ...state });
  }
  // v0.7.1 事实收敛 -----------------------------------------------------------
  listClaimEntries(tenantId: string, userId: string, spaceId: string, claimKey: string): ClaimIndexEntry[] {
    const canonical = this.resolveCanonicalClaimKey(claimKey);
    const prefix = `${tenantId}|${userId}|${spaceId}|${canonical}|`;
    return [...this.claims.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => ({ ...value }));
  }
  upsertClaimEntry(entry: ClaimIndexEntry): void {
    this.claims.set(`${entry.tenant_id}|${entry.user_id}|${entry.space_id}|${entry.claim_key}|${entry.memory_id}`, { ...entry });
  }
  updateMemoryBeliefState(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    state: Memory["belief_state"],
    opts: { invalidAt?: string; expiredAt?: string; correctedBy?: string; supersedes?: string } = {},
  ): void {
    if (layer === "archival") return;
    const memory = this.data.get(this.key(tenantId, userId, layer, id));
    if (!memory) return;
    if (state && state !== "active") memory.belief_state = state;
    else delete memory.belief_state;
    if (opts.invalidAt) memory.invalid_at = opts.invalidAt;
    if (opts.expiredAt) memory.expired_at = opts.expiredAt;
    if (opts.supersedes) memory.supersedes = opts.supersedes;
    if (opts.correctedBy) memory.corrected_by = [...new Set([...(memory.corrected_by ?? []), opts.correctedBy])];
    for (const entry of this.claims.values()) {
      if (entry.tenant_id === tenantId && entry.user_id === userId && entry.memory_id === id) {
        entry.status = state ?? "active";
        entry.updated_at = nowIso();
      }
    }
  }
  addMemorySourceEvent(tenantId: string, userId: string, layer: Layer, id: string, sourceEventId: string): void {
    const memory = this.data.get(this.key(tenantId, userId, layer, id));
    if (!memory || layer === "archival") return;
    memory.source_event_ids = [...new Set([...(memory.source_event_ids ?? []), sourceEventId])];
    ensureMemoryQualityMetadata(memory);
  }
  rekeyMemoryClaim(tenantId: string, userId: string, layer: Layer, id: string, claimKey: string): void {
    const memory = this.data.get(this.key(tenantId, userId, layer, id));
    if (!memory || !memory.claim_key) return;
    const oldEntries = [...this.claims.entries()].filter(([, entry]) => entry.tenant_id === tenantId && entry.user_id === userId && entry.memory_id === id);
    for (const [key, entry] of oldEntries) {
      this.claims.delete(key);
      memory.claim_key = claimKey;
      this.upsertClaimEntry({ ...entry, claim_key: claimKey, updated_at: nowIso() });
    }
  }  recordClaimKeyAlias(oldClaimKey: string, canonicalClaimKey: string, _operationId: string, _createdAt: string): void {
    this.claimAliases.set(oldClaimKey, canonicalClaimKey);
  }
  resolveCanonicalClaimKey(claimKey: string): string {
    let current = claimKey;
    const visited = new Set<string>();
    while (this.claimAliases.has(current) && !visited.has(current)) {
      visited.add(current);
      current = this.claimAliases.get(current)!;
    }
    return current;
  }  insertMemoryOperation(operation: MemoryOperation): void {
    if (!this.operations.has(operation.id)) this.operations.set(operation.id, { ...operation, subject_memory_ids: [...operation.subject_memory_ids] });
  }
  listMemoryOperations(tenantId: string, userId: string, claimKey?: string): MemoryOperation[] {
    return [...this.operations.values()]
      .filter((item) => item.tenant_id === tenantId && item.user_id === userId && (!claimKey || item.claim_key === claimKey))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  insertProvenanceEdge(edge: ProvenanceEdge): void {
    const key = `${edge.tenant_id}|${edge.user_id}|${edge.source_id}|${edge.derived_id}|${edge.relation}`;
    if (!this.provenance.has(key)) this.provenance.set(key, { ...edge });
  }
  listProvenanceFrom(tenantId: string, userId: string, sourceId: string): ProvenanceEdge[] {
    return [...this.provenance.values()].filter((edge) => edge.tenant_id === tenantId && edge.user_id === userId && edge.source_id === sourceId);
  }
  listProvenanceTo(tenantId: string, userId: string, derivedId: string): ProvenanceEdge[] {
    return [...this.provenance.values()].filter((edge) => edge.tenant_id === tenantId && edge.user_id === userId && edge.derived_id === derivedId);
  }
  resolveCanonicalSubject(tenantId: string, userId: string, spaceId: string, subjectId: string): string {
    return this.identities.get(`${tenantId}|${userId}|${spaceId}|${subjectId}`) ?? subjectId;
  }
  applyIdentityOperation(operation: IdentityOperation): void {
    this.identityOperations.set(operation.id, { ...operation, subject_ids: [...operation.subject_ids] });
    if (operation.kind === "MERGE") {
      for (const subjectId of operation.subject_ids) {
        this.identities.set(`${operation.tenant_id}|${operation.user_id}|${operation.space_id}|${subjectId}`, operation.canonical_subject_id);
      }
      return;
    }
    const reversed = operation.reverses_operation_id ? this.identityOperations.get(operation.reverses_operation_id) : null;
    for (const subjectId of reversed?.subject_ids ?? operation.subject_ids) {
      this.identities.delete(`${operation.tenant_id}|${operation.user_id}|${operation.space_id}|${subjectId}`);
    }
  }
  getIdentityOperation(tenantId: string, userId: string, operationId: string): IdentityOperation | null {
    const operation = this.identityOperations.get(operationId);
    return operation && operation.tenant_id === tenantId && operation.user_id === userId ? { ...operation, subject_ids: [...operation.subject_ids] } : null;
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
    row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count" | "next_attempt_at">,
  ): IngestQueueRow {
    const full: IngestQueueRow = {
      ...row,
      updated_at: row.created_at,
      completed_at: null,
      derived_count: null,
      next_attempt_at: row.created_at,
    };
    this.queue.set(row.id, full);
    return full;
  }

  getQueueRow(id: string): IngestQueueRow | null {
    return this.queue.get(id) ?? null;
  }

  takeNextQueued(readyAt = new Date().toISOString()): IngestQueueRow | null {
    const arr: IngestQueueRow[] = [];
    for (const r of this.queue.values()) {
      if (r.status === "queued" && r.next_attempt_at <= readyAt) arr.push(r);
    }
    arr.sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at) || a.created_at.localeCompare(b.created_at));
    const next = arr[0] ?? null;
    if (next) {
      // 与 SQLite 实现对齐：出队即原子认领（标 analyzing）
      next.status = "analyzing";
      next.updated_at = new Date().toISOString();
    }
    return next;
  }

  updateQueueStatus(
    id: string,
    patch: {
      status?: IngestStatus;
      attempts?: number;
      last_error?: string | null;
      completed_at?: string | null;
      derived_count?: number | null;
      next_attempt_at?: string;
    },
  ): void {
    const r = this.queue.get(id);
    if (!r) return;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.attempts !== undefined) r.attempts = patch.attempts;
    if (patch.last_error !== undefined) r.last_error = patch.last_error;
    if (patch.completed_at !== undefined) r.completed_at = patch.completed_at;
    if (patch.derived_count !== undefined) r.derived_count = patch.derived_count;
    if (patch.next_attempt_at !== undefined) r.next_attempt_at = patch.next_attempt_at;
    r.updated_at = new Date().toISOString();
  }

  resetStaleAnalyzing(leaseMs = 0): number {
    const cutoff = leaseMs > 0 ? new Date(Date.now() - leaseMs).toISOString() : null;
    let n = 0;
    for (const r of this.queue.values()) {
      if (r.status === "analyzing") {
        if (cutoff && r.updated_at >= cutoff) continue;
        r.status = "queued";
        r.updated_at = new Date().toISOString();
        r.next_attempt_at = r.updated_at;
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
    arr.sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at) || a.created_at.localeCompare(b.created_at));
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
        last_decay_at: m.last_decay_at ?? null,
      });
    }
    // 游标语义与 SQLite 对齐：最久未做 decay 检查的优先（null 最前），轮转整库
    out.sort((a, b) => {
      const da = a.last_decay_at ?? "";
      const dbb = b.last_decay_at ?? "";
      return da === dbb ? a.last_accessed.localeCompare(b.last_accessed) : da.localeCompare(dbb);
    });
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

  listEpisodicByEventSeq(
    tenantId: string,
    userId: string,
    spaceId: string,
    afterSeq: number,
    upToSeq: number,
  ): Memory[] {
    return this.list(tenantId, userId, "episodic", { limit: 100000 })
      .map((memory) => ({ memory, event: this.eventMetadata.get(memory.archival_ref ?? memory.id) }))
      .filter(({ event }) => event?.space_id === spaceId && event.event_seq > afterSeq && event.event_seq <= upToSeq)
      .sort((a, b) => b.event!.event_seq - a.event!.event_seq)
      .map(({ memory }) => memory);
  }
  listPersonalSemantic(tenantId: string, userId: string): Memory[] {
    return this.list(tenantId, userId, "personal_semantic", { limit: 200 });
  }

  // v0.6（RFC 0007 §2.2）------------------------------------------------------
  markInvalidated(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    opts: { invalidAt: string; expiredAt?: string; correctedBy?: string },
  ): void {
    if (layer === "archival") return;
    const m = this.data.get(this.key(tenantId, userId, layer, id));
    if (!m) return;
    m.belief_state = "invalidated";
    m.invalid_at = opts.invalidAt;
    if (opts.expiredAt) m.expired_at = opts.expiredAt;
    if (opts.correctedBy) {
      const cb = new Set(m.corrected_by ?? []);
      cb.add(opts.correctedBy);
      m.corrected_by = Array.from(cb);
    }
    for (const entry of this.claims.values()) {
      if (entry.tenant_id === tenantId && entry.user_id === userId && entry.memory_id === id) {
        entry.status = "invalidated";
        entry.updated_at = nowIso();
      }
    }
  }

  // v0.5 领域轴 ---------------------------------------------------------------
  ensureGlobalDomain(tenantId: string, userId: string): Domain {
    const existing = this.getDomain(tenantId, userId, GLOBAL_DOMAIN_ID);
    if (existing) return existing;
    const now = nowIso();
    const g: Domain = {
      id: GLOBAL_DOMAIN_ID,
      tenant_id: tenantId,
      user_id: userId,
      label: "GLOBAL",
      prototype_vec: null,
      parent_id: undefined,
      level: 0,
      status: "hot",
      origin: "seed",
      always_on: true,
      load_count: 0,
      retrievability: 1.0,
      last_routed_at: undefined,
      created_at: now,
      updated_at: now,
    };
    this.upsertDomain(tenantId, userId, g);
    return g;
  }
  upsertDomain(tenantId: string, userId: string, domain: Domain): void {
    this.domains.set(`${tenantId}|${userId}|${domain.id}`, { ...domain });
  }
  getDomain(tenantId: string, userId: string, id: string): Domain | null {
    return this.domains.get(`${tenantId}|${userId}|${id}`) ?? null;
  }
  listDomains(tenantId: string, userId: string, opts?: { includeCold?: boolean }): Domain[] {
    const prefix = `${tenantId}|${userId}|`;
    const out: Domain[] = [];
    for (const [k, v] of this.domains) {
      if (!k.startsWith(prefix)) continue;
      if (!opts?.includeCold && v.status === "cold") continue;
      out.push(v);
    }
    return out;
  }
  setMemoryDomains(
    tenantId: string,
    userId: string,
    memoryId: string,
    links: MemoryDomain[],
  ): void {
    this.memDomains.set(`${tenantId}|${userId}|${memoryId}`, links.map((l) => ({ ...l })));
  }
  getMemoryDomainsFor(tenantId: string, userId: string, memoryIds: string[]): MemoryDomain[] {
    const out: MemoryDomain[] = [];
    for (const id of memoryIds) {
      const links = this.memDomains.get(`${tenantId}|${userId}|${id}`);
      if (links) out.push(...links);
    }
    return out;
  }
  getDomainMemberIds(tenantId: string, userId: string, domainId: string): string[] {
    const prefix = `${tenantId}|${userId}|`;
    const out: string[] = [];
    for (const [k, links] of this.memDomains) {
      if (!k.startsWith(prefix)) continue;
      if (links.some((l) => l.domain_id === domainId)) {
        out.push(k.slice(prefix.length));
      }
    }
    return out;
  }
  getEmbedding(tenantId: string, userId: string, recordId: string): Float32Array | null {
    const suffix = `|${recordId}`;
    const prefix = `${tenantId}|${userId}|`;
    for (const [k, v] of this.embeddings) {
      if (k.startsWith(prefix) && k.endsWith(suffix)) return v.vec;
    }
    return null;
  }
  touchDomainRouted(tenantId: string, userId: string, domainId: string, at: string): void {
    const d = this.getDomain(tenantId, userId, domainId);
    if (!d) return;
    this.upsertDomain(tenantId, userId, {
      ...d,
      load_count: d.load_count + 1,
      last_routed_at: at,
      updated_at: at,
    });
  }
  listAffinities(tenantId: string, userId: string, domainId: string): DomainAffinity[] {
    const prefix = `${tenantId}|${userId}|`;
    const out: DomainAffinity[] = [];
    for (const [k, v] of this.affinity) {
      if (!k.startsWith(prefix)) continue;
      if (v.domain_a === domainId || v.domain_b === domainId) out.push(v);
    }
    return out;
  }
  upsertAffinity(
    tenantId: string,
    userId: string,
    domainA: string,
    domainB: string,
    affinityDelta: number,
    at: string,
  ): void {
    const a = domainA < domainB ? domainA : domainB;
    const b = domainA < domainB ? domainB : domainA;
    const key = `${tenantId}|${userId}|${a}|${b}`;
    const cur = this.affinity.get(key);
    this.affinity.set(key, {
      domain_a: a,
      domain_b: b,
      affinity: (cur?.affinity ?? 0) + affinityDelta,
      updated_at: at,
    });
  }

  // v0.5 前瞻记忆 -------------------------------------------------------------
  insertProspective(tenantId: string, userId: string, p: Prospective): Prospective {
    this.prospectives.set(`${tenantId}|${userId}|${p.id}`, { ...p });
    return p;
  }
  getProspective(tenantId: string, userId: string, id: string): Prospective | null {
    return this.prospectives.get(`${tenantId}|${userId}|${id}`) ?? null;
  }
  listProspective(
    tenantId: string,
    userId: string,
    opts?: { limit?: number; scope?: string },
  ): Prospective[] {
    const prefix = `${tenantId}|${userId}|`;
    let out: Prospective[] = [];
    for (const [k, v] of this.prospectives) {
      if (!k.startsWith(prefix)) continue;
      if (opts?.scope && v.scope !== opts.scope) continue;
      out.push(v);
    }
    out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (opts?.limit) out = out.slice(0, opts.limit);
    return out;
  }
  searchProspectiveByCue(
    tenantId: string,
    userId: string,
    query: string,
    queryVec: Float32Array | null,
    topK: number,
  ): Array<{ prospective: Prospective; score: number }> {
    const all = this.listProspective(tenantId, userId);
    let scored: Array<{ prospective: Prospective; score: number }>;
    if (queryVec) {
      scored = all
        .map((p) => ({
          prospective: p,
          score: p.cue_vec ? cosineSimLocal(queryVec, p.cue_vec) : 0,
        }))
        .filter((x) => x.score > 0);
    } else {
      const q = query.toLowerCase();
      scored = all
        .map((p) => ({
          prospective: p,
          score: p.cue.toLowerCase().includes(q) ? 1 : 0,
        }))
        .filter((x) => x.score > 0);
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
  updateProspective(
    tenantId: string,
    userId: string,
    id: string,
    patch: ProspectivePatch,
  ): void {
    const cur = this.getProspective(tenantId, userId, id);
    if (!cur) return;
    this.prospectives.set(`${tenantId}|${userId}|${id}`, {
      ...cur,
      ...(patch.projection !== undefined ? { projection: patch.projection } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.prediction_log !== undefined ? { prediction_log: patch.prediction_log } : {}),
      ...(patch.retrievability !== undefined ? { retrievability: patch.retrievability } : {}),
      ...(patch.last_verified_at !== undefined ? { last_verified_at: patch.last_verified_at } : {}),
      ...(patch.last_accessed !== undefined ? { last_accessed: patch.last_accessed } : {}),
    });
  }

  close(): void {
    this.data.clear();
    this.embeddings.clear();
    this.queue.clear();
    this.domains.clear();
    this.memDomains.clear();
    this.affinity.clear();
    this.prospectives.clear();
  }
}
