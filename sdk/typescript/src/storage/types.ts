// storage/types.ts — Storage interface + 队列行 + 过滤器
//
// 这是公开类型来源。SqliteStorage / InMemoryStorage 都实现 Storage 接口。

import type {
  ClaimIndexEntry,
  Domain,
  DomainAffinity,
  EventMetadata,
  IngestStatus,
  Layer,
  LifecycleStage,
  LifecycleStageRecord,
  Memory,
  MemoryDomain,
  MemoryOperation,
  ProvenanceEdge,
  IdentityOperation,
  ReflectionState,
  Prospective,
  ProspectivePrediction,
  RecallTimeRange,
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
  next_attempt_at: string;
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
  /** decay 扫描游标：上次被 decay 检查的时刻；null = 从未检查（优先入选）。 */
  last_decay_at?: string | null;
}

export interface Storage {
  /**
   * 在单个事务里执行 fn（fn 必须是同步的——SQLite 事务不能跨 await）。
   * 抛异常时整体回滚；支持嵌套（内层走 savepoint）。
   * memory 实现无回滚语义（仅测试用），调用方不得依赖其原子性。
   */
  transaction<T>(fn: () => T): T;
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
  searchByTime(
    tenantId: string,
    userId: string,
    range: RecallTimeRange,
    layers: Layer[],
    scope: string | string[] | undefined,
    topK: number,
    filter?: SearchFilter,
  ): Memory[];
  delete(tenantId: string, userId: string, layer: Layer, id: string): void;
  stats(tenantId: string, userId: string): {
    total: number;
    by_layer: Record<Layer, number>;
    by_scope: Record<string, number>;
  };

  // v0.7 生命周期 --------------------------------------------------------------
  ensureEventMetadata(input: Omit<EventMetadata, "event_seq">): EventMetadata;
  getEventMetadata(eventId: string): EventMetadata | null;
  getLatestEventSeq(tenantId: string, userId: string, spaceId: string): number;
  upsertLifecycleStage(record: LifecycleStageRecord): void;
  getLifecycleStage(eventId: string, stage: LifecycleStage, algorithmVersion: string): LifecycleStageRecord | null;
  listLifecycleStages(eventId: string): LifecycleStageRecord[];
  getReflectionState(tenantId: string, userId: string, spaceId: string): ReflectionState;
  tryAcquireReflectionLease(tenantId: string, userId: string, spaceId: string, owner: string, leaseUntil: string, now: string): boolean;
  updateReflectionState(state: ReflectionState): void;
  // v0.7.1 事实收敛 -----------------------------------------------------------
  listClaimEntries(tenantId: string, userId: string, spaceId: string, claimKey: string): ClaimIndexEntry[];
  upsertClaimEntry(entry: ClaimIndexEntry): void;
  updateMemoryBeliefState(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    state: Memory["belief_state"],
    opts?: { invalidAt?: string; expiredAt?: string; correctedBy?: string; supersedes?: string },
  ): void;
  addMemorySourceEvent(tenantId: string, userId: string, layer: Layer, id: string, sourceEventId: string): void;
  rekeyMemoryClaim(tenantId: string, userId: string, layer: Layer, id: string, claimKey: string): void;
  recordClaimKeyAlias(oldClaimKey: string, canonicalClaimKey: string, operationId: string, createdAt: string): void;
  resolveCanonicalClaimKey(claimKey: string): string;
  insertMemoryOperation(operation: MemoryOperation): void;
  listMemoryOperations(tenantId: string, userId: string, claimKey?: string): MemoryOperation[];
  insertProvenanceEdge(edge: ProvenanceEdge): void;
  listProvenanceFrom(tenantId: string, userId: string, sourceId: string): ProvenanceEdge[];
  listProvenanceTo(tenantId: string, userId: string, derivedId: string): ProvenanceEdge[];
  resolveCanonicalSubject(tenantId: string, userId: string, spaceId: string, subjectId: string): string;
  applyIdentityOperation(operation: IdentityOperation): void;
  getIdentityOperation(tenantId: string, userId: string, operationId: string): IdentityOperation | null;
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
  enqueueIngest(row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count" | "next_attempt_at">): IngestQueueRow;
  getQueueRow(id: string): IngestQueueRow | null;
  /** 原子认领下一个 status='queued' 的任务（按 created_at 升序）：返回前已标为 analyzing。 */
  takeNextQueued(nowIso?: string): IngestQueueRow | null;
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
  ): void;
  /** 启动时把 'analyzing' 重置为 'queued'（崩溃恢复）。leaseMs>0 时仅重置 updated_at 早于租约窗口的行（多实例共库）。 */
  resetStaleAnalyzing(leaseMs?: number): number;
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
  /** v0.7：按原始事件序号读取确定反思区间。 */
  listEpisodicByEventSeq(tenantId: string, userId: string, spaceId: string, afterSeq: number, upToSeq: number): Memory[];
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
