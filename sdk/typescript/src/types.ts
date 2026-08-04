// types.ts — nemos SDK 公共类型集中地
//
// 类型大体对齐 spec/10-data-schema.md 与 spec/40-sdk-contract.md，但 v0.1
// 嵌入式 SDK 实施简化（详见 README §「Spec 对齐度」）。

export const LAYERS = [
  "archival",
  "episodic",
  "semantic",
  "personal_semantic",
  "procedural",
] as const;

export type Layer = (typeof LAYERS)[number];

export type DerivedLayer = Exclude<Layer, "archival">;

export type MemoryType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "claude-self"
  | "ai-propose";

/**
 * derived 置信度。
 *
 * v0.2：high / medium / conflict
 * v0.3：加入 low（仅单 perspective 看到、未走 doubleCheck）；
 * - high     → 多视角 ≥2 都看到，或 v0.2 doubleCheck high
 * - medium   → 仅 1 视角看到（v0.3 multi-perspective），或 v0.2 doubleCheck medium
 * - low      → v0.3 单视角 single-pass（保留兼容字段，但当前抽取路径不会主动产）
 * - conflict → 多视角对同一事实矛盾（或 v0.2 doubleCheck conflict）
 */
export type Confidence = "high" | "medium" | "low" | "conflict";

/** v0.3：抽取视角名。 */
export type Perspective =
  | "fact"
  | "emotion"
  | "method"
  | "decision"
  | "temporal";

export type SourceKind = "authoritative" | "derived";

export type OwnershipKind = "self" | "relational" | "public";

export type Extractor =
  | "user_typed"
  | "ocr"
  | "asr"
  | "llm_summary"
  | "llm_inference"
  | "deterministic_normalizer"
  | "agent_observation"
  | "sensor";

export interface MemorySource {
  /** 与 spec source.kind 对齐；authoritative 等价 kind=="authoritative" */
  authoritative: boolean;
  kind: SourceKind;
  /** 写入来源（"user-upload" / agent id / "llm-extract" / "llm-merged"） */
  origin: string;
  /** 0 = 用户直接输入；>=1 = 经 N 次 LLM 转述 */
  chain_depth: number;
  /** 双 pass 校验时填 1|2，单 pass 为 undefined */
  pass_count?: number;
  /** 置信度（v0.2: 3 档；v0.3: 4 档） */
  confidence?: Confidence;
  /** 抽取器类型，便于审计 */
  extractor?: Extractor;
  /** 发起调用的 agent，便于跨产品记账 */
  origin_agent?: string;

  // v0.3 新增 -----------------------------------------------------------------
  /**
   * 该 derived 出现在哪些 perspective 抽取里。
   * length>=2 → confidence='high'；==1 → 'medium'；冲突 → 'conflict'。
   * v0.2 doubleCheck 路径不写此字段。
   */
  perspectives?: Perspective[];
  /** 视角间冲突标记（content 内括号注明两种说法）。 */
  perspectives_conflict?: boolean;
}

export interface MemoryArousal {
  value: number; // 0..1
  signal_sources: string[];
}

export interface MemorySurprise {
  value: number; // 0..1（v0.1 用归一化值；spec 是 bits）
  basis: string;
}

export interface MemoryOwnership {
  kind: OwnershipKind;
  consent_status?: "implicit" | "explicit" | "pending" | "revoked";
}

/**
 * v0.6（RFC 0007）：一条记忆「不再活跃」的成因。undefined 等价 'active'。
 * 物化字段，单一真相源是事件流（RFC 0007 §3，后续接入）；此处仅为热路径索引缓存。
 */
export type BeliefState =
  | "active"
  | "invalidated"
  | "superseded"
  | "corrected"
  | "disputed"
  | "stale"
  | "hidden";

export type UtteranceMode =
  | "literal"
  | "roleplay"
  | "hypothetical"
  | "quoted"
  | "joke"
  | "uncertain";

export type Specificity = "global" | "contextual" | "temporary";

export type EvidenceCoverageState =
  | "unverified"
  | "direct"
  | "supported"
  | "corroborated";

export interface MemorySalience {
  score: number;
  signals: string[];
  algorithm_version: number;
  computed_at: string;
}
export type SubjectResolution = "resolved" | "provisional" | "ambiguous";
export type PredicateValueType = "string" | "string_set" | "entity" | "entity_set";

export interface PredicateDefinition {
  id: string;
  aliases: string[];
  value_type: PredicateValueType;
  single_valued: boolean;
  context_dimensions: string[];
  subject_kinds: Array<"user" | "agent" | "contact">;
  temporal_rule: "current" | "historical" | "timeless";
  normalization: "text" | "entity_ref" | "set";
}

export type MemoryOperationKind =
  | "ADD"
  | "CONFIRM"
  | "SUPERSEDE"
  | "INVALIDATE"
  | "DISPUTE"
  | "RESOLVE_DISPUTE"
  | "MERGE"
  | "IGNORE";

export interface MemoryOperation {
  id: string;
  tenant_id: string;
  user_id: string;
  space_id: string;
  claim_key: string | null;
  kind: MemoryOperationKind;
  subject_memory_ids: string[];
  source_event_id: string;
  reason: string;
  created_at: string;
}

export interface ProvenanceEdge {
  tenant_id: string;
  user_id: string;
  source_id: string;
  derived_id: string;
  relation: "extracted_from" | "consolidated_from" | "corrected_from";
  created_at: string;
}

export interface ClaimIndexEntry {
  tenant_id: string;
  user_id: string;
  space_id: string;
  claim_key: string;
  memory_id: string;
  layer: Layer;
  canonical_object_hash: string;
  event_seq: number;
  valid_from: string | null;
  trust_tier: number;
  status: BeliefState;
  updated_at: string;
}
export interface IdentityOperation {
  id: string;
  tenant_id: string;
  user_id: string;
  space_id: string;
  kind: "MERGE" | "SPLIT";
  subject_ids: string[];
  canonical_subject_id: string;
  reverses_operation_id?: string;
  created_at: string;
}

export interface CorrectionInput {
  content: string;
  object?: unknown;
  valid_from?: string;
}

/**
 * 单条 memory 记录。同时覆盖 5 层；type-specific 字段标 optional。
 * 字段命名采用 snake_case 以与 ECC v2 / nemos 文件级 markdown 兼容。
 */
export interface Memory {
  id: string;
  layer: Layer;
  /** 业务类型，与 layer 正交 */
  type: MemoryType;
  /** 用户原文（archival）/ 提取后的事实（derived） */
  content: string;
  /** "global" / "project:xxx" / "task:xxx" / "scope:work" */
  scope: string;

  source: MemorySource;
  arousal: MemoryArousal;
  surprise: MemorySurprise;
  ownership: MemoryOwnership;

  created_at: string; // ISO8601
  last_accessed: string;
  access_count: number;
  /** 简化版稳定性，spec 0.1 用 FSRS 完整模型，这里只是粗粒度浮点 */
  stability: number;
  schema_version: string;
  /** v0.7：原始事件=0，直接抽取=1，反思产物=2；自动派生不得超过 2。 */
  generation?: number;

  // v0.7.1：事实身份、规范化值与来源
  data_subject_ids?: string[];
  subject_id?: string;
  subject_resolution?: SubjectResolution;
  predicate?: string;
  context_dimensions?: Record<string, string>;
  object_json?: unknown;
  canonical_object_hash?: string;
  claim_key?: string;
  claim_key_version?: number;
  normalizer_version?: number;
  trust_tier?: number;
  utterance_mode?: UtteranceMode;
  specificity?: Specificity;
  source_event_ids?: string[];
  legacy_unstructured?: boolean;

  /** 持久化的长期显著性，用于稳定准入并解释保留原因。 */
  salience?: MemorySalience;
  /** 原始或派生记忆获得了多少独立来源支持。 */
  evidence_coverage?: EvidenceCoverageState;
  evidence_count?: number;

  /** spec day-1 必锁字段：派生 record 指回 archival */
  archival_ref?: string;

  /** 关系字段（双向链） */
  related?: string[];
  corrects?: string[];
  corrected_by?: string[];
  supersedes?: string;

  /** ECC v2 错误标注 */
  wrong_scope?: "always" | "context-specific";
  wrong_behavior?: string;

  /** 嵌入向量元数据（embedding 本体不放进 Memory，单独表存） */
  embedding_model_id?: string;

  // v0.2 新增 ---------------------------------------------------------------
  /**
   * 内容里事件实际发生的时间（ISO 8601；day 或 month 精度可接受）。
   * 与 created_at（ingest 落地的时间）区分。LLM 抽取不出来则不写。
   */
  event_at?: string;
  /** 敏感内容标记；默认 false。sensitive 记录默认不进 search 结果。 */
  sensitive?: boolean;
  /** 来自哪个 scenario profile（追溯用）。 */
  scenario?: string;

  // v0.3 新增 ---------------------------------------------------------------
  /**
   * 抽取出的 entity（人名 / 项目名 / 概念 / 工具），≤10 个。
   * 用于跨 memory linking。仅 worker 异步填充；同步 ingest 路径不主动抽。
   */
  entities?: string[];

  // v0.4 新增（FSRS decay） -------------------------------------------------
  /**
   * FSRS D 参数（0-1，难记度）。v0.4 schema 字段；公式 v0.5 启用。
   * 当前仅保留接口；当前实现不读不写。
   */
  difficulty?: number;
  /**
   * FSRS R 参数（0-1，遗忘曲线 retrievability）。每次 decay tick 计算并填。
   * R = exp(-Δt / S)，Δt = (now - last_accessed) days。
   */
  retrievability?: number;
  /** 上次 decay scan 的时间（ISO 8601）。 */
  last_decay_at?: string;
  /**
   * archival 永久 protected = true，永不衰减 / 永不被 reflect 修改 / 永不标 cold。
   * 仅 archival 持有；derived 该字段始终为 undefined。
   */
  archival_protected?: true;
  /**
   * 当前是否处于 cold 状态（R 低于阈值 + access_count==0 + 经过 dormancy 天数）。
   * cold 默认从 search 隐藏（archival 永不 cold）。
   */
  cold?: boolean;
  /** 进入 cold 状态的时间（ISO 8601）。 */
  cold_at?: string;

  // v0.4 新增（Reflect consolidation） --------------------------------------
  /**
   * 当此 derived 是 reflect job 产出时，记录被合并的源 episodic id 列表。
   * 反映"哪些经验沉淀出这条 semantic"。仅 semantic / personal_semantic 持有。
   */
  consolidated_from?: string[];
  /** Reflect job 写入的时间（ISO 8601）。 */
  consolidated_at?: string;

  // v0.6 新增（RFC 0007：双时间有效性与失效语义） ---------------------------
  /**
   * 世界轴·起：事实在世界中**开始为真**的时刻（ISO 8601）。
   * 泛化自 personal_semantic.valid_from，统一替代（event_at → valid_at 别名见 Step 2）。
   * 仅 derived 层持有；archival（原始字节）不参与双时间。存量/新记录默认回填 created_at。
   */
  valid_at?: string;
  /**
   * 世界轴·止：事实在世界中**停止为真**的时刻（ISO 8601）；undefined = 仍为真。
   * 由矛盾失效或用户设置；**不改 valid_at**。
   */
  invalid_at?: string;
  /**
   * 系统轴·止：此记录**被系统取代**的时刻（ISO 8601）；undefined = 当前信念。
   * 系统轴起点复用已有 created_at。
   */
  expired_at?: string;
  /**
   * 派生态（物化）：当前信念状态。undefined 视为 'active'。
   * 存在仅为让热路径 `WHERE belief_state='active'` 走索引。
   */
  belief_state?: BeliefState;
}

// ============================================================================
// Scenario profile（v0.2）
// ============================================================================

/**
 * 场景配置：让 SDK 在同一份内容上根据上下文调整层级偏好/抽取重点/隐私行为。
 *
 * 用法：
 * ```ts
 * await userMem.ingest(diaryText, { scenario: 'diary' });            // 内置
 * await userMem.ingest(symptomLog, { scenario: { promptAddendum, privacy:{sensitive:true} } });
 * ```
 */
export interface ScenarioProfile {
  /** 内置 profile 不必填；自定义建议填以便审计追溯。 */
  name?: string;

  /** 调用方已知的表达语境；用于阻止角色扮演/假设被升级成事实。 */
  utteranceMode?: UtteranceMode;

  /** 层级与信号加权（prompt 引导，非 hard 排序）。 */
  emphasis?: {
    /** 每层倾向权重；默认 1.0；>1.0 偏向。 */
    layers?: Partial<Record<DerivedLayer, number>>;
    /** 重点信号关键词（emotion/decision/pattern/...）。 */
    signals?: string[];
  };

  /** 显式排除（hard filter，分析后剔除）。 */
  exclude?: {
    layers?: DerivedLayer[];
  };

  /** 拼到 SYSTEM_PROMPT 末尾的额外指令。 */
  promptAddendum?: string;

  /** 时间感知。 */
  temporal?: {
    /** 启用 event_at 抽取；prompt 引导 LLM 输出 ISO 8601。 */
    extractEventDate?: boolean;
  };

  /** 隐私行为。 */
  privacy?: {
    /** 默认把所有 derived 标 sensitive=true。 */
    sensitive?: boolean;
    /** 默认 derived 不进 search 结果（archival 不受影响）。 */
    hideFromSearch?: boolean;
  };

  /** 长内容切段配置。 */
  chunking?: {
    /** 单段最大字符数（默认 8000）。 */
    maxChars?: number;
    /** 段间重叠字符数（默认 200）。 */
    overlap?: number;
  };
}

// ============================================================================
// 输入类型
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface IngestOptions {
  scope?: string;
  originAgent?: string;
  /** 只存 archival，跳过 LLM 抽取 */
  skipAnalysis?: boolean;
  /** 自由扩展，写入 Memory.metadata（保留接口；当前层不参与 query） */
  metadata?: Record<string, unknown>;

  // v0.2 新增
  /** 场景配置：string 引用内置 profile（'chat'/'doc-research'/...），object 自定义。 */
  scenario?: string | ScenarioProfile;
  /** 已知内容产生时间（ISO 8601），覆盖 LLM 自动抽取。 */
  contentDate?: string;

  // v0.3 新增 ---------------------------------------------------------------
  /**
   * 后台模式：archival 立即同步写入；derived/entity/linking 入队由 worker 异步跑。
   * 默认 false（沿用 v0.2 同步行为）。
   */
  background?: boolean;
}

export interface IngestResult {
  archival: Memory;
  derived: Memory[];
  verification_stats?: VerificationStats;
}

// ============================================================================
// v0.3 后台 ingest 队列
// ============================================================================

export type IngestStatus =
  | "queued"
  | "analyzing"
  | "completed"
  | "failed";

/**
 * background ingest 返回的句柄。archival 已同步写入；derived 后续异步产出。
 */
export interface IngestHandle {
  /** 队列任务 id（独立于 memory id）。 */
  id: string;
  /** 同步落地的 archival 记录。 */
  archival: Memory;
  /** 入队时的状态（通常是 'queued'）。 */
  status: IngestStatus;
  /** 入队时间。 */
  created_at: string;
}

/**
 * 查询某个 background ingest 的状态。
 */
export interface IngestStatusInfo {
  id: string;
  status: IngestStatus;
  attempts: number;
  derivedCount?: number;
  last_error?: string;
  created_at: string;
  /** 完成时间（status='completed' 时填）。 */
  completed_at?: string;
}

/**
 * Worker 配置。
 */
export interface WorkerConfig {
  /** 自动跑 worker（true：构造 Nemos 时启 setInterval）。默认 true。 */
  enabled?: boolean;
  /** 轮询间隔（ms）。默认 1000。 */
  pollIntervalMs?: number;
  /** 是否启用：调用方显式 manualWorker=true 时关 auto loop。 */
  manualWorker?: boolean;
  /** 最大重试次数（含首次），默认 3。 */
  maxAttempts?: number;
  /**
   * 启动崩溃恢复的租约窗口（ms）。默认 0 = 重置全部 analyzing（单实例语义）。
   * 多实例共库时应设为 > 单任务最长处理时长，避免启动时抢走兄弟实例在途任务。
   */
  analyzingLeaseMs?: number;
}

export interface VerificationStats {
  pass_a_count: number;
  pass_b_count: number;
  merged_count: number;
  high_confidence: number;
  medium_confidence: number;
  conflicts: number;
}

export interface WriteMemoryInput {
  layer: Layer;
  content: string;
  type?: MemoryType;
  scope?: string;
  source: Partial<MemorySource> & Pick<MemorySource, "authoritative" | "origin">;
  arousal?: Partial<MemoryArousal>;
  surprise?: Partial<MemorySurprise>;
  ownership?: Partial<MemoryOwnership>;
  archival_ref?: string;
  related?: string[];
  corrects?: string[];
  wrong_scope?: "always" | "context-specific";
  wrong_behavior?: string;
  subject?: string;
  predicate?: string;
  object?: unknown;
  contextDimensions?: Record<string, string>;
  validFrom?: string;
  trustTier?: number;
  utteranceMode?: UtteranceMode;
  specificity?: Specificity;
  eventAt?: string;
  sensitive?: boolean;
}

export interface SearchOptions {
  layers?: Layer[];
  /** 单 scope 过滤（精确匹配）。与 scopes 互斥：同时传时 scopes 优先。 */
  scope?: string;
  /**
   * 多 scope OR 过滤。常用于"项目记忆 + 全局记忆"同时命中：
   * `{ scopes: ["project:maolab", "global"] }`
   * 传空数组等价于不过滤。
   */
  scopes?: string[];
  topK?: number;
  /** 仅 high / 同时 high+medium */
  confidenceMin?: "high" | "medium";
  /** 仅返回 authoritative=true（用户陈述，不返回 derived） */
  authoritativeOnly?: boolean;
  /** v0.2：是否包含 sensitive 记录（默认 false）。 */
  includeSensitive?: boolean;
  /**
   * v0.3：开启 spreading activation。
   * 先用 vector/FTS 找种子集 → 沿 `related` 拓展 N 跳（默认 2 跳，每跳取前 5）。
   */
  spreadingActivation?: boolean;
  /**
   * v0.4：只返回 sensitive=true 的记录（与 includeSensitive 独立；默认 false）。
   * 用户主动想看自己 sensitive 集合时使用。
   */
  sensitiveOnly?: boolean;
  /**
   * v0.4：是否包含 cold 记录（默认 false）。archival 永不 cold，不受此影响。
   */
  includeCold?: boolean;
  /**
   * v0.6（RFC 0007/0008）：是否包含已失效记录（belief_state != 'active'，即
   * invalidated / superseded / corrected）。默认 false —— 检索默认只返回当前为真、
   * 当前采信的事实（「从不踩雷」）。设 true 取全集（审计 / 时间旅行）。
   */
  includeInvalidated?: boolean;
}

export type RecallIntent =
  | "current_fact"
  | "historical_fact"
  | "episode"
  | "procedure"
  | "general";

export type RecallChannel =
  | "claim"
  | "evidence"
  | "fts"
  | "embedding"
  | "entity"
  | "time"
  | "related"
  | "recent"
  | "domain";

export interface RecallTimeRange {
  from?: string;
  to?: string;
}

export interface QueryPlan {
  algorithm_version: string;
  query: string;
  intent: RecallIntent;
  layers: Layer[];
  scopes: string[];
  subject_ids: string[];
  predicates: string[];
  claim_keys: string[];
  entity_terms: string[];
  time_range?: RecallTimeRange;
  include_sensitive: boolean;
  include_historical: boolean;
  include_recent: boolean;
  include_related: boolean;
  include_evidence: boolean;
  max_candidates_per_channel: number;
  max_results: number;
  max_tokens: number;
}

export interface RecallOptions extends SearchOptions {
  subjectIds?: string[];
  predicates?: string[];
  claimKeys?: string[];
  entities?: string[];
  timeRange?: RecallTimeRange;
  includeHistorical?: boolean;
  includeRelated?: boolean;
  /** Use immutable user events as a bounded fallback when derived memories are insufficient. */
  includeEvidence?: boolean;
  maxCandidatesPerChannel?: number;
  maxResults?: number;
  maxTokens?: number;
  minScore?: number;
  /** Deterministic clock override for tests and replay. */
  now?: string;
}

export interface RecallReason {
  channel: RecallChannel;
  rank: number;
  contribution: number;
}

export interface RecallItem {
  memory: Memory;
  /** Query-focused projection used for packet budgeting and prompt context. */
  excerpt?: string;
  score: number;
  reasons: RecallReason[];
}

export interface RecallChannelTrace {
  channel: RecallChannel;
  candidate_count: number;
  elapsed_ms: number;
  error?: string;
}

export interface RecallRejection {
  memory_id: string;
  reason: string;
}

export interface RecallTrace {
  id: string;
  tenant_id: string;
  user_id: string;
  query: string;
  plan: QueryPlan;
  channels: RecallChannelTrace[];
  rejected: RecallRejection[];
  selected_memory_ids: string[];
  elapsed_ms: number;
  created_at: string;
}

export interface MemoryPacket {
  trace_id: string;
  query_plan: QueryPlan;
  items: RecallItem[];
  estimated_tokens: number;
  reliable: boolean;
  refusal_reason?: "empty_query" | "no_reliable_memory";
}
/** v0.4：getRelevantContext 输出格式。 */
export type ContextFormat = "flat" | "tiered" | "narrative";

export interface ContextOptions extends RecallOptions {
  /** 默认 true：返回拼好的 markdown */
  asMarkdown?: boolean;
  /** 粗略 token 限制（按 char/4 估算） */
  maxTokens?: number;
  /**
   * v0.4：markdown 形态。
   * - 'flat'（默认，v0.3 行为）：按 layer 分组的简单 bullet 列表
   * - 'tiered'：按层分组，标注 confidence + 中文层标签
   * - 'narrative'：调 LLM 合成自然段（未配 llm 时降级 tiered + warn）
   */
  format?: ContextFormat;
}

export interface ListOptions {
  scope?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryStats {
  total: number;
  by_layer: Record<Layer, number>;
  by_scope: Record<string, number>;
  schema_version: string;
}

// ============================================================================
// LLM provider
// ============================================================================

export interface LLMProvider {
  /** system + user → 文本（一般是 JSON 字符串） */
  chat(system: string, user: string): Promise<string>;
  /** provider 自描述（用于 audit / debug） */
  readonly name: string;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  readonly modelId: string;
  readonly dim: number;
}

// ============================================================================
// v0.5：领域轴（RFC 0005 — Domain Experts & Sparse Activation Routing）
// ============================================================================

/** 共享层 L0 的特殊领域 id：无条件注入，不参与路由打分。 */
export const GLOBAL_DOMAIN_ID = "GLOBAL";

export type DomainStatus = "hot" | "warm" | "cold";
export type DomainOrigin = "seed" | "emergent";

/** 领域 = embedding 锚点（质心）+ 层级位置，叠加在 5 层功能轴之上的正交索引。 */
export interface Domain {
  id: string;
  tenant_id: string;
  user_id: string;
  label: string;
  /** 质心向量；GLOBAL 共享层为 null（不参与路由打分）。 */
  prototype_vec: Float32Array | null;
  /** split 后子领域回指父；顶层 undefined。 */
  parent_id?: string;
  /** 层级深度，顶层 = 0。 */
  level: number;
  status: DomainStatus;
  origin: DomainOrigin;
  /** GLOBAL = true：无条件注入，路由跳过。 */
  always_on: boolean;
  /** 被路由命中次数。 */
  load_count: number;
  /** 领域级 retrievability（FSRS 粒度提升到领域）。 */
  retrievability: number;
  last_routed_at?: string;
  created_at: string;
  updated_at: string;
}

/** 记忆对领域的 soft membership（连续隶属度，可多归属）。 */
export interface MemoryDomain {
  memory_id: string;
  domain_id: string;
  membership_weight: number;
  is_primary: boolean;
}

/** 领域间亲和度（共激活 + 共边统计），驱动 L2 邻接与 merge。 */
export interface DomainAffinity {
  domain_a: string;
  domain_b: string;
  affinity: number;
  updated_at: string;
}

/** 路由结果：L1 主领域 + L2 邻接 + 置信 + 低置信回退标记。 */
export interface RouteResult {
  l1: string | null;
  l2: string[];
  confidence: number;
  /** 置信不足 → 退化为全局检索（逃生阀）。 */
  fallback: boolean;
}

/** 路由是单一职责模块，与 LLMProvider / EmbeddingProvider 同构。 */
export interface RouterProvider {
  route(
    query: string,
    queryVec: Float32Array | null,
    domains: Domain[],
  ): Promise<RouteResult>;
  readonly name: string;
}

// ============================================================================
// v0.5：时态轴 — 前瞻记忆（RFC 0006 — Prospective Memory）
// ============================================================================

/** 当前仅固化态落库；按需生成不持久。 */
export type ProspectiveStatus = "crystallized";

/** 历次「预测 vs 现实」对照。 */
export interface ProspectivePrediction {
  predicted_at: string;
  /** 命中时的 projection 快照。 */
  predicted: string;
  /** reflect 离线匹配到的现实事件；未匹配前 undefined（pending）。 */
  actual?: string;
  /** 预测误差（surprise 的第二身份）。 */
  surprise?: number;
  resolved: boolean;
}

/**
 * 前瞻记忆：面对某类情境「可能/应当如何行为与思考」的建构性模板。
 * 恒为 derived，永不进 personal_semantic（原则 1）。独立形态、专用表，可多归属。
 */
export interface Prospective {
  id: string;
  tenant_id: string;
  user_id: string;
  scope: string;
  /** 归属标注（可多归属）；仅供 reflect 归并，不作检索分区。 */
  domain_ids: string[];
  /** 「面对什么情境」——检索匹配的 key。 */
  cue: string;
  cue_vec?: Float32Array;
  /** 「可能/应当如何行为与思考」——内容，发散。 */
  projection: string;
  /** = f(证据量, 历史命中率)。 */
  confidence: number;
  /** 支撑它的回溯记忆 id（可追溯）。 */
  evidence_refs: string[];
  prediction_log: ProspectivePrediction[];
  /** 复用 FSRS：长期不触发/验证则衰减。 */
  retrievability: number;
  status: ProspectiveStatus;
  created_at: string;
  last_accessed: string;
  last_verified_at?: string;
}

// ============================================================================
// SDK config
// ============================================================================

export type StorageConfig =
  | { type: "sqlite"; path: string }
  | { type: "memory" }
  | { type: "remote"; endpoint: string; apiKey: string };

export type LLMConfig =
  | { provider: "anthropic"; apiKey: string; model?: string }
  | { provider: "openai"; apiKey: string; model?: string }
  | { provider: "zhipu"; apiKey: string; model?: string }
  | {
      provider: "custom";
      chat: (system: string, user: string) => Promise<string>;
      name?: string;
    };

export type EmbeddingConfig =
  | { provider: "openai"; apiKey: string; model?: string }
  | { provider: "zhipu"; apiKey: string; model?: string }
  | { provider: "none" } // 关闭 embedding，search 退化为 FTS
  | {
      provider: "custom";
      embed: (text: string) => Promise<Float32Array>;
      modelId: string;
      dim: number;
    };

/**
 * v0.5：路由器选型（RFC 0005 §5），随规模叠加演化。
 * - 'llm'：LLMRouter 保底，复用 config.llm。
 * - 'centroid'：CentroidRouter 纯数值 top-k（守 100ms）。
 * - 'custom'：调用方自带 RouterProvider。
 */
export type RouterConfig =
  | { provider: "llm" }
  | { provider: "centroid" }
  | {
      provider: "custom";
      route: (
        query: string,
        queryVec: Float32Array | null,
        domains: Domain[],
      ) => Promise<RouteResult>;
      name?: string;
    };

export interface NemosConfig {
  storage: StorageConfig;
  llm: LLMConfig;
  /** 默认 'none'。生产建议配 openai */
  embedding?: EmbeddingConfig;
  /** 默认 'global' */
  defaultScope?: string;
  /** 默认 'default'（spec day-1 多租户字段，自托管单租户用此） */
  tenantId?: string;
  features?: {
    /** 默认 true：双 pass + 校验抗 LLM 非确定性 */
    doubleCheck?: boolean;
    /** 默认 true：ingest 自动跑 analyzer */
    autoIngest?: boolean;
    /**
     * v0.3：多视角抽取。
     * - 不传 / undefined → 走 v0.2 doubleCheck 路径（兼容）
     * - 传数组（如 ['fact','method','decision']） → 走 v0.3 multi-perspective
     * 与 doubleCheck 互斥：同时传两个 truthy 值 → 构造 Nemos 时 throw。
     */
    perspectives?: Perspective[];
    /** v0.3：worker 在 derived 写完后自动跑 entity 抽取 + cross-memory linking。默认 true。 */
    autoLinking?: boolean;
    /** v0.3：跨 scope 自动连接（同 user 内）。默认 true。跨 user 永远不连。 */
    crossScopeLink?: boolean;
    /**
     * v0.4：FSRS decay 引擎。默认 enabled=false（向后兼容；v0.5 改 true）。
     * archival 永不衰减；跨 user namespace 永不互相 decay。
     */
    decay?: {
      /** 总开关。默认 false。 */
      enabled?: boolean;
      /** R < coldThreshold 时进入 cold 候选。默认 0.1。 */
      coldThreshold?: number;
      /** cold 标记后多少天 search 隐藏。默认 7。 */
      coldDormancyDays?: number;
      /** worker 跑 decay-scan 的间隔（ms）。默认 86_400_000（24h）。 */
      scanIntervalMs?: number;
      /** 每次访问命中后 stability *= 1.3，capped at 365 (天)。 */
      stabilityCapDays?: number;
    };
    /**
     * v0.4：Reflect consolidation。默认 enabled=false（向后兼容）。
     * 累积 ≥ autoTriggerThreshold 条新 episodic 后自动入 reflect 队列。
     * 跨 user namespace 永不互相 reflect。
     */
    reflect?: {
      /** 总开关。默认 false。 */
      enabled?: boolean;
      /** 累积多少条新 episodic 自动触发 reflect。默认 20。 */
      autoTriggerThreshold?: number;
      /** reflect 时是否把现有 personal_semantic 当 anchor 输入 LLM。默认 true。 */
      includePersonalSemantic?: boolean;
    };
    /**
     * v0.5：领域专家与稀疏激活路由（RFC 0005）。默认 enabled=false（向后兼容）。
     * 关闭时检索等价 v0.4 全局检索；存量记忆默认归 GLOBAL 单领域。
     */
    domains?: {
      /** 总开关。默认 false。 */
      enabled?: boolean;
      /** 路由器选型。默认 { provider: 'llm' }。 */
      router?: RouterConfig;
      /** top-1 置信 < 此值 → 全局回退（逃生阀）。默认 0.35。 */
      routeConfidenceThreshold?: number;
      /** L2 邻接领域最大数。默认 3。 */
      l2Max?: number;
      /** L3 跨域扩散每个 seed 的限额。默认 5。 */
      l3SpreadLimit?: number;
    };
    /**
     * v0.5：前瞻记忆与预测-验证闭环（RFC 0006）。默认 enabled=false。
     * 关闭时检索不含前瞻通道；开启后热路径只取固化前瞻，按需生成异步。
     */
    prospective?: {
      /** 总开关。默认 false。 */
      enabled?: boolean;
      /** 低于此 confidence 的前瞻不返回调用方。默认 0.4。 */
      minConfidence?: number;
      /** 是否允许 query 时按需 LLM 合成（异步固化供下次）。默认 false。 */
      onDemand?: boolean;
    };
    /**
     * v0.6（RFC 0007 §2.3 / RFC 0008 §5）：矛盾驱动自动失效。默认 enabled=false。
     * 开启后 reflect 离线检测到新事实与现有 personal_semantic 矛盾时，把被推翻的
     * 旧 personal_semantic 标 belief_state='invalidated'（守 I4：仅 personal_semantic
     * anchor，且只在 reflect 这条用户自述流上）。关闭时 reflect 仅标记冲突、不失效（v0.5 行为）。
     */
    invalidation?: {
      /** 总开关。默认 false。 */
      enabled?: boolean;
      /**
       * 矛盾候选检索方式。默认 'semantic'。
       * - 'lexical'：v1 字符 bigram Jaccard 粗筛（漏掉用词不同的属性替换矛盾）。
       * - 'semantic'：v2 embedding cosine 候选检索（捕捉语义相近但用词不同的矛盾，如 素食↔鱼素）。
       * 无 embedding provider 时 'semantic' 自动回退 'lexical'。
       */
      detector?: "lexical" | "semantic";
      /** 'semantic' 模式下送入 LLM 判矛盾的候选 anchor 上限。默认 50。 */
      candidateTopN?: number;
      /** 'semantic' 模式下候选最低 cosine 相似度（与任一近期 episodic）。默认 0.30。 */
      minCosine?: number;
    };
  };
  /** v0.3：worker 配置；不传 = 默认 long-running 模式。 */
  worker?: WorkerConfig;
  logger?: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void;
}

export const LIFECYCLE_ALGORITHM_VERSION = "0.7.1-alpha.1";
export const RECALL_ALGORITHM_VERSION = "0.7.5-alpha.17";

export type LifecycleStage = "append" | "extract" | "persist" | "link" | "schedule" | "complete";
export type LifecycleStageStatus = "running" | "completed" | "skipped" | "failed";

export interface EventMetadata {
  event_id: string;
  tenant_id: string;
  user_id: string;
  space_id: string;
  event_seq: number;
  generation: number;
  source_event_ids: string[];
  created_at: string;
}

export interface LifecycleStageRecord {
  event_id: string;
  stage: LifecycleStage;
  algorithm_version: string;
  idempotency_key: string;
  status: LifecycleStageStatus;
  generation: number;
  metadata_json: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_error: string | null;
}

export interface ReflectionState {
  tenant_id: string;
  user_id: string;
  space_id: string;
  last_event_seq: number;
  last_run_at: string | null;
  algorithm_version: string;
  lease_owner: string | null;
  lease_until: string | null;
  last_error: string | null;
}

export interface LifecycleStatusInfo {
  event: EventMetadata;
  stages: LifecycleStageRecord[];
  completed: boolean;
  failed: boolean;
}

export const SCHEMA_VERSION = "0.7";
/** v0.5 schema 字符串常量。 */
export const SCHEMA_VERSION_V05 = "0.5";
/** v0.4 schema 字符串常量。 */
export const SCHEMA_VERSION_V04 = "0.4";
/** v0.3 schema 字符串常量。 */
export const SCHEMA_VERSION_V03 = "0.3";
/** v0.2 schema 字符串常量。 */
export const SCHEMA_VERSION_V02 = "0.2";
/** v0.1 schema 字符串常量，schema migration / 历史 record 兼容用。 */
export const SCHEMA_VERSION_V01 = "0.1";
