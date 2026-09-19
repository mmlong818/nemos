import type { CompanionModelInfo, CompanionModelProvider } from "./model-connection.js";

export const MODEL_CAPABILITIES = [
  "chat", "vision", "image_generation", "speech_to_text",
  "text_to_speech", "video_generation", "embedding",
] as const;
export type ModelCapability = typeof MODEL_CAPABILITIES[number];

/**
 * Application-level model consumers. This is the single product registry used
 * by persistence, API validation and the settings UI. Media types are model
 * capabilities, not applications, so they do not belong here.
 */
export const MODEL_APPLICATION_SCENES = [
  {
    id: "assistant_chat",
    name: "助理",
    description: "日常对话与即时协助。",
    capabilities: ["chat"],
    modelOverride: true,
    reasoningOverride: true,
    executionState: "wired",
    executionEntries: ["assistant.notify", "assistant.notifyStream"],
  },
  {
    id: "task_workspace",
    name: "任务工作区",
    description: "执行任务、团队协作与技能调用。",
    capabilities: ["chat"],
    modelOverride: true,
    reasoningOverride: true,
    executionState: "wired",
    executionEntries: ["task.notify", "task.notifyStream", "task.prepare"],
  },
  {
    id: "pantheon",
    name: "万神殿",
    description: "多种思维模型的讨论、质询与归纳。",
    capabilities: ["chat"],
    modelOverride: true,
    reasoningOverride: true,
    executionState: "wired",
    executionEntries: ["pantheon.debate"],
  },
  {
    id: "distillation",
    name: "思维蒸馏",
    description: "把人物、著作与方法整理为结构化思维单元。",
    capabilities: ["chat"],
    modelOverride: true,
    reasoningOverride: true,
    executionState: "wired",
    executionEntries: ["pantheon.distill"],
  },
] as const;
export type ModelScene = typeof MODEL_APPLICATION_SCENES[number]["id"];
export const MODEL_SCENES: readonly ModelScene[] = MODEL_APPLICATION_SCENES.map((scene) => scene.id);

export type ModelExecutionState = "available" | "integration_pending";
export type ModelExecutionAdapter = "openai-responses" | "openai-chat-completions" | "anthropic-messages" | "openai-audio-transcriptions" | "openai-audio-speech" | "openai-images-generations";

export interface CapabilityAdapterSupport {
  capability: ModelCapability;
  state: ModelExecutionState;
  adapters: ModelExecutionAdapter[];
  reason: string;
}

/**
 * Product execution truth. Provider marketing and a model-directory row never
 * make a capability executable: an adapter must be registered here and proven
 * through the same routed request path.
 */
export const CAPABILITY_ADAPTER_SUPPORT: Readonly<Record<ModelCapability, CapabilityAdapterSupport>> = Object.freeze({
  chat: { capability: "chat", state: "available", adapters: ["openai-responses", "openai-chat-completions", "anthropic-messages"], reason: "已接入文字对话执行器，并通过连接检查后使用。" },
  vision: { capability: "vision", state: "integration_pending", adapters: [], reason: "看图输入尚未接入统一消息与路由链。" },
  speech_to_text: { capability: "speech_to_text", state: "integration_pending", adapters: [], reason: "语音输入执行器尚未接入统一连接与验证。" },
  text_to_speech: { capability: "text_to_speech", state: "integration_pending", adapters: [], reason: "朗读执行器尚未接入统一连接与验证。" },
  image_generation: { capability: "image_generation", state: "integration_pending", adapters: [], reason: "图片生成执行器尚未接入统一连接与验证。" },
  video_generation: { capability: "video_generation", state: "integration_pending", adapters: [], reason: "视频生成执行器尚未接入统一连接与验证。" },
  embedding: { capability: "embedding", state: "integration_pending", adapters: [], reason: "向量模型尚未接入统一连接与路由。" },
});

export function capabilityAdapterSupport(capability: ModelCapability): CapabilityAdapterSupport {
  return CAPABILITY_ADAPTER_SUPPORT[capability];
}

const OPENAI_OFFICIAL_CAPABILITY_ADAPTERS: Partial<Record<ModelCapability, ModelExecutionAdapter>> = {
  chat: "openai-responses", vision: "openai-responses", speech_to_text: "openai-audio-transcriptions",
  text_to_speech: "openai-audio-speech", image_generation: "openai-images-generations",
};

/** Execution support is provider and exact-endpoint scoped. Compatible gateways start unknown. */
export function providerCapabilityAdapterSupport(provider: CompanionModelProvider, baseUrl: string, capability: ModelCapability): CapabilityAdapterSupport {
  if (provider === "openai" && normalizedEndpoint(baseUrl) === "https://api.openai.com/v1") {
    const adapter = OPENAI_OFFICIAL_CAPABILITY_ADAPTERS[capability];
    if (adapter) return { capability, state: "available", adapters: [adapter], reason: "OpenAI 官方端点已接入；需对当前账号和型号分别验证此能力。" };
  }
  return capabilityAdapterSupport(capability);
}
export interface ModelCapabilityEvidence {
  source: "explicit-check" | "provider-directory" | "maintained-runtime-catalog";
  updatedAt: string;
  verified: boolean;
  health?: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  costTier?: "low" | "standard" | "high";
  contextTokens?: number;
}
export interface ModelResource {
  connectionId: string;
  modelId: string;
  capabilities: ModelCapability[];
  evidence: ModelCapabilityEvidence;
  executionState?: Partial<Record<ModelCapability, ModelExecutionState>>;
  tags?: string[];
  reason?: string;
  displayName?: string;
  autoEligible?: boolean;
  /** Explicit local membership in this connection's usable model pool. */
  enabled?: boolean;
  lifecycle?: "active" | "retired";
  replacement?: string;
  curated?: boolean;
  /** Ephemeral evidence for a still-running pre-edit configuration. Never persisted or auto-routed. */
  runtimeSnapshot?: boolean;
  readOnly?: boolean;
}
export interface ModelResourceRef {
  connectionId: string;
  modelId: string;
  capability: ModelCapability;
}
export type CapabilityAssignment = { mode: "auto" } | { mode: "fixed"; ref: ModelResourceRef };
export interface CapabilityAssignments {
  system: Record<ModelCapability, CapabilityAssignment>;
  scenes: Record<ModelScene, Partial<Record<ModelCapability, CapabilityAssignment>>>;
}

const DEFAULT_ASSIGNMENT: CapabilityAssignment = Object.freeze({ mode: "auto" });
const SPECIALIZED_NON_CHAT = /(?:audio|realtime|transcrib|tts|whisper|image|dall-e|sora|embedding|moderation|codex|deep-research|search-preview|video)/i;
const OBSOLETE = /(?:^|[-_.])(deprecated|obsolete|legacy|unavailable|disabled)(?:$|[-_.])/i;

export interface CuratedModelEntry {
  exactId: string;
  tier: "primary" | "balanced" | "fast" | "compat";
  recommended: boolean;
  lifecycle: "active" | "retired";
  replacement?: string;
  capabilities: ModelCapability[];
  execution: { adapter: ModelExecutionAdapter; status: "wired" | "integration_pending" };
  requiresProbe: boolean;
  evidence: { sourceUrl: string; statement: string; retrievedAt: string };
}
export interface CuratedProviderCatalog {
  provider: Exclude<CompanionModelProvider, "custom">;
  officialEndpoints: string[];
  sourceUrl: string;
  models: CuratedModelEntry[];
}
export interface CuratedModelCatalog {
  schema: "clownfish.curated-model-catalog";
  catalogVersion: string;
  retrievedAt: string;
  expiresAt: string;
  providers: CuratedProviderCatalog[];
}

const RETRIEVED_AT = "2026-09-18";
const evidence = (sourceUrl: string, statement: string) => ({ sourceUrl, statement, retrievedAt: RETRIEVED_AT });
const curated = (exactId: string, tier: CuratedModelEntry["tier"], sourceUrl: string, adapter: CuratedModelEntry["execution"]["adapter"], options: Partial<CuratedModelEntry> = {}): CuratedModelEntry => ({
  exactId, tier, recommended: true, lifecycle: "active", capabilities: ["chat"], execution: { adapter, status: "wired" }, requiresProbe: true,
  evidence: evidence(sourceUrl, "官方模型资料与当前执行适配器共同限定此条目；仍需对当前账号做一次轻量验证。"), ...options,
});

export const CURATED_MODEL_CATALOG: CuratedModelCatalog = {
  schema: "clownfish.curated-model-catalog",
  catalogVersion: "2026-09-18.1",
  retrievedAt: RETRIEVED_AT,
  expiresAt: "2026-12-18",
  providers: [
    { provider: "zhipu", officialEndpoints: ["https://open.bigmodel.cn/api/paas/v4"], sourceUrl: "https://docs.bigmodel.cn/cn/guide/develop/openai/introduction", models: [
      curated("glm-5.3", "primary", "https://docs.bigmodel.cn/cn/guide/develop/openai/introduction", "openai-chat-completions"),
      curated("glm-5.3-flash", "fast", "https://docs.bigmodel.cn/llms.txt", "openai-chat-completions", { recommended: false, capabilities: ["vision"], execution: { adapter: "openai-chat-completions", status: "integration_pending" } }),
    ] },
    { provider: "openai", officialEndpoints: ["https://api.openai.com/v1"], sourceUrl: "https://developers.openai.com/api/docs/models", models: [
      curated("gpt-5.4", "primary", "https://developers.openai.com/api/docs/models", "openai-responses", { capabilities: ["chat", "vision"] }),
      curated("gpt-transcribe", "balanced", "https://developers.openai.com/api/docs/guides/speech-to-text", "openai-audio-transcriptions", { recommended: false, capabilities: ["speech_to_text"] }),
      curated("gpt-4o-mini-tts", "fast", "https://developers.openai.com/api/docs/guides/text-to-speech", "openai-audio-speech", { recommended: false, capabilities: ["text_to_speech"] }),
      curated("gpt-image-2.5-sunburst", "primary", "https://developers.openai.com/api/docs/guides/image-generation", "openai-images-generations", { recommended: false, capabilities: ["image_generation"] }),
      curated("gpt-image-2.5-flare", "fast", "https://developers.openai.com/api/docs/guides/image-generation", "openai-images-generations", { recommended: false, capabilities: ["image_generation"] }),
    ] },
    { provider: "anthropic", officialEndpoints: ["https://api.anthropic.com"], sourceUrl: "https://platform.claude.com/docs/en/models/overview", models: [
      curated("claude-opus-5", "primary", "https://platform.claude.com/docs/en/models/overview", "anthropic-messages"),
      curated("claude-sonnet-5", "balanced", "https://platform.claude.com/docs/en/models/overview", "anthropic-messages"),
      curated("claude-haiku-4-5-20251001", "fast", "https://platform.claude.com/docs/en/models/overview", "anthropic-messages"),
    ] },
    { provider: "deepseek", officialEndpoints: ["https://api.deepseek.com"], sourceUrl: "https://api-docs.deepseek.com/updates/", models: [
      curated("deepseek-flash", "primary", "https://api-docs.deepseek.com/updates/", "openai-chat-completions"),
      curated("deepseek-v4-flash", "compat", "https://api-docs.deepseek.com/updates/", "openai-chat-completions", { recommended: false, lifecycle: "retired", replacement: "deepseek-flash" }),
    ] },
    { provider: "qwen", officialEndpoints: ["https://dashscope.aliyuncs.com/compatible-mode/v1"], sourceUrl: "https://help.aliyun.com/zh/model-studio/text-generation-model", models: [
      curated("qwen3.8-max", "primary", "https://help.aliyun.com/zh/model-studio/text-generation-model", "openai-chat-completions"),
      curated("qwen3.8-flash", "fast", "https://help.aliyun.com/zh/model-studio/text-generation-model", "openai-chat-completions"),
      curated("qwen3.7-plus", "balanced", "https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions", "openai-chat-completions"),
    ] },
    { provider: "minimax", officialEndpoints: ["https://api.minimax.cn/v1"], sourceUrl: "https://platform.minimaxi.com/docs/guides/models-intro.md", models: [
      curated("MiniMax-M3", "primary", "https://platform.minimaxi.com/docs/guides/models-intro.md", "openai-chat-completions", { execution: { adapter: "openai-chat-completions", status: "integration_pending" } }),
    ] },
  ],
};

const KNOWN_ENDPOINTS: ReadonlyArray<{ provider: CompanionModelProvider; origin: string; path: string }> = [
  { provider: "zhipu", origin: "https://open.bigmodel.cn", path: "/api/paas/v4" },
  { provider: "openai", origin: "https://api.openai.com", path: "/v1" },
  { provider: "anthropic", origin: "https://api.anthropic.com", path: "" },
  { provider: "deepseek", origin: "https://api.deepseek.com", path: "" },
  { provider: "qwen", origin: "https://dashscope.aliyuncs.com", path: "/compatible-mode/v1" },
  { provider: "minimax", origin: "https://api.minimax.cn", path: "/v1" },
  { provider: "gemini", origin: "https://generativelanguage.googleapis.com", path: "/v1beta" },
  { provider: "volcengine", origin: "https://ark.cn-beijing.volces.com", path: "/api/v3" },
  { provider: "qwen", origin: "https://dashscope-intl.aliyuncs.com", path: "/api/v1" },
  { provider: "qwen", origin: "https://cn-hongkong.dashscope.aliyuncs.com", path: "/api/v1" },
  { provider: "vidu", origin: "https://api.vidu.com", path: "" },
  { provider: "pixverse", origin: "https://app-api.pixverse.ai", path: "/openapi/v2" },
  { provider: "hunyuan", origin: "https://vclm.tencentcloudapi.com", path: "" },
];

function normalizedEndpoint(baseUrl: string): string {
  try { const url = new URL(baseUrl); return `${url.origin}${url.pathname.replace(/\/+$/, "")}`; } catch { return ""; }
}

export function curatedProviderCatalog(provider: CompanionModelProvider, baseUrl: string): CuratedProviderCatalog | undefined {
  if (provider === "custom") return undefined;
  const endpoint = normalizedEndpoint(baseUrl);
  return CURATED_MODEL_CATALOG.providers.find((item) => item.provider === provider && item.officialEndpoints.includes(endpoint));
}

export function curatedModelEntry(provider: CompanionModelProvider, baseUrl: string, modelId: string): CuratedModelEntry | undefined {
  return curatedProviderCatalog(provider, baseUrl)?.models.find((item) => item.exactId === modelId);
}

export function eligibleCuratedCatalog(provider: CompanionModelProvider, baseUrl: string, now = Date.now()): CompanionModelInfo[] {
  if (now > Date.parse(`${CURATED_MODEL_CATALOG.expiresAt}T23:59:59.999Z`)) return [];
  return (curatedProviderCatalog(provider, baseUrl)?.models || [])
    .filter((item) => item.recommended && item.lifecycle === "active" && item.execution.status === "wired" && item.capabilities.includes("chat"))
    .sort((a, b) => ["primary", "balanced", "fast"].indexOf(a.tier) - ["primary", "balanced", "fast"].indexOf(b.tier))
    .map((item) => ({ id: item.exactId, displayName: item.exactId }));
}

export function planOnboardingModel(input: {
  provider: CompanionModelProvider;
  baseUrl: string;
  rawCatalog: readonly CompanionModelInfo[];
  requestedModel?: string;
  selectionMode?: "auto" | "manual";
}): { model: string; automatic: boolean; requiresUnlistedConfirmation: boolean } {
  const requested = String(input.requestedModel || "").trim();
  if (requested) {
    const entry = curatedModelEntry(input.provider, input.baseUrl, requested);
    if (entry?.lifecycle === "retired") throw new Error(`指定型号 ${requested} 已停止推荐${entry.replacement ? `；替代型号为 ${entry.replacement}` : ""}，不能新设为默认。`);
    const listed = input.rawCatalog.some((item) => item.id === requested);
    if (!listed) {
      const catalogCurrent = eligibleCuratedCatalog(input.provider, input.baseUrl).some((item) => item.id === requested);
      const confirmable = catalogCurrent && entry?.lifecycle === "active" && entry.execution.status === "wired" && entry.capabilities.includes("chat");
      if (!confirmable) throw new Error(`账号模型目录未发现指定型号 ${requested}，且它不在当前官方可执行短名单中；没有发送验证请求。`);
    }
    return { model: requested, automatic: false, requiresUnlistedConfirmation: !listed };
  }
  if (input.selectionMode !== "auto") throw new Error("未指定模型；只有选择自动模式时才会使用官方推荐型号。 ");
  const model = eligibleCuratedCatalog(input.provider, input.baseUrl)[0]?.id;
  if (!model) throw new Error("此端点没有处于有效期且已接入执行器的官方推荐文字模型；没有发送验证请求。 ");
  return { model, automatic: true, requiresUnlistedConfirmation: false };
}

export function detectCompanionProvider(baseUrl: string): { provider: CompanionModelProvider; confidence: "exact" | "custom"; evidence: string } {
  let url: URL;
  try { url = new URL(baseUrl); } catch { return { provider: "custom", confidence: "custom", evidence: "地址未匹配维护端点" }; }
  const path = url.pathname.replace(/\/+$/, "");
  const found = KNOWN_ENDPOINTS.find((item) => url.origin === item.origin && path === item.path);
  return found
    ? { provider: found.provider, confidence: "exact", evidence: "匹配应用内维护的服务端点" }
    : { provider: "custom", confidence: "custom", evidence: "未匹配维护端点，保留为自定义服务" };
}

const MAINTAINED_UPDATED_AT = "2026-09-18";
const maintained = (modelId: string, capabilities: ModelCapability[], available: ModelCapability[]): Omit<ModelResource, "connectionId"> => ({
  modelId,
  capabilities,
  evidence: { source: "maintained-runtime-catalog", updatedAt: MAINTAINED_UPDATED_AT, verified: true, health: "healthy" },
  // Catalog facts describe a model contract, not a wired execution route. The
  // unified resolver currently consumes only checked chat resources.
  executionState: Object.fromEntries(capabilities.map((capability) => [capability,
    available.includes(capability) && capabilityAdapterSupport(capability).state === "available" ? "available" : "integration_pending",
  ])) as Partial<Record<ModelCapability, ModelExecutionState>>,
});

/** Facts in this catalog are limited to model IDs already hard-coded by the current runtime. */
export function maintainedModelResources(provider: CompanionModelProvider): Array<Omit<ModelResource, "connectionId">> {
  if (provider === "zhipu") return [
    maintained("glm-4.6v-flash", ["vision"], ["vision"]),
    maintained("glm-tts", ["text_to_speech"], ["text_to_speech"]),
    maintained("glm-asr-2512", ["speech_to_text"], ["speech_to_text"]),
    maintained("embedding-3", ["embedding"], ["embedding"]),
  ];
  return [];
}

export function candidateModelResources(connectionId: string, catalog: readonly CompanionModelInfo[], enabledModels?: readonly string[]): ModelResource[] {
  const enabled = new Set(enabledModels ?? catalog.map((item) => item.id));
  const rows = catalog
    .filter((item) => item?.id && !SPECIALIZED_NON_CHAT.test(item.id) && !OBSOLETE.test(item.id))
    .map((item) => ({
      connectionId, modelId: item.id, displayName: item.displayName,
      capabilities: ["chat"] as ModelCapability[],
      enabled: enabled.has(item.id),
      evidence: { source: "provider-directory", updatedAt: new Date().toISOString(), verified: false } as ModelCapabilityEvidence,
      ...(item.created ? { created: item.created } : {}),
    }))
    .sort((left, right) => (right.created || 0) - (left.created || 0));
  return rows.map(({ created, ...item }, index) => ({
    ...item,
    ...(index === 0 ? { reason: created ? "服务商目录中带时间信息的最新通用候选" : "服务商目录中的首个通用候选" } : {}),
    autoEligible: false,
  }));
}

export function checkedModelResource(connectionId: string, modelId: string, checkedAt: string, capabilities: ModelCapability[], latencyMs?: number): ModelResource {
  return {
    connectionId, modelId, capabilities,
    evidence: { source: "explicit-check", updatedAt: checkedAt, verified: true, health: "healthy", ...(latencyMs ? { latencyMs } : {}) },
    executionState: Object.fromEntries(capabilities.map((capability) => [capability, capabilityAdapterSupport(capability).state])) as Partial<Record<ModelCapability, ModelExecutionState>>,
  };
}

export function allResourcesForConnection(input: {
  id: string; provider: CompanionModelProvider; baseUrl: string; catalog: readonly CompanionModelInfo[];
  checks: Record<string, { checkedAt: string; chat: string; latencyMs?: number }>;
  enabledModels?: readonly string[];
  reasoningModels?: readonly string[];
  capabilityChecks?: Record<string, { checkedAt: string; status: string; capability: ModelCapability; modelId: string; latencyMs?: number }>;
}): ModelResource[] {
  const byKey = new Map<string, ModelResource>();
  const enabledModels = new Set(input.enabledModels ?? [...input.catalog.map((item) => item.id), ...Object.keys(input.checks)]);
  const curatedProvider = curatedProviderCatalog(input.provider, input.baseUrl);
  const eligibleIds = new Set(eligibleCuratedCatalog(input.provider, input.baseUrl).map((item) => item.id));
  for (const item of [...input.catalog, ...(curatedProvider?.models || []).map((entry) => ({ id: entry.exactId, displayName: entry.exactId }))]) {
    const entry = curatedProvider?.models.find((candidate) => candidate.exactId === item.id);
    if (!entry) continue;
    for (const capability of entry.capabilities) {
      const resource: ModelResource = {
        connectionId: input.id, modelId: item.id, displayName: item.displayName, capabilities: [capability],
        evidence: { source: "maintained-runtime-catalog", updatedAt: entry.evidence.retrievedAt, verified: false },
        executionState: { [capability]: entry.execution.status === "wired" && providerCapabilityAdapterSupport(input.provider, input.baseUrl, capability).state === "available" ? "available" : "integration_pending" },
        tags: ["官方推荐"], reason: `官方维护目录（更新 ${entry.evidence.retrievedAt}）`, autoEligible: true, lifecycle: entry.lifecycle, replacement: entry.replacement, curated: true,
        enabled: enabledModels.has(item.id),
      };
      byKey.set(`${item.id}:${capability}`, resource);
    }
  }
  // The provider directory is evidence that an ID exists for this account, not
  // an allowlist. Keep these rows selectable for an explicit check while the
  // curated catalog remains only the small recommendation/automatic-routing set.
  for (const resource of candidateModelResources(input.id, input.catalog, input.enabledModels)) {
    const key = `${resource.modelId}:chat`;
    if (!byKey.has(key)) byKey.set(key, resource);
  }
  for (const [modelId, check] of Object.entries(input.checks)) {
    if (check.chat === "passed") {
      const capabilities: ModelCapability[] = ["chat"];
      const entry = curatedModelEntry(input.provider, input.baseUrl, modelId);
      byKey.set(`${modelId}:chat`, { ...checkedModelResource(input.id, modelId, check.checkedAt, capabilities, check.latencyMs),
        enabled: enabledModels.has(modelId),
        autoEligible: Boolean(entry && eligibleIds.has(modelId)), curated: Boolean(entry), lifecycle: entry?.lifecycle, replacement: entry?.replacement,
        ...(entry ? { tags: ["官方推荐"], reason: `官方维护目录（更新 ${entry.evidence.retrievedAt}）` } : { tags: ["手动型号"], reason: "已显式验证，但不参与自动路由" }),
      });
    }
  }
  for (const check of Object.values(input.capabilityChecks || {})) {
    if (check.status !== "passed") continue;
    const entry = curatedModelEntry(input.provider, input.baseUrl, check.modelId);
    if (!entry?.capabilities.includes(check.capability)) continue;
    byKey.set(`${check.modelId}:${check.capability}`, {
      ...checkedModelResource(input.id, check.modelId, check.checkedAt, [check.capability], check.latencyMs),
      enabled: enabledModels.has(check.modelId), autoEligible: true, curated: true,
      executionState: { [check.capability]: providerCapabilityAdapterSupport(input.provider, input.baseUrl, check.capability).state },
      tags: ["官方能力"], reason: `已显式验证${check.capability}能力`, lifecycle: entry.lifecycle,
    });
  }
  for (const item of maintainedModelResources(input.provider)) {
    const resource = { ...item, connectionId: input.id, enabled: enabledModels.has(item.modelId) };
    for (const capability of resource.capabilities) byKey.set(`${resource.modelId}:${capability}`, resource);
  }
  return [...byKey.values()];
}

export function validateFixedAssignment(assignment: CapabilityAssignment, resources: readonly ModelResource[]): void {
  if (assignment.mode === "auto") return;
  const { ref } = assignment;
  const resource = resources.find((item) => item.connectionId === ref.connectionId && item.modelId === ref.modelId && item.capabilities.includes(ref.capability));
  if (!resource) throw new Error("所选模型与目标能力不匹配，或缺少可核验的能力证据。");
  if (resource.lifecycle === "retired") throw new Error(`所选模型已停止推荐${resource.replacement ? `；替代型号为 ${resource.replacement}` : ""}，旧引用仅供查看，不能新设。`);
  if (resource.enabled === false) throw new Error("所选模型尚未在此连接中启用，请先在模型库中启用它。");
  if (!resource.evidence.verified || resource.evidence.health === "unhealthy" || resource.executionState?.[ref.capability] !== "available") {
    throw new Error("所选模型尚未通过当前连接验证，或该能力仍在接入中，不能设为固定执行资源。");
  }
}

export function emptyCapabilityAssignments(): CapabilityAssignments {
  return {
    system: Object.fromEntries(MODEL_CAPABILITIES.map((id) => [id, DEFAULT_ASSIGNMENT])) as Record<ModelCapability, CapabilityAssignment>,
    scenes: Object.fromEntries(MODEL_SCENES.map((id) => [id, {}])) as Record<ModelScene, Partial<Record<ModelCapability, CapabilityAssignment>>>,
  };
}

export function normalizeCapabilityAssignments(system: Partial<Record<ModelCapability, CapabilityAssignment>> = {}, scenes: Partial<Record<ModelScene, Partial<Record<ModelCapability, CapabilityAssignment>>>> = {}): CapabilityAssignments {
  const result = emptyCapabilityAssignments();
  for (const capability of MODEL_CAPABILITIES) if (system[capability]) result.system[capability] = system[capability]!;
  const legacyScenes = scenes as typeof scenes & { task?: Partial<Record<ModelCapability, CapabilityAssignment>> };
  for (const scene of MODEL_SCENES) {
    const source = scene === "task_workspace" ? (scenes[scene] || legacyScenes.task) : scenes[scene];
    for (const capability of MODEL_CAPABILITIES) if (source?.[capability]) result.scenes[scene][capability] = source[capability]!;
  }
  return result;
}

export function explainAutomaticRoute(capability: ModelCapability, resources: readonly ModelResource[]): { selected: ModelResource | null; fallbacks: ModelResource[]; reason: string } {
  const eligible = resources.filter((item) => item.enabled !== false && item.capabilities.includes(capability) && item.evidence.verified
    && item.evidence.health !== "unhealthy" && item.executionState?.[capability] === "available" && item.autoEligible === true && item.lifecycle !== "retired");
  const score = (item: ModelResource) => {
    let value = item.evidence.health === "healthy" ? 100 : 50;
    if (typeof item.evidence.latencyMs === "number") value += Math.max(0, 30 - item.evidence.latencyMs / 30);
    if (item.evidence.costTier === "low") value += 15;
    const age = Date.now() - Date.parse(item.evidence.updatedAt);
    if (Number.isFinite(age)) value += Math.max(0, 10 - age / 86_400_000);
    return value;
  };
  eligible.sort((a, b) => score(b) - score(a));
  const fields = [eligible.some((item) => item.evidence.health) ? "健康" : "", eligible.some((item) => item.evidence.latencyMs !== undefined) ? "延迟" : "", eligible.some((item) => item.evidence.costTier) ? "成本" : "", "证据更新时间"].filter(Boolean);
  return { selected: eligible[0] || null, fallbacks: eligible.slice(1), reason: eligible.length ? `按${fields.join("、")}排序；仅使用已验证证据，后续候选为可解释回退链。` : "没有具备已验证能力证据的可用模型。" };
}
