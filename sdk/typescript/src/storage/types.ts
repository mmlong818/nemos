// storage/types.ts — Storage interface + 队列行 + 过滤器
//
// 这是公开类型来源。SqliteStorage / InMemoryStorage 都实现 Storage 接口。

import type {
  IngestStatus,
  Layer,
  Memory,
} from "../types.js";

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

  close(): void;
}
