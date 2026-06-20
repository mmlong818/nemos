// examples/companion/llm.ts — 真实 / 离线 LLM 解析（按环境变量自动选择）
//
// 有 ZHIPU_API_KEY → 用智谱：glm-5.2 抽取(JSON) + embedding-3 向量检索 + free-form 人格回复。
// 无 key → 离线兜底：本地启发式抽取 + 回声脑（零依赖，仍能演示拓扑）。
//
// 注意：API key 只从环境变量读，绝不硬编码 / 落盘 / 提交。
//   PowerShell:  $env:ZHIPU_API_KEY="..."; npx tsx examples/companion/chat-cli.ts
//   bash:        ZHIPU_API_KEY=... npx tsx examples/companion/chat-cli.ts

import type { EmbeddingConfig, LLMConfig } from "../../src/index.js";
import type { ChatFn, ChatStreamFn } from "./engine.js";

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

/** 给角色"开口"的 LLM 调用一个工具时的定义 + 执行器。 */
interface Tool {
  def: object; // OpenAI 风格 function 定义
  name: string;
  run: (args: Record<string, unknown>) => Promise<string>;
}

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
  label: string;
  live: boolean;
}

export function resolveLLM(): ResolvedLLM {
  const zhipuKey = process.env.ZHIPU_API_KEY;
  if (zhipuKey) {
    // 对话默认用快模型（首 token ~300ms，闲聊流畅）；具体角色可在 personas.ts 用 chatModel 分层覆盖。
    const chatModel = process.env.ZHIPU_MODEL || "glm-4.5-air";
    // 抽取=后台/不可见，用 glm-5.2 保质量（关思考保速度）；可用 EXTRACT_MODEL 覆盖。
    const extractModel = process.env.EXTRACT_MODEL || DEFAULT_ZHIPU_MODEL;
    const tools = [makeWebSearchTool(zhipuKey)];
    return {
      extraction: makeZhipuExtract(zhipuKey, extractModel),
      embedding: { provider: "zhipu", apiKey: zhipuKey },
      chat: makeZhipuChat(zhipuKey, chatModel, tools),
      chatStream: makeZhipuChatStream(zhipuKey, chatModel, tools),
      vision: makeVision(zhipuKey),
      tts: makeTts(zhipuKey),
      asr: makeAsr(zhipuKey),
      label: `zhipu chat=${chatModel}(分层) / extract=${extractModel} + embedding-3 + 自动联网 + 识图`,
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
    label: "offline（本地启发式抽取 + 回声脑；设 ZHIPU_API_KEY 切真实 LLM + 工具）",
    live: false,
  };
}

// —— 联网搜索工具（function calling；handler 调独立 Web Search API）——
function makeWebSearchTool(apiKey: string): Tool {
  return {
    name: "web_search",
    def: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "联网搜索实时 / 最新信息（新闻、天气、价格、近期事件、你不确定或可能过时的事实）。需要外部最新信息时调用。",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "搜索关键词" } },
          required: ["query"],
        },
      },
    },
    run: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return "（空查询）";
      const resp = await fetch(ZHIPU_SEARCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        // search_pro：高级引擎，结果更新更准（search_std 会返回过时旧文）。
        body: JSON.stringify({ search_engine: "search_pro", search_query: query, count: 5 }),
      });
      if (!resp.ok) return `（搜索失败 HTTP ${resp.status}）`;
      const data = (await resp.json()) as { search_result?: Array<{ title?: string; content?: string; link?: string }> };
      const items = (data.search_result ?? []).slice(0, 5);
      if (items.length === 0) return "（没搜到相关结果）";
      return items
        .map((r, i) => `[${i + 1}] ${r.title ?? ""}\n${(r.content ?? "").slice(0, 300)}\n${r.link ?? ""}`)
        .join("\n\n");
    },
  };
}

// —— 抽取 LLM（包一层强制中文，避免 flash 偶尔输出英文事实）——
function makeZhipuExtract(apiKey: string, model: string): LLMConfig {
  const ZH = "\n\n【语言要求】抽取出的所有文本字段（content / basis 等）必须用中文（与用户输入语言一致），绝不要译成英文。JSON 结构保持不变。";
  return {
    provider: "custom",
    name: `zhipu-extract-zh(${model})`,
    chat: async (system: string, user: string): Promise<string> => {
      const resp = await fetch(ZHIPU_CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system + ZH },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" }, // 抽取是机械任务，关 CoT 保速度
        }),
      });
      if (!resp.ok) {
        throw new Error(`[companion] zhipu extract HTTP ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
      }
      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "{}";
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
    fd.append("file", new Blob([audio], { type: mime || "audio/webm" }), filename || "audio.webm");
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
  "\n\n【联网能力】你可以联网搜索（web_search）。仅当问题确实依赖实时 / 最新信息时才调用——" +
  "如行情股价、汇率、天气、新闻赛事、某公司或产品的最新状况（是否上市 / 市值 / 融资）、" +
  "或带「最新 / 现在 / 今天 / 近期 / 多少钱」且你不确定的事实；这类别凭旧记忆下结论。" +
  "日常聊天、情绪陪伴、你已知道的常识，都不要调用，直接自然回应。";

function makeZhipuChat(apiKey: string, defaultModel: string, tools: Tool[] = []): ChatFn {
  const toolDefs = tools.map((t) => t.def);
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async (system: string, user: string, model?: string): Promise<string> => {
    model = model || defaultModel;
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    const sys =
      toolDefs.length > 0
        ? `${system}${TOOL_POLICY}\n（现在是 ${now}（北京时间），引用搜索结果时务必注意时效，过时的就说过时。）`
        : system;
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: sys },
      { role: "user", content: user },
    ];
    // 最多 4 轮：模型可能先调工具（搜索）拿结果，再用结果回复。
    for (let i = 0; i < 4; i++) {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: 0.85,
        max_tokens: 800,
        thinking: { type: "disabled" }, // 陪聊关 CoT，回复更快
      };
      if (toolDefs.length > 0) body.tools = toolDefs;
      const resp = await fetch(ZHIPU_CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`[companion] zhipu chat HTTP ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
      }
      const data = (await resp.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
      };
      const msg = data.choices?.[0]?.message;
      if (!msg) return "（……）";
      const calls = msg.tool_calls;
      if (calls && calls.length > 0) {
        messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
        for (const c of calls) {
          const tool = byName.get(c.function?.name ?? "");
          let result = "（未知工具）";
          if (tool) {
            try {
              const a = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
              result = await tool.run(a as Record<string, unknown>);
            } catch (e) {
              result = `（工具出错：${e instanceof Error ? e.message : String(e)}）`;
            }
          }
          messages.push({ role: "tool", tool_call_id: c.id, content: result });
        }
        continue; // 带着工具结果再问一次
      }
      return msg.content?.trim() || "（……）";
    }
    return "（……）";
  };
}

// —— 流式对话（助理用）：每回合走 stream:true；命中工具推「查询中/工作中」，最终回合逐字推文字 ——
function makeZhipuChatStream(apiKey: string, defaultModel: string, tools: Tool[] = []): ChatStreamFn {
  const toolDefs = tools.map((t) => t.def);
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async (system, user, cb, model) => {
    model = model || defaultModel;
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: `${system}${TOOL_POLICY}\n（现在是 ${now}（北京时间），引用搜索结果注意时效。）` },
      { role: "user", content: user },
    ];
    cb.onStatus("工作中");
    let full = "";
    for (let round = 0; round < 4; round++) {
      const resp = await fetch(ZHIPU_CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: 0.6,
          max_tokens: 1200,
          thinking: { type: "disabled" },
          stream: true,
        }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`[companion] zhipu stream HTTP ${resp.status}: ${resp.ok ? "no body" : (await resp.text()).slice(0, 200)}`);
      }
      const decoder = new TextDecoder();
      let buf = "";
      let content = "";
      const tc: Record<number, { id: string; name: string; args: string }> = {};
      for await (const chunk of resp.body as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let j: { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
          try { j = JSON.parse(payload); } catch { continue; }
          const delta = j.choices?.[0]?.delta;
          if (delta?.content) { content += delta.content; full += delta.content; cb.onToken(delta.content); }
          if (delta?.tool_calls) {
            for (const t of delta.tool_calls) {
              const i = t.index ?? 0;
              const acc = (tc[i] ||= { id: "", name: "", args: "" });
              if (t.id) acc.id = t.id;
              if (t.function?.name) acc.name = t.function.name;
              if (t.function?.arguments) acc.args += t.function.arguments;
            }
          }
        }
      }
      const calls = Object.values(tc).filter((c) => c.name);
      if (calls.length > 0) {
        cb.onStatus(calls.some((c) => c.name === "web_search") ? "查询中" : "工作中");
        messages.push({ role: "assistant", content, tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) });
        for (const c of calls) {
          const tool = byName.get(c.name);
          let r = "（未知工具）";
          if (tool) {
            try { r = await tool.run(JSON.parse(c.args || "{}")); } catch (e) { r = `（工具出错：${e instanceof Error ? e.message : String(e)}）`; }
          }
          messages.push({ role: "tool", tool_call_id: c.id, content: r });
        }
        cb.onStatus("整理中");
        continue;
      }
      return full.trim() || "（……）";
    }
    return full.trim() || "（……）";
  };
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
