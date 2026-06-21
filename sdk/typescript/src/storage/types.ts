// storage/types.ts — Storage interface + 队列行 + 过滤器
//
// 这是公开类型来源。SqliteStorage / InMemoryStorage 都实现 Storage 接口。

import type {
  Domain,
  DomainAffinity,
  IngestStatus,
  Layer,
  Memory,
  MemoryDomain,
  Prospective,
  ProspectivePrediction,
} from "../types.js";

/** v0.5：前瞻条目可变字段（reflect 修正 / 命中更新）。 */
export interface ProspectivePatch {
  projection?: string;
  confidence?: number;
  prediction_log?: ProspectivePrediction[];
  retrievability?: number;
  last_verified_at?: string;
  last_accessed?: string;
}

/**
 * v0.3 队列行（仅 storage 内部 + queue.ts 使用）。
 */
export interface IngestQueueRow {
  id: string;
  tenant_id: string;
  user_id: string;
  archival_id: string;
  scope: string;
  content: string;
  scenario_json: string | null;
  origin_agent: string | null;
  content_date: string | null;
  perspectives_json: string | null;
  status: IngestStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  derived_count: number | null;
}

export interface SearchFilter {
  /** v0.2：是否包含 sensitive 记录；默认 false。 */
  includeSensitive?: boolean;
  /** v0.4：仅返回 sensitive=true（默认 false；与 includeSensitive 独立）。 */
  sensitiveOnly?: boolean;
  /** v0.4：是否包含 cold 记录。默认 false。archival 永不 cold，不受此影响。 */
  includeCold?: boolean;
  /** v0.6（RFC 0007/0008）：是否包含已失效记录（belief_state != 'active'）。默认 false。 */
  includeInvalidated?: boolean;
}

/** v0.4：批量 decay scan 候选行（轻量字段，避免每行全量 rowToMemory）。 */
export interface DecayCandidate {
  id: string;
  layer: Layer;
  tenant_id: string;
  user_id: string;
  last_accessed: string;
  access_count: number;
  stability: number;
  sensitive: number;
  cold: number;
  cold_at: string | null;
  archival_protected: number;
}

export interface Storage {
  insert(tenantId: string, userId: string, memory: Memory): Memory;
  insertEmbedding(
    tenantId: string,
    userId: string,
    layer: Layer,
    recordId: string,
    embedding: Float32Array,
    modelId: string,
  ): void;
  list(
    tenantId: string,
    userId: string,
    layer: Layer,
    opts?: { scope?: string; limit?: number; offset?: number },
  ): Memory[];
  listAll(tenantId: string, userId: string): Memory[];
  get(tenantId: string, userId: string, layer: Layer, id: string): Memory | null;
  /** v0.3：跨 layer 查找；返回首个匹配。 */
  findById(
    tenantId: string,
    userId: string,
    id: string,
  ): Memory | null;
  searchFts(
    tenantId: string,
    userId: string,
    query: string,
    layers: Layer[],
    scope: string | string[] | undefined,
    topK: number,
    filter?: SearchFilter,
  ): Memory[];
  searchEmbedding(
    tenantId: string,
    userId: string,
    queryVec: Float32Array,
    layers: Layer[],
    scope: string | string[] | undefined,
    topK: number,
    filter?: SearchFilter,
  ): Array<{ memory: Memory; score: number }>;
  delete(tenantId: string, userId: string, layer: Layer, id: string): void;
  stats(tenantId: string, userId: string): {
    total: number;
    by_layer: Record<Layer, number>;
    by_scope: Record<string, number>;
  };

  // v0.3 新增 ----------------------------------------------------------------
  /** 更新 memory.entities（worker 抽完写回）。 */
  updateEntities(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    entities: string[],
  ): void;
  /** 更新 memory.related（去重 + 双向需调用方两次调用）。 */
  updateRelated(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    related: string[],
  ): void;
  /** 查 user 名下所有含某个 entity 的 memory（精确字符串 + scope filter）。 */
  findByEntity(
    tenantId: string,
    userId: string,
    entity: string,
    opts?: { scope?: string; topK?: number; excludeId?: string },
  ): Memory[];

  // 队列
  enqueueIngest(row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count">): IngestQueueRow;
  getQueueRow(id: string): IngestQueueRow | null;
  /** 取下一个 status='queued' 的（按 created_at 升序）。 */
  takeNextQueued(): IngestQueueRow | null;
  updateQueueStatus(
    id: string,
    patch: {
      status?: IngestStatus;
      attempts?: number;
      last_error?: string | null;
      completed_at?: string | null;
      derived_count?: number | null;
    },
  ): void;
  /** 启动时把 'analyzing' 重置为 'queued'（崩溃恢复）。 */
  resetStaleAnalyzing(): number;
  listPendingByUser(
    tenantId: string,
    userId: string,
  ): IngestQueueRow[];

  // v0.4 新增 ----------------------------------------------------------------
  /**
   * 命中后更新 last_accessed / access_count / stability。
   * archival 不应该走这里（archival_protected）。
   */
  touchAccess(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    nextStability: number,
  ): void;
  /** 列 decay-scan 用候选（跳过 archival_protected=1；按 last_accessed 升序）。 */
  listDecayCandidates(limit?: number): DecayCandidate[];
  /** 标 cold（含 cold_at）；仅非 archival_protected 才写入。 */
  markCold(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    coldAt: string,
  ): void;
  /** 取消 cold（用户主动 unmark）。 */
  clearCold(tenantId: string, userId: string, layer: Layer, id: string): void;
  /** 写入 decay 计算字段（retrievability / last_decay_at）。 */
  updateDecayMeta(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    retrievability: number,
    lastDecayAt: string,
  ): void;
  /** 列当前 user 的 cold 记录（含 archival 之外的所有层）。 */
  listColdByUser(tenantId: string, userId: string): Memory[];
  /**
   * 统计指定 user 在某 layer 中"已被纳入 reflect"的 episodic 数。
   * Reflect job 自动触发用：accumulated_episodic - consolidated_count >= threshold。
   * v0.4 实现：直接数所有 episodic 数；reflect 进度由 worker 用 reflectLastRunAt 记录。
   */
  countEpisodicSinceLastReflect(tenantId: string, userId: string, sinceIso: string | null): number;
  /** 取 user 最近 N 条 episodic（按 created_at 倒序）。 */
  listRecentEpisodic(tenantId: string, userId: string, limit: number): Memory[];
  /** 取 user 当前所有 personal_semantic（作为 reflect anchor）。 */
  listPersonalSemantic(tenantId: string, userId: string): Memory[];

  // v0.6（RFC 0007 §2.2 失效语义）-------------------------------------------
  /**
   * 标记一条 derived 记忆「失效」（世界变了，不再为真）：
   * belief_state='invalidated' + invalid_at；可选 expired_at（被新信念取代）
   * 与 correctedBy（回链推翻它的新记录，追加进 corrected_by）。
   * archival 永不失效（直接 no-op；schema trigger 亦会 ABORT 任何 UPDATE）。
   */
  markInvalidated(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    opts: { invalidAt: string; expiredAt?: string; correctedBy?: string },
  ): void;

  // v0.5 领域轴（RFC 0005）-----------------------------------------------------
  /** lazy 注入并返回 (tenant,user) 的 GLOBAL 共享层（幂等）。 */
  ensureGlobalDomain(tenantId: string, userId: string): Domain;
  /** 新建/覆盖一个领域（birth/split/merge/质心更新均走这里）。 */
  upsertDomain(tenantId: string, userId: string, domain: Domain): void;
  getDomain(tenantId: string, userId: string, id: string): Domain | null;
  /** 列领域；默认排除 cold（路由用），includeCold 取全集。 */
  listDomains(
    tenantId: string,
    userId: string,
    opts?: { includeCold?: boolean },
  ): Domain[];
  /** 覆盖式写一条记忆的领域归属（先删后插，幂等）。 */
  setMemoryDomains(
    tenantId: string,
    userId: string,
    memoryId: string,
    links: MemoryDomain[],
  ): void;
  /** 批量取一组记忆的领域归属（rerank 用，扁平返回）。 */
  getMemoryDomainsFor(
    tenantId: string,
    userId: string,
    memoryIds: string[],
  ): MemoryDomain[];
  /** 列某领域的成员 memory id（split/merge/质心重算用）。 */
  getDomainMemberIds(tenantId: string, userId: string, domainId: string): string[];
  /** 取某条记忆的 embedding（质心计算用）；无则 null。 */
  getEmbedding(tenantId: string, userId: string, recordId: string): Float32Array | null;
  /** 路由命中后更新 load_count / last_routed_at。 */
  touchDomainRouted(
    tenantId: string,
    userId: string,
    domainId: string,
    at: string,
  ): void;
  /** 列某领域的所有亲和边（L2 邻接 / merge 用）。 */
  listAffinities(
    tenantId: string,
    userId: string,
    domainId: string,
  ): DomainAffinity[];
  /** 累加/更新一条领域亲和边（无向，内部归一存 a<b）。 */
  upsertAffinity(
    tenantId: string,
    userId: string,
    domainA: string,
    domainB: string,
    affinityDelta: number,
    at: string,
  ): void;

  // v0.5 前瞻记忆（RFC 0006）---------------------------------------------------
  insertProspective(tenantId: string, userId: string, p: Prospective): Prospective;
  getProspective(tenantId: string, userId: string, id: string): Prospective | null;
  listProspective(
    tenantId: string,
    userId: string,
    opts?: { limit?: number; scope?: string },
  ): Prospective[];
  /** 全局 cue 匹配（不受领域路由约束）。有 queryVec → 向量，否则降级 FTS。 */
  searchProspectiveByCue(
    tenantId: string,
    userId: string,
    query: string,
    queryVec: Float32Array | null,
    topK: number,
  ): Array<{ prospective: Prospective; score: number }>;
  updateProspective(
    tenantId: string,
    userId: string,
    id: string,
    patch: ProspectivePatch,
  ): void;

  close(): void;
}
