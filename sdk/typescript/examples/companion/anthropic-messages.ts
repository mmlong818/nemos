import type { AgentMessage, AgentModel, AgentModelResponse, AgentToolCall } from "../../src/agent/types.js";
import { fetch as undiciFetch } from "undici";
import { CompanionModelHttpError, modelConnectionEndpoint, type CompanionModelConnection } from "./model-connection.js";

type Item = Record<string, unknown>;

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export function makeAnthropicMessagesAgentModel(options: {
  connection: CompanionModelConnection;
  model: string;
  maxTokens: number;
  temperature: number;
  stream: boolean;
}): AgentModel {
  return { complete: async (request) => {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const body: Record<string, unknown> = {
      model: options.model,
      system,
      messages: request.messages.flatMap(toAnthropicMessage),
      max_tokens: Math.max(1, Math.min(options.maxTokens, request.maxOutputTokens ?? options.maxTokens)),
      temperature: options.temperature,
      ...(request.tools.length ? { tools: request.tools.map((tool) => ({
        name: tool.name, description: tool.description, input_schema: tool.inputSchema,
      })) } : {}),
      ...(options.stream ? { stream: true } : {}),
    };
    const headers: Record<string, string> = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
    if (options.connection.apiKey) headers["x-api-key"] = options.connection.apiKey;
    if (options.connection.providerSettings?.workspaceId) headers["anthropic-workspace-id"] = options.connection.providerSettings.workspaceId;
    const requestInit = {
      method: "POST", headers, body: JSON.stringify(body), signal: request.signal,
    };
    const response = options.connection.transportDispatcher
      ? await undiciFetch(modelConnectionEndpoint(options.connection), { ...requestInit, dispatcher: options.connection.transportDispatcher })
      : await fetch(modelConnectionEndpoint(options.connection), requestInit);
    if (!response.ok) {
      await response.body?.cancel();
      throw new CompanionModelHttpError(response.status);
    }
    if (options.stream) return readAnthropicMessageStream(response, request.onTextDelta);
    let data: { content?: AnthropicContentBlock[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    try { data = await response.json() as typeof data; }
    catch { throw new Error("模型服务返回的 Anthropic JSON 无效。"); }
    const blocks = data.content ?? [];
    const text = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
    if (text) request.onTextDelta?.(text);
    return {
      text,
      toolCalls: blocks.flatMap((block, index) => block.type === "tool_use" && block.name
        ? [{ id: block.id || `tool-call-${index + 1}`, name: block.name, arguments: objectInput(block.input) }]
        : []),
      stopReason: data.stop_reason,
      inputTokens: anthropicInputTokens(data.usage),
      outputTokens: token(data.usage?.output_tokens),
    };
  } };
}

function toAnthropicMessage(message: AgentMessage): Array<Record<string, unknown>> {
  if (message.role === "system") return [];
  if (message.role === "assistant" && message.toolCalls?.length) {
    const content: Array<Record<string, unknown>> = [];
    if (message.content) content.push({ type: "text", text: message.content });
    content.push(...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments })));
    return [{ role: "assistant", content }];
  }
  if (message.role === "tool") {
    return [{ role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] }];
  }
  return [{ role: message.role, content: message.content }];
}

interface StreamingBlock {
  type: "text" | "tool_use";
  stopped: boolean;
  text: string;
  id?: string;
  name?: string;
  initialInput?: Record<string, unknown>;
  partialJson: string;
}

/** Parses one native Anthropic Messages SSE response. Known events are fail-closed; unknown future top-level events are ignored. */
export async function readAnthropicMessageStream(response: Response, onTextDelta?: (text: string) => void): Promise<AgentModelResponse> {
  if (!response.body || !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    await response.body?.cancel();
    throw new Error("模型未返回 Anthropic 事件流。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const blocks = new Map<number, StreamingBlock>();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let started = false;
  let nextBlockIndex = 0;
  let messageDelta = false;
  let stopped = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let stopReason: string | undefined;

  const requireStarted = (): void => { if (!started || stopped) throw new Error("Anthropic 事件顺序无效；未执行本轮工具。"); };
  const consumeEvent = (): void => {
    if (!dataLines.length) { eventName = ""; return; }
    const raw = dataLines.join("\n"); dataLines = [];
    let event: Item;
    try { event = JSON.parse(raw) as Item; }
    catch { throw new Error("Anthropic 事件格式无效；未执行本轮工具。"); }
    if (typeof event.type !== "string" || !event.type) throw new Error("Anthropic 事件缺少类型；未执行本轮工具。");
    const type = event.type;
    if (eventName && typeof event.type === "string" && eventName !== event.type) throw new Error("Anthropic 事件类型不一致；未执行本轮工具。");
    eventName = "";
    if (type === "ping") return;
    if (type === "error") throw new Error("Anthropic 事件流返回错误；未执行本轮工具。");
    if (type === "message_start") {
      if (started || stopped || !isObject(event.message) || event.message.type !== "message" || event.message.role !== "assistant"
        || !Array.isArray(event.message.content) || !isObject(event.message.usage)) throw new Error("Anthropic message_start 无效；未执行本轮工具。");
      started = true;
      const usage = event.message.usage;
      inputTokens = anthropicInputTokens(usage, true);
      outputTokens = token(usage.output_tokens);
      if (inputTokens === undefined || outputTokens === undefined) throw new Error("Anthropic message_start usage 无效；未执行本轮工具。");
      return;
    }
    if (type === "content_block_start") {
      requireStarted();
      const index = blockIndex(event.index), content = event.content_block;
      if (index !== nextBlockIndex || [...blocks.values()].some((block) => !block.stopped)
        || blocks.has(index) || !isObject(content) || (content.type !== "text" && content.type !== "tool_use")) throw new Error("Anthropic content_block_start 无效；未执行本轮工具。");
      nextBlockIndex++;
      if (content.type === "text") {
        if (content.text !== undefined && typeof content.text !== "string") throw new Error("Anthropic 文字块无效；未执行本轮工具。");
        const text = content.text ?? "";
        blocks.set(index, { type: "text", stopped: false, text, partialJson: "" });
        if (text) onTextDelta?.(text);
      } else {
        if (typeof content.id !== "string" || !content.id || typeof content.name !== "string" || !content.name || !isObject(content.input)) {
          throw new Error("Anthropic 工具块无效；未执行本轮工具。");
        }
        blocks.set(index, { type: "tool_use", stopped: false, text: "", id: content.id, name: content.name,
          initialInput: content.input as Record<string, unknown> | undefined, partialJson: "" });
      }
      return;
    }
    if (type === "content_block_delta") {
      requireStarted();
      const block = blocks.get(blockIndex(event.index));
      if (!block || block.stopped || !isObject(event.delta) || typeof event.delta.type !== "string") throw new Error("Anthropic content_block_delta 无效；未执行本轮工具。");
      if (event.delta.type === "text_delta") {
        if (block.type !== "text" || typeof event.delta.text !== "string") throw new Error("Anthropic text_delta 无效；未执行本轮工具。");
        block.text += event.delta.text;
        if (event.delta.text) onTextDelta?.(event.delta.text);
      } else if (event.delta.type === "input_json_delta") {
        if (block.type !== "tool_use" || typeof event.delta.partial_json !== "string") throw new Error("Anthropic input_json_delta 无效；未执行本轮工具。");
        block.partialJson += event.delta.partial_json;
        if (block.partialJson.length > 2_000_000) throw new Error("Anthropic 工具参数过大；未执行本轮工具。");
      } else throw new Error("Anthropic 内容增量类型未启用；未执行本轮工具。");
      return;
    }
    if (type === "content_block_stop") {
      requireStarted();
      const block = blocks.get(blockIndex(event.index));
      if (!block || block.stopped) throw new Error("Anthropic content_block_stop 无效；未执行本轮工具。");
      block.stopped = true;
      return;
    }
    if (type === "message_delta") {
      requireStarted();
      if (messageDelta || [...blocks.values()].some((block) => !block.stopped) || !isObject(event.delta) || typeof event.delta.stop_reason !== "string" || !event.delta.stop_reason) {
        throw new Error("Anthropic message_delta 无效；未执行本轮工具。");
      }
      messageDelta = true; stopReason = event.delta.stop_reason;
      if (!isObject(event.usage)) throw new Error("Anthropic usage 无效；未执行本轮工具。");
      const streamedOutput = token(event.usage.output_tokens);
      if (streamedOutput === undefined) throw new Error("Anthropic usage 无效；未执行本轮工具。");
      outputTokens = streamedOutput;
      return;
    }
    if (type === "message_stop") {
      requireStarted();
      if (!messageDelta || [...blocks.values()].some((block) => !block.stopped)) throw new Error("Anthropic message_stop 提前到达；未执行本轮工具。");
      stopped = true;
    }
    // Unknown future top-level events are deliberately ignored.
  };
  const consumeLine = (line: string): void => {
    if (!line) { consumeEvent(); return; }
    if (line.startsWith(":")) return;
    if (line.startsWith("event:")) eventName = line.slice(6).replace(/^ /, "");
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  };
  try {
    while (!stopped) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 8_000_000) throw new Error("Anthropic 单个事件过大；未执行本轮工具。");
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
    if (!stopped) throw new Error("Anthropic 事件流提前断开；未执行本轮工具。");
    const text = [...blocks.entries()].sort(([a], [b]) => a - b).filter(([, block]) => block.type === "text").map(([, block]) => block.text).join("");
    const toolCalls: AgentToolCall[] = [];
    const ids = new Set<string>();
    for (const [, block] of [...blocks.entries()].sort(([a], [b]) => a - b)) {
      if (block.type !== "tool_use") continue;
      if (!block.id || !block.name || ids.has(block.id)) throw new Error("Anthropic 工具调用标识无效；未执行本轮工具。");
      let streamed: unknown = {};
      if (block.partialJson) {
        try { streamed = JSON.parse(block.partialJson); }
        catch { throw new Error("Anthropic 工具参数不是完整 JSON；未执行本轮工具。"); }
      }
      if (!isObject(streamed)) throw new Error("Anthropic 工具参数必须为对象；未执行本轮工具。");
      ids.add(block.id);
      toolCalls.push({ id: block.id, name: block.name, arguments: { ...(block.initialInput ?? {}), ...streamed } });
    }
    if (!text && !toolCalls.length) throw new Error("Anthropic 未返回文字或有效工具调用。");
    return { text, toolCalls, stopReason, inputTokens, outputTokens };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function blockIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Anthropic 内容块序号无效；未执行本轮工具。");
  return value as number;
}
function isObject(value: unknown): value is Item { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function objectInput(value: unknown): Record<string, unknown> { return isObject(value) ? value : {}; }
function token(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined; }
function anthropicInputTokens(usage: unknown, required = false): number | undefined {
  if (!isObject(usage)) {
    if (required) throw new Error("Anthropic input usage 无效；未执行本轮工具。");
    return undefined;
  }
  const keys = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;
  if (required && usage.input_tokens === undefined) throw new Error("Anthropic input usage 无效；未执行本轮工具。");
  if (!keys.some((key) => usage[key] !== undefined)) return undefined;
  let total = 0;
  for (const key of keys) {
    if (usage[key] === undefined) continue;
    const value = token(usage[key]);
    if (value === undefined) throw new Error("Anthropic input usage 无效；未执行本轮工具。");
    total += value;
  }
  if (!Number.isSafeInteger(total)) throw new Error("Anthropic input usage 无效；未执行本轮工具。");
  return total;
}
