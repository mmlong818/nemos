// examples/companion/llm.ts — 真实 / 离线 LLM 解析（按环境变量自动选择）
//
// 有 ZHIPU_API_KEY → 用智谱主模型做抽取/复杂任务，embedding-3 做向量检索；日常对话模型由服务端路由。
// 无 key → 离线兜底：本地启发式抽取 + 回声脑（零依赖，仍能演示拓扑）。
//
// 注意：API key 只从环境变量读，绝不硬编码 / 落盘 / 提交。
//   PowerShell:  $env:ZHIPU_API_KEY="..."; npx tsx examples/companion/chat-cli.ts
//   bash:        ZHIPU_API_KEY=... npx tsx examples/companion/chat-cli.ts

import { randomUUID } from "node:crypto";

import {
  AgentRuntime,
  type AgentMessage,
  type AgentModel,
  type AgentRunCheckpoint,
  type AgentRunObserver,
  type AgentStoredRun,
  type AgentTool,
  type AgentToolAuthorizationInput,
  type AgentToolAuthorizationResult,
  type EmbeddingConfig,
  type LLMConfig,
} from "../../src/index.js";
import type { ChatAgentContext, ChatFn, ChatStreamFn } from "./engine.js";
import {
  companionModelProviderPreset,
  defaultCompanionModelConnection,
  modelConnectionEndpoint,
  normalizeCompanionModelConnection,
  type CompanionModelConnection,
} from "./model-connection.js";

const ZHIPU_CHAT_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const ZHIPU_SEARCH_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/web_search";
const ZHIPU_TTS_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/audio/speech";
const ZHIPU_ASR_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions";
const DEFAULT_ZHIPU_MODEL = "glm-5.2";
const VISION_MODEL = "glm-4.6v-flash"; // 免费图像理解模型（识图）

/** 文字转语音（角色专属音色）。 */
export type TtsFn = (text: string, voice: string) => Promise<Buffer>;
/** 语音转文字。 */
export type AsrFn = (audio: Buffer, filename: string, mime: string) => Promise<string>;
export type AgentToolProvider = (
  instruction: string,
  context?: ChatAgentContext,
) => readonly AgentTool[] | Promise<readonly AgentTool[]>;
export type AgentToolAuthorizer = (
  input: AgentToolAuthorizationInput,
) => Promise<AgentToolAuthorizationResult>;

/** 识图：给一段 base64/URL 图片 + 提问，返回文字理解。 */
export type VisionFn = (imageUrl: string, prompt: string) => Promise<string>;

export interface ResolvedLLM {
  /** SDK 抽取/反思用（需 JSON）。 */
  extraction: LLMConfig;
  /** 向量检索用（中文 FTS 弱，强烈建议开）。 */
  embedding: EmbeddingConfig;
  /** 人格"开口"用（free-form 自然语言；内部可自动联网搜索）。 */
  chat: ChatFn;
  /** 流式回复（助理用；无 key 时为 null）。 */
  chatStream: ChatStreamFn | null;
  /** 识图（无 key 时为 null）。 */
  vision: VisionFn | null;
  /** 文字转语音 / 语音转文字（无 key 时为 null）。 */
  tts: TtsFn | null;
  asr: AsrFn | null;
  /** 由产品层追加按当前请求动态选择的工具。 */
  configureAgentTools: (provider: AgentToolProvider) => void;
  /** 记录运行事件、检查点与终态，供服务重启后的恢复和审计使用。 */
  configureAgentObserver: (observer?: AgentRunObserver) => void;
  /** 高权限工具统一进入产品层的持久化审批。 */
  configureAgentAuthorizer: (authorizer?: AgentToolAuthorizer) => void;
  /** 从持久化检查点继续一次中断的 Agent 运行。 */
  resumeAgentRun: ((
    run: AgentStoredRun,
    checkpoint: AgentRunCheckpoint,
    cb?: StreamCb,
  ) => Promise<string>) | null;
  label: string;
  live: boolean;
}

export function resolveLLM(config?: CompanionModelConnection): ResolvedLLM {
  let agentToolProvider: AgentToolProvider = () => [];
  let agentObserver: AgentRunObserver | undefined;
  let agentAuthorizer: AgentToolAuthorizer | undefined;
  const additionalTools: AgentToolProvider = (instruction, context) => agentToolProvider(instruction, context);
  const configureAgentTools = (provider: AgentToolProvider): void => {
    agentToolProvider = provider;
  };
  const configureAgentObserver = (observer?: AgentRunObserver): void => {
    agentObserver = observer;
  };
  const configureAgentAuthorizer = (authorizer?: AgentToolAuthorizer): void => {
    agentAuthorizer = authorizer;
  };
  const connection = config ? normalizeCompanionModelConnection(config) : connectionFromEnvironment();
  if (connection) {
    const chatModel = connection.model;
    const extractModel = process.env.EXTRACT_MODEL || chatModel;
    const provider = companionModelProviderPreset(connection.provider);
    const isZhipu = connection.provider === "zhipu";
    const isOfficialOpenAI = connection.provider === "openai"
      && connection.baseUrl === "https://api.openai.com/v1";
    const tools = isZhipu ? [makeWebSearchTool(connection.apiKey)] : [];
    return {
      extraction: makeConnectionExtract(connection, extractModel),
      embedding: isZhipu
        ? { provider: "zhipu", apiKey: connection.apiKey }
        : isOfficialOpenAI
          ? { provider: "openai", apiKey: connection.apiKey }
          : { provider: "none" },
      chat: makeConnectionChat(connection, chatModel, tools, additionalTools, () => agentObserver, () => agentAuthorizer),
      chatStream: makeConnectionChatStream(connection, chatModel, tools, additionalTools, () => agentObserver, () => agentAuthorizer),
      vision: isZhipu ? makeVision(connection.apiKey) : null,
      tts: isZhipu ? makeTts(connection.apiKey) : null,
      asr: isZhipu ? makeAsr(connection.apiKey) : null,
      configureAgentTools,
      configureAgentObserver,
      configureAgentAuthorizer,
      resumeAgentRun: makeConnectionAgentResume(
        connection,
        chatModel,
        tools,
        additionalTools,
        () => agentObserver,
        () => agentAuthorizer,
      ),
      label: `${provider.name} · ${chatModel}`,
      live: true,
    };
  }
  return {
    extraction: localExtractionLLM(),
    embedding: { provider: "none" },
    chat: echoChat,
    chatStream: null,
    vision: null,
    tts: null,
    asr: null,
    configureAgentTools,
    configureAgentObserver,
    configureAgentAuthorizer,
    resumeAgentRun: null,
    label: "离线模式（本地启发式抽取 + 基础回复）",
    live: false,
  };
}

function connectionFromEnvironment(): CompanionModelConnection | undefined {
  const apiKey = process.env.ZHIPU_API_KEY?.trim();
  if (!apiKey) return undefined;
  const connection = defaultCompanionModelConnection("zhipu", apiKey);
  connection.model = process.env.ZHIPU_MODEL || DEFAULT_ZHIPU_MODEL;
  return connection;
}

// —— 联网搜索工具（function calling；handler 调独立 Web Search API）——
export interface CompanionWebSearchItem {
  title: string;
  content: string;
  url: string;
}

export async function searchWeb(apiKey: string, rawQuery: string, signal?: AbortSignal): Promise<CompanionWebSearchItem[]> {
  const query = freshSearchQuery(rawQuery.trim());
  if (!query) return [];
  const resp = await fetch(ZHIPU_SEARCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ search_engine: "search_pro", search_query: query, count: 8 }),
    signal,
  });
  if (!resp.ok) throw new Error(`搜索失败 HTTP ${resp.status}`);
  const data = await resp.json() as { search_result?: Array<{ title?: string; content?: string; link?: string }> };
  return (data.search_result ?? []).slice(0, 8).map((item) => ({
    title: String(item.title || "").trim(),
    content: String(item.content || "").trim(),
    url: String(item.link || "").trim(),
  }));
}

function makeWebSearchTool(apiKey: string): AgentTool {
  return {
    definition: {
      name: "web_search",
      description:
        "Search the web for time-sensitive or source-sensitive facts. Use it for transport, hotels, restaurants, bookings, prices, schedules, availability, news, markets, weather, locations, ratings, and official-source checks.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "搜索关键词" } },
        required: ["query"],
      },
      effect: "read",
      timeoutMs: 30_000,
    },
    execute: async (args, context) => {
      const query = freshSearchQuery(String(args.query ?? "").trim());
      if (!query) return { content: "（空查询）", isError: true };
      let items: CompanionWebSearchItem[];
      try {
        items = await searchWeb(apiKey, query, context.signal);
      } catch (error) {
        return { content: `（${error instanceof Error ? error.message : String(error)}）`, isError: true };
      }
      if (items.length === 0) return { content: "（没搜到相关结果）" };
      return {
        content: [
          `Search checked at: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`,
          ...items.slice(0, 5).map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 300)}\n${r.url}`),
        ].join("\n\n"),
      };
    },
  };
}

function freshSearchQuery(query: string): string {
  if (!query) return "";
  const now = new Date();
  const yyyyMmDd = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replace(/\//g, "-");
  const year = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now);
  if (/\b20\d{2}\b/.test(query) || query.includes(yyyyMmDd)) return query;
  if (/(今天|今日|最新|当前|现在|24\s*小时|过去\s*24|本周|news|latest|today|current|now)/i.test(query)) {
    return `${query} ${yyyyMmDd} ${year}`;
  }
  return query;
}

// —— 抽取 LLM（包一层强制中文，避免 flash 偶尔输出英文事实）——
function makeConnectionExtract(connection: CompanionModelConnection, model: string): LLMConfig {
  const ZH = "\n\n【语言要求】抽取出的所有文本字段（content / basis 等）必须用中文（与用户输入语言一致），绝不要译成英文。JSON 结构保持不变。";
  return {
    provider: "custom",
    name: `${connection.provider}-extract-zh(${model})`,
    chat: async (system: string, user: string): Promise<string> => {
      const agentModel = makeConnectionAgentModel({
        connection,
        model,
        maxTokens: 2200,
        temperature: 0,
        stream: false,
      });
      const response = await agentModel.complete({
        messages: [
          { role: "system", content: system + ZH + "\n只返回 JSON，不要附加解释或 Markdown 代码块。" },
          { role: "user", content: user },
        ],
        tools: [],
        signal: new AbortController().signal,
      });
      return response.text || "{}";
    },
  };
}

// —— 识图（glm-4v-flash 视觉模型）——
function makeVision(apiKey: string): VisionFn {
  return async (imageUrl: string, prompt: string): Promise<string> => {
    const resp = await fetch(ZHIPU_CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt || "请详细描述这张图片的内容。" },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      throw new Error(`[companion] zhipu vision HTTP ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || "（看不太清这张图）";
  };
}

// —— TTS（GLM-TTS，角色专属音色）——
function makeTts(apiKey: string): TtsFn {
  return async (text, voice) => {
    const resp = await fetch(ZHIPU_TTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "glm-tts",
        input: text.slice(0, 1200),
        voice: voice || "tongtong",
        response_format: "wav",
        speed: 1.0,
      }),
    });
    if (!resp.ok) {
      throw new Error(`[companion] zhipu tts HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    }
    return trimWavLead(Buffer.from(await resp.arrayBuffer()), 1800);
  };
}

// glm-tts 每段音频开头固定有一段 ~1850ms 的引导音（多个纯音脉冲 + 静音交替，逐字节恒定，与文本/音色无关），
// 真正说话在 ~1850ms 后才开始。裁掉开头 leadMs 去除这段"嘟嘟"前导（留余量不切到人声）。
function trimWavLead(wav: Buffer, leadMs: number): Buffer {
  try {
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") return wav;
    const rate = wav.readUInt32LE(24), ch = wav.readUInt16LE(22), bits = wav.readUInt16LE(34);
    // 定位 data chunk
    let off = 12, dataOff = -1, dataSz = 0;
    while (off + 8 <= wav.length) {
      const id = wav.toString("ascii", off, off + 4), sz = wav.readUInt32LE(off + 4);
      if (id === "data") { dataOff = off + 8; dataSz = sz; break; }
      off += 8 + sz + (sz & 1);
    }
    if (dataOff < 0) return wav;
    const bytesPerSample = (bits / 8) * ch;
    let cut = Math.floor((rate * leadMs) / 1000) * bytesPerSample;
    if (cut <= 0 || cut >= dataSz) return wav;
    const pcm = wav.subarray(dataOff + cut, dataOff + dataSz);
    // 重建标准 44 字节头
    const out = Buffer.alloc(44 + pcm.length);
    out.write("RIFF", 0, "ascii"); out.writeUInt32LE(36 + pcm.length, 4); out.write("WAVE", 8, "ascii");
    out.write("fmt ", 12, "ascii"); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(ch, 22);
    out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * bytesPerSample, 28); out.writeUInt16LE(bytesPerSample, 32); out.writeUInt16LE(bits, 34);
    out.write("data", 36, "ascii"); out.writeUInt32LE(pcm.length, 40);
    pcm.copy(out, 44);
    return out;
  } catch { return wav; }
}

// —— ASR（GLM-ASR，语音转文字）——
function makeAsr(apiKey: string): AsrFn {
  return async (audio, filename, mime) => {
    const fd = new FormData();
    fd.append("model", "glm-asr-2512");
    fd.append("stream", "false");
    const fileBytes = new Uint8Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer);
    fd.append("file", new Blob([fileBytes], { type: mime || "audio/webm" }), filename || "audio.webm");
    const resp = await fetch(ZHIPU_ASR_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    if (!resp.ok) {
      throw new Error(`[companion] zhipu asr HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    }
    const data = (await resp.json()) as { text?: string; result?: string; data?: { text?: string } };
    return (data.text ?? data.result ?? data.data?.text ?? "").trim();
  };
}

// —— 智谱 free-form 对话（人格回复；带 function-calling 工具循环；不设 response_format）——
// 联网=模型自动判断：只在确实需要实时/最新信息时才搜，日常闲聊直接答（首 token 才快）。
const TOOL_POLICY =
  "\n\n[Web search ability] You can call web_search, but only when the user needs current, exact, or source-sensitive information. " +
  "Use it for markets, prices, exchange rates, weather, news, sports, company/product status, flights, trains, hotels, restaurants, bookings, opening hours, routes, addresses, phones, ratings, menus, tickets, inventory, and official-source verification. " +
  "Do not invent exact prices, schedules, availability, or booking facts. If search results are weak, say what was checked and what still needs confirmation. " +
  "When the user explicitly asks to install, save, schedule, or change local state and a matching tool is available, call that tool now. Never claim the action succeeded before receiving a successful tool result. " +
  "Use multi-agent delegation only for 2-4 genuinely distinct expert perspectives or parallel verification tasks; keep simple work in the current agent, and let Clownfish synthesize the expert artifacts.";

// 工具按需挂载：弱模型不听"别搜"的话，所以日常/情绪聊天根本不把 web_search 给它。
// 只在用户这句话确实像在问实时硬事实时才挂工具。只看"对方："（用户）说的话，
// 不被角色自己上一条回复（可能恰好提了天气）带偏。
const WEB_CUES =
  /(weather|temperature|rain|typhoon|stock|index|fund|exchange rate|price|quote|ticket|fare|inventory|availability|room status|news|headline|score|match|IPO|market cap|funding|earnings|flight|train|schedule|hotel|restaurant|booking|reservation|opening hours|menu|queue|seat|attraction|ticketing|route|address|phone|rating|review|official|source|verify|today|tomorrow|latest|current|now|nearby|map|availability|\u5929\u6c14|\u6c14\u6e29|\u4e0b\u96e8|\u53f0\u98ce|\u964d\u6e29|\u66b4\u96e8|\u80a1\u4ef7|\u80a1\u7968|\u5927\u76d8|\u6307\u6570|\u57fa\u91d1|\u6da8\u8dcc|\u6c47\u7387|\u7f8e\u5143|\u65e5\u5143|\u6b27\u5143|\u82f1\u9551|\u6bd4\u7279\u5e01|\u6cb9\u4ef7|\u91d1\u4ef7|\u623f\u4ef7|\u591a\u5c11\u94b1|\u62a5\u4ef7|\u7968\u4ef7|\u4ef7\u683c|\u8d39\u7528|\u65b0\u95fb|\u5934\u6761|\u53d1\u751f\u4e86\u4ec0\u4e48|\u51fa\u4ec0\u4e48\u4e8b|\u6bd4\u5206|\u8d5b\u4e8b|\u6bd4\u8d5b|\u593a\u51a0|\u5229\u7387|\u878d\u8d44|\u5e02\u503c|\u4e0a\u5e02|\u8d22\u62a5|\u822a\u73ed|\u8f66\u6b21|\u73ed\u6b21|\u52a8\u8f66|\u9ad8\u94c1|\u706b\u8f66|\u5217\u8f66|\u673a\u7968|\u706b\u8f66\u7968|\u9152\u5e97|\u9910\u9986|\u996d\u5e97|\u9884\u8ba2|\u8ba2\u623f|\u623f\u6001|\u83dc\u5355|\u6392\u961f|\u6392\u53f7|\u8425\u4e1a\u65f6\u95f4|\u5730\u5740|\u7535\u8bdd|\u8bc4\u5206|\u8bc4\u4ef7|\u9644\u8fd1|\u8def\u7ebf|\u5730\u56fe|\u666f\u70b9|\u95e8\u7968|\u5b98\u65b9|\u6765\u6e90|\u6838\u5b9e|\u4eca\u5929|\u660e\u5929|\u6700\u65b0|\u73b0\u5728|\u8def\u51b5|\u9650\u53f7|\u4e0a\u6620|\u7968\u623f|\u6392\u540d|\u699c\u5355)/i;
const WEB_VERBS = /(搜一?下|查一?下|搜搜|帮我查|查查|联网|百度|谷歌|google)/i;
function mightNeedWeb(user: string): boolean {
  const lines = user.split("\n").filter((l) => /^对方/.test(l)).join("\n") || user;
  return WEB_CUES.test(lines) || WEB_VERBS.test(lines);
}

function makeConnectionChat(
  connection: CompanionModelConnection,
  defaultModel: string,
  tools: AgentTool[] = [],
  additionalTools: AgentToolProvider = () => [],
  observer: () => AgentRunObserver | undefined = () => undefined,
  authorizer: () => AgentToolAuthorizer | undefined = () => undefined,
): ChatFn {
  return async (system, user, model, maxTokens, context): Promise<string> => {
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    const extraTools = context?.toolMode === "off" ? [] : [...await additionalTools(context?.instruction ?? user, context)];
    const runtimeTools = context?.toolMode === "off" ? [] : uniqueAgentTools([...tools, ...extraTools]).filter((tool) => context?.toolMode !== "read-only" || readOnlyAgentTool(tool));
    const useTools = runtimeTools.length > 0 && (mightNeedWeb(user) || extraTools.length > 0);
    const sys = useTools
      ? `${system}${TOOL_POLICY}\n（现在是 ${now}（北京时间），引用搜索结果时务必注意时效，过时的就说过时。）`
      : system;
    const requestedMaxTokens = maxTokens || 800;
    const limits = agentLimits(context, requestedMaxTokens);
    const selectedModel = model || defaultModel;
    const completionTokens = Math.min(requestedMaxTokens, limits.maxTokens);
    const runtime = new AgentRuntime(
      makeConnectionAgentModel({
        connection,
        model: selectedModel,
        maxTokens: completionTokens,
        temperature: 0.85,
        stream: false,
      }),
      useTools ? runtimeTools : [],
      {
        maxRounds: limits.maxRounds,
        maxToolRounds: limits.maxToolRounds,
        maxTotalTokens: limits.maxTotalTokens,
        authorizeTool: authorizer(),
      },
    );
    const runId = context?.runId ?? `companion-chat-${randomUUID()}`;
    const result = await runtime.run({
      runId,
      sessionId: context?.sessionId ?? runId,
      systemPrompt: sys,
      prompt: user,
      signal: context?.signal,
      metadata: agentMetadata(context, {
        model: selectedModel,
        maxTokens: String(completionTokens),
        maxRounds: String(limits.maxRounds),
        maxToolRounds: String(limits.maxToolRounds),
        maxTotalTokens: String(limits.maxTotalTokens),
        maxOutputChars: String(limits.maxOutputChars),
        stream: "false",
      }),
      observer: observer(),
    });
    return result.output.slice(0, limits.maxOutputChars).trim() || "（……）";
  };
}

// —— 流式对话（助理用）：每回合走 stream:true；命中工具推「查询中/工作中」，最终回合逐字推文字 ——
function makeConnectionChatStream(
  connection: CompanionModelConnection,
  defaultModel: string,
  tools: AgentTool[] = [],
  additionalTools: AgentToolProvider = () => [],
  observer: () => AgentRunObserver | undefined = () => undefined,
  authorizer: () => AgentToolAuthorizer | undefined = () => undefined,
): ChatStreamFn {
  return async (system, user, cb, model, maxTokens, context) => {
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    const extraTools = context?.toolMode === "off" ? [] : [...await additionalTools(context?.instruction ?? user, context)];
    const runtimeTools = context?.toolMode === "off" ? [] : uniqueAgentTools([...tools, ...extraTools]).filter((tool) => context?.toolMode !== "read-only" || readOnlyAgentTool(tool));
    const useTools = runtimeTools.length > 0 && (mightNeedWeb(user) || extraTools.length > 0);
    const sys = useTools
      ? `${system}${TOOL_POLICY}\n（现在是 ${now}（北京时间），引用搜索结果注意时效。）`
      : system;
    const requestedMaxTokens = maxTokens || 1200;
    const limits = agentLimits(context, requestedMaxTokens);
    const selectedModel = model || defaultModel;
    const completionTokens = Math.min(requestedMaxTokens, limits.maxTokens);
    let emittedChars = 0;
    const runtime = new AgentRuntime(
      makeConnectionAgentModel({
        connection,
        model: selectedModel,
        maxTokens: completionTokens,
        temperature: 0.6,
        stream: true,
      }),
      useTools ? runtimeTools : [],
      {
        maxRounds: limits.maxRounds,
        maxToolRounds: limits.maxToolRounds,
        maxTotalTokens: limits.maxTotalTokens,
        authorizeTool: authorizer(),
      },
    );
    const runId = context?.runId ?? `companion-stream-${randomUUID()}`;
    const result = await runtime.run({
      runId,
      sessionId: context?.sessionId ?? runId,
      systemPrompt: sys,
      prompt: user,
      signal: context?.signal,
      metadata: agentMetadata(context, {
        model: selectedModel,
        maxTokens: String(completionTokens),
        maxRounds: String(limits.maxRounds),
        maxToolRounds: String(limits.maxToolRounds),
        maxTotalTokens: String(limits.maxTotalTokens),
        maxOutputChars: String(limits.maxOutputChars),
        stream: "true",
      }),
      observer: observer(),
      onTextDelta: (text) => {
        const remaining = limits.maxOutputChars - emittedChars;
        if (remaining <= 0) return;
        const bounded = text.slice(0, remaining);
        emittedChars += bounded.length;
        if (bounded) cb.onToken(bounded);
      },
      onEvent: (event) => {
        if (event.type === "tool_start") {
          cb.onStatus(event.call.name === "web_search" ? "查询中" : "工作中");
        } else if (event.type === "tool_end") {
          cb.onStatus("整理中");
        }
      },
    });
    return result.output.slice(0, limits.maxOutputChars).trim() || "（……）";
  };
}

function makeConnectionAgentResume(
  connection: CompanionModelConnection,
  defaultModel: string,
  tools: AgentTool[],
  additionalTools: AgentToolProvider,
  observer: () => AgentRunObserver | undefined,
  authorizer: () => AgentToolAuthorizer | undefined,
): NonNullable<ResolvedLLM["resumeAgentRun"]> {
  return async (run, checkpoint, cb) => {
    const context = storedAgentContext(run);
    const extraTools = [...await additionalTools(context?.instruction ?? run.prompt, context)];
    const runtimeTools = uniqueAgentTools([...tools, ...extraTools]);
    const selectedModel = run.metadata?.model || defaultModel;
    const maxTokens = metadataNumber(run, "maxTokens", 1200, 1, 200_000);
    const maxRounds = metadataNumber(run, "maxRounds", 4, 1, 20);
    const maxToolRounds = metadataNumber(run, "maxToolRounds", 2, 0, maxRounds);
    const maxTotalTokens = metadataNumber(run, "maxTotalTokens", maxTokens * maxRounds * 2, 100, 2_000_000);
    const maxOutputChars = metadataNumber(run, "maxOutputChars", 4_800, 100, 200_000);
    let emittedChars = 0;
    cb?.onStatus("恢复任务");

    const runtime = new AgentRuntime(
      makeConnectionAgentModel({
        connection,
        model: selectedModel,
        maxTokens,
        temperature: 0.6,
        stream: Boolean(cb),
      }),
      runtimeTools,
      {
        maxRounds,
        maxToolRounds,
        maxTotalTokens,
        authorizeTool: authorizer(),
      },
    );
    const result = await runtime.run({
      runId: run.runId,
      sessionId: run.sessionId,
      systemPrompt: run.systemPrompt,
      prompt: run.prompt,
      metadata: run.metadata,
      observer: observer(),
      resume: checkpoint,
      onTextDelta: cb ? (value) => {
        const remaining = maxOutputChars - emittedChars;
        if (remaining <= 0) return;
        const bounded = value.slice(0, remaining);
        emittedChars += bounded.length;
        if (bounded) cb.onToken(bounded);
      } : undefined,
    });
    return result.output.slice(0, maxOutputChars).trim();
  };
}

function storedAgentContext(run: AgentStoredRun): ChatAgentContext | undefined {
  const metadata = run.metadata;
  const mode = metadata?.mode;
  if (
    !metadata?.userId ||
    !metadata.personaId ||
    !metadata.scope ||
    (mode !== "chat" && mode !== "task" && mode !== "group")
  ) {
    return undefined;
  }
  let memoryScopes: string[] = [metadata.scope];
  try {
    const parsed = JSON.parse(metadata.memoryScopes || "[]");
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (cleaned.length > 0) memoryScopes = cleaned;
    }
  } catch {
    // 旧运行没有 memoryScopes 时使用当前会话 scope。
  }
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    userId: metadata.userId,
    personaId: metadata.personaId,
    instruction: run.prompt,
    scope: metadata.scope,
    memoryScopes,
    mode,
    toolMode: metadata.toolMode === "off" ? "off" : metadata.toolMode === "read-only" ? "read-only" : "auto",
  };
}

function metadataNumber(
  run: AgentStoredRun,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(run.metadata?.[key]);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}
function readOnlyAgentTool(tool: AgentTool): boolean {
  return /(^|_)(search|read|get|list|find|lookup|preview|inspect|status|query)(_|$)/i.test(tool.definition.name);
}

function uniqueAgentTools(tools: readonly AgentTool[]): AgentTool[] {
  const byName = new Map<string, AgentTool>();
  for (const tool of tools) byName.set(tool.definition.name, tool);
  return [...byName.values()];
}

function agentMetadata(
  context?: ChatAgentContext,
  runtime: Record<string, string> = {},
): Record<string, string> | undefined {
  if (!context && Object.keys(runtime).length === 0) return undefined;
  return {
    ...(context ? {
      userId: context.userId,
      personaId: context.personaId,
      scope: context.scope,
      mode: context.mode,
      memoryScopes: JSON.stringify(context.memoryScopes),
      toolMode: context.toolMode ?? "auto",
    } : {}),
    ...runtime,
  };
}

function agentLimits(context: ChatAgentContext | undefined, defaultMaxTokens: number): {
  maxRounds: number;
  maxToolRounds: number;
  maxTotalTokens: number;
  maxOutputChars: number;
  maxTokens: number;
} {
  const requested = context?.runtimeLimits;
  const maxRounds = Math.min(20, Math.max(1, requested?.maxRounds ?? 4));
  const maxToolRounds = Math.min(maxRounds, Math.max(0, requested?.maxToolRounds ?? 2));
  const maxOutputChars = Math.min(200_000, Math.max(100, requested?.maxOutputChars ?? defaultMaxTokens * 4));
  const maxTokens = Math.max(1, Math.min(defaultMaxTokens, maxOutputChars));
  const maxTotalTokens = Math.min(
    2_000_000,
    Math.max(100, requested?.maxTotalTokens ?? maxTokens * maxRounds * 2),
  );
  return { maxRounds, maxToolRounds, maxTotalTokens, maxOutputChars, maxTokens };
}
interface ConnectionAgentModelOptions {
  connection: CompanionModelConnection;
  model: string;
  maxTokens: number;
  temperature: number;
  stream: boolean;
}

interface ZhipuToolCall {
  id?: string;
  index?: number;
  function?: { name?: string; arguments?: string };
}

interface ZhipuChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string; tool_calls?: ZhipuToolCall[] };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function makeConnectionAgentModel(options: ConnectionAgentModelOptions): AgentModel {
  return options.connection.protocol === "anthropic"
    ? makeAnthropicAgentModel(options)
    : makeOpenAICompatibleAgentModel(options);
}

function makeOpenAICompatibleAgentModel(options: ConnectionAgentModelOptions): AgentModel {
  return {
    complete: async (request) => {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: request.messages.map(toZhipuMessage),
      };
      const outputTokens = Math.max(1, Math.min(options.maxTokens, request.maxOutputTokens ?? options.maxTokens));
      if (options.connection.provider === "openai") {
        body.max_completion_tokens = outputTokens;
      } else {
        body.max_tokens = outputTokens;
        body.temperature = options.temperature;
      }
      if (options.connection.provider === "zhipu") body.thinking = { type: "disabled" };
      if (request.tools.length > 0) body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      if (options.stream) body.stream = true;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (options.connection.apiKey) headers.Authorization = `Bearer ${options.connection.apiKey}`;
      const resp = await fetch(modelConnectionEndpoint(options.connection), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (!resp.ok) {
        const provider = companionModelProviderPreset(options.connection.provider).name;
        throw new Error(`[companion] ${provider} HTTP ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
      }
      return options.stream
        ? readZhipuStream(resp, request.onTextDelta)
        : readZhipuResponse(resp);
    },
  };
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function makeAnthropicAgentModel(options: ConnectionAgentModelOptions): AgentModel {
  return {
    complete: async (request) => {
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const body: Record<string, unknown> = {
        model: options.model,
        system,
        messages: request.messages.flatMap(toAnthropicMessage),
        max_tokens: Math.max(1, Math.min(options.maxTokens, request.maxOutputTokens ?? options.maxTokens)),
        temperature: options.temperature,
      };
      if (request.tools.length > 0) body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };
      if (options.connection.apiKey) {
        headers["x-api-key"] = options.connection.apiKey;
        headers.Authorization = `Bearer ${options.connection.apiKey}`;
      }
      const resp = await fetch(modelConnectionEndpoint(options.connection), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (!resp.ok) {
        const provider = companionModelProviderPreset(options.connection.provider).name;
        throw new Error(`[companion] ${provider} HTTP ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
      }
      const data = await resp.json() as {
        content?: AnthropicContentBlock[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const blocks = data.content ?? [];
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
      if (text) request.onTextDelta?.(text);
      return {
        text,
        toolCalls: blocks.flatMap((block, index) => block.type === "tool_use" && block.name
          ? [{
              id: block.id || `tool-call-${index + 1}`,
              name: block.name,
              arguments: block.input && typeof block.input === "object" ? block.input : {},
            }]
          : []),
        stopReason: data.stop_reason,
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      };
    },
  };
}

function toAnthropicMessage(message: AgentMessage): Array<Record<string, unknown>> {
  if (message.role === "system") return [];
  if (message.role === "assistant" && message.toolCalls?.length) {
    const content: Array<Record<string, unknown>> = [];
    if (message.content) content.push({ type: "text", text: message.content });
    content.push(...message.toolCalls.map((call) => ({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: call.arguments,
    })));
    return [{ role: "assistant", content }];
  }
  if (message.role === "tool") {
    return [{
      role: "user",
      content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }],
    }];
  }
  return [{ role: message.role, content: message.content }];
}

function toZhipuMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  return { role: message.role, content: message.content };
}

async function readZhipuResponse(resp: Response): Promise<{
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}> {
  const data = (await resp.json()) as ZhipuChatResponse;
  const choice = data.choices?.[0];
  const message = choice?.message;
  return {
    text: message?.content ?? "",
    toolCalls: parseZhipuToolCalls(message?.tool_calls ?? []),
    stopReason: choice?.finish_reason,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

async function readZhipuStream(
  resp: Response,
  onTextDelta?: (text: string) => void,
): Promise<{
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  inputTokens?: number;
  outputTokens?: number;
}> {
  if (!resp.body) throw new Error("[companion] zhipu stream response has no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let data: {
      choices?: Array<{ delta?: { content?: string; tool_calls?: ZhipuToolCall[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try { data = JSON.parse(payload) as typeof data; } catch { return; }
    if (Number.isFinite(data.usage?.prompt_tokens)) inputTokens = Math.max(0, Math.floor(data.usage!.prompt_tokens!));
    if (Number.isFinite(data.usage?.completion_tokens)) outputTokens = Math.max(0, Math.floor(data.usage!.completion_tokens!));
    const delta = data.choices?.[0]?.delta;
    if (delta?.content) {
      content += delta.content;
      onTextDelta?.(delta.content);
    }
    for (const item of delta?.tool_calls ?? []) {
      const index = item.index ?? 0;
      const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (item.id) current.id = item.id;
      if (item.function?.name) current.name += item.function.name;
      if (item.function?.arguments) current.arguments += item.function.arguments;
      calls.set(index, current);
    }
  };

  for await (const chunk of resp.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
  return {
    text: content,
    toolCalls: [...calls.entries()].flatMap(([index, call]) => call.name.trim()
      ? [{
          id: call.id || `tool-call-${index + 1}`,
          name: call.name.trim(),
          arguments: parseToolArguments(call.arguments),
        }]
      : []),
    inputTokens,
    outputTokens,
  };
}

function parseZhipuToolCalls(calls: readonly ZhipuToolCall[]): Array<{
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}> {
  return calls.flatMap((call, index) => {
    const name = call.function?.name?.trim();
    if (!name) return [];
    return [{
      id: call.id || `tool-call-${index + 1}`,
      name,
      arguments: parseToolArguments(call.function?.arguments),
    }];
  });
}

function parseToolArguments(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : { value };
  } catch {
    return { __invalidJson: raw };
  }
}

export async function validateCompanionModelConnection(
  input: CompanionModelConnection,
): Promise<{ provider: string; model: string }> {
  const connection = normalizeCompanionModelConnection(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const model = makeConnectionAgentModel({
      connection,
      model: connection.model,
      maxTokens: 16,
      temperature: 0,
      stream: false,
    });
    const response = await model.complete({
      messages: [
        { role: "system", content: "你是连通性测试接口，只回复 OK。" },
        { role: "user", content: "ping" },
      ],
      tools: [],
      signal: controller.signal,
      maxOutputTokens: 16,
    });
    if (!response.text.trim()) throw new Error("接口没有返回有效回复。");
    return { provider: connection.provider, model: connection.model };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("连接超时，请检查 API 地址与网络。 ");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// —— 离线兜底：本地启发式抽取 LLM（契约同 SDK SYSTEM_PROMPT JSON）——
export function localExtractionLLM(): LLMConfig {
  const pickLayer = (s: string): string => {
    if (/我.*(喜欢|讨厌|偏好|养|怕|想|打算)/.test(s)) return "personal_semantic";
    if (/(今天|昨天|刚才|上周|去世|走了)/.test(s)) return "episodic";
    return "semantic";
  };
  return {
    provider: "custom",
    name: "local-extract",
    chat: async (_system: string, user: string): Promise<string> => {
      const m = user.match(/用户内容：\n([\s\S]*)$/);
      const content = (m?.[1] || "").trim();
      const sentences = content
        .split(/[\n。.！!？?，,]+/)
        .map((x) => x.trim())
        .filter((x) => x.length > 2);
      const derived = sentences.slice(0, 5).map((sent) => ({
        layer: pickLayer(sent),
        content: sent,
        type: pickLayer(sent) === "personal_semantic" ? "user" : "project",
        source: { authoritative: false, origin: "local-extract", chain_depth: 1 },
        arousal: { value: 0.3, signal_sources: [] },
        surprise: { value: 0.2, basis: "local" },
      }));
      return JSON.stringify({
        archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "raw" } },
        derived,
      });
    },
  };
}

// —— 离线兜底：回声脑（摘要事实块，证明记忆被用上）——
export const echoChat: ChatFn = async (system: string): Promise<string> => {
  const factsBlock = /【关于对方的事实】[\s\S]*?\n([\s\S]*?)\n\n【你自己的近况】/.exec(system)?.[1] ?? "";
  const bullets = [...factsBlock.matchAll(/^- (.+?)(?:\s+_.*_)?$/gm)].map((m) => m[1]!.trim());
  return bullets.length > 0
    ? `（我记得你说过：${bullets.join("；")}）嗯，我都记着呢。`
    : `（我们还不太熟，慢慢来。）`;
};
