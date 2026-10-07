import { randomUUID } from "node:crypto";
import { EmptyModelOutputError, makeConnectionAgentModel } from "./llm.js";
import type { FileLlmCallLedger } from "./llm-call-ledger.js";
import type { CompanionModelConnection } from "./model-connection.js";

/** Keep the tool credential independent of the user's selected model connection. */
export function resolveToolZhipuKey(saved: string | null, toolEnv: string | undefined, llmEnv: string | undefined):
  { key: string | null; source: "tool" | "env" | "llm" | "none" } {
  if (saved?.trim()) return { key: saved.trim(), source: "tool" };
  if (toolEnv?.trim()) return { key: toolEnv.trim(), source: "env" };
  if (llmEnv?.trim()) return { key: llmEnv.trim(), source: "llm" };
  return { key: null, source: "none" };
}

/** One HTTP request identity covers the first attempt and its single safe retry. */
export async function zhipuToolChat(apiKey: string, model: string, system: string, user: string, maxTokens = 1200, ledger?: FileLlmCallLedger): Promise<string> {
  const connection: CompanionModelConnection = {
    provider: "zhipu", protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4", model, apiKey,
  };
  const gateway = makeConnectionAgentModel({
    connection, model, maxTokens, temperature: 0.2, stream: false,
    runId: randomUUID(), purpose: "tool_text", ledger,
  });
  let response;
  try {
    response = await gateway.complete({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      tools: [], signal: new AbortController().signal,
    });
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("工具模型返回格式无效。");
    throw error;
  }
  if (response.toolCalls?.length) throw new Error("工具模型返回了未请求的工具调用。");
  return response.text.trim();
}

/** ASR correction retains the transcript when the model produces no text. */
export async function zhipuToolChatOrSource(apiKey: string, model: string, system: string, source: string, maxTokens: number, ledger?: FileLlmCallLedger): Promise<string> {
  try {
    return (await zhipuToolChat(apiKey, model, system, source, maxTokens, ledger)) || source;
  } catch (error) {
    if (error instanceof EmptyModelOutputError) return source;
    throw error;
  }
}
