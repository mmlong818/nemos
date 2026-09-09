import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentToolDefinition } from "../../src/index.js";
import { makeReadinessProbeAgentModel } from "./llm.js";
import {
  CompanionModelHttpError,
  modelTransport,
  usesOpenAIResponses,
  type CompanionModelCheck,
  type CompanionModelConnection,
  type CompanionModelInfo,
} from "./model-connection.js";

/** Synthetic only: never passes user history to the service or invokes real tools. */
export async function checkCompanionModel(
  input: CompanionModelConnection,
  timeoutMs = usesOpenAIResponses(input) ? 60_000 : 20_000,
): Promise<CompanionModelCheck> {
  const connection = { ...input, modelChecks: undefined };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const check: CompanionModelCheck = {
    ...(connection.connectionRevision ? { connectionRevision: connection.connectionRevision } : {}),
    transport: modelTransport(connection, connection.model),
    checkedAt: new Date().toISOString(), chat: "failed", streaming: "not-tested", tools: "not-tested",
    detail: "文字回复检查未通过。",
  };
  const maxTokens = usesOpenAIResponses(connection) ? 1024 : 512;
  const complete = (messages: AgentMessage[], stream: boolean, tools: AgentToolDefinition[] = []) =>
    makeReadinessProbeAgentModel({ connection, model: connection.model, maxTokens, temperature: 0, stream })
      .complete({ messages, tools, signal: controller.signal, maxOutputTokens: maxTokens });
  const ping: AgentMessage[] = [{ role: "user", content: "Connection check. Reply only OK." }];
  // Auth, quota, outages and network failures should not trigger paid retries on other models.
  const stopOnGlobalFailure = (error: unknown): void => {
    if (controller.signal.aborted) throw new Error("模型检查超时；原连接未更改，请检查网络或手动选择模型。");
    if (error instanceof CompanionModelHttpError && (error.status === 401 || error.status === 429 || error.status >= 500)) throw error;
    if (error instanceof TypeError && /fetch|network/i.test(error.message)) throw new Error("无法连接模型服务，请检查网络或代理设置。");
  };
  try {
    try {
      const response = await complete(ping, false);
      if (!response.text.trim() || response.toolCalls?.length) return check;
      check.chat = "passed";
    } catch (error) { stopOnGlobalFailure(error); return check; }

    // The Anthropic adapter currently buffers JSON; do not claim native SSE works.
    check.streaming = connection.protocol === "anthropic" ? "buffered" : "failed";
    if (connection.protocol !== "anthropic") {
      try {
        const response = await complete(ping, true);
        if (response.text.trim() && !response.toolCalls?.length) check.streaming = "passed";
      } catch (error) { stopOnGlobalFailure(error); }
    }
    check.tools = "failed";
    check.detail = "文字回复已验证；工具调用未通过检查，可关闭工具后对话。";
    const tool: AgentToolDefinition = {
      name: "clownfish_connection_probe", description: "A harmless synthetic connection check. Call once with value 7.",
      inputSchema: { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false },
      effect: "read",
    };
    const messages: AgentMessage[] = [{ role: "user", content: "Call clownfish_connection_probe with value 7 now. After receiving its result, reply with only the exact result text." }];
    try {
      const stream = check.streaming === "passed";
      const response = await complete(messages, stream, [tool]);
      const calls = response.toolCalls || [];
      const call = calls[0];
      if (calls.length !== 1 || !call?.id || call.name !== tool.name || call.arguments.value !== 7 || Object.keys(call.arguments).length !== 1) return check;
      const receipt = `probe-${randomUUID()}`;
      const final = await complete([
        ...messages,
        { role: "assistant", content: response.text, toolCalls: calls, providerState: response.providerState },
        { role: "tool", toolCallId: call.id, name: call.name, content: receipt },
      ], stream);
      if (final.text.trim() !== receipt || final.toolCalls?.length) return check;
      check.tools = "passed";
      check.detail = check.streaming === "passed"
        ? "文字回复、流式输出和模拟工具往返已验证。"
        : "文字回复和模拟工具往返已验证；当前使用完整回复输出。";
    } catch (error) {
      stopOnGlobalFailure(error);
      if (error instanceof CompanionModelHttpError) check.detail += ` 工具请求 HTTP ${error.status}，请检查服务的工具接口兼容性。`;
    }
    return check;
  } finally { clearTimeout(timeout); }
}

/**
 * Lower-level synthetic probe primitive. Product routes must invoke it only via
 * an explicit user-initiated single-model check; saving, switching and listing
 * are deliberately pure local operations.
 */
export async function checkSingleCompanionModel(
  connection: CompanionModelConnection,
  model: string,
  probe: (connection: CompanionModelConnection) => Promise<CompanionModelCheck> = checkCompanionModel,
): Promise<CompanionModelCheck> {
  const id = model.trim();
  if (!id || id.length > 160 || /[\r\n]/.test(id)) throw new Error("模型名称格式不正确。");
  const checked = await probe({ ...connection, model: id });
  return connection.connectionRevision && checked.connectionRevision !== connection.connectionRevision
    ? { ...checked, connectionRevision: connection.connectionRevision }
    : checked;
}

/**
 * Compatibility export for older callers. It deliberately neither probes nor
 * substitutes a catalog candidate: a save must preserve the user's model ID.
 * Use checkSingleCompanionModel from an explicit user action.
 */
export async function selectCheckedCompanionModel(
  connection: CompanionModelConnection,
  _catalog: readonly CompanionModelInfo[],
  mode: "auto" | "manual",
  _probe?: (connection: CompanionModelConnection) => Promise<CompanionModelCheck>,
): Promise<CompanionModelConnection> {
  return { ...connection, selectionMode: mode };
}
