import { ToolScheduler } from "./tool-scheduler.js";
import type {
  AgentMessage,
  AgentModel,
  AgentRunCheckpoint,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  AgentRuntimeConfig,
  AgentStopReason,
  AgentTool,
  AgentToolCall,
} from "./types.js";

const DEFAULTS = {
  maxRounds: 8,
  maxTotalTokens: Number.MAX_SAFE_INTEGER,
  maxToolRounds: 8,
  maxParallelReadTools: 3,
  maxToolCallsPerRound: 32,
  maxIdenticalToolCalls: 3,
  maxToolResultChars: 50_000,
  maxHistoryChars: 1_000_000,
  handoffThresholdChars: 700_000,
  maxHandoffs: 3,
};

export class AgentRuntime {
  private readonly config: Required<Omit<AgentRuntimeConfig, "createHandoff" | "authorizeTool">> &
    Pick<AgentRuntimeConfig, "createHandoff" | "authorizeTool">;

  constructor(
    private readonly model: AgentModel,
    private readonly tools: readonly AgentTool[],
    config: AgentRuntimeConfig = {},
  ) {
    this.config = {
      ...DEFAULTS,
      ...config,
      maxTotalTokens: normalizeMaxTotalTokens(config.maxTotalTokens),
    };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const runId = input.runId?.trim() || input.sessionId;
    const normalizedInput: AgentRunInput = input.runId === runId ? input : { ...input, runId };
    const link = linkedController(input.signal);
    const controller = link.controller;
    const resume = input.resume ? cloneCheckpoint(input.resume) : undefined;
    let messages = resume ? resume.messages : initialMessages(input);
    let usage = normalizeTokenUsage(resume?.usage);
    const destructiveState = { stopped: resume?.destructiveFailureStopped === true, failedTool: undefined as string | undefined };
    const emit = (event: AgentRunEvent): void => {
      input.onEvent?.(event);
      observe(() => input.observer?.onEvent?.(runId, event));
    };
    const saveCheckpoint = (
      phase: AgentRunCheckpoint["phase"],
      round: number,
      nextRound: number,
      handoffs: number,
      previousToolCallSignature: string,
      repeatedToolCallCount: number,
      pendingToolCalls?: readonly AgentToolCall[],
    ): AgentRunCheckpoint => {
      const checkpoint: AgentRunCheckpoint = {
        phase,
        round,
        nextRound,
        messages: structuredClone(messages),
        handoffs,
        previousToolCallSignature,
        repeatedToolCallCount,
        pendingToolCalls: pendingToolCalls ? pendingToolCalls.map((call) => structuredClone(call)) : undefined,
        usage: { ...usage },
        destructiveFailureStopped: destructiveState.stopped || undefined,
      };
      observe(() => input.observer?.onCheckpoint?.(runId, checkpoint));
      return checkpoint;
    };
    const complete = (
      reason: AgentStopReason,
      rounds: number,
      handoffCount: number,
      output = "",
    ): AgentRunResult => {
      const result = finish(runId, input.sessionId, reason, rounds, handoffCount, messages, usage, emit, output);
      observe(() => input.observer?.onComplete?.(runId, result));
      return result;
    };

    let handoffs = resume?.handoffs ?? 0;
    let previousSignature = resume?.previousToolCallSignature ?? "";
    let repeatedCount = resume?.repeatedToolCallCount ?? 0;
    let nextRound = resume?.nextRound ?? 1;
    let completedRounds = resume?.round ?? 0;

    try {
      if (resume) {
        observe(() => input.observer?.onResume?.(normalizedInput, resume));
        emit({ type: "run_resume", runId, sessionId: input.sessionId, round: resume.round });
      } else {
        observe(() => input.observer?.onStart?.(normalizedInput, messages));
        emit({ type: "run_start", runId, sessionId: input.sessionId, metadata: input.metadata });
      }

      if (resume?.phase === "after_model") {
        const calls = pendingToolCalls(resume);
        if (calls.length === 0) throw new Error("resume checkpoint has no pending tool calls");
        if (controller.signal.aborted) {
          return complete("cancelled", completedRounds, handoffs);
        }
        messages.push(...await this.executeTools(
          runId,
          input.sessionId,
          calls,
          controller.signal,
          emit,
          input.metadata,
          destructiveState,
        ));
        messages = trimHistory(messages, this.config.maxHistoryChars);
        completedRounds = resume.round;
        nextRound = resume.round + 1;
        saveCheckpoint(
          "after_tools",
          completedRounds,
          nextRound,
          handoffs,
          previousSignature,
          repeatedCount,
        );
      }

      for (let round = nextRound; round <= this.config.maxRounds; round++) {
        if (controller.signal.aborted) {
          return complete("cancelled", round - 1, handoffs);
        }
        if (usage.totalTokens >= this.config.maxTotalTokens) {
          emit({ type: "token_budget_exhausted", limit: this.config.maxTotalTokens, used: usage.totalTokens });
          return complete("token_budget_exhausted", round - 1, handoffs);
        }
        let handoff: { messages: AgentMessage[]; count: number };
        try {
          handoff = await this.maybeHandoff(input, messages, handoffs, controller.signal, emit);
        } catch (error) {
          if (controller.signal.aborted) {
            return complete("cancelled", round - 1, handoffs);
          }
          throw error;
        }
        messages = handoff.messages;
        handoffs = handoff.count;
        if (controller.signal.aborted) {
          return complete("cancelled", round - 1, handoffs);
        }
        emit({ type: "round_start", round });

        let response;
        try {
          response = await this.model.complete({
            messages,
            tools: round <= this.config.maxToolRounds
              ? this.tools.map((tool) => tool.definition)
              : [],
            signal: controller.signal,
            onTextDelta: input.onTextDelta,
            maxOutputTokens: remainingOutputTokenBudget(this.config.maxTotalTokens, usage.totalTokens),
          });
        } catch (error) {
          if (controller.signal.aborted) {
            return complete("cancelled", round - 1, handoffs);
          }
          throw error;
        }
        usage = addModelUsage(usage, response.inputTokens, response.outputTokens);
        const calls = (response.toolCalls ?? []).slice(0, this.config.maxToolCallsPerRound);
        emit({
          type: "model_end",
          round,
          toolCallCount: calls.length,
          ...(response.inputTokens === undefined ? {} : { inputTokens: normalizeTokenCount(response.inputTokens) }),
          ...(response.outputTokens === undefined ? {} : { outputTokens: normalizeTokenCount(response.outputTokens) }),
        });
        messages.push({ role: "assistant", content: response.text, toolCalls: calls });
        completedRounds = round;

        if (calls.length > 0 && usage.totalTokens >= this.config.maxTotalTokens) {
          emit({ type: "token_budget_exhausted", limit: this.config.maxTotalTokens, used: usage.totalTokens });
          return complete("token_budget_exhausted", round, handoffs, response.text);
        }

        if (calls.length === 0) {
          return complete("completed", round, handoffs, response.text);
        }
        const repeat = repeatedCallState(calls, previousSignature, repeatedCount);
        previousSignature = repeat.signature;
        repeatedCount = repeat.count;
        if (repeatedCount >= this.config.maxIdenticalToolCalls) {
          return complete("repeated_tool_call", round, handoffs);
        }
        saveCheckpoint(
          "after_model",
          round,
          round,
          handoffs,
          previousSignature,
          repeatedCount,
          calls,
        );
        messages.push(...await this.executeTools(
          runId,
          input.sessionId,
          calls,
          controller.signal,
          emit,
          input.metadata,
          destructiveState,
        ));
        messages = trimHistory(messages, this.config.maxHistoryChars);
        saveCheckpoint(
          "after_tools",
          round,
          round + 1,
          handoffs,
          previousSignature,
          repeatedCount,
        );
      }
      return complete("max_rounds", Math.max(completedRounds, this.config.maxRounds), handoffs);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      emit({ type: "run_error", message: normalized.message });
      observe(() => input.observer?.onError?.(runId, normalized));
      throw error;
    } finally {
      link.dispose();
    }
  }

  private async executeTools(
    runId: string,
    sessionId: string,
    calls: readonly AgentToolCall[],
    signal: AbortSignal,
    emit: (event: AgentRunEvent) => void,
    metadata?: Readonly<Record<string, string>>,
    destructiveState?: { stopped: boolean; failedTool?: string },
  ): Promise<AgentMessage[]> {
    const scheduler = new ToolScheduler(this.tools, {
      runId,
      sessionId,
      maxParallelReads: this.config.maxParallelReadTools,
      maxResultChars: this.config.maxToolResultChars,
      signal,
      emit,
      metadata,
      authorizeTool: this.config.authorizeTool,
      destructiveState,
    });
    const results = await scheduler.execute(calls);
    return results.map((result, index) => ({
      role: "tool",
      name: calls[index]!.name,
      toolCallId: calls[index]!.id,
      content: result.isError
        ? `${result.content}\n\n[Reflect] Identify the cause and change your approach before retrying.`
        : result.content,
    }));
  }

  private async maybeHandoff(
    input: AgentRunInput,
    messages: AgentMessage[],
    count: number,
    signal: AbortSignal,
    emit: (event: AgentRunEvent) => void,
  ): Promise<{ messages: AgentMessage[]; count: number }> {
    const beforeChars = historyChars(messages);
    if (
      beforeChars < this.config.handoffThresholdChars ||
      count >= this.config.maxHandoffs ||
      !this.config.createHandoff
    ) {
      return { messages, count };
    }
    const summary = await this.config.createHandoff({
      systemPrompt: input.systemPrompt,
      messages,
      originalPrompt: input.prompt,
      signal,
    });
    if (!summary.trim()) return { messages, count };
    const latestUser = [...messages].reverse().find((item) => item.role === "user")?.content;
    const next: AgentMessage[] = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: `[Context Handoff]\n${summary.trim()}` },
    ];
    if (latestUser) next.push({ role: "user", content: latestUser });
    emit({
      type: "handoff",
      count: count + 1,
      beforeChars,
      afterChars: historyChars(next),
    });
    return { messages: next, count: count + 1 };
  }
}

function observe(action: () => void): void {
  try { action(); } catch { /* 持久化/遥测失败不能破坏 Agent 主循环 */ }
}

function initialMessages(input: AgentRunInput): AgentMessage[] {
  const history = (input.history ?? []).filter((item) => item.role !== "system");
  return [
    { role: "system", content: input.systemPrompt },
    ...history.map((item) => ({ ...item })),
    { role: "user", content: input.prompt },
  ];
}

function cloneCheckpoint(checkpoint: AgentRunCheckpoint): AgentRunCheckpoint {
  return structuredClone(checkpoint);
}

function pendingToolCalls(checkpoint: AgentRunCheckpoint): AgentToolCall[] {
  const assistant = [...checkpoint.messages]
    .reverse()
    .find((message) => message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0);
  return structuredClone(checkpoint.pendingToolCalls ?? assistant?.toolCalls ?? []);
}

function repeatedCallState(
  calls: readonly AgentToolCall[],
  previous: string,
  count: number,
): { signature: string; count: number } {
  const signature = calls.map((call) => `${call.name}:${stableJson(call.arguments)}`).join("|");
  return { signature, count: signature === previous ? count + 1 : 1 };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function trimHistory(messages: AgentMessage[], maxChars: number): AgentMessage[] {
  if (historyChars(messages) <= maxChars) return messages;
  const system = messages.find((item) => item.role === "system");
  const kept: AgentMessage[] = [];
  let used = system?.content.length ?? 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const item = messages[index]!;
    if (item.role === "system") continue;
    if (used + item.content.length > maxChars && kept.length > 0) break;
    kept.unshift(item);
    used += item.content.length;
  }
  while (kept[0]?.role === "tool") kept.shift();
  return system ? [system, ...kept] : kept;
}

function historyChars(messages: readonly AgentMessage[]): number {
  return messages.reduce((sum, item) => sum + item.content.length, 0);
}

function linkedController(signal?: AbortSignal): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!signal) return { controller, dispose: () => undefined };
  const onAbort = (): void => controller.abort(signal.reason);
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener("abort", onAbort, { once: true });
  return {
    controller,
    dispose: () => signal.removeEventListener("abort", onAbort),
  };
}

function finish(
  runId: string,
  sessionId: string,
  reason: AgentStopReason,
  rounds: number,
  handoffs: number,
  messages: AgentMessage[],
  usage: AgentRunResult["usage"],
  emit: (event: AgentRunEvent) => void,
  output = "",
): AgentRunResult {
  emit({ type: "run_end", reason, rounds });
  return { runId, sessionId, output, reason, rounds, handoffs, messages, usage: { ...usage } };
}

function normalizeMaxTotalTokens(value?: number): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : 1;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(value)));
}

function remainingOutputTokenBudget(limit: number, used: number): number | undefined {
  if (limit === Number.MAX_SAFE_INTEGER) return undefined;
  return Math.max(1, limit - used);
}
function normalizeTokenUsage(usage?: Partial<AgentRunResult["usage"]>): AgentRunResult["usage"] {
  const inputTokens = normalizeTokenCount(usage?.inputTokens);
  const outputTokens = normalizeTokenCount(usage?.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    modelCalls: normalizeTokenCount(usage?.modelCalls),
  };
}

function addModelUsage(
  usage: AgentRunResult["usage"],
  inputTokens?: number,
  outputTokens?: number,
): AgentRunResult["usage"] {
  const input = normalizeTokenCount(inputTokens);
  const output = normalizeTokenCount(outputTokens);
  return {
    inputTokens: usage.inputTokens + input,
    outputTokens: usage.outputTokens + output,
    totalTokens: usage.totalTokens + input + output,
    modelCalls: usage.modelCalls + 1,
  };
}

function normalizeTokenCount(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : 0;
}
