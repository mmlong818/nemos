import { randomUUID } from "node:crypto";

export type CompanionModelProtocol = "openai-compatible" | "anthropic";

export type CompanionModelProvider =
  | "zhipu"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "qwen"
  | "minimax"
  | "custom";

export interface CompanionModelConnection {
  provider: CompanionModelProvider;
  protocol: CompanionModelProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  selectionMode?: "auto" | "manual";
  /** Opaque local revision; it is never derived from or exposed with the API key. */
  connectionRevision?: string;
  /** User preference only. A favourite is not evidence that the model is usable. */
  favoriteModels?: string[];
  /** Only checks made with this exact connection and credential belong here. */
  modelChecks?: Record<string, CompanionModelCheck>;
}

export interface CompanionModelCheck {
  /** The connection revision on which this synthetic check was actually made. */
  connectionRevision?: string;
  checkedAt: string;
  chat: "passed" | "failed";
  streaming: "passed" | "failed" | "buffered" | "not-tested";
  tools: "passed" | "failed" | "not-tested";
  detail: string;
}

export const COMPANION_MODEL_CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class CompanionModelHttpError extends Error {
  constructor(readonly status: number, operation = "模型请求") {
    // Never persist or expose a provider's raw response: gateways can echo keys.
    super(`${operation}失败 HTTP ${status}。`);
  }
}

export interface CompanionModelInfo {
  id: string;
  created?: number;
  displayName?: string;
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
    model: "glm-5.2",
    dailyChatModel: "glm-5.2",
    keyRequired: true,
    note: "日常对话与任务默认使用 glm-5.2。",
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    dailyChatModel: "gpt-5.6-luna",
    keyRequired: true,
    note: "日常对话与任务使用已选择的模型，不会自动切到未经检查的预设型号。",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5",
    dailyChatModel: "claude-haiku-4-5",
    keyRequired: true,
    note: "使用已选择的模型；当前适配器以完整回复输出，不代表已验证原生流式。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    dailyChatModel: "deepseek-v4-flash",
    keyRequired: true,
    note: "日常对话与任务使用已选择的模型，不会自动切到未经检查的预设型号。",
  },
  {
    id: "qwen",
    name: "通义千问",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-max",
    dailyChatModel: "qwen3.6-flash",
    keyRequired: true,
    note: "日常对话与任务使用已选择的模型，不会自动切到未经检查的预设型号。",
  },
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai-compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    model: "MiniMax-M3",
    dailyChatModel: "MiniMax-M2.7-highspeed",
    keyRequired: true,
    note: "日常对话与任务使用已选择的模型，不会自动切到未经检查的预设型号。",
  },
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
  const protocol = preset.id === "custom"
    ? normalizeProtocol(input.protocol)
    : preset.protocol;
  const baseUrl = normalizeBaseUrl(String(input.baseUrl || preset.baseUrl));
  const model = String(input.model || preset.model).trim();
  const apiKey = String(input.apiKey || "").trim();

  if (!model) throw new Error("请填写模型名称。");
  if (model.length > 160 || /[\r\n]/.test(model)) throw new Error("模型名称格式不正确。");
  if (preset.keyRequired && !apiKey) throw new Error(`请填写 ${preset.name} 的 API Key。`);

  return { provider: preset.id, protocol, baseUrl, model, apiKey,
    ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}),
    ...(isConnectionRevision(input.connectionRevision) ? { connectionRevision: input.connectionRevision } : {}),
    ...(input.favoriteModels ? { favoriteModels: normalizeFavoriteModels(input.favoriteModels) } : {}),
    ...(input.modelChecks ? { modelChecks: input.modelChecks } : {}),
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
    && !credentialChanged;
  const connectionRevision = sameConnection && isConnectionRevision(previous!.connectionRevision)
    ? previous!.connectionRevision!
    : createConnectionRevision();
  const favoriteModels = normalizeFavoriteModels(next.favoriteModels ?? previous?.favoriteModels ?? []);
  const modelChecks = sameConnection
    ? retainModelChecksForRevision(next.modelChecks ?? previous?.modelChecks, connectionRevision)
    : {};
  return { ...normalized, connectionRevision, favoriteModels, modelChecks };
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
  connection: Pick<CompanionModelConnection, "connectionRevision">,
  check: CompanionModelCheck | undefined,
  capability: "chat" | "streaming" | "tools" = "chat",
  now = Date.now(),
): boolean {
  const checkedAt = check ? Date.parse(check.checkedAt) : Number.NaN;
  return Boolean(isConnectionRevision(connection.connectionRevision)
    && check?.connectionRevision === connection.connectionRevision
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
  const suffix = connection.protocol === "anthropic" ? "/messages" : "/chat/completions";
  if (connection.baseUrl.endsWith(suffix)) return connection.baseUrl;
  return `${connection.baseUrl}${suffix}`;
}

/** Astra's tools require Responses, including the result-only continuation round. */
export function usesOpenAIResponses(connection: Pick<CompanionModelConnection, "provider" | "protocol" | "model">): boolean {
  return connection.provider === "openai" && connection.protocol === "openai-compatible"
    && /^gpt-6-astra(?:-|$)/i.test(connection.model);
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
    });
  }
  return [...unique.values()].sort((left, right) => {
    if (left.created && right.created) return right.created - left.created;
    if (left.created) return -1;
    if (right.created) return 1;
    return 0; // 没有时间信息时保留服务商返回顺序。
  });
}

export async function fetchCompanionModelCatalog(
  input: CompanionModelConnection,
  signal?: AbortSignal,
): Promise<CompanionModelInfo[]> {
  const connection = normalizeCompanionModelConnection(input);
  const endpoint = `${connection.baseUrl}/models${connection.protocol === "anthropic" ? "?limit=1000" : ""}`;
  const headers: Record<string, string> = connection.protocol === "anthropic"
    ? { "anthropic-version": "2023-06-01", ...(connection.apiKey ? { "x-api-key": connection.apiKey } : {}) }
    : connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
  const response = await fetch(endpoint, { headers, signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new CompanionModelHttpError(response.status, "读取模型列表");
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
    hasKey: Boolean(connection.apiKey),
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
