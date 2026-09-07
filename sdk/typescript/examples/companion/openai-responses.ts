import type { AgentMessage, AgentModel, AgentModelResponse, AgentToolCall } from "../../src/agent/types.js";
import { CompanionModelHttpError, type CompanionModelConnection } from "./model-connection.js";
import { resolveReasoningEffort, type ReasoningEffort } from "./model-reasoning.js";

type Item = Record<string, unknown>;
interface ResponseBody {
  status?: string;
  output?: Item[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Stateless Responses transport. No hosted tools, stored response IDs, or paid retry fallback. */
export function makeOpenAIResponsesAgentModel(options: {
  connection: CompanionModelConnection; model: string; maxTokens: number; stream: boolean;
  reasoningEffort?: ReasoningEffort;
}): AgentModel {
  const endpoint = `${options.connection.baseUrl}/responses`;
  return { complete: async (request) => {
    const body = {
      model: options.model,
      ...(options.reasoningEffort ? { reasoning: { effort: resolveReasoningEffort(options.connection, options.model, options.reasoningEffort) } } : {}),
      input: responseInput(request.messages, options.model, endpoint),
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: Math.max(1, Math.min(options.maxTokens, request.maxOutputTokens ?? options.maxTokens)),
      // Preserve existing optional tool schemas: do not silently make all fields required.
      ...(request.tools.length ? { tools: request.tools.map((tool) => ({
        type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false,
      })) } : {}),
      ...(options.stream ? { stream: true } : {}),
    };
    const response = await fetch(endpoint, { method: "POST", signal: request.signal, redirect: "error",
      headers: { "Content-Type": "application/json", ...(options.connection.apiKey ? { Authorization: `Bearer ${options.connection.apiKey}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CompanionModelHttpError(response.status);
    }
    let data: ResponseBody;
    if (options.stream) data = await readResponseStream(response, request.onTextDelta);
    else {
      try { data = await response.json() as ResponseBody; }
      catch { throw new Error("模型服务返回的 Responses JSON 无效。"); }
    }
    const result = parseResponse(data, options.model, endpoint);
    if (!options.stream && result.text) request.onTextDelta?.(result.text);
    return result;
  } };
}

function responseInput(messages: readonly AgentMessage[], model: string, endpoint: string): Item[] {
  const result: Item[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.toolCallId) throw new Error("工具结果缺少调用标识。");
      result.push({ type: "function_call_output", call_id: message.toolCallId, output: message.content });
      continue;
    }
    const state = message.role === "assistant" ? message.providerState : undefined;
    if (state?.format === "openai-responses" && state.model === model && state.endpoint === endpoint) {
      const allowedCalls = new Set(message.toolCalls?.map((call) => call.id));
      // The runtime may truncate excessive tool calls. Never replay calls it did not accept.
      result.push(...state.output.filter((item) => item.type !== "function_call" || allowedCalls.has(String(item.call_id))));
      continue;
    }
    if (message.content) result.push({ role: message.role, content: message.content });
    for (const call of message.toolCalls ?? []) result.push({
      type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments),
    });
  }
  return result;
}

function parseResponse(data: ResponseBody, model: string, endpoint: string): AgentModelResponse {
  // Partial JSON/tool arguments and interrupted SSE must never execute tools or appear successful.
  if (data?.status !== "completed" || !Array.isArray(data.output)) {
    throw new Error(data?.status === "incomplete"
      ? "模型输出未完成，可能达到输出额度；未执行本轮工具，请增加输出预算后重试。"
      : "模型 Responses 响应未正常完成；未执行本轮工具。");
  }
  const text: string[] = [];
  const toolCalls: AgentToolCall[] = [];
  const ids = new Set<string>();
  for (const item of data.output) {
    if (!item || typeof item !== "object") throw new Error("模型 Responses 输出项无效。");
    if (item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content)) throw new Error("模型 Responses 消息无效。");
      for (const part of item.content as Item[]) {
        if (part.type === "output_text" && typeof part.text === "string") text.push(part.text);
        else if (part.type === "refusal" && typeof part.refusal === "string") text.push(part.refusal);
      }
    } else if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || !item.call_id || ids.has(item.call_id)
        || typeof item.name !== "string" || !item.name || typeof item.arguments !== "string"
        || (item.status !== undefined && item.status !== "completed")) throw new Error("模型工具调用标识或状态无效。");
      let args: unknown;
      try { args = JSON.parse(item.arguments); } catch { throw new Error("模型工具参数不是有效 JSON。"); }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("模型工具参数必须为对象。");
      ids.add(item.call_id);
      toolCalls.push({ id: item.call_id, name: item.name, arguments: args as Item });
    } else if (item.type !== "reasoning") {
      throw new Error("模型返回了未启用的 Responses 输出类型。");
    }
  }
  if (!text.length && !toolCalls.length) throw new Error("模型未返回文字或有效工具调用。");
  const tokens = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
  return { text: text.join(""), toolCalls, stopReason: "completed",
    inputTokens: tokens(data.usage?.input_tokens), outputTokens: tokens(data.usage?.output_tokens),
    // Includes encrypted reasoning and message phase for tool continuation / checkpoint resume.
    providerState: { format: "openai-responses", model, endpoint, output: structuredClone(data.output) },
  };
}

async function readResponseStream(response: Response, onTextDelta?: (text: string) => void): Promise<ResponseBody> {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    await response.body?.cancel();
    throw new Error("模型未返回 Responses 事件流。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let completed: ResponseBody | undefined;
  let emitted = false;
  const consumeEvent = (): void => {
    if (!dataLines.length) return;
    const raw = dataLines.join("\n"); dataLines = [];
    if (raw === "[DONE]") return;
    let event: Item;
    try { event = JSON.parse(raw) as Item; } catch { throw new Error("模型 Responses 事件格式无效。"); }
    if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
      // Provider messages can echo input/key. Expose no raw error payload.
      throw new Error("模型 Responses 流未完成；未执行本轮工具。");
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      emitted = true; onTextDelta?.(event.delta);
    }
    if (event.type === "response.completed") completed = event.response as ResponseBody;
  };
  const consumeLine = (line: string): void => {
    if (!line) consumeEvent();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  };
  try {
    while (!completed) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 8_000_000) throw new Error("模型 Responses 单个事件过大。");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consumeLine(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
      }
      if (chunk.done) {
        if (buffer) consumeLine(buffer.replace(/\r$/, ""));
        consumeEvent();
        break;
      }
    }
    if (!completed) throw new Error("模型 Responses 流提前断开，未收到完成事件；未执行本轮工具。");
    // Some proxies emit only a final response, not text deltas. Still return its canonical text.
    if (!emitted && completed.status === "completed") {
      for (const item of completed.output ?? []) if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content as Item[]) if (part.type === "output_text" && typeof part.text === "string") onTextDelta?.(part.text);
      }
    }
    return completed;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
