// user-memory.ts — UserMemory class（每个 userId namespace 一份）

//
// 公开类，调用方通过 mem.forUser(userId) 拿到实例。

import { analyze, buildDerived } from "./analyzer.js";
import { ClaimService } from "./claim-service.js";
import { inferControlledAssertions } from "./claims.js";
import { RecallService, RecallTraceStore } from "./recall.js";
import { resolveScenario } from "./prompts.js";
import { DEFAULT_PERSPECTIVES } from "./perspectives.js";
import type { EmbeddingProvider } from "./types.js";
import {
  resolveDomainsConfig,
  resolveProspectiveConfig,
  rerankByActivation,
  buildProspectiveContext,
  type DomainsRuntimeConfig,
} from "./domains.js";
import { createRouter } from "./router.js";
import { reinforceStability } from "./decay.js";
import type { ReflectResult } from "./reflect.js";
import type { Storage } from "./storage.js";
import type { NemosWorker } from "./queue.js";
import type { LifecycleOrchestrator } from "./lifecycle.js";
import {
  LAYERS,
  SCHEMA_VERSION,
  type ContextOptions,
  type CorrectionInput,
  type IdentityOperation,
  type IngestHandle,
  type IngestOptions,
  type IngestResult,
  type IngestStatusInfo,
  type Layer,
  type ListOptions,
  type LLMProvider,
  type LogLevel,
  type Memory,
  type MemoryArousal,
  type MemoryOwnership,
  type MemoryOperation,
  type MemoryPacket,
  type MemorySource,
  type MemoryStats,
  type MemorySurprise,
  type NemosConfig,
  type Perspective,
  type RecallOptions,
  type RecallTrace,
  type RouteResult,
  type SearchOptions,
  type WriteMemoryInput,
} from "./types.js";
import {
  memoriesToMarkdown,
  memoriesToMarkdownNarrative,
  memoriesToMarkdownTiered,
} from "./utils/markdown.js";
import { exportJsonLd, exportMarkdown } from "./utils/export.js";
import {
  detectArousalSignals,
  estimateArousal,
  estimateSurprise,
} from "./utils/arousal.js";
import { newId, nowIso } from "./utils/id.js";

export class UserMemory {
  constructor(
    private readonly storage: Storage,
    private readonly llm: LLMProvider,
    private readonly embedding: EmbeddingProvider | null,
    private readonly tenantId: string,
    private readonly userId: string,
    private readonly config: NemosConfig & {
      defaultScope: string;
      tenantId: string;
    },
    private readonly log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
    private readonly worker: NemosWorker,
    private readonly lifecycle: LifecycleOrchestrator,
    private readonly recallTraces: RecallTraceStore,
  ) {}

  // ===========================================================================
  // 写入路径
  // ===========================================================================

  /**
   * 沉淀一段用户内容。默认行为：
   * 1. 创建 1 条 archival（不可变 raw 副本）
   * 2. LLM 抽取 N 条 derived 分到 episodic/semantic/personal_semantic/procedural
   * 3. 默认开双 pass + 校验抗 LLM 非确定性
   * 4. 自动算 embedding（若配了 embedding provider）
   *
   * options.skipAnalysis = true → 只存 archival，不跑 LLM。
   */
  async ingest(content: string, options?: IngestOptions): Promise<IngestResult>;
  async ingest(
    content: string,
    options: IngestOptions & { background: true },
  ): Promise<IngestHandle>;
  async ingest(
    content: string,
    options: IngestOptions = {},
  ): Promise<IngestResult | IngestHandle> {
    const scope = options.scope || this.config.defaultScope;
    const trimmed = (content || "").trim();
    if (!trimmed) throw new Error("[nemos] ingest content is empty");

    const profile = resolveScenario(options.scenario);
    const archival = this.buildArchivalOnly(trimmed, scope, options.originAgent);
    if (options.contentDate) archival.event_at = options.contentDate;
    if (profile?.privacy?.sensitive) archival.sensitive = true;
    if (profile?.name && profile.name !== "default") archival.scenario = profile.name;
    if (profile?.utteranceMode) archival.utterance_mode = profile.utteranceMode;
    this.lifecycle.appendEvent(this.tenantId, this.userId, archival);
    await this.maybeEmbed(archival);

    if (options.skipAnalysis === true) {
      this.lifecycle.markSkipped(archival.id);
      return { archival, derived: [] };
    }

    const perspectives = this.resolvePerspectives();
    if (options.background === true) {
      return this.worker.enqueue({
        tenantId: this.tenantId,
        userId: this.userId,
        archival,
        scope,
        content: trimmed,
        scenario: options.scenario,
        originAgent: options.originAgent,
        contentDate: options.contentDate,
        perspectives,
      });
    }

    const useVerify = perspectives === undefined && this.config.features?.doubleCheck !== false;
    let analyzed: Awaited<ReturnType<typeof analyze>>;
    try {
      analyzed = await analyze(trimmed, scope, this.llm, options.originAgent, {
        profile,
        contentDate: options.contentDate,
        doubleCheck: useVerify,
        perspectives,
      });
    } catch (error) {
      this.lifecycle.markFailure(archival.id, "extract", error);
      throw error;
    }
    const deterministicAllowed =
      !profile?.exclude?.layers?.includes("personal_semantic") &&
      (profile?.utteranceMode === undefined || profile.utteranceMode === "literal");
    const deterministic = deterministicAllowed
      ? inferControlledAssertions(trimmed).map((candidate) => buildDerived({
          layer: "personal_semantic",
          content: trimmed,
          type: "user",
          source: {
            authoritative: false,
            origin: "deterministic-controlled-claim",
            chain_depth: 1,
            extractor: "deterministic_normalizer",
          },
          subject: candidate.subject,
          predicate: candidate.predicate,
          object: candidate.object,
          context_dimensions: candidate.contextDimensions,
          utterance_mode: candidate.utteranceMode,
          specificity: candidate.specificity,
          trust_tier: candidate.trustTier,
          event_at: options.contentDate,
          valid_from: options.contentDate,
        }, scope, options.originAgent, archival.id, 1, profile))
      : [];
    const extracted = [
      ...deterministic,
      ...analyzed.derived.map((memory) => ({
        ...memory,
        archival_ref: archival.id,
        generation: 1,
        event_at: memory.event_at ?? options.contentDate,
      })),
    ];
    this.lifecycle.recordExtraction(archival.id, extracted);
    let persisted: Memory[];
    let hasConflict: boolean;
    try {
      ({ persisted, hasConflict } = await this.lifecycle.processDerived(
        this.tenantId,
        this.userId,
        archival.id,
        extracted,
      ));
    } catch (error) {
      this.lifecycle.markFailure(archival.id, "persist", error);
      throw error;
    }
    this.lifecycle.markScheduled(archival.id, { background: false });

    if (hasConflict && this.config.features?.reflect?.enabled) {
      void this.worker.runAutomaticReflectFor(this.tenantId, this.userId, scope).catch((error) => {
        this.log("warn", "[nemos] conflict reflect failed", {
          err: error instanceof Error ? error.message : String(error),
        });
      });
    } else {
      void this.worker.maybeAutoReflect(this.tenantId, this.userId, scope).catch((error) => {
        this.log("warn", "[nemos] auto reflect failed", {
          err: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return {
      archival,
      derived: persisted,
      verification_stats: analyzed.verification_stats,
    };
  }
  /** v0.3：拿当前 user 配置中的 perspectives；不显式启用 → undefined。 */
  private resolvePerspectives(): Perspective[] | undefined {
    const p = this.config.features?.perspectives;
    if (!Array.isArray(p)) return undefined;
    if (p.length === 0) return undefined;
    return p;
  }

  /** v0.3：查 background ingest 状态。 */
  async getIngestStatus(handleId: string): Promise<IngestStatusInfo | null> {
    const info = this.worker.getStatus(handleId);
    if (!info) return null;
    // 验证归属（防止跨 user 读）
    const row = this.storage.getQueueRow(handleId);
    if (!row) return null;
    if (row.tenant_id !== this.tenantId || row.user_id !== this.userId) return null;
    return info;
  }

  /** v0.3：列当前 user 的所有未完成 ingest（queued / analyzing / failed）。 */
  async listPendingIngests(): Promise<IngestStatusInfo[]> {
    return this.worker.listPending(this.tenantId, this.userId);
  }

  /** v0.3：默认开启的 perspectives 集合（调用方显式启用 features.perspectives=true 走默认）。 */
  static DEFAULT_PERSPECTIVES = DEFAULT_PERSPECTIVES;

  /**
   * 直接写一条 memory。绕过 LLM 分析。
   * 用途：上层应用已经分类好（e.g. 用户在 UI 上手动标 fact）。
   */
  async write(input: WriteMemoryInput): Promise<Memory> {
    if (!LAYERS.includes(input.layer)) {
      throw new Error(`[nemos] 无效 layer: ${input.layer}`);
    }
    if (input.layer === "archival" && input.source.authoritative !== true) {
      throw new Error(
        "[nemos] archival 必须 authoritative=true（spec I3）",
      );
    }
    // 硬约束：personal_semantic 拒绝 authoritative=true（spec I4）
    if (input.layer === "personal_semantic" && input.source.authoritative === true) {
      throw new Error(
        "[nemos] personal_semantic 不接受 authoritative=true 写入（spec I4）。" +
          "如需用户直接陈述偏好，请用 .ingest() 让 LLM 派生，或写到 episodic。",
      );
    }

    const scope = input.scope || this.config.defaultScope;
    const now = nowIso();
    const content = input.content.trim();
    if (!content) throw new Error("[nemos] write content is empty");

    const source: MemorySource = {
      authoritative: input.source.authoritative,
      kind: input.source.authoritative ? "authoritative" : "derived",
      origin: input.source.origin,
      chain_depth: input.source.chain_depth ?? (input.source.authoritative ? 0 : 1),
      extractor: input.source.extractor,
      origin_agent: input.source.origin_agent,
      pass_count: input.source.pass_count,
      confidence: input.source.confidence,
    };
    const arousal: MemoryArousal = {
      value:
        typeof input.arousal?.value === "number"
          ? input.arousal.value
          : estimateArousal(content),
      signal_sources:
        input.arousal?.signal_sources ?? detectArousalSignals(content),
    };
    const surprise: MemorySurprise = {
      value:
        typeof input.surprise?.value === "number"
          ? input.surprise.value
          : estimateSurprise(content),
      basis: input.surprise?.basis ?? "user-supplied",
    };
    const ownership: MemoryOwnership = {
      kind: input.ownership?.kind ?? "self",
      consent_status: input.ownership?.consent_status ?? "implicit",
    };

    const memory: Memory = {
      id: newId(input.layer),
      layer: input.layer,
      type: input.type ?? "user",
      scope,
      content,
      source,
      arousal,
      surprise,
      ownership,
      created_at: now,
      last_accessed: now,
      access_count: 0,
      stability: 1.0,
      schema_version: SCHEMA_VERSION,
      generation: input.layer === "archival" ? 0 : 1,
      archival_ref: input.archival_ref,
      related: input.related,
      corrects: input.corrects,
      wrong_scope: input.wrong_scope,
      wrong_behavior: input.wrong_behavior,
      subject_id: input.subject,
      predicate: input.predicate,
      object_json: input.object,
      context_dimensions: input.contextDimensions,
      valid_at: input.validFrom,
      trust_tier: input.trustTier,
      utterance_mode: input.utteranceMode,
      specificity: input.specificity,
      event_at: input.eventAt,
      sensitive: input.sensitive,
    };

    const structured = await this.lifecycle.appendStructuredMemory(this.tenantId, this.userId, memory);
    const hasConflict = structured.hasConflict;
    await this.maybeEmbed(structured.memory);
    if (hasConflict && this.config.features?.reflect?.enabled) {
      void this.worker.runAutomaticReflectFor(this.tenantId, this.userId, memory.scope).catch((error) => {
        this.log("warn", "[nemos] structured conflict reflect failed", {
          err: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return structured.memory;
  }

  // ===========================================================================
  // 读取路径
  // ===========================================================================

  /**
   * 语义搜索。若配了 embedding → 向量检索；否则降级为 FTS5 / LIKE 关键词。
   */
  /** Run the v0.7.2 multi-channel recall pipeline and retain an explainable trace. */
  async recall(query: string, options: RecallOptions = {}): Promise<MemoryPacket> {
    const service = new RecallService({
      storage: this.storage,
      embedding: this.embedding,
      tenantId: this.tenantId,
      userId: this.userId,
      defaultScope: this.config.defaultScope,
      rerank: async (value, memories, recallOptions) => {
        const domainsCfg = resolveDomainsConfig(this.config);
        if (!domainsCfg.enabled || memories.length === 0) return memories;
        return this.applyDomainActivation(value, memories, domainsCfg, recallOptions);
      },
    }, this.recallTraces);
    const packet = await service.recall(query, options);
    const decayCfg = this.worker.getDecayConfig();
    if (decayCfg.enabled) {
      for (const item of packet.items) {
        const memory = item.memory;
        if (memory.layer === "archival" || memory.archival_protected) continue;
        const stability = reinforceStability(memory.stability, decayCfg.stabilityCapDays);
        this.storage.touchAccess(this.tenantId, this.userId, memory.layer, memory.id, stability);
      }
    }
    if (!packet.reliable && query.trim() && !options.includeSensitive && !options.sensitiveOnly) {
      this.log("info", "[nemos] recall returned no reliable memory", { trace_id: packet.trace_id });
    }
    return packet;
  }

  async explainRecall(traceId: string): Promise<RecallTrace> {
    const service = new RecallService({
      storage: this.storage,
      embedding: this.embedding,
      tenantId: this.tenantId,
      userId: this.userId,
      defaultScope: this.config.defaultScope,
    }, this.recallTraces);
    return service.explain(traceId);
  }

  /** Backward-compatible simplified view over recall(). */
  async search(query: string, options: SearchOptions = {}): Promise<Memory[]> {
    const packet = await this.recall(query, {
      ...options,
      maxResults: options.topK,
      includeRelated: options.spreadingActivation === true,
    });
    return packet.items.map((item) => item.memory);
  }
  /**
   * v0.5：四级稀疏激活 rerank。路由 → 按领域归属重排（soft 降权不剔除）。
   * 逃生阀：fallback / 低置信 → 原样返回全局结果。失败不影响检索。
   */
  private async applyDomainActivation(
    query: string,
    results: Memory[],
    cfg: DomainsRuntimeConfig,
    options: SearchOptions = {},
  ): Promise<Memory[]> {
    try {
      this.storage.ensureGlobalDomain(this.tenantId, this.userId);
      const domains = this.storage.listDomains(this.tenantId, this.userId);
      let queryVec: Float32Array | null = null;
      if (this.embedding) {
        try {
          queryVec = await this.embedding.embed(query);
        } catch {
          queryVec = null;
        }
      }
      const router = createRouter(cfg.router ?? { provider: "llm" }, this.llm);
      const route = await router.route(query, queryVec, domains);
      if (route.fallback || route.confidence < cfg.routeConfidenceThreshold || !route.l1) {
        return results; // 逃生阀：隔离是优化不是牢笼
      }
      // L3 跨域扩散（RFC 0005 §4）：从命中 L1/L2 领域的结果出发，沿 cross-memory 边扩散
      // 一跳、每种子限额 l3SpreadLimit，把跨域关联记忆纳入。领域隔离只作用于路由层，
      // 绝不限制记忆间连接——这是保住"跨领域意外联想"的关键。扩散进来的记忆不属路由领域、
      // 在下面 rerank 里落到最低权重层（降权不剔除）。
      const augmented = this.spreadL3(results, route, cfg.l3SpreadLimit, options);

      const links = this.storage.getMemoryDomainsFor(
        this.tenantId,
        this.userId,
        augmented.map((m) => m.id),
      );
      const byMem = new Map<string, string[]>();
      for (const l of links) {
        const arr = byMem.get(l.memory_id) ?? [];
        arr.push(l.domain_id);
        byMem.set(l.memory_id, arr);
      }
      const reranked = rerankByActivation(
        augmented,
        route,
        (id) => byMem.get(id) ?? [],
        cfg.routeConfidenceThreshold,
      );
      const now = nowIso();
      this.storage.touchDomainRouted(this.tenantId, this.userId, route.l1, now);
      for (const d of route.l2) {
        this.storage.touchDomainRouted(this.tenantId, this.userId, d, now);
      }
      return reranked;
    } catch (e) {
      this.log("warn", "[nemos] 领域激活失败，退回全局结果", {
        err: e instanceof Error ? e.message : String(e),
      });
      return results;
    }
  }

  /**
   * L3 跨域扩散（RFC 0005 §4）：种子 = 命中路由领域(L1/L2)的结果；沿其 related 边取一跳，
   * 每种子最多 limit 条新记忆（跨域允许）。扩散进来的同样遵守可见性：默认隐藏失效/敏感/cold。
   * limit<=0 或无种子时不扩散。
   */
  private spreadL3(
    results: Memory[],
    route: RouteResult,
    limit: number,
    options: SearchOptions,
  ): Memory[] {
    if (limit <= 0) return results;
    const links = this.storage.getMemoryDomainsFor(
      this.tenantId,
      this.userId,
      results.map((m) => m.id),
    );
    const routed = new Set<string>([route.l1 as string, ...route.l2]);
    const inRouted = new Set<string>();
    for (const l of links) {
      if (routed.has(l.domain_id)) inRouted.add(l.memory_id);
    }
    const have = new Set(results.map((m) => m.id));
    const added: Memory[] = [];
    for (const seed of results) {
      if (!inRouted.has(seed.id)) continue; // 只从路由命中的种子扩散
      let take = 0;
      for (const rid of seed.related ?? []) {
        if (have.has(rid)) continue;
        const m = this.storage.findById(this.tenantId, this.userId, rid);
        if (!m) continue;
        if (!options.includeSensitive && m.sensitive) continue;
        if (!options.includeInvalidated && m.belief_state && m.belief_state !== "active") continue;
        if (!options.includeCold && m.cold) continue;
        have.add(rid);
        added.push(m);
        take++;
        if (take >= limit) break;
      }
    }
    return added.length > 0 ? [...results, ...added] : results;
  }

  /**
   * 取出与 query 相关的上下文，拼成 markdown 直接喂给 LLM prompt。
   * 这是调用方最常用的方法之一。
   */
  async getRelevantContext(query: string, options: ContextOptions = {}): Promise<string> {
    const packet = await this.recall(query, options);
    const memories = packet.items.map((item) =>
      item.excerpt ? { ...item.memory, content: item.excerpt } : item.memory,
    );
    // v0.5：前瞻通道（RFC 0006）——全局 cue 匹配，与领域路由并列、独立。
    const prospectiveLines = await this.collectProspective(query);
    const asMarkdown = options.asMarkdown !== false;
    if (!asMarkdown) {
      const body = memories.map((m) => m.content).join("\n\n");
      return prospectiveLines.length > 0
        ? `${prospectiveLines.join("\n")}\n\n${body}`
        : body;
    }
    const maxChars = options.maxTokens ? options.maxTokens * 4 : undefined;
    const format = options.format ?? "flat";
    let base: string;
    if (format === "tiered") {
      base = memoriesToMarkdownTiered(memories, maxChars);
    } else if (format === "narrative") {
      try {
        base = await memoriesToMarkdownNarrative(memories, this.llm, maxChars);
      } catch (e) {
        this.log("warn", "[nemos] narrative 合成失败，降级 tiered", {
          err: e instanceof Error ? e.message : String(e),
        });
        base = memoriesToMarkdownTiered(memories, maxChars);
      }
    } else {
      base = memoriesToMarkdown(memories, maxChars);
    }
    if (prospectiveLines.length === 0) return base;
    return `${prospectiveLines.join("\n")}\n\n${base}`;
  }

  /**
   * v0.5：收集命中的固化前瞻（RFC 0006）。全局 cue 匹配，不受领域路由约束。
   * 命中即记 pending（fire-and-forget，不阻塞热路径）。低置信不返回。
   */
  private async collectProspective(query: string): Promise<string[]> {
    const pcfg = resolveProspectiveConfig(this.config);
    if (!pcfg.enabled) return [];
    try {
      let queryVec: Float32Array | null = null;
      if (this.embedding) {
        try {
          queryVec = await this.embedding.embed(query);
        } catch {
          queryVec = null;
        }
      }
      const hits = this.storage.searchProspectiveByCue(
        this.tenantId,
        this.userId,
        query,
        queryVec,
        5,
      );
      const kept = hits.filter((h) => h.prospective.confidence >= pcfg.minConfidence);
      // fire-and-forget：给命中前瞻记 pending 预测（不 await，不阻塞返回）
      const now = nowIso();
      for (const h of kept) {
        const p = h.prospective;
        const log = [
          ...p.prediction_log,
          { predicted_at: now, predicted: p.projection, resolved: false },
        ];
        void Promise.resolve().then(() =>
          this.storage.updateProspective(this.tenantId, this.userId, p.id, {
            prediction_log: log,
            last_accessed: now,
          }),
        );
      }
      return buildProspectiveContext(kept, pcfg.minConfidence);
    } catch (e) {
      this.log("warn", "[nemos] 前瞻通道失败，跳过", {
        err: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  /**
   * 列出某 layer 的最近 N 条（按 created_at 倒序）。
   */
  async listByLayer(layer: Layer, options: ListOptions = {}): Promise<Memory[]> {
    return this.storage.list(this.tenantId, this.userId, layer, options);
  }

  // ===========================================================================
  // 元操作
  // ===========================================================================

  /**
   * 导出当前 user 的全部 memory。
   * - format='json-ld'：jsonld-lite 结构（与 spec §10 export schema 对齐）
   * - format='markdown'：每条带 frontmatter 的 md 拼接
   */
  async export(format: "json-ld" | "markdown" = "json-ld"): Promise<string> {
    const all = this.storage.listAll(this.tenantId, this.userId);
    if (format === "markdown") return exportMarkdown(all);
    return exportJsonLd(all, this.tenantId, this.userId);
  }

  /** Correct a structured assertion and retain an auditable operation record. */
  async correct(memoryId: string, correction: string | CorrectionInput): Promise<MemoryOperation> {
    return this.claimService().correct(memoryId, correction);
  }

  /** Invalidate an assertion without supplying a replacement value. */
  async invalidate(memoryId: string, reason: string): Promise<MemoryOperation> {
    return this.claimService().invalidate(memoryId, reason);
  }

  /** Resolve a disputed claim by selecting one of its existing assertions. */
  async resolveDispute(claimKey: string, winnerMemoryId: string): Promise<MemoryOperation> {
    return this.claimService().resolveDispute(claimKey, winnerMemoryId);
  }

  async listOperations(claimKey?: string): Promise<MemoryOperation[]> {
    return this.claimService().listOperations(claimKey);
  }

  /** Migrate a claim key while preserving an auditable alias. */
  async rekeyClaim(
    oldClaimKey: string,
    canonicalClaimKey: string,
    reason: string,
    scope = this.config.defaultScope,
  ): Promise<MemoryOperation> {
    return this.claimService().rekeyClaim(oldClaimKey, canonicalClaimKey, reason, scope);
  }

  /** Merge subject aliases and re-key the affected claims. */
  async mergeIdentity(
    subjectIds: string[],
    canonicalSubjectId: string,
    scope = this.config.defaultScope,
  ): Promise<IdentityOperation> {
    return this.claimService().mergeIdentity(subjectIds, canonicalSubjectId, scope);
  }

  /** Reverse a previous identity merge. */
  async splitIdentity(operationId: string): Promise<IdentityOperation> {
    return this.claimService().splitIdentity(operationId);
  }

  private claimService(): ClaimService {
    return new ClaimService({
      storage: this.storage,
      lifecycle: this.lifecycle,
      tenantId: this.tenantId,
      userId: this.userId,
      defaultScope: this.config.defaultScope,
      buildArchival: (content, scope) => this.buildArchivalOnly(content, scope, undefined),
      embed: (memory) => this.maybeEmbed(memory),
    });
  }
  /**
   * 软删除一条 memory（非 archival）。
   * archival 原始证据保持不可变；此接口只删除非 archival 记忆。
   */
  async forget(memoryId: string): Promise<void> {
    // 在所有非 archival layer 里找一遍
    for (const layer of LAYERS) {
      if (layer === "archival") continue;
      const got = this.storage.get(this.tenantId, this.userId, layer, memoryId);
      if (got) {
        this.storage.delete(this.tenantId, this.userId, layer, memoryId);
        return;
      }
    }
    throw new Error(`[nemos] memory not found (or is archival): ${memoryId}`);
  }

  async stats(): Promise<MemoryStats> {
    const s = this.storage.stats(this.tenantId, this.userId);
    return { ...s, schema_version: SCHEMA_VERSION };
  }

  // ===========================================================================
  // v0.4：Reflect / Decay 公开 API
  // ===========================================================================

  /**
   * v0.4：手动跑一次 reflect consolidation。
   * 读最近 N 条 episodic + 现有 personal_semantic，让 LLM 抽出可升 semantic 的 pattern。
   *
   * 不要求 features.reflect.enabled=true；这是「显式触发」入口。
   */
  async runReflect(): Promise<ReflectResult> {
    return this.worker.runReflectFor(this.tenantId, this.userId, this.config.defaultScope);
  }

  /**
   * v0.4：手动跑一次 decay scan（serverless / cron 友好）。
   * 仅当 features.decay.enabled=true 时才会真正扫描；否则返回 {0, 0}。
   */
  async runDecayScan(nowMs?: number): Promise<{ scanned: number; cooled: number }> {
    return this.worker.runDecayScanNow(nowMs);
  }

  /** v0.4：列当前 user 名下所有 cold 记录（archival 永不 cold）。 */
  async listCold(): Promise<Memory[]> {
    return this.storage.listColdByUser(this.tenantId, this.userId);
  }

  /** v0.4：取消 cold 标（用户主动「这条还有用」）。 */
  async clearCold(memoryId: string): Promise<void> {
    for (const layer of LAYERS) {
      if (layer === "archival") continue;
      const m = this.storage.get(this.tenantId, this.userId, layer, memoryId);
      if (m) {
        this.storage.clearCold(this.tenantId, this.userId, layer, memoryId);
        return;
      }
    }
    throw new Error(`[nemos] memory not found: ${memoryId}`);
  }

  // ===========================================================================
  // 私有
  // ===========================================================================

  private async maybeEmbed(m: Memory): Promise<void> {
    if (!this.embedding) return;
    try {
      const vec = await this.embedding.embed(m.content);
      this.storage.insertEmbedding(
        this.tenantId,
        this.userId,
        m.layer,
        m.id,
        vec,
        this.embedding.modelId,
      );
      m.embedding_model_id = this.embedding.modelId;
    } catch (e) {
      this.log("warn", "embedding 失败（不阻塞写入）", {
        id: m.id,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private buildArchivalOnly(
    content: string,
    scope: string,
    originAgent: string | undefined,
  ): Memory {
    const now = nowIso();
    return {
      id: newId("archival"),
      layer: "archival",
      type: "user",
      scope,
      content,
      source: {
        authoritative: true,
        kind: "authoritative",
        origin: originAgent ? `user-upload:${originAgent}` : "user-upload",
        chain_depth: 0,
        extractor: "user_typed",
        origin_agent: originAgent,
      },
      arousal: {
        value: estimateArousal(content),
        signal_sources: detectArousalSignals(content),
      },
      surprise: { value: 0, basis: "raw input baseline" },
      ownership: { kind: "self", consent_status: "implicit" },
      created_at: now,
      last_accessed: now,
      access_count: 0,
      stability: 1.0,
      schema_version: SCHEMA_VERSION,
      generation: 1,
    };
  }
}
