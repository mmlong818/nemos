/**
 * Official provider configuration registry.
 *
 * A row here describes how to configure and discover a provider. It does not
 * claim that an account can execute a model: catalog visibility and capability
 * verification are deliberately separate states.
 */
export const PROVIDER_CATALOG_RETRIEVED_AT = "2026-09-20";
export const PROVIDER_CATALOG_VERSION = "2026-09-20.1";

export type ProviderId =
  | "openai" | "anthropic" | "gemini" | "zhipu" | "minimax"
  | "volcengine" | "qwen" | "kling" | "vidu" | "pixverse" | "hunyuan"
  | "deepseek" | "custom";

export type ProviderProtocol =
  | "openai-compatible" | "anthropic" | "gemini-native" | "dashscope-native"
  | "ark" | "async-media" | "tencent-tc3";
export type DiscoveryMode = "accountCatalog" | "staticCuratedThenProbe" | "endpointCatalog" | "asyncMediaNoFreeProbe";
export type CredentialAuthScheme = "bearer" | "x-api-key" | "x-goog-api-key" | "api-key-trace" | "tc3";
export type ProviderCapability = "chat" | "vision" | "speech_to_text" | "text_to_speech" | "image_generation" | "video_generation" | "embedding";
export type CatalogAdapter = "openai-models" | "anthropic-models" | "gemini-models" | "minimax-models" | "bailian-models" | "none";

export interface ProviderCredentialField {
  id: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
}
export interface ProviderSettingField {
  id: string;
  label: string;
  required: boolean;
  kind: "text" | "select";
  options?: ReadonlyArray<{ value: string; label: string }>;
  note?: string;
}
export interface ProviderModelEntry {
  id: string;
  displayName?: string;
  capabilities: ProviderCapability[];
  lifecycle: "active" | "preview" | "retired";
  recommended?: boolean;
  sourceUrl: string;
}
export interface ProviderCatalogEntry {
  providerId: ProviderId;
  brand: string;
  region: "global" | "cn" | "multi" | "custom";
  protocol: ProviderProtocol;
  authScheme: CredentialAuthScheme;
  officialEndpoints: readonly string[];
  defaultEndpoint: string;
  sourceUrls: readonly string[];
  discoveryMode: DiscoveryMode;
  catalogAdapter: CatalogAdapter;
  credentialFields: readonly ProviderCredentialField[];
  settingFields: readonly ProviderSettingField[];
  models: readonly ProviderModelEntry[];
  adapterStatus: Partial<Record<ProviderCapability, "wired" | "integration_pending">>;
  verificationPolicy: {
    catalogIsAuthenticationOnly: true;
    automaticPaidProbe: false;
    note: string;
  };
  endpointIdRequired?: boolean;
  note: string;
}

const key = (label = "API Key"): ProviderCredentialField => ({ id: "apiKey", label, secret: true, required: true });
const model = (id: string, capabilities: ProviderCapability[], sourceUrl: string, options: Partial<ProviderModelEntry> = {}): ProviderModelEntry => ({
  id, capabilities, lifecycle: "active", ...options, sourceUrl,
});
const OPENAI_MODELS = "https://developers.openai.com/api/docs/models";
const ANTHROPIC_MODELS = "https://platform.claude.com/docs/en/models/overview";
const GEMINI_MODELS = "https://ai.google.dev/gemini-api/docs/models";
const ZHIPU_MODELS = "https://docs.bigmodel.cn/cn/guide/start/model-overview.md";
const MINIMAX_MODELS = "https://platform.minimaxi.com/docs/guides/models-intro.md";
const ARK_MODELS = "https://www.volcengine.com/docs/82379/1554711";
const BAILIAN_MODELS = "https://help.aliyun.com/zh/model-studio/models";

export const PROVIDER_CATALOG = Object.freeze({
  schema: "clownfish.provider-catalog",
  version: PROVIDER_CATALOG_VERSION,
  retrievedAt: PROVIDER_CATALOG_RETRIEVED_AT,
  providers: [
    {
      providerId: "openai", brand: "OpenAI", region: "global", protocol: "openai-compatible", authScheme: "bearer",
      officialEndpoints: ["https://api.openai.com/v1"], defaultEndpoint: "https://api.openai.com/v1",
      sourceUrls: [OPENAI_MODELS, "https://developers.openai.com/api/reference/cli/resources/models/methods/retrieve"],
      discoveryMode: "accountCatalog", catalogAdapter: "openai-models", credentialFields: [key()], settingFields: [],
      models: [
        model("gpt-5.4", ["chat", "vision"], OPENAI_MODELS, { recommended: true }),
        model("gpt-transcribe", ["speech_to_text"], OPENAI_MODELS, { recommended: true }),
        model("gpt-4o-transcribe", ["speech_to_text"], OPENAI_MODELS),
        model("gpt-4o-mini-transcribe", ["speech_to_text"], OPENAI_MODELS),
        model("gpt-4o-transcribe-diarize", ["speech_to_text"], OPENAI_MODELS),
        model("gpt-4o-mini-tts", ["text_to_speech"], OPENAI_MODELS, { recommended: true }),
        model("tts-1", ["text_to_speech"], OPENAI_MODELS), model("tts-1-hd", ["text_to_speech"], OPENAI_MODELS),
        model("gpt-image-2.5-sunburst", ["image_generation"], OPENAI_MODELS, { recommended: true }),
        model("gpt-image-2.5-flare", ["image_generation"], OPENAI_MODELS),
        model("text-embedding-3-large", ["embedding"], OPENAI_MODELS, { recommended: true }),
        model("text-embedding-3-small", ["embedding"], OPENAI_MODELS),
      ],
      adapterStatus: { chat: "wired", vision: "wired", speech_to_text: "wired", text_to_speech: "wired", image_generation: "wired", embedding: "integration_pending" },
      verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "读取 /models 不产生生成费用；各能力仍需用户显式验证。" },
      note: "官方目录只证明账号可见性，不证明某项能力已通过调用。",
    },
    {
      providerId: "anthropic", brand: "Anthropic Claude", region: "global", protocol: "anthropic", authScheme: "x-api-key",
      officialEndpoints: ["https://api.anthropic.com"], defaultEndpoint: "https://api.anthropic.com",
      sourceUrls: [ANTHROPIC_MODELS, "https://platform.claude.com/docs/en/api/models", "https://platform.claude.com/docs/en/api/overview"],
      discoveryMode: "accountCatalog", catalogAdapter: "anthropic-models", credentialFields: [key()],
      settingFields: [{ id: "workspaceId", label: "Workspace ID（可选）", required: false, kind: "text" }],
      models: [
        model("claude-fable-5-1", ["chat", "vision"], ANTHROPIC_MODELS, { recommended: true }),
        model("claude-opus-5", ["chat", "vision"], ANTHROPIC_MODELS),
        model("claude-sonnet-5", ["chat", "vision"], ANTHROPIC_MODELS, { recommended: true }),
        model("claude-haiku-4-5-20251001", ["chat", "vision"], ANTHROPIC_MODELS, { recommended: true }),
      ], adapterStatus: { chat: "wired", vision: "integration_pending" },
      verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "模型目录读取后仍需显式发送 Messages 验证。" }, note: "支持可选 Workspace 作用域。",
    },
    {
      providerId: "gemini", brand: "Google Gemini", region: "global", protocol: "gemini-native", authScheme: "x-goog-api-key",
      officialEndpoints: ["https://generativelanguage.googleapis.com/v1beta"], defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta",
      sourceUrls: [GEMINI_MODELS, "https://ai.google.dev/api/models", "https://ai.google.dev/gemini-api/docs/get-started"],
      discoveryMode: "accountCatalog", catalogAdapter: "gemini-models", credentialFields: [key("Gemini API Key")], settingFields: [],
      models: [
        model("gemini-3.8-flash", ["chat", "vision"], GEMINI_MODELS, { recommended: true }), model("gemini-3.7-flash", ["chat", "vision"], GEMINI_MODELS),
        model("gemini-3.6-flash", ["chat", "vision"], GEMINI_MODELS), model("gemini-3.1-pro-preview", ["chat", "vision"], GEMINI_MODELS, { lifecycle: "preview" }),
        model("gemini-3.1-flash-image", ["image_generation"], GEMINI_MODELS, { recommended: true }), model("gemini-3.1-flash-lite-image", ["image_generation"], GEMINI_MODELS), model("gemini-3-pro-image", ["image_generation"], GEMINI_MODELS),
        model("gemini-3.5-transcribe", ["speech_to_text"], GEMINI_MODELS), model("gemini-3.1-flash-tts-preview", ["text_to_speech"], GEMINI_MODELS, { lifecycle: "preview" }),
        model("gemini-embedding-001", ["embedding"], GEMINI_MODELS, { recommended: true }), model("gemini-omni-1.1-flash", ["video_generation"], GEMINI_MODELS),
      ], adapterStatus: { chat: "integration_pending", vision: "integration_pending", image_generation: "integration_pending", speech_to_text: "integration_pending", text_to_speech: "integration_pending", video_generation: "integration_pending", embedding: "integration_pending" },
      verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "models.list 为无生成目录请求；执行能力需显式验证。" }, note: "使用 Gemini 原生 models.list 与 supported_actions。",
    },
    {
      providerId: "zhipu", brand: "智谱 BigModel", region: "cn", protocol: "openai-compatible", authScheme: "bearer",
      officialEndpoints: ["https://open.bigmodel.cn/api/paas/v4"], defaultEndpoint: "https://open.bigmodel.cn/api/paas/v4", sourceUrls: [ZHIPU_MODELS, "https://docs.bigmodel.cn/llms.txt"],
      discoveryMode: "staticCuratedThenProbe", catalogAdapter: "none", credentialFields: [key()], settingFields: [],
      models: [model("glm-5.3", ["chat"], ZHIPU_MODELS, { recommended: true }), model("glm-5.3-flash", ["vision"], ZHIPU_MODELS), model("glm-5.3-flashx", ["vision"], ZHIPU_MODELS), model("glm-asr-2512", ["speech_to_text"], ZHIPU_MODELS), model("glm-tts", ["text_to_speech"], ZHIPU_MODELS), model("glm-image", ["image_generation"], ZHIPU_MODELS), model("cogvideox-3", ["video_generation"], ZHIPU_MODELS), model("embedding-3", ["embedding"], ZHIPU_MODELS)],
      adapterStatus: { chat: "wired", vision: "integration_pending", speech_to_text: "integration_pending", text_to_speech: "integration_pending", image_generation: "integration_pending", video_generation: "integration_pending", embedding: "integration_pending" },
      verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "没有通用 models API；只载入官方静态候选，用户确认后才付费验证。" }, note: "静态候选不是账号可用性证明。",
    },
    {
      providerId: "minimax", brand: "MiniMax 中国", region: "cn", protocol: "openai-compatible", authScheme: "bearer",
      officialEndpoints: ["https://api.minimax.cn/v1"], defaultEndpoint: "https://api.minimax.cn/v1", sourceUrls: [MINIMAX_MODELS, "https://platform.minimaxi.com/docs/llms.txt"],
      discoveryMode: "accountCatalog", catalogAdapter: "minimax-models", credentialFields: [key()], settingFields: [],
      models: [model("MiniMax-M3", ["chat", "vision"], MINIMAX_MODELS, { recommended: true }), model("MiniMax-M2.7", ["chat"], MINIMAX_MODELS), model("MiniMax-M2.7-highspeed", ["chat"], MINIMAX_MODELS), model("asr-1.0", ["speech_to_text"], MINIMAX_MODELS), model("speech-2.8-hd", ["text_to_speech"], MINIMAX_MODELS), model("speech-2.8-turbo", ["text_to_speech"], MINIMAX_MODELS), model("image-01", ["image_generation"], MINIMAX_MODELS), model("image-01-live", ["image_generation"], MINIMAX_MODELS), model("MiniMax-H3", ["video_generation"], MINIMAX_MODELS), model("MiniMax-H3-Max", ["video_generation"], MINIMAX_MODELS)],
      adapterStatus: { chat: "integration_pending", vision: "integration_pending", speech_to_text: "integration_pending", text_to_speech: "integration_pending", image_generation: "integration_pending", video_generation: "integration_pending" },
      verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "读取官方模型目录后仍需显式验证能力。" }, note: "中国站官方 API。",
    },
    {
      providerId: "volcengine", brand: "火山方舟 / 豆包 / Seedance", region: "cn", protocol: "ark", authScheme: "bearer",
      officialEndpoints: ["https://ark.cn-beijing.volces.com/api/v3"], defaultEndpoint: "https://ark.cn-beijing.volces.com/api/v3", sourceUrls: [ARK_MODELS, "https://www.volcengine.com/docs/82379/1795150"],
      discoveryMode: "endpointCatalog", catalogAdapter: "none", credentialFields: [key("ARK API Key")], settingFields: [{ id: "endpointId", label: "推理接入点 ID", required: true, kind: "text", note: "实际调用使用账号接入点 ID；基础模型名只用于展示。" }], endpointIdRequired: true,
      models: [model("doubao-seed-2-0-lite-260215", ["chat"], ARK_MODELS)], adapterStatus: { chat: "integration_pending", vision: "integration_pending", image_generation: "integration_pending", video_generation: "integration_pending" },
      verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "保存接入点 ID；未经用户确认不创建生成任务。" }, note: "Seedance/Seedream 必须使用账号推理接入点 ID，基础模型名不能代替 endpointId。",
    },
    {
      providerId: "qwen", brand: "阿里百炼 / 通义千问 / 通义万相", region: "multi", protocol: "dashscope-native", authScheme: "bearer",
      officialEndpoints: ["https://dashscope-intl.aliyuncs.com/api/v1", "https://cn-hongkong.dashscope.aliyuncs.com/api/v1"], defaultEndpoint: "https://dashscope-intl.aliyuncs.com/api/v1", sourceUrls: [BAILIAN_MODELS, "https://help.aliyun.com/zh/model-studio/list-models"],
      discoveryMode: "accountCatalog", catalogAdapter: "bailian-models", credentialFields: [key("DASHSCOPE API Key")], settingFields: [
        { id: "region", label: "服务区域", required: true, kind: "select", options: [{ value: "singapore", label: "新加坡" }, { value: "hongkong", label: "香港" }, { value: "beijing-workspace", label: "北京 Workspace" }] },
        { id: "workspaceId", label: "Workspace ID", required: false, kind: "text", note: "北京 Workspace 区域必填。" },
      ], models: [model("qwen3.8-max", ["chat"], BAILIAN_MODELS, { recommended: true }), model("qwen3.8-flash", ["chat"], BAILIAN_MODELS, { recommended: true }), model("qwen3.7-plus", ["chat"], BAILIAN_MODELS), model("qwen3.7-flash", ["chat"], BAILIAN_MODELS), model("qwen3-tts-flash", ["text_to_speech"], BAILIAN_MODELS), model("qwen3-tts-instruct-flash", ["text_to_speech"], BAILIAN_MODELS), model("qwen-audio-3.1-tts-flash", ["text_to_speech"], BAILIAN_MODELS), model("wan2.6-t2i", ["image_generation"], BAILIAN_MODELS), model("wan2.6-image", ["image_generation"], BAILIAN_MODELS), model("wan3.0-video", ["video_generation"], "https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference", { recommended: true }), model("wan3.0-video-prime", ["video_generation"], "https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference"), model("qwen3.7-text-embedding", ["embedding"], BAILIAN_MODELS), model("qwen3.7-text-embedding-flash", ["embedding"], BAILIAN_MODELS), model("qwen3-vl-embedding", ["embedding"], BAILIAN_MODELS)],
      adapterStatus: { chat: "integration_pending", text_to_speech: "integration_pending", image_generation: "integration_pending", embedding: "integration_pending" }, verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "目录按分页和 capabilities 读取；不会自动调用模型。" }, note: "万相作为百炼中的媒体能力展示。",
    },
    { providerId: "deepseek", brand: "DeepSeek", region: "global", protocol: "openai-compatible", authScheme: "bearer", officialEndpoints: ["https://api.deepseek.com"], defaultEndpoint: "https://api.deepseek.com", sourceUrls: ["https://api-docs.deepseek.com/updates/"], discoveryMode: "accountCatalog", catalogAdapter: "openai-models", credentialFields: [key()], settingFields: [], models: [], adapterStatus: { chat: "wired" }, verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "目录与执行验证分开。" }, note: "保留现有 DeepSeek 连接兼容。" },
    { providerId: "kling", brand: "可灵 Kling", region: "global", protocol: "async-media", authScheme: "bearer", officialEndpoints: [], defaultEndpoint: "", sourceUrls: ["https://kling.ai/document-api/apiReference/model/textToVideo"], discoveryMode: "asyncMediaNoFreeProbe", catalogAdapter: "none", credentialFields: [key()], settingFields: [], models: [model("kling-v2-6", ["video_generation"], "https://kling.ai/document-api/apiReference/model/textToVideo")], adapterStatus: { video_generation: "integration_pending" }, verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "官方公开页不足以安全确定当前主机、认证和任务路径；只保存凭据，不自动创建任务。" }, note: "等待补齐可核验的官方 API 契约后接入。" },
    { providerId: "vidu", brand: "Vidu", region: "global", protocol: "async-media", authScheme: "bearer", officialEndpoints: ["https://api.vidu.com"], defaultEndpoint: "https://api.vidu.com", sourceUrls: ["https://platform.vidu.com/docs/text-to-video", "https://docs.platform.vidu.com/"], discoveryMode: "asyncMediaNoFreeProbe", catalogAdapter: "none", credentialFields: [key("Vidu API Key（Token）")], settingFields: [], models: [model("viduq3-pro", ["video_generation"], "https://platform.vidu.com/docs/text-to-video", { recommended: true }), model("q3-turbo", ["video_generation"], "https://platform.vidu.com/docs/text-to-video"), model("q2", ["video_generation"], "https://platform.vidu.com/docs/text-to-video"), model("q1", ["video_generation"], "https://platform.vidu.com/docs/text-to-video")], adapterStatus: { video_generation: "integration_pending" }, verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "Authorization 使用 Token；保存凭据不创建付费视频任务。" }, note: "异步视频任务接入待完成。" },
    { providerId: "pixverse", brand: "拍我 AI / PixVerse", region: "global", protocol: "async-media", authScheme: "api-key-trace", officialEndpoints: ["https://app-api.pixverse.ai/openapi/v2"], defaultEndpoint: "https://app-api.pixverse.ai/openapi/v2", sourceUrls: ["https://pixverse.ai/en/developers", "https://docs.platform.pixverse.ai/how-does-the-api-work-882967m0", "https://docs.platform.pixverse.ai/text-to-video-generation-13016634e0"], discoveryMode: "asyncMediaNoFreeProbe", catalogAdapter: "none", credentialFields: [key("API-KEY")], settingFields: [], models: [model("v6", ["video_generation"], "https://docs.platform.pixverse.ai/text-to-video-generation-13016634e0", { recommended: true })], adapterStatus: { video_generation: "integration_pending" }, verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "每次请求都必须生成新的 Ai-trace-id；保存凭据不创建任务。" }, note: "异步视频任务接入待完成。" },
    { providerId: "hunyuan", brand: "腾讯混元视频", region: "cn", protocol: "tencent-tc3", authScheme: "tc3", officialEndpoints: ["https://vclm.tencentcloudapi.com"], defaultEndpoint: "https://vclm.tencentcloudapi.com", sourceUrls: ["https://cloud.tencent.com/document/product/1616/126160", "https://cloud.tencent.com/document/product/1616/107795"], discoveryMode: "asyncMediaNoFreeProbe", catalogAdapter: "none", credentialFields: [{ id: "secretId", label: "SecretId", secret: true, required: true }, { id: "secretKey", label: "SecretKey", secret: true, required: true }], settingFields: [{ id: "region", label: "地域", required: true, kind: "text" }], models: [], adapterStatus: { video_generation: "integration_pending" }, verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "使用 TC3-HMAC-SHA256；没有独立模型 ID 选择器，保存后不提交视频任务。" }, note: "原生 Action 为 SubmitHunyuanToVideoJob / DescribeHunyuanToVideoJob。" },
    { providerId: "custom", brand: "高级自定义服务", region: "custom", protocol: "openai-compatible", authScheme: "bearer", officialEndpoints: [], defaultEndpoint: "http://127.0.0.1:1234/v1", sourceUrls: [], discoveryMode: "accountCatalog", catalogAdapter: "openai-models", credentialFields: [{ ...key(), required: false }], settingFields: [{ id: "baseUrl", label: "API 地址", required: true, kind: "text" }, { id: "protocol", label: "协议", required: true, kind: "select", options: [{ value: "openai-compatible", label: "OpenAI 兼容" }, { value: "anthropic", label: "Anthropic" }] }], models: [], adapterStatus: { chat: "wired" }, verificationPolicy: { catalogIsAuthenticationOnly: true, automaticPaidProbe: false, note: "自定义主机永不继承官方品牌、推荐或能力声明。" }, note: "供网关、本地模型和兼容服务使用。" },
  ],
} satisfies { schema: "clownfish.provider-catalog"; version: string; retrievedAt: string; providers: ProviderCatalogEntry[] });

export function providerCatalogEntry(providerId: unknown): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.providers.find((item) => item.providerId === providerId);
}

export function providerPublicCatalog(): typeof PROVIDER_CATALOG {
  return PROVIDER_CATALOG;
}

export function officialProviderEndpoint(providerId: ProviderId, baseUrl: string): boolean {
  const entry = providerCatalogEntry(providerId);
  const normalized = baseUrl.replace(/\/+$/, "");
  return Boolean(entry && entry.officialEndpoints.some((endpoint) => endpoint.replace(/\/+$/, "") === normalized));
}
