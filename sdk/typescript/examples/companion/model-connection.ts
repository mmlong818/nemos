import { randomUUID } from "node:crypto";
import { fetch as undiciFetch, type Dispatcher } from "undici";
import type { ReasoningEffort } from "./model-reasoning.js";
import { providerCatalogEntry, type ProviderId, type ProviderProtocol } from "./provider-catalog.js";

export type CompanionModelProtocol = ProviderProtocol;

export type CompanionModelProvider = ProviderId;

export interface CompanionModelConnection {
  provider: CompanionModelProvider;
  protocol: CompanionModelProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Generic provider credentials. `apiKey` remains a compatibility mirror. */
  credentials?: Record<string, string>;
  /** Non-secret provider configuration such as region, workspace or endpoint ID. */
  providerSettings?: Record<string, string>;
  selectionMode?: "auto" | "manual";
  /** Opaque local revision; it is never derived from or exposed with the API key. */
  connectionRevision?: string;
  /** Public transport-policy identity; changing proxy/direct routing invalidates checks and queued work. */
  networkFingerprint?: string;
  /** Runtime-only dispatcher used to stage a connection without changing other requests' global route. */
  transportDispatcher?: Dispatcher;
  /** Models explicitly added to this connection. Registration is local and never probes. */
  registeredModels?: string[];
  /** Models intentionally enabled under this shared credential. Enabling is local and never probes. */
  enabledModels?: string[];
  /** Only checks made with this exact connection and credential belong here. */
  modelChecks?: Record<string, CompanionModelCheck>;
  /** Explicit per-capability probes. A /models row never populates this map. */
  capabilityChecks?: Record<string, CompanionCapabilityCheck>;
}

export interface CompanionCapabilityCheck {
  connectionRevision?: string;
  modelId: string;
  capability: "vision" | "speech_to_text" | "text_to_speech" | "image_generation";
  checkedAt: string;
  status: "passed" | "failed";
  detail: string;
  latencyMs?: number;
  diagnostic?: CompanionModelFailureDiagnostic;
}

export interface CompanionModelCheck {
  /** The connection revision on which this synthetic check was actually made. */
  connectionRevision?: string;
  /** The transport this check actually exercised. A check never speaks for another one. */
  transport?: CompanionModelTransport;
  checkedAt: string;
  chat: "passed" | "failed";
  streaming: "passed" | "failed" | "buffered" | "not-tested";
  tools: "passed" | "failed" | "not-tested";
  detail: string;
  /** Measured synthetic round-trip only; absent means latency is unknown. */
  latencyMs?: number;
  /** Safe troubleshooting metadata; provider response content is never retained. */
  diagnostic?: CompanionModelFailureDiagnostic;
}

export const COMPANION_MODEL_CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CompanionModelFailureCategory = "auth" | "quota" | "model" | "parameter" | "network" | "protocol";

/** Deliberately excludes response bodies, endpoints, credentials and prompts. */
export interface CompanionModelFailureDiagnostic {
  category: CompanionModelFailureCategory;
  httpStatus?: number;
  requestId?: string;
  /** Official, numeric provider error code only; provider messages are never retained. */
  providerCode?: string;
  networkKind?: "dns" | "refused" | "timeout" | "tls" | "proxy_unavailable";
}

export class CompanionModelHttpError extends Error {
  constructor(readonly status: number, operation = "模型请求", readonly requestId?: string, readonly providerCode?: string) {
    // Never persist or expose a provider's raw response: gateways can echo keys.
    super(`${operation}失败 HTTP ${status}。`);
  }
}

/** Request IDs are useful for provider support, but arbitrary response headers are not trusted. */
export function safeProviderRequestId(headers: Headers): string | undefined {
  const value = headers.get("x-request-id") || headers.get("request-id") || headers.get("x-correlation-id");
  return value && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : undefined;
}

/**
 * Zhipu's documented error envelope carries a numeric `error.code`.  Parse no
 * other response content: gateway messages can include prompts or credentials.
 */
export async function safeZhipuProviderErrorCode(response: Response): Promise<string | undefined> {
  let payload: unknown;
  try { payload = await response.json(); } catch { return undefined; }
  const error = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).error : undefined;
  const code = error && typeof error === "object" && !Array.isArray(error)
    ? (error as Record<string, unknown>).code : undefined;
  const value = typeof code === "number" && Number.isSafeInteger(code) ? String(code) : code;
  // Current official codes are compact numeric identifiers (for example 1213,
  // 1310).  Reject text, whitespace, and unbounded values rather than echoing
  // an untrusted provider body.
  return typeof value === "string" && /^\d{3,5}$/.test(value) ? value : undefined;
}

export function companionModelFailureDiagnostic(error: unknown): CompanionModelFailureDiagnostic | undefined {
  if (error instanceof CompanionModelHttpError) {
    const category: CompanionModelFailureCategory = error.status === 401 || error.status === 403 ? "auth"
      : error.status === 429 ? "quota"
      : error.status === 404 ? "model"
      : error.status === 400 || error.status === 422 ? "parameter"
      : "protocol";
    return { category, httpStatus: error.status, ...(error.requestId ? { requestId: error.requestId } : {}), ...(error.providerCode ? { providerCode: error.providerCode } : {}) };
  }
  const networkKind = companionNetworkFailureKind(error);
  if (networkKind || error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) {
    return { category: "network", ...(networkKind ? { networkKind } : {}) };
  }
  return undefined;
}

function companionNetworkFailureKind(error: unknown): CompanionModelFailureDiagnostic["networkKind"] | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth++) {
    seen.add(current);
    const record = typeof current === "object" ? current as Record<string, unknown> : {};
    const code = String(record.code || "").toUpperCase();
    const name = String(record.name || "").toUpperCase();
    const message = current instanceof Error ? current.message : String(record.message || "");
    if (/ENOTFOUND|EAI_AGAIN|DNS/.test(`${code} ${name} ${message}`)) return "dns";
    if (/PROXY.*(?:UNAVAILABLE|LISTEN)|系统代理|代理端口未监听|PAC(?:\/WPAD|\/自动配置脚本)?|WPAD/i.test(`${code} ${name} ${message}`)) return "proxy_unavailable";
    if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|ABORTERROR|TIMEOUT|超时/i.test(`${code} ${name} ${message}`)) return "timeout";
    if (/CERT|TLS|SSL|ERR_SSL|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(`${code} ${name} ${message}`)) return "tls";
    if (/ECONNRESET|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED/i.test(`${code} ${name} ${message}`)) return "refused";
    current = record.cause;
  }
  return undefined;
}

export interface CompanionModelInfo {
  id: string;
  created?: number;
  displayName?: string;
  /** Provider directory metadata. It describes visibility, never verification. */
  directory?: {
    supportedActions?: string[];
    capabilities?: string[];
    modalities?: string[];
    contextTokens?: number;
    outputTokens?: number;
    pricing?: Record<string, string | number>;
  };
}

export interface CompanionModelProviderPreset {
  id: CompanionModelProvider;
  name: string;
  protocol: CompanionModelProtocol;
  baseUrl: string;
  model: string;
  dailyChatModel?: string;
  keyRequired: boolean;
  note: string;
}

export const COMPANION_MODEL_PROVIDER_PRESETS: readonly CompanionModelProviderPreset[] = [
  {
    id: "zhipu",
    name: "智谱 GLM",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
    dailyChatModel: "glm-5.3",
    keyRequired: true,
    note: "日常对话与任务默认使用官方维护目录中的 glm-5.3；仍需当前账号轻量验证。",
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4",
    dailyChatModel: "gpt-5.4",
    keyRequired: true,
    note: "日常对话与任务使用已选择的模型，不会自动切到未经检查的预设型号。",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-5",
    dailyChatModel: "claude-haiku-4-5-20251001",
    keyRequired: true,
    note: "原生 SSE 流式在显式检查通过后启用；检查失败或旧版 buffered 记录继续使用完整 JSON。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    dailyChatModel: "deepseek-flash",
    keyRequired: true,
    note: "日常对话与任务使用已选择的模型，不会自动切到未经检查的预设型号。",
  },
  {
    id: "qwen",
    name: "通义千问",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-max",
    dailyChatModel: "qwen3.8-flash",
    keyRequired: true,
    note: "日常对话与任务使用已选择的模型，不会自动切到未经检查的预设型号。",
  },
  {
    id: "minimax",
    name: "MiniMax 中国",
    protocol: "openai-compatible",
    baseUrl: "https://api.minimax.cn/v1",
    model: "MiniMax-M3",
    dailyChatModel: "MiniMax-M3",
    keyRequired: true,
    note: "官方端点已更新；当前执行适配仍待验证，不能自动设为可执行模型。",
  },
  { id: "gemini", name: "Google Gemini", protocol: "gemini-native", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.8-flash", keyRequired: true, note: "原生 models.list 读取账号目录；能力需要单独验证。" },
  { id: "volcengine", name: "火山方舟 / 豆包 / Seedance", protocol: "ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "configured-endpoint", keyRequired: true, note: "实际调用必须填写账号推理接入点 ID。" },
  { id: "kling", name: "可灵 Kling", protocol: "async-media", baseUrl: "", model: "kling-v2-6", keyRequired: true, note: "只保存凭据；不会自动创建付费任务。" },
  { id: "vidu", name: "Vidu", protocol: "async-media", baseUrl: "https://api.vidu.com", model: "viduq3-pro", keyRequired: true, note: "只保存凭据；不会自动创建付费任务。" },
  { id: "pixverse", name: "拍我 AI / PixVerse", protocol: "async-media", baseUrl: "https://app-api.pixverse.ai/openapi/v2", model: "v6", keyRequired: true, note: "只保存凭据；不会自动创建付费任务。" },
  { id: "hunyuan", name: "腾讯混元视频", protocol: "tencent-tc3", baseUrl: "https://vclm.tencentcloudapi.com", model: "hunyuan-video", keyRequired: false, note: "使用 SecretId 与 SecretKey 的 TC3 签名。" },
  {
    id: "custom",
    name: "自定义服务",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    keyRequired: false,
    note: "可连接代理网关、LM Studio、Ollama 等兼容服务。",
  },
] as const;

export function companionModelProviderPreset(provider: unknown): CompanionModelProviderPreset {
  const preset = COMPANION_MODEL_PROVIDER_PRESETS.find((item) => item.id === provider);
  if (!preset) throw new Error("不支持的模型服务商。请选择内置服务商，或使用“自定义服务”并明确协议和 API 地址。");
  return preset;
}

export function defaultCompanionModelConnection(
  provider: CompanionModelProvider = "zhipu",
  apiKey = "",
): CompanionModelConnection {
  const preset = companionModelProviderPreset(provider);
  return {
    provider: preset.id,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: apiKey.trim(),
  };
}

export function normalizeCompanionModelConnection(
  input: Partial<CompanionModelConnection>,
): CompanionModelConnection {
  const preset = companionModelProviderPreset(input.provider ?? "zhipu");
  const definition = providerCatalogEntry(preset.id);
  const protocol = preset.id === "custom"
    ? normalizeProtocol(input.protocol)
    : preset.protocol;
  const normalizedBaseUrl = definition?.discoveryMode === "asyncMediaNoFreeProbe" && !definition.defaultEndpoint
    ? `clownfish-unconfigured://${preset.id}`
    : normalizeBaseUrl(String(input.baseUrl || preset.baseUrl));
  const baseUrl = protocol === "anthropic" ? normalizedBaseUrl.replace(/\/v1$/, "") : normalizedBaseUrl;
  const model = String(input.model || preset.model).trim();
  const apiKey = String(input.apiKey || "").trim();
  const credentials = normalizeStringMap(input.credentials);
  if (apiKey && !credentials.apiKey) credentials.apiKey = apiKey;
  const providerSettings = normalizeStringMap(input.providerSettings, false);

  if (!model) throw new Error("请填写模型名称。");
  if (model.length > 160 || /[\r\n]/.test(model)) throw new Error("模型名称格式不正确。");
  for (const field of definition?.credentialFields || []) {
    if (field.required && !credentials[field.id]) throw new Error(`请填写 ${preset.name} 的${field.label}。`);
  }
  for (const field of definition?.settingFields || []) {
    if (field.required && field.id !== "baseUrl" && field.id !== "protocol" && !providerSettings[field.id]) throw new Error(`请填写 ${preset.name} 的${field.label}。`);
  }

  return { provider: preset.id, protocol, baseUrl, model, apiKey: credentials.apiKey || apiKey, credentials, providerSettings,
    ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}),
    ...(isConnectionRevision(input.connectionRevision) ? { connectionRevision: input.connectionRevision } : {}),
    ...(typeof input.networkFingerprint === "string" && /^[a-f0-9]{24}$/.test(input.networkFingerprint) ? { networkFingerprint: input.networkFingerprint } : {}),
    ...(input.transportDispatcher ? { transportDispatcher: input.transportDispatcher } : {}),
    ...(input.registeredModels ? { registeredModels: normalizeFavoriteModels(input.registeredModels) } : {}),
    ...(input.enabledModels ? { enabledModels: normalizeFavoriteModels(input.enabledModels) } : {}),
    ...(input.modelChecks ? { modelChecks: input.modelChecks } : {}),
    ...(input.capabilityChecks ? { capabilityChecks: input.capabilityChecks } : {}),
  };
}

/** A local opaque revision makes check reuse safe without hashing or retaining a credential. */
export function createConnectionRevision(): string {
  return randomUUID();
}

export function ensureConnectionRevision(connection: CompanionModelConnection): CompanionModelConnection {
  return isConnectionRevision(connection.connectionRevision)
    ? connection
    : { ...connection, connectionRevision: createConnectionRevision() };
}

/**
 * Preserve preferences and a selected ID, but never carry checks across an endpoint,
 * protocol, provider, or credential change. Callers must separately mark catalogs stale.
 */
export function withConnectionRevision(
  next: CompanionModelConnection,
  previous?: CompanionModelConnection,
  credentialChanged = false,
): CompanionModelConnection {
  const normalized = normalizeCompanionModelConnection(next);
  const sameConnection = Boolean(previous)
    && normalized.provider === previous!.provider
    && normalized.protocol === previous!.protocol
    && normalized.baseUrl === previous!.baseUrl
    && normalized.networkFingerprint === previous!.networkFingerprint
    && JSON.stringify(normalized.credentials || {}) === JSON.stringify(previous!.credentials || { ...(previous!.apiKey ? { apiKey: previous!.apiKey } : {}) })
    && JSON.stringify(normalized.providerSettings || {}) === JSON.stringify(previous!.providerSettings || {})
    && !credentialChanged;
  const connectionRevision = sameConnection && isConnectionRevision(previous!.connectionRevision)
    ? previous!.connectionRevision!
    : createConnectionRevision();
  const registeredModels = normalizeFavoriteModels(next.registeredModels ?? previous?.registeredModels ?? []);
  const enabledModels = normalizeFavoriteModels(next.enabledModels ?? previous?.enabledModels ?? []);
  const modelChecks = sameConnection
    ? retainModelChecksForRevision(next.modelChecks ?? previous?.modelChecks, connectionRevision)
    : {};
  const capabilityChecks = sameConnection
    ? Object.fromEntries(Object.entries(next.capabilityChecks ?? previous?.capabilityChecks ?? {}).filter(([, check]) => check?.connectionRevision === connectionRevision))
    : {};
  return { ...normalized, connectionRevision, registeredModels, enabledModels, modelChecks, capabilityChecks };
}

function normalizeStringMap(value: unknown, secret = true): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(rawKey)) continue;
    const text = String(rawValue ?? "").trim();
    if (!text || text.length > (secret ? 4096 : 512) || /[\r\n]/.test(text)) continue;
    normalized[rawKey] = text;
  }
  return normalized;
}

export function bindModelChecksToRevision(
  checks: CompanionModelConnection["modelChecks"] | undefined,
  connectionRevision: string,
): Record<string, CompanionModelCheck> {
  if (!isConnectionRevision(connectionRevision)) return {};
  const bound: Record<string, CompanionModelCheck> = {};
  for (const [model, check] of Object.entries(checks ?? {})) {
    if (!isModelId(model) || !check || typeof check !== "object") continue;
    // Legacy v2/v3 checks belonged to the one saved connection. Bind only at migration;
    // all future connection changes discard them through withConnectionRevision().
    bound[model] = { ...check, connectionRevision };
  }
  return bound;
}

/** Normal operation never upgrades an unbound or mismatched check into a valid one. */
export function retainModelChecksForRevision(
  checks: CompanionModelConnection["modelChecks"] | undefined,
  connectionRevision: string,
): Record<string, CompanionModelCheck> {
  if (!isConnectionRevision(connectionRevision)) return {};
  const retained: Record<string, CompanionModelCheck> = {};
  for (const [model, check] of Object.entries(checks ?? {})) {
    if (isModelId(model) && check?.connectionRevision === connectionRevision) retained[model] = check;
  }
  return retained;
}

export function isModelCheckEligible(
  connection: Pick<CompanionModelConnection, "connectionRevision" | "provider" | "protocol">,
  check: CompanionModelCheck | undefined,
  model: string,
  capability: "chat" | "streaming" | "tools" = "chat",
  now = Date.now(),
): boolean {
  const checkedAt = check ? Date.parse(check.checkedAt) : Number.NaN;
  const checkedOver = check?.transport ?? legacyCheckTransport(connection, model);
  return Boolean(isConnectionRevision(connection.connectionRevision)
    && check?.connectionRevision === connection.connectionRevision
    && checkedOver === modelTransport(connection, model)
    && Number.isFinite(checkedAt)
    && checkedAt <= now
    && now - checkedAt <= COMPANION_MODEL_CHECK_TTL_MS
    && check[capability] === "passed");
}

export function normalizeFavoriteModels(models: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const candidate of models) {
    const id = String(candidate ?? "").trim();
    if (isModelId(id)) seen.add(id);
    if (seen.size >= 50) break;
  }
  return [...seen];
}

function isConnectionRevision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{16,64}$/i.test(value);
}

function isModelId(value: string): boolean {
  return Boolean(value) && value.length <= 160 && !/[\r\n]/.test(value);
}

export function modelConnectionEndpoint(connection: CompanionModelConnection): string {
  const suffix = connection.protocol === "anthropic" ? "/v1/messages" : "/chat/completions";
  if (connection.baseUrl.endsWith(suffix)) return connection.baseUrl;
  return `${connection.baseUrl}${suffix}`;
}

/** Which wire protocol a model is actually reached over. One source for adapter choice and checks. */
export type CompanionModelTransport = "openai-responses" | "openai-chat-completions" | "anthropic-messages";

export type CompanionReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type CompanionThinkingMode = "enabled" | "disabled" | "omit";
export interface CompanionModelCapabilityProfile {
  thinking: CompanionThinkingMode;
  reasoningEfforts?: readonly CompanionReasoningEffort[];
}

/**
 * Wire-level capabilities are provider profiles, not UI-name exceptions.  New
 * families belong here only when their provider documentation establishes a
 * different request contract.
 */
const COMPANION_MODEL_CAPABILITY_PROFILES: readonly {
  provider: CompanionModelProvider;
  model: RegExp;
  profile: CompanionModelCapabilityProfile;
}[] = [
  {
    provider: "zhipu",
    model: /^glm-5\.3(?:$|[-_])/i,
    profile: { thinking: "enabled", reasoningEfforts: ["low", "high", "max"] },
  },
  // Earlier Zhipu chat families accept disabled thinking; retain the existing
  // latency-oriented default unless a newer explicit profile supersedes it.
  { provider: "zhipu", model: /.+/, profile: { thinking: "disabled" } },
];

export function companionModelCapabilities(
  connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined,
  model: string,
): CompanionModelCapabilityProfile {
  return COMPANION_MODEL_CAPABILITY_PROFILES.find((entry) => entry.provider === connection?.provider && entry.model.test(model))?.profile
    ?? { thinking: "omit" };
}

/**
 * OpenAI reasoning families, matched by prefix so a dated snapshot inherits its family.
 * Official model pages checked 2026-09-09. This one table decides both the offered
 * thinking efforts and the transport: chat completions rejects function tools for these
 * models unless reasoning is off, so their tool rounds must go through Responses.
 */
export const OPENAI_REASONING_FAMILIES: readonly { prefix: string; efforts: readonly ReasoningEffort[] }[] = [
  { prefix: "gpt-6-astra", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { prefix: "gpt-5.6-terra", efforts: ["none", "low", "medium", "high", "xhigh", "max"] },
  { prefix: "gpt-5.6-luna", efforts: ["none", "low", "medium", "high", "xhigh", "max"] },
];

/** Prefix match without a regex: family IDs contain dots that a pattern would treat as wildcards. */
function inModelFamily(model: string, prefix: string): boolean {
  const id = model.trim().toLowerCase();
  const family = prefix.toLowerCase();
  return id === family || id.startsWith(`${family}-`);
}

export function openAIReasoningFamily(
  connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined,
  model: string,
): { prefix: string; efforts: readonly ReasoningEffort[] } | undefined {
  if (connection?.provider !== "openai" || connection.protocol !== "openai-compatible") return undefined;
  return OPENAI_REASONING_FAMILIES.find((family) => inModelFamily(model, family.prefix));
}

export function modelTransport(
  connection: Pick<CompanionModelConnection, "provider" | "protocol">,
  model: string,
): CompanionModelTransport {
  if (connection.protocol === "anthropic") return "anthropic-messages";
  return openAIReasoningFamily(connection, model) ? "openai-responses" : "openai-chat-completions";
}

export function usesOpenAIResponses(connection: Pick<CompanionModelConnection, "provider" | "protocol" | "model">): boolean {
  return modelTransport(connection, connection.model) === "openai-responses";
}

/**
 * Checks stored before the transport was recorded were made under the previous routing,
 * where only the astra family used Responses. Reconstructing that keeps an astra check
 * valid and correctly retires a terra/luna check that only ever exercised chat completions.
 */
function legacyCheckTransport(
  connection: Pick<CompanionModelConnection, "provider" | "protocol">,
  model: string,
): CompanionModelTransport {
  if (connection.protocol === "anthropic") return "anthropic-messages";
  return inModelFamily(model, "gpt-6-astra") && connection.provider === "openai"
    ? "openai-responses"
    : "openai-chat-completions";
}

export function sortCompanionModels(models: readonly CompanionModelInfo[]): CompanionModelInfo[] {
  const unique = new Map<string, CompanionModelInfo>();
  for (const item of models) {
    const id = String(item?.id || "").trim();
    // Keep every syntactically safe ID returned by the endpoint. Names are not a
    // reliable capability signal; explicit checks decide chat/tool eligibility.
    if (!id || id.length > 160 || /[\r\n]/.test(id)) continue;
    const created = Number(item.created);
    unique.set(id, {
      id,
      ...(Number.isFinite(created) && created > 0 ? { created } : {}),
      ...(item.displayName ? { displayName: String(item.displayName).trim().slice(0, 160) } : {}),
      ...(item.directory ? { directory: normalizeDirectoryMetadata(item.directory) } : {}),
    });
  }
  return [...unique.values()].sort((left, right) => {
    if (left.created && right.created) return right.created - left.created;
    if (left.created) return -1;
    if (right.created) return 1;
    return 0; // 没有时间信息时保留服务商返回顺序。
  });
}

function normalizeDirectoryMetadata(value: CompanionModelInfo["directory"]): CompanionModelInfo["directory"] {
  if (!value) return undefined;
  const strings = (items: unknown) => Array.isArray(items)
    ? [...new Set(items.map((item) => String(item || "").trim()).filter((item) => item && item.length <= 80))].slice(0, 50)
    : undefined;
  const positive = (item: unknown) => Number.isFinite(Number(item)) && Number(item) > 0 ? Number(item) : undefined;
  const pricing = value.pricing && typeof value.pricing === "object"
    ? Object.fromEntries(Object.entries(value.pricing).filter(([key, item]) => /^[A-Za-z0-9._-]{1,60}$/.test(key) && (typeof item === "number" || typeof item === "string")).slice(0, 30))
    : undefined;
  const normalized = {
    supportedActions: strings(value.supportedActions), capabilities: strings(value.capabilities), modalities: strings(value.modalities),
    contextTokens: positive(value.contextTokens), outputTokens: positive(value.outputTokens), pricing,
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, item]) => item !== undefined)) as CompanionModelInfo["directory"];
}

export async function fetchCompanionModelCatalog(
  input: CompanionModelConnection,
  signal?: AbortSignal,
): Promise<CompanionModelInfo[]> {
  const connection = normalizeCompanionModelConnection(input);
  const endpoint = connection.protocol === "anthropic"
    ? `${connection.baseUrl}/v1/models?limit=1000`
    : `${connection.baseUrl}/models`;
  const headers: Record<string, string> = connection.protocol === "anthropic"
    ? { "anthropic-version": "2023-06-01", ...(connection.apiKey ? { "x-api-key": connection.apiKey } : {}), ...(connection.providerSettings?.workspaceId ? { "anthropic-workspace-id": connection.providerSettings.workspaceId } : {}) }
    : connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
  const response = connection.transportDispatcher
    ? await undiciFetch(endpoint, { headers, signal, dispatcher: connection.transportDispatcher })
    : await fetch(endpoint, { headers, signal });
  if (!response.ok) {
    const requestId = safeProviderRequestId(response.headers);
    await response.body?.cancel();
    throw new CompanionModelHttpError(response.status, "读取模型列表", requestId);
  }
  const payload = await response.json().catch(() => { throw new Error("模型目录不是有效的 JSON，请检查服务地址和接口兼容性。"); }) as {
    data?: Array<{ id?: unknown; created?: unknown; created_at?: unknown; display_name?: unknown }>;
    models?: Array<{ id?: unknown; name?: unknown; created?: unknown; created_at?: unknown; display_name?: unknown }>;
  };
  if (!payload || typeof payload !== "object") throw new Error("模型服务没有返回有效的模型目录。");
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  const models = sortCompanionModels(rows.map((item) => ({
    id: String(item.id || ("name" in item ? item.name : "") || ""),
    created: modelCreatedAt(item.created ?? item.created_at),
    displayName: item.display_name ? String(item.display_name) : undefined,
  })));
  if (!models.length) throw new Error("模型服务没有返回可用于对话的模型。");
  return models;
}

function modelCreatedAt(value: unknown): number | undefined {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

export function dailyChatModelForConnection(
  connection: Pick<CompanionModelConnection, "provider" | "model">,
): string {
  return connection.model;
}

const COMPANION_TASK_CUE = /帮我|请你|给我(?:写|做|生成|制作|整理|分析|设计|规划|总结|翻译|修改|查找|搜索)|写一|生成|制作|调研|分析|整理|总结|翻译|设计|规划|创建|编辑|修改|修复|实现|开发|导出|保存|上传|下载|联网|搜索|能力|工具|代码|项目|文档|表格|演示|PPT|PDF|Word|Excel|任务/i;

export function isCompanionDailyConversation(instruction: string): boolean {
  const text = instruction.trim();
  if (!text) return true;
  if (text.length > 1200) return false;
  return !COMPANION_TASK_CUE.test(text);
}

export function selectCompanionConversationModel(input: {
  connection?: Pick<CompanionModelConnection, "provider" | "model">;
  requestedModel?: string;
  target: { kind: "persona" | "group"; id: string };
  expertPersonaIds?: ReadonlySet<string>;
  instruction?: string;
  forceTaskModel?: boolean;
}): string | undefined {
  if (input.requestedModel) return input.requestedModel;
  if (!input.connection || input.target.kind !== "persona") return undefined;
  if (input.expertPersonaIds?.has(input.target.id)) return undefined;
  if (input.forceTaskModel || !isCompanionDailyConversation(input.instruction || "")) return undefined;
  return dailyChatModelForConnection(input.connection);
}

export function publicModelConnection(connection?: CompanionModelConnection): {
  provider: CompanionModelProvider | null;
  providerName: string;
  protocol: CompanionModelProtocol | null;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  networkFingerprint?: string;
} {
  if (!connection) {
    return { provider: null, providerName: "离线模式", protocol: null, baseUrl: "", model: "", hasKey: false };
  }
  const preset = companionModelProviderPreset(connection.provider);
  return {
    provider: connection.provider,
    providerName: preset.name,
    protocol: connection.protocol,
    baseUrl: connection.baseUrl,
    model: connection.model,
    hasKey: Boolean(connection.apiKey || Object.values(connection.credentials || {}).some(Boolean)),
    ...(connection.networkFingerprint ? { networkFingerprint: connection.networkFingerprint } : {}),
  };
}

function normalizeProtocol(value: unknown): CompanionModelProtocol {
  return value === "anthropic" ? "anthropic" : "openai-compatible";
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("请填写 API 地址。");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("API 地址格式不正确，请填写完整的 http:// 或 https:// 地址。");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("远程 API 必须使用 HTTPS；本机服务可以使用 localhost 或 127.0.0.1。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API 地址不能包含账号、密码、查询参数或锚点。");
  }
  // Accept a pasted completion endpoint, but keep one canonical API root.
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages|responses)\/?$/, "");
  return url.toString().replace(/\/+$/, "");
}
