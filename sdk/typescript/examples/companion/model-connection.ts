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
}

export interface CompanionModelProviderPreset {
  id: CompanionModelProvider;
  name: string;
  protocol: CompanionModelProtocol;
  baseUrl: string;
  model: string;
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
    keyRequired: true,
    note: "支持对话、记忆向量、识图、语音与联网搜索。",
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    keyRequired: true,
    note: "支持对话、工具调用与记忆向量。",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5",
    keyRequired: true,
    note: "支持对话与工具调用；记忆检索使用本地文字索引。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    keyRequired: true,
    note: "支持对话与工具调用；记忆检索使用本地文字索引。",
  },
  {
    id: "qwen",
    name: "通义千问",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-max",
    keyRequired: true,
    note: "使用阿里云百炼的 OpenAI 兼容接口。",
  },
  {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai-compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    model: "MiniMax-M3",
    keyRequired: true,
    note: "使用 MiniMax 的 OpenAI 兼容接口。",
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
  return COMPANION_MODEL_PROVIDER_PRESETS.find((item) => item.id === provider)
    ?? COMPANION_MODEL_PROVIDER_PRESETS[0]!;
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
  const preset = companionModelProviderPreset(input.provider);
  const protocol = preset.id === "custom"
    ? normalizeProtocol(input.protocol)
    : preset.protocol;
  const baseUrl = normalizeBaseUrl(String(input.baseUrl || preset.baseUrl));
  const model = String(input.model || preset.model).trim();
  const apiKey = String(input.apiKey || "").trim();

  if (!model) throw new Error("请填写模型名称。");
  if (model.length > 160 || /[\r\n]/.test(model)) throw new Error("模型名称格式不正确。");
  if (preset.keyRequired && !apiKey) throw new Error(`请填写 ${preset.name} 的 API Key。`);

  return { provider: preset.id, protocol, baseUrl, model, apiKey };
}

export function modelConnectionEndpoint(connection: CompanionModelConnection): string {
  const suffix = connection.protocol === "anthropic" ? "/messages" : "/chat/completions";
  if (connection.baseUrl.endsWith(suffix)) return connection.baseUrl;
  return `${connection.baseUrl}${suffix}`;
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
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("远程 API 必须使用 HTTPS；本机服务可以使用 localhost 或 127.0.0.1。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API 地址不能包含账号、密码、查询参数或锚点。");
  }
  return trimmed;
}
