// examples/companion/llm.ts — 真实 / 离线 LLM 解析（按环境变量自动选择）
//
// 有 ZHIPU_API_KEY → 用智谱：glm-5.2 抽取(JSON) + embedding-3 向量检索 + free-form 人格回复。
// 无 key → 离线兜底：本地启发式抽取 + 回声脑（零依赖，仍能演示拓扑）。
//
// 注意：API key 只从环境变量读，绝不硬编码 / 落盘 / 提交。
//   PowerShell:  $env:ZHIPU_API_KEY="..."; npx tsx examples/companion/chat-cli.ts
//   bash:        ZHIPU_API_KEY=... npx tsx examples/companion/chat-cli.ts

import type { EmbeddingConfig, LLMConfig } from "../../src/index.js";
import type { ChatFn } from "./engine.js";

const ZHIPU_CHAT_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_ZHIPU_MODEL = "glm-5.2";

export interface ResolvedLLM {
  /** SDK 抽取/反思用（需 JSON）。 */
  extraction: LLMConfig;
  /** 向量检索用（中文 FTS 弱，强烈建议开）。 */
  embedding: EmbeddingConfig;
  /** 人格"开口"用（free-form 自然语言）。 */
  chat: ChatFn;
  label: string;
  live: boolean;
}

export function resolveLLM(): ResolvedLLM {
  const zhipuKey = process.env.ZHIPU_API_KEY;
  if (zhipuKey) {
    const model = process.env.ZHIPU_MODEL || DEFAULT_ZHIPU_MODEL;
    return {
      extraction: { provider: "zhipu", apiKey: zhipuKey, model },
      embedding: { provider: "zhipu", apiKey: zhipuKey },
      chat: makeZhipuChat(zhipuKey, model),
      label: `zhipu ${model} + embedding-3`,
      live: true,
    };
  }
  return {
    extraction: localExtractionLLM(),
    embedding: { provider: "none" },
    chat: echoChat,
    label: "offline（本地启发式抽取 + 回声脑；设 ZHIPU_API_KEY 切真实 LLM）",
    live: false,
  };
}

// —— 智谱 free-form 对话（人格回复；不设 response_format，要自然语言）——
function makeZhipuChat(apiKey: string, model: string): ChatFn {
  return async (system: string, user: string): Promise<string> => {
    const resp = await fetch(ZHIPU_CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.85,
        max_tokens: 800,
      }),
    });
    if (!resp.ok) {
      throw new Error(`[companion] zhipu chat HTTP ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || "（……）";
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
