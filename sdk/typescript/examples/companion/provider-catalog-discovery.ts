import { fetch as undiciFetch } from "undici";
import type { CompanionModelConnection, CompanionModelInfo } from "./model-connection.js";
import { CompanionModelHttpError, safeProviderRequestId, sortCompanionModels } from "./model-connection.js";
import { officialProviderEndpoint, providerCatalogEntry } from "./provider-catalog.js";

type SafeFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ProviderCatalogDiscoveryResult {
  models: CompanionModelInfo[];
  source: "account" | "official-static" | "endpoint" | "none";
  authenticationChecked: boolean;
  generationRequests: 0;
  note: string;
}

function credential(connection: CompanionModelConnection, name = "apiKey"): string {
  return connection.credentials?.[name] || (name === "apiKey" ? connection.apiKey : "");
}

function requestHeaders(connection: CompanionModelConnection): Record<string, string> {
  const entry = providerCatalogEntry(connection.provider);
  const apiKey = credential(connection);
  if (!entry) return {};
  switch (entry.authScheme) {
    case "x-goog-api-key": return { "x-goog-api-key": apiKey };
    case "x-api-key": return { "x-api-key": apiKey };
    case "api-key-trace": return { "API-KEY": apiKey };
    case "tc3": return {};
    default: return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }
}

async function checkedJson(url: string, connection: CompanionModelConnection, signal: AbortSignal | undefined, fetchImpl: SafeFetch): Promise<Record<string, unknown>> {
  const headers = requestHeaders(connection);
  if (connection.provider === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    const workspace = connection.providerSettings?.workspaceId;
    if (workspace) headers["anthropic-workspace-id"] = workspace;
  }
  const response = await fetchImpl(url, { method: "GET", headers, signal });
  if (!response.ok) {
    const requestId = safeProviderRequestId(response.headers);
    await response.body?.cancel();
    throw new CompanionModelHttpError(response.status, "读取模型目录", requestId);
  }
  const payload = await response.json().catch(() => { throw new Error("模型目录不是有效的 JSON。"); });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("模型服务没有返回有效目录。");
  return payload as Record<string, unknown>;
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).filter(([, enabled]) => enabled === true || (enabled && typeof enabled === "object")).map(([name]) => name);
  return undefined;
}

function numeric(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function safePricing(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([name, item]) => /^[A-Za-z0-9._-]{1,60}$/.test(name) && (typeof item === "string" || typeof item === "number"))
    .slice(0, 30) as Array<[string, string | number]>;
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function capabilitiesForActions(actions: readonly string[]): string[] {
  const capabilities = new Set<string>();
  if (actions.some((item) => ["generateContent", "streamGenerateContent", "bidiGenerateContent"].includes(item))) capabilities.add("chat");
  if (actions.some((item) => ["embedContent", "batchEmbedContents"].includes(item))) capabilities.add("embedding");
  return [...capabilities];
}

function rowModels(payload: Record<string, unknown>, provider: CompanionModelConnection["provider"]): CompanionModelInfo[] {
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  return sortCompanionModels(rows.map((unknownRow) => {
    const row = unknownRow && typeof unknownRow === "object" ? unknownRow as Record<string, unknown> : {};
    const rawName = String(row.id || row.name || "");
    const supportedActions = stringList(row.supported_actions ?? row.supportedActions) || [];
    const capabilities = provider === "gemini"
      ? capabilitiesForActions(supportedActions)
      : stringList(row.capabilities) || [];
    const modalities = stringList(row.modalities ?? row.input_modalities ?? row.inputModalities) || [];
    const pricing = safePricing(row.price ?? row.pricing);
    const contextTokens = numeric(row.context_length ?? row.context_window ?? row.input_token_limit ?? row.inputTokenLimit ?? row.max_input_tokens);
    const outputTokens = numeric(row.output_token_limit ?? row.outputTokenLimit ?? row.max_output_tokens ?? row.max_tokens);
    const directory = Object.fromEntries(Object.entries({ supportedActions: supportedActions.length ? supportedActions : undefined, capabilities: capabilities.length ? capabilities : undefined, modalities: modalities.length ? modalities : undefined, contextTokens, outputTokens, pricing }).filter(([, item]) => item !== undefined));
    return { id: rawName.replace(/^models\//, ""), displayName: String(row.display_name || row.displayName || row.name || rawName), ...(Object.keys(directory).length ? { directory } : {}) };
  }));
}

function mergeModels(pages: readonly CompanionModelInfo[][]): CompanionModelInfo[] {
  const merged = new Map<string, CompanionModelInfo>();
  for (const page of pages) for (const item of page) {
    const old = merged.get(item.id);
    if (!old) { merged.set(item.id, item); continue; }
    const union = (left: string[] | undefined, right: string[] | undefined) => [...new Set([...(left || []), ...(right || [])])];
    merged.set(item.id, { ...old, ...item, directory: {
      ...old.directory, ...item.directory,
      supportedActions: union(old.directory?.supportedActions, item.directory?.supportedActions),
      capabilities: union(old.directory?.capabilities, item.directory?.capabilities),
      modalities: union(old.directory?.modalities, item.directory?.modalities),
      pricing: { ...(old.directory?.pricing || {}), ...(item.directory?.pricing || {}) },
    } });
  }
  return sortCompanionModels([...merged.values()]);
}

function fetchFor(connection: CompanionModelConnection, override?: SafeFetch): SafeFetch {
  if (override) return override;
  if (!connection.transportDispatcher) return (url, init) => fetch(url, init);
  return (url, init) => undiciFetch(url, { ...init, dispatcher: connection.transportDispatcher }) as unknown as Promise<Response>;
}

export function resolveOfficialProviderBaseUrl(connection: Pick<CompanionModelConnection, "provider" | "baseUrl" | "providerSettings">): string {
  if (connection.provider === "qwen") {
    const region = connection.providerSettings?.region || "singapore";
    if (region === "singapore") return "https://dashscope-intl.aliyuncs.com/api/v1";
    if (region === "hongkong") return "https://cn-hongkong.dashscope.aliyuncs.com/api/v1";
    if (region === "beijing-workspace") {
      const workspace = String(connection.providerSettings?.workspaceId || "").trim();
      if (!/^[A-Za-z0-9_-]{2,128}$/.test(workspace)) throw new Error("北京百炼连接需要有效的 Workspace ID。");
      return `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1`;
    }
    throw new Error("不支持的百炼服务区域。");
  }
  return connection.baseUrl.replace(/\/+$/, "");
}

/**
 * Discovers only account visibility. It never creates a completion or media
 * task and therefore never writes capability verification evidence.
 */
export async function discoverOfficialProviderCatalog(
  connection: CompanionModelConnection,
  signal?: AbortSignal,
  fetchOverride?: SafeFetch,
): Promise<ProviderCatalogDiscoveryResult> {
  const entry = providerCatalogEntry(connection.provider);
  if (!entry) throw new Error("未知模型服务商。");
  if (connection.provider !== "custom" && connection.provider !== "qwen" && !officialProviderEndpoint(connection.provider, connection.baseUrl)) {
    throw new Error("当前地址不是该厂商的官方端点；不会继承官方目录或认证规则。");
  }
  if (entry.discoveryMode === "staticCuratedThenProbe") {
    return { models: entry.models.map((item) => ({ id: item.id, displayName: item.displayName || item.id })), source: "official-static", authenticationChecked: false, generationRequests: 0, note: entry.verificationPolicy.note };
  }
  if (entry.discoveryMode === "asyncMediaNoFreeProbe") {
    return { models: entry.models.map((item) => ({ id: item.id, displayName: item.displayName || item.id })), source: "none", authenticationChecked: false, generationRequests: 0, note: entry.verificationPolicy.note };
  }
  if (entry.discoveryMode === "endpointCatalog") {
    const endpointId = String(connection.providerSettings?.endpointId || "").trim();
    if (!endpointId) throw new Error("请填写账号的推理接入点 ID。");
    return { models: [{ id: endpointId, displayName: `接入点 ${endpointId}` }], source: "endpoint", authenticationChecked: false, generationRequests: 0, note: "已保存接入点 ID；基础模型名称只作展示。" };
  }

  const baseUrl = resolveOfficialProviderBaseUrl(connection);
  const fetchImpl = fetchFor(connection, fetchOverride);
  if (connection.provider === "gemini") {
    const pages: CompanionModelInfo[][] = [];
    const seenTokens = new Set<string>();
    let pageToken = "";
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
      const payload = await checkedJson(`${baseUrl}/models?${query}`, connection, signal, fetchImpl);
      pages.push(rowModels(payload, "gemini"));
      const next = String(payload.nextPageToken || "").trim();
      if (!next) return { models: mergeModels(pages), source: "account", authenticationChecked: true, generationRequests: 0, note: "已读取完整 models.list；supported_actions 仅作为目录元数据。" };
      if (seenTokens.has(next)) throw new Error("Gemini 模型目录返回了重复分页标记；未保存不完整目录。");
      seenTokens.add(next); pageToken = next;
    }
    throw new Error("Gemini 模型目录超过 20 页安全上限；未保存不完整目录。");
  }
  if (connection.provider === "anthropic") {
    const pages: CompanionModelInfo[][] = [];
    const seenCursors = new Set<string>();
    let afterId = "";
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ limit: "1000", ...(afterId ? { after_id: afterId } : {}) });
      const payload = await checkedJson(`${baseUrl}/v1/models?${query}`, connection, signal, fetchImpl);
      pages.push(rowModels(payload, "anthropic"));
      if (payload.has_more !== true) return { models: mergeModels(pages), source: "account", authenticationChecked: true, generationRequests: 0, note: "已读取完整 Claude 账号模型目录；capabilities 只作为目录元数据。" };
      const next = String(payload.last_id || "").trim();
      if (!next) throw new Error("Claude 模型目录声明还有下一页，但没有返回 last_id；未保存不完整目录。");
      if (seenCursors.has(next)) throw new Error("Claude 模型目录返回了重复游标；未保存不完整目录。");
      seenCursors.add(next); afterId = next;
    }
    throw new Error("Claude 模型目录超过 20 页安全上限；未保存不完整目录。");
  }
  if (connection.provider === "qwen") {
    const found: CompanionModelInfo[] = [];
    let page = 1;
    for (; page <= 20; page += 1) {
      const payload = await checkedJson(`${baseUrl}/models?page=${page}&page_size=100`, connection, signal, fetchImpl);
      found.push(...rowModels(payload, "qwen"));
      const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : undefined;
      const rows = data && Array.isArray(data.models) ? data.models : undefined;
      if (rows) found.push(...rowModels({ models: rows }, "qwen"));
      const hasMore = Boolean(payload.has_more ?? data?.has_more);
      if (!hasMore && (!rows || rows.length < 100)) break;
    }
    return { models: mergeModels([found]), source: "account", authenticationChecked: true, generationRequests: 0, note: `已读取百炼账号目录（${page} 页）；能力元数据仍需执行适配器验证。` };
  }
  const payload = await checkedJson(`${baseUrl}/models`, connection, signal, fetchImpl);
  return { models: rowModels(payload, connection.provider), source: "account", authenticationChecked: true, generationRequests: 0, note: "目录读取成功；尚未产生模型调用。" };
}
