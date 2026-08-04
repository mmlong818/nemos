// storage/sqlite-impl.ts — Storage 的 SQLite 实现（better-sqlite3）
//
// 设计要点：
// - 5 张表对应 5 层（archival / episodic / semantic / personal_semantic / procedural）
// - archival 表 schema 层强制 INSERT-only（trigger 拒绝 UPDATE/DELETE）
// - 每条记录都带 tenant_id + user_id 作 namespace 隔离
// - source / arousal / surprise / ownership 序列化为 JSON 子列
// - embedding 单独表 nemos_embeddings (record_id, layer, vector blob, model_id)
// - FTS5 虚表 nemos_fts 加速 BM25 search

import Database from "better-sqlite3";
import {
  LAYERS,
  type ClaimIndexEntry,
  type EventMetadata,
  type IngestStatus,
  type Layer,
  LIFECYCLE_ALGORITHM_VERSION,
  type LifecycleStage,
  type LifecycleStageRecord,
  type Memory,
  type MemoryOperation,
  type ProvenanceEdge,
  type IdentityOperation,
  type ReflectionState,
  type RecallTimeRange,
} from "../types.js";
import type { DecayCandidate, IngestQueueRow, SearchFilter, Storage } from "./types.js";
import { applyMigrations, tryLoadSqliteVec } from "./schema.js";
import {
  bufferToFloat32,
  cosineSimLocal,
  rowToMemory,
  sanitizeFtsQuery,
  type RowMemory,
} from "./row-mapper.js";
import { float32ToBuffer } from "../utils/vector.js";
import { ensureMemoryQualityMetadata } from "../salience.js";
import * as queueOps from "./queue-ops-sqlite.js";
import * as decayOps from "./decay-ops-sqlite.js";
import * as lifecycleOps from "./lifecycle-ops-sqlite.js";
import * as claimOps from "./claim-ops-sqlite.js";
import * as domainOps from "./domain-ops-sqlite.js";
import * as prospectiveOps from "./prospective-ops-sqlite.js";
import type {
  Domain,
  DomainAffinity,
  MemoryDomain,
  Prospective,
} from "../types.js";
import type { ProspectivePatch } from "./types.js";

export class SqliteStorage implements Storage {
  private readonly db: Database.Database;

  /** sqlite-vec 是否加载成功（true → searchEmbedding 走 SQL 侧余弦）。 */
  private readonly vecEnabled: boolean;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // 多写者时排队等锁而非立即抛 SQLITE_BUSY（多进程/多实例的前提）
    this.db.pragma("busy_timeout = 5000");
    this.vecEnabled = tryLoadSqliteVec(this.db);
    applyMigrations(this.db);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  insert(tenantId: string, userId: string, m: Memory): Memory {
    return this.transaction(() => this.insertInner(tenantId, userId, m));
  }

  /** insert 的三条语句（主表 + FTS + entity FTS）必须原子：崩溃中途会留下"写入成功但搜索不到"的半套数据。 */
  private insertInner(tenantId: string, userId: string, m: Memory): Memory {
    ensureMemoryQualityMetadata(m);
    const table = m.layer;
    // archival 自动 protected=true（hard rule：archival 永不衰减）
    const archivalProtected = m.layer === "archival" || m.archival_protected === true ? 1 : 0;
    if (archivalProtected) m.archival_protected = true;
    // v0.6（RFC 0007）：derived 默认 valid_at=created_at；archival 不参与双时间。
    if (m.layer !== "archival" && m.valid_at === undefined) m.valid_at = m.created_at;

    const stmt = this.db.prepare(`
      INSERT INTO ${table} (
        id, tenant_id, user_id, layer, type, scope, content,
        source_json, arousal_json, surprise_json, ownership_json,
        created_at, last_accessed, access_count, stability, schema_version, generation,
        archival_ref, related_json, corrects_json, corrected_by_json,
        supersedes, wrong_scope, wrong_behavior, embedding_model_id,
        event_at, sensitive, scenario, entities_json,
        difficulty, retrievability, last_decay_at, archival_protected,
        cold, cold_at, consolidated_from_json, consolidated_at,
        valid_at, invalid_at, expired_at, belief_state,
        data_subject_ids_json, subject_id, subject_resolution, predicate,
        context_dimensions_json, object_json, canonical_object_hash,
        claim_key, claim_key_version, normalizer_version, trust_tier,
        utterance_mode, specificity, source_event_ids_json, legacy_unstructured,
        salience_json, evidence_coverage, evidence_count
      ) VALUES (
        @id, @tenant_id, @user_id, @layer, @type, @scope, @content,
        @source_json, @arousal_json, @surprise_json, @ownership_json,
        @created_at, @last_accessed, @access_count, @stability, @schema_version, @generation,
        @archival_ref, @related_json, @corrects_json, @corrected_by_json,
        @supersedes, @wrong_scope, @wrong_behavior, @embedding_model_id,
        @event_at, @sensitive, @scenario, @entities_json,
        @difficulty, @retrievability, @last_decay_at, @archival_protected,
        @cold, @cold_at, @consolidated_from_json, @consolidated_at,
        @valid_at, @invalid_at, @expired_at, @belief_state,
        @data_subject_ids_json, @subject_id, @subject_resolution, @predicate,
        @context_dimensions_json, @object_json, @canonical_object_hash,
        @claim_key, @claim_key_version, @normalizer_version, @trust_tier,
        @utterance_mode, @specificity, @source_event_ids_json, @legacy_unstructured,
        @salience_json, @evidence_coverage, @evidence_count
      )
    `);
    stmt.run({
      id: m.id,
      tenant_id: tenantId,
      user_id: userId,
      layer: m.layer,
      type: m.type,
      scope: m.scope,
      content: m.content,
      source_json: JSON.stringify(m.source),
      arousal_json: JSON.stringify(m.arousal),
      surprise_json: JSON.stringify(m.surprise),
      ownership_json: JSON.stringify(m.ownership),
      created_at: m.created_at,
      last_accessed: m.last_accessed,
      access_count: m.access_count,
      stability: m.stability,
      schema_version: m.schema_version,
      generation: m.generation ?? (m.layer === "archival" ? 0 : 1),
      archival_ref: m.archival_ref ?? null,
      related_json: m.related ? JSON.stringify(m.related) : null,
      corrects_json: m.corrects ? JSON.stringify(m.corrects) : null,
      corrected_by_json: m.corrected_by ? JSON.stringify(m.corrected_by) : null,
      supersedes: m.supersedes ?? null,
      wrong_scope: m.wrong_scope ?? null,
      wrong_behavior: m.wrong_behavior ?? null,
      embedding_model_id: m.embedding_model_id ?? null,
      event_at: m.event_at ?? null,
      sensitive: m.sensitive ? 1 : 0,
      scenario: m.scenario ?? null,
      entities_json: m.entities && m.entities.length > 0 ? JSON.stringify(m.entities) : null,
      difficulty: typeof m.difficulty === "number" ? m.difficulty : null,
      retrievability: typeof m.retrievability === "number" ? m.retrievability : null,
      last_decay_at: m.last_decay_at ?? null,
      archival_protected: archivalProtected,
      cold: m.cold ? 1 : 0,
      cold_at: m.cold_at ?? null,
      consolidated_from_json:
        m.consolidated_from && m.consolidated_from.length > 0
          ? JSON.stringify(m.consolidated_from)
          : null,
      consolidated_at: m.consolidated_at ?? null,
      valid_at: m.valid_at ?? null,
      invalid_at: m.invalid_at ?? null,
      expired_at: m.expired_at ?? null,
      belief_state: m.belief_state ?? "active",
      data_subject_ids_json: m.data_subject_ids ? JSON.stringify(m.data_subject_ids) : null,
      subject_id: m.subject_id ?? null,
      subject_resolution: m.subject_resolution ?? null,
      predicate: m.predicate ?? null,
      context_dimensions_json: m.context_dimensions ? JSON.stringify(m.context_dimensions) : null,
      object_json: m.object_json !== undefined ? JSON.stringify(m.object_json) : null,
      canonical_object_hash: m.canonical_object_hash ?? null,
      claim_key: m.claim_key ?? null,
      claim_key_version: m.claim_key_version ?? null,
      normalizer_version: m.normalizer_version ?? null,
      trust_tier: m.trust_tier ?? null,
      utterance_mode: m.utterance_mode ?? null,
      specificity: m.specificity ?? null,
      source_event_ids_json: m.source_event_ids ? JSON.stringify(m.source_event_ids) : null,
      legacy_unstructured: m.legacy_unstructured ? 1 : 0,
      salience_json: m.salience ? JSON.stringify(m.salience) : null,
      evidence_coverage: m.evidence_coverage ?? null,
      evidence_count: m.evidence_count ?? 0,
    });

    // 同步写 FTS
    this.db
      .prepare(
        `INSERT INTO ${table}_fts (id, tenant_id, user_id, scope, content) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(m.id, tenantId, userId, m.scope, m.content);

    // entities 写入时同步写 entity FTS
    if (m.entities && m.entities.length > 0) {
      this.upsertEntityFts(tenantId, userId, m.layer, m.id, m.scope, m.entities);
    }

    return m;
  }

  private upsertEntityFts(
    tenantId: string,
    userId: string,
    layer: Layer,
    recordId: string,
    scope: string,
    entities: string[],
  ): void {
    // 先删旧 row
    this.db
      .prepare(`DELETE FROM nemos_entities_fts WHERE record_id = ? AND layer = ?`)
      .run(recordId, layer);
    if (entities.length === 0) return;
    const joined = entities.join(" ");
    this.db
      .prepare(
        `INSERT INTO nemos_entities_fts (record_id, layer, tenant_id, user_id, scope, entities)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(recordId, layer, tenantId, userId, scope, joined);
  }

  insertEmbedding(
    tenantId: string,
    userId: string,
    layer: Layer,
    recordId: string,
    embedding: Float32Array,
    modelId: string,
  ): void {
    // 取 record 的 scope（用于 search 时按 scope 过滤）
    const rec = this.db
      .prepare(`SELECT scope FROM ${layer} WHERE id = ? AND tenant_id = ? AND user_id = ?`)
      .get(recordId, tenantId, userId) as { scope?: string } | undefined;
    if (!rec) return;

    const buf = Buffer.from(
      embedding.buffer,
      embedding.byteOffset,
      embedding.byteLength,
    );
    this.db
      .prepare(
        `INSERT OR REPLACE INTO nemos_embeddings
         (record_id, layer, tenant_id, user_id, scope, model_id, dim, vector_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(recordId, layer, tenantId, userId, rec.scope, modelId, embedding.length, buf);
  }

  list(
    tenantId: string,
    userId: string,
    layer: Layer,
    opts: { scope?: string; limit?: number; offset?: number } = {},
  ): Memory[] {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    let sql = `SELECT * FROM ${layer} WHERE tenant_id = ? AND user_id = ?`;
    const params: unknown[] = [tenantId, userId];
    if (opts.scope) {
      sql += ` AND scope = ?`;
      params.push(opts.scope);
    }
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const rows = this.db.prepare(sql).all(...params) as RowMemory[];
    return rows.map(rowToMemory);
  }

  listAll(tenantId: string, userId: string): Memory[] {
    const out: Memory[] = [];
    for (const layer of LAYERS) {
      out.push(...this.list(tenantId, userId, layer, { limit: 1000 }));
    }
    return out;
  }

  get(tenantId: string, userId: string, layer: Layer, id: string): Memory | null {
    const row = this.db
      .prepare(`SELECT * FROM ${layer} WHERE id = ? AND tenant_id = ? AND user_id = ?`)
      .get(id, tenantId, userId) as RowMemory | undefined;
    return row ? rowToMemory(row) : null;
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
    const safeQuery = sanitizeFtsQuery(query);
    if (!safeQuery) return [];
    const out: Array<{ memory: Memory; rank: number }> = [];
    for (const layer of layers) {
      let sql = `
        SELECT m.*, fts.rank AS fts_rank
        FROM ${layer}_fts fts
        JOIN ${layer} m ON m.id = fts.id
        WHERE ${layer}_fts MATCH ?
          AND fts.tenant_id = ?
          AND fts.user_id = ?
      `;
      const params: unknown[] = [safeQuery, tenantId, userId];
      if (Array.isArray(scope) && scope.length > 0) {
        sql += ` AND fts.scope IN (${scope.map(() => "?").join(",")})`;
        params.push(...scope);
      } else if (typeof scope === "string") {
        sql += ` AND fts.scope = ?`;
        params.push(scope);
      }
      if (filter.sensitiveOnly) {
        sql += ` AND m.sensitive = 1`;
      } else if (!filter.includeSensitive) {
        sql += ` AND m.sensitive = 0`;
      }
      // v0.4：cold 过滤；archival 永不 cold（archival_protected=1）所以不影响
      if (!filter.includeCold) {
        sql += ` AND m.cold = 0`;
      }
      // v0.6（RFC 0007/0008）：默认只返回当前采信的事实（「从不踩雷」），
      // 隐藏 invalidated / superseded / corrected。走 idx_belief_* 索引。
      if (!filter.includeInvalidated) {
        sql += ` AND m.belief_state = 'active'`;
      }
      sql += ` ORDER BY fts.rank LIMIT ?`;
      params.push(topK);
      let rows: Array<RowMemory & { fts_rank: number }>;
      try {
        rows = this.db.prepare(sql).all(...params) as Array<RowMemory & { fts_rank: number }>;
      } catch {
        // FTS MATCH 语法异常时降级为 LIKE
        rows = [];
      }
      for (const row of rows) {
        out.push({ memory: rowToMemory(row), rank: row.fts_rank });
      }
    }
    out.sort((a, b) => a.rank - b.rank); // FTS rank 越小越相关
    return out.slice(0, topK).map((x) => x.memory);
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
    const scored = this.vecEnabled
      ? this.scanEmbeddingsSql(tenantId, userId, queryVec, layers, scope, topK)
      : this.scanEmbeddingsJs(tenantId, userId, queryVec, layers, scope);
    // 先按分数排，再 hydrate memory；hydrate 时按 sensitive 过滤后继续取直到 topK
    const out: Array<{ memory: Memory; score: number }> = [];
    for (const s of scored) {
      if (out.length >= topK) break;
      const mem = this.get(tenantId, userId, s.layer, s.record_id);
      if (!mem) continue;
      if (filter.sensitiveOnly && !mem.sensitive) continue;
      if (!filter.sensitiveOnly && !filter.includeSensitive && mem.sensitive) continue;
      if (!filter.includeCold && mem.cold) continue;
      // v0.6：默认隐藏已失效（rowToMemory 把 active 归一为 undefined）
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
    const matches: Array<{ memory: Memory; timestamp: string }> = [];
    const timeExpr = "COALESCE(event_at, valid_at, created_at)";
    for (const layer of layers) {
      let sql = `SELECT * FROM ${layer} WHERE tenant_id = ? AND user_id = ?`;
      const params: unknown[] = [tenantId, userId];
      sql = this.appendScopeFilter(sql, params, scope);
      if (filter.sensitiveOnly) {
        sql += " AND sensitive = 1";
      } else if (!filter.includeSensitive) {
        sql += " AND sensitive = 0";
      }
      if (!filter.includeCold) sql += " AND cold = 0";
      if (!filter.includeInvalidated) sql += " AND belief_state = 'active'";
      if (range.from) {
        sql += ` AND ${timeExpr} >= ?`;
        params.push(range.from);
      }
      if (range.to) {
        sql += ` AND ${timeExpr} <= ?`;
        params.push(range.to);
      }
      sql += ` ORDER BY ${timeExpr} DESC LIMIT ?`;
      params.push(topK);
      const rows = this.db.prepare(sql).all(...params) as RowMemory[];
      for (const row of rows) {
        const memory = rowToMemory(row);
        matches.push({ memory, timestamp: memory.event_at ?? memory.valid_at ?? memory.created_at });
      }
    }
    matches.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return matches.slice(0, topK).map((item) => item.memory);
  }
  /** scope 条件拼接（两条扫描路径共用）。 */
  private appendScopeFilter(
    sql: string,
    params: unknown[],
    scope: string | string[] | undefined,
  ): string {
    if (Array.isArray(scope) && scope.length > 0) {
      params.push(...scope);
      return sql + ` AND scope IN (${scope.map(() => "?").join(",")})`;
    }
    if (typeof scope === "string") {
      params.push(scope);
      return sql + ` AND scope = ?`;
    }
    return sql;
  }

  /**
   * SQL 侧余弦（sqlite-vec 可用时）：排序与截断都发生在 SQLite 内，
   * 不再把全表 embedding 反序列化进 JS。
   * - dim=? 守卫：vec_distance_cosine 对维度不一致会报错（模型切换后的混血库），
   *   与查询向量维度不同的记录直接不参与本次检索。
   * - LIMIT 取 topK 的 4 倍（下限 50）：hydrate 阶段还要过滤 sensitive/cold/invalidated，
   *   预留余量避免过滤后凑不满 topK。
   */
  private scanEmbeddingsSql(
    tenantId: string,
    userId: string,
    queryVec: Float32Array,
    layers: Layer[],
    scope: string | string[] | undefined,
    topK: number,
  ): Array<{ record_id: string; layer: Layer; score: number }> {
    let sql = `
      SELECT record_id, layer, vec_distance_cosine(vector_blob, ?) AS dist
      FROM nemos_embeddings
      WHERE tenant_id = ? AND user_id = ? AND dim = ?
        AND layer IN (${layers.map(() => "?").join(",")})
    `;
    const params: unknown[] = [
      float32ToBuffer(queryVec),
      tenantId,
      userId,
      queryVec.length,
      ...layers,
    ];
    sql = this.appendScopeFilter(sql, params, scope);
    sql += ` ORDER BY dist ASC LIMIT ?`;
    params.push(Math.max(topK * 4, 50));
    const rows = this.db.prepare(sql).all(...params) as Array<{
      record_id: string;
      layer: Layer;
      dist: number;
    }>;
    // cosine distance = 1 - cosine similarity
    return rows.map((r) => ({ record_id: r.record_id, layer: r.layer, score: 1 - r.dist }));
  }

  /** JS 兜底（sqlite-vec 不可用时）：全量拉取 + 本地余弦。O(N·D)/查询，仅适合个人量级（<10k）。 */
  private scanEmbeddingsJs(
    tenantId: string,
    userId: string,
    queryVec: Float32Array,
    layers: Layer[],
    scope: string | string[] | undefined,
  ): Array<{ record_id: string; layer: Layer; score: number }> {
    let sql = `
      SELECT record_id, layer, vector_blob, dim
      FROM nemos_embeddings
      WHERE tenant_id = ? AND user_id = ? AND layer IN (${layers.map(() => "?").join(",")})
    `;
    const params: unknown[] = [tenantId, userId, ...layers];
    sql = this.appendScopeFilter(sql, params, scope);
    const rows = this.db.prepare(sql).all(...params) as Array<{
      record_id: string;
      layer: Layer;
      vector_blob: Buffer;
      dim: number;
    }>;
    const scored = rows.map((row) => {
      const vec = bufferToFloat32(row.vector_blob);
      const score = cosineSimLocal(queryVec, vec);
      return { record_id: row.record_id, layer: row.layer, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  delete(tenantId: string, userId: string, layer: Layer, id: string): void {
    if (layer === "archival") {
      throw new Error(
        "[nemos] archival 不允许直接 delete（spec I3）。如需 GDPR burn，请用 forget() + 后续 v0.2 burn 接口",
      );
    }
    this.transaction(() => {
      this.db
        .prepare(`DELETE FROM ${layer} WHERE id = ? AND tenant_id = ? AND user_id = ?`)
        .run(id, tenantId, userId);
      this.db
        .prepare(`DELETE FROM ${layer}_fts WHERE id = ?`)
        .run(id);
      this.db
        .prepare(`DELETE FROM nemos_embeddings WHERE record_id = ? AND layer = ?`)
        .run(id, layer);
      this.db
        .prepare(`DELETE FROM nemos_entities_fts WHERE record_id = ? AND layer = ?`)
        .run(id, layer);
      this.db.prepare(`DELETE FROM nemos_claim_index WHERE tenant_id=? AND user_id=? AND memory_id=?`).run(tenantId, userId, id);
      this.db.prepare(`DELETE FROM nemos_provenance_edges WHERE tenant_id=? AND user_id=? AND (source_id=? OR derived_id=?)`).run(tenantId, userId, id, id);
    });
  }

  // v0.3 新增 ----------------------------------------------------------------
  findById(tenantId: string, userId: string, id: string): Memory | null {
    for (const layer of LAYERS) {
      const got = this.get(tenantId, userId, layer, id);
      if (got) return got;
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
    if (layer === "archival") {
      const row = this.db.prepare(`SELECT scope FROM archival WHERE id=? AND tenant_id=? AND user_id=?`)
        .get(id, tenantId, userId) as { scope?: string } | undefined;
      if (row?.scope !== undefined) this.upsertEntityFts(tenantId, userId, layer, id, row.scope, entities);
      return;
    }
    const json = entities.length > 0 ? JSON.stringify(entities) : null;
    const r = this.db
      .prepare(
        `UPDATE ${layer} SET entities_json = ? WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      )
      .run(json, id, tenantId, userId);
    if (r.changes === 0) return;
    // 取 scope 同步 FTS
    const row = this.db
      .prepare(`SELECT scope FROM ${layer} WHERE id = ?`)
      .get(id) as { scope?: string } | undefined;
    if (row?.scope !== undefined) {
      this.upsertEntityFts(tenantId, userId, layer, id, row.scope, entities);
    }
  }

  updateRelated(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    related: string[],
  ): void {
    const json = related.length > 0 ? JSON.stringify(related) : null;
    this.db
      .prepare(
        `UPDATE ${layer} SET related_json = ? WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      )
      .run(json, id, tenantId, userId);
  }

  findByEntity(
    tenantId: string,
    userId: string,
    entity: string,
    opts: { scope?: string; topK?: number; excludeId?: string } = {},
  ): Memory[] {
    const topK = opts.topK ?? 20;
    const safe = sanitizeFtsQuery(entity);
    if (!safe) return [];
    let sql = `
      SELECT record_id, layer
      FROM nemos_entities_fts
      WHERE nemos_entities_fts MATCH ?
        AND tenant_id = ?
        AND user_id = ?
    `;
    const params: unknown[] = [safe, tenantId, userId];
    if (opts.scope) {
      sql += ` AND scope = ?`;
      params.push(opts.scope);
    }
    sql += ` LIMIT ?`;
    params.push(topK);
    let rows: Array<{ record_id: string; layer: Layer }>;
    try {
      rows = this.db.prepare(sql).all(...params) as Array<{ record_id: string; layer: Layer }>;
    } catch {
      rows = [];
    }
    const out: Memory[] = [];
    for (const r of rows) {
      if (opts.excludeId && r.record_id === opts.excludeId) continue;
      const m = this.get(tenantId, userId, r.layer, r.record_id);
      if (m) out.push(m);
    }
    return out;
  }

  ensureEventMetadata(input: Omit<EventMetadata, "event_seq">): EventMetadata {
    return this.transaction(() => lifecycleOps.ensureEventMetadata(this.db, input));
  }
  getEventMetadata(eventId: string): EventMetadata | null {
    return lifecycleOps.getEventMetadata(this.db, eventId);
  }
  getLatestEventSeq(tenantId: string, userId: string, spaceId: string): number {
    return lifecycleOps.getLatestEventSeq(this.db, tenantId, userId, spaceId);
  }
  upsertLifecycleStage(record: LifecycleStageRecord): void {
    lifecycleOps.upsertLifecycleStage(this.db, record);
  }
  getLifecycleStage(eventId: string, stage: LifecycleStage, algorithmVersion: string): LifecycleStageRecord | null {
    return lifecycleOps.getLifecycleStage(this.db, eventId, stage, algorithmVersion);
  }
  listLifecycleStages(eventId: string): LifecycleStageRecord[] {
    return lifecycleOps.listLifecycleStages(this.db, eventId);
  }
  getReflectionState(tenantId: string, userId: string, spaceId: string): ReflectionState {
    return lifecycleOps.getReflectionState(this.db, tenantId, userId, spaceId, LIFECYCLE_ALGORITHM_VERSION);
  }
  tryAcquireReflectionLease(tenantId: string, userId: string, spaceId: string, owner: string, leaseUntil: string, now: string): boolean {
    return lifecycleOps.tryAcquireReflectionLease(this.db, tenantId, userId, spaceId, owner, leaseUntil, now, LIFECYCLE_ALGORITHM_VERSION);
  }
  updateReflectionState(state: ReflectionState): void {
    lifecycleOps.updateReflectionState(this.db, state);
  }
  // ============ Queue 操作（委托给 queueOps 模块） ============

  enqueueIngest(
    row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count" | "next_attempt_at">,
  ): IngestQueueRow {
    return queueOps.enqueueIngest(this.db, row);
  }

  getQueueRow(id: string): IngestQueueRow | null {
    return queueOps.getQueueRow(this.db, id);
  }

  takeNextQueued(now?: string): IngestQueueRow | null {
    return queueOps.takeNextQueued(this.db, now);
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
    queueOps.updateQueueStatus(this.db, id, patch);
  }

  resetStaleAnalyzing(leaseMs = 0): number {
    return queueOps.resetStaleAnalyzing(this.db, leaseMs);
  }

  listPendingByUser(tenantId: string, userId: string): IngestQueueRow[] {
    return queueOps.listPendingByUser(this.db, tenantId, userId);
  }

  // ============ v0.7.1：claim / provenance / identity ============
  listClaimEntries(tenantId: string, userId: string, spaceId: string, claimKey: string): ClaimIndexEntry[] {
    return claimOps.listClaimEntries(this.db, tenantId, userId, spaceId, claimKey);
  }
  upsertClaimEntry(entry: ClaimIndexEntry): void { claimOps.upsertClaimEntry(this.db, entry); }
  updateMemoryBeliefState(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    state: Memory["belief_state"],
    opts?: { invalidAt?: string; expiredAt?: string; correctedBy?: string; supersedes?: string },
  ): void { claimOps.updateMemoryBeliefState(this.db, tenantId, userId, layer, id, state, opts); }
  addMemorySourceEvent(tenantId: string, userId: string, layer: Layer, id: string, sourceEventId: string): void {
    claimOps.addMemorySourceEvent(this.db, tenantId, userId, layer, id, sourceEventId);
  }
  rekeyMemoryClaim(tenantId: string, userId: string, layer: Layer, id: string, claimKey: string): void {
    claimOps.rekeyMemoryClaim(this.db, tenantId, userId, layer, id, claimKey);
  }
  recordClaimKeyAlias(oldClaimKey: string, canonicalClaimKey: string, operationId: string, createdAt: string): void {
    claimOps.recordClaimKeyAlias(this.db, oldClaimKey, canonicalClaimKey, operationId, createdAt);
  }
  resolveCanonicalClaimKey(claimKey: string): string { return claimOps.resolveCanonicalClaimKey(this.db, claimKey); }
  insertMemoryOperation(operation: MemoryOperation): void { claimOps.insertMemoryOperation(this.db, operation); }
  listMemoryOperations(tenantId: string, userId: string, claimKey?: string): MemoryOperation[] {
    return claimOps.listMemoryOperations(this.db, tenantId, userId, claimKey);
  }
  insertProvenanceEdge(edge: ProvenanceEdge): void { claimOps.insertProvenanceEdge(this.db, edge); }
  listProvenanceFrom(tenantId: string, userId: string, sourceId: string): ProvenanceEdge[] {
    return claimOps.listProvenanceFrom(this.db, tenantId, userId, sourceId);
  }
  listProvenanceTo(tenantId: string, userId: string, derivedId: string): ProvenanceEdge[] {
    return claimOps.listProvenanceTo(this.db, tenantId, userId, derivedId);
  }
  resolveCanonicalSubject(tenantId: string, userId: string, spaceId: string, subjectId: string): string {
    return claimOps.resolveCanonicalSubject(this.db, tenantId, userId, spaceId, subjectId);
  }
  applyIdentityOperation(operation: IdentityOperation): void { claimOps.applyIdentityOperation(this.db, operation); }
  getIdentityOperation(tenantId: string, userId: string, operationId: string): IdentityOperation | null {
    return claimOps.getIdentityOperation(this.db, tenantId, userId, operationId);
  }
  // ============ v0.4：decay / reflect 支持（委托给 decayOps） ============

  touchAccess(tenantId: string, userId: string, layer: Layer, id: string, nextStability: number): void {
    decayOps.touchAccess(this.db, tenantId, userId, layer, id, nextStability);
  }
  listDecayCandidates(limit?: number): DecayCandidate[] {
    return decayOps.listDecayCandidates(this.db, limit);
  }
  markCold(tenantId: string, userId: string, layer: Layer, id: string, coldAt: string): void {
    decayOps.markCold(this.db, tenantId, userId, layer, id, coldAt);
  }
  clearCold(tenantId: string, userId: string, layer: Layer, id: string): void {
    decayOps.clearCold(this.db, tenantId, userId, layer, id);
  }
  updateDecayMeta(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    retrievability: number,
    lastDecayAt: string,
  ): void {
    decayOps.updateDecayMeta(this.db, tenantId, userId, layer, id, retrievability, lastDecayAt);
  }
  listColdByUser(tenantId: string, userId: string): Memory[] {
    return decayOps.listColdByUser(this.db, tenantId, userId);
  }
  countEpisodicSinceLastReflect(tenantId: string, userId: string, sinceIso: string | null): number {
    return decayOps.countEpisodicSinceLastReflect(this.db, tenantId, userId, sinceIso);
  }
  listRecentEpisodic(tenantId: string, userId: string, limit: number): Memory[] {
    return decayOps.listRecentEpisodic(this.db, tenantId, userId, limit);
  }
  listEpisodicByEventSeq(tenantId: string, userId: string, spaceId: string, afterSeq: number, upToSeq: number): Memory[] {
    return decayOps.listEpisodicByEventSeq(this.db, tenantId, userId, spaceId, afterSeq, upToSeq);
  }  listPersonalSemantic(tenantId: string, userId: string): Memory[] {
    return decayOps.listPersonalSemantic(this.db, tenantId, userId);
  }

  // v0.6（RFC 0007 §2.2）------------------------------------------------------
  markInvalidated(
    tenantId: string,
    userId: string,
    layer: Layer,
    id: string,
    opts: { invalidAt: string; expiredAt?: string; correctedBy?: string },
  ): void {
    if (layer === "archival") return; // archival 永不失效（trigger 亦会 ABORT）
    const row = this.db
      .prepare(
        `SELECT corrected_by_json FROM ${layer} WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      )
      .get(id, tenantId, userId) as { corrected_by_json: string | null } | undefined;
    if (!row) return;
    let correctedBy: string[] = [];
    if (row.corrected_by_json) {
      try {
        const arr = JSON.parse(row.corrected_by_json) as string[];
        if (Array.isArray(arr)) correctedBy = arr;
      } catch {
        // ignore malformed
      }
    }
    if (opts.correctedBy && !correctedBy.includes(opts.correctedBy)) {
      correctedBy.push(opts.correctedBy);
    }
    this.db
      .prepare(
        `UPDATE ${layer}
         SET belief_state = 'invalidated',
             invalid_at = ?,
             expired_at = COALESCE(?, expired_at),
             corrected_by_json = ?
         WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      )
      .run(
        opts.invalidAt,
        opts.expiredAt ?? null,
        correctedBy.length > 0 ? JSON.stringify(correctedBy) : null,
        id,
        tenantId,
        userId,
      );
    this.db.prepare(`UPDATE nemos_claim_index SET status='invalidated',updated_at=?
      WHERE tenant_id=? AND user_id=? AND memory_id=?`).run(opts.invalidAt, tenantId, userId, id);
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
      const rows = this.db
        .prepare(
          `SELECT scope, COUNT(*) as c FROM ${layer} WHERE tenant_id = ? AND user_id = ? GROUP BY scope`,
        )
        .all(tenantId, userId) as Array<{ scope: string; c: number }>;
      for (const r of rows) {
        byLayer[layer] += r.c;
        byScope[r.scope] = (byScope[r.scope] || 0) + r.c;
        total += r.c;
      }
    }
    return { total, by_layer: byLayer, by_scope: byScope };
  }

  // v0.5 领域轴 ---------------------------------------------------------------
  ensureGlobalDomain(tenantId: string, userId: string): Domain {
    return domainOps.ensureGlobalDomain(this.db, tenantId, userId);
  }
  upsertDomain(tenantId: string, userId: string, domain: Domain): void {
    domainOps.upsertDomain(this.db, tenantId, userId, domain);
  }
  getDomain(tenantId: string, userId: string, id: string): Domain | null {
    return domainOps.getDomain(this.db, tenantId, userId, id);
  }
  listDomains(tenantId: string, userId: string, opts?: { includeCold?: boolean }): Domain[] {
    return domainOps.listDomains(this.db, tenantId, userId, opts);
  }
  setMemoryDomains(
    tenantId: string,
    userId: string,
    memoryId: string,
    links: MemoryDomain[],
  ): void {
    domainOps.setMemoryDomains(this.db, tenantId, userId, memoryId, links);
  }
  getMemoryDomainsFor(tenantId: string, userId: string, memoryIds: string[]): MemoryDomain[] {
    return domainOps.getMemoryDomainsFor(this.db, tenantId, userId, memoryIds);
  }
  getDomainMemberIds(tenantId: string, userId: string, domainId: string): string[] {
    return domainOps.getDomainMemberIds(this.db, tenantId, userId, domainId);
  }
  getEmbedding(tenantId: string, userId: string, recordId: string): Float32Array | null {
    return domainOps.getEmbedding(this.db, tenantId, userId, recordId);
  }
  touchDomainRouted(tenantId: string, userId: string, domainId: string, at: string): void {
    domainOps.touchDomainRouted(this.db, tenantId, userId, domainId, at);
  }
  listAffinities(tenantId: string, userId: string, domainId: string): DomainAffinity[] {
    return domainOps.listAffinities(this.db, tenantId, userId, domainId);
  }
  upsertAffinity(
    tenantId: string,
    userId: string,
    domainA: string,
    domainB: string,
    affinityDelta: number,
    at: string,
  ): void {
    domainOps.upsertAffinity(this.db, tenantId, userId, domainA, domainB, affinityDelta, at);
  }

  // v0.5 前瞻记忆 -------------------------------------------------------------
  insertProspective(tenantId: string, userId: string, p: Prospective): Prospective {
    return prospectiveOps.insertProspective(this.db, tenantId, userId, p);
  }
  getProspective(tenantId: string, userId: string, id: string): Prospective | null {
    return prospectiveOps.getProspective(this.db, tenantId, userId, id);
  }
  listProspective(
    tenantId: string,
    userId: string,
    opts?: { limit?: number; scope?: string },
  ): Prospective[] {
    return prospectiveOps.listProspective(this.db, tenantId, userId, opts);
  }
  searchProspectiveByCue(
    tenantId: string,
    userId: string,
    query: string,
    queryVec: Float32Array | null,
    topK: number,
  ): Array<{ prospective: Prospective; score: number }> {
    return prospectiveOps.searchProspectiveByCue(this.db, tenantId, userId, query, queryVec, topK);
  }
  updateProspective(
    tenantId: string,
    userId: string,
    id: string,
    patch: ProspectivePatch,
  ): void {
    prospectiveOps.updateProspective(this.db, tenantId, userId, id, patch);
  }

  close(): void {
    this.db.close();
  }
}
