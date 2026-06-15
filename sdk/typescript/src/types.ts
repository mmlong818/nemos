// types.ts — mnemos SDK 公共类型集中地
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
 * 单条 memory 记录。同时覆盖 5 层；type-specific 字段标 optional。
 * 字段命名采用 snake_case 以与 ECC v2 / mnemos 文件级 markdown 兼容。
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
  /** 自动跑 worker（true：构造 Mnemos 时启 setInterval）。默认 true。 */
  enabled?: boolean;
  /** 轮询间隔（ms）。默认 1000。 */
  pollIntervalMs?: number;
  /** 是否启用：朋友显式 manualWorker=true 时关 auto loop。 */
  manualWorker?: boolean;
  /** 最大重试次数（含首次），默认 3。 */
  maxAttempts?: number;
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
}

/** v0.4：getRelevantContext 输出格式。 */
export type ContextFormat = "flat" | "tiered" | "narrative";

export interface ContextOptions extends SearchOptions {
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

export interface MnemosConfig {
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
     * 与 doubleCheck 互斥：同时传两个 truthy 值 → 构造 Mnemos 时 throw。
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
  };
  /** v0.3：worker 配置；不传 = 默认 long-running 模式。 */
  worker?: WorkerConfig;
  logger?: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void;
}

export const SCHEMA_VERSION = "0.4";
/** v0.3 schema 字符串常量。 */
export const SCHEMA_VERSION_V03 = "0.3";
/** v0.2 schema 字符串常量。 */
export const SCHEMA_VERSION_V02 = "0.2";
/** v0.1 schema 字符串常量，schema migration / 历史 record 兼容用。 */
export const SCHEMA_VERSION_V01 = "0.1";
