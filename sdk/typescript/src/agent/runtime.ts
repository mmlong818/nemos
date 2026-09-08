import { ToolScheduler } from "./tool-scheduler.js";
import {
  FINISH_TURN_TOOL_NAME,
  finishTurnToolDefinition,
  legacyTurnDisposition,
  parseTurnDisposition,
  validateTurnCompletion,
} from "./completion.js";
import type {
  AgentCompletionEvidence,
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
  AgentTurnDisposition,
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
  terminationProtocol: "legacy" as const,
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
    let completionEvidence = structuredClone(resume?.completionEvidence ?? []);
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
        completionEvidence: structuredClone(completionEvidence),
      };
      observe(() => input.observer?.onCheckpoint?.(runId, checkpoint));
      return checkpoint;
    };
    const complete = (
      reason: AgentStopReason,
      rounds: number,
      handoffCount: number,
      output = "",
      disposition: AgentTurnDisposition = dispositionForStop(reason, output, completionEvidence),
    ): AgentRunResult => {
      emit({ type: "turn_disposition", disposition });
      const result = finish(runId, input.sessionId, reason, rounds, handoffCount, messages, usage, emit, output, disposition);
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
        const execution = await this.executeTools(
          runId,
          input.sessionId,
          calls,
          controller.signal,
          emit,
          input.metadata,
          destructiveState,
        );
        messages.push(...execution.messages);
        completionEvidence.push(...execution.evidence);
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
          return complete("cancelled", round - 1, handoffs, "", cancelledDisposition(controller.signal, completionEvidence));
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
            tools: this.modelTools(round <= this.config.maxToolRounds),
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
        if (controller.signal.aborted) {
          return complete("cancelled", round - 1, handoffs, "", cancelledDisposition(controller.signal, completionEvidence));
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
        messages.push({ role: "assistant", content: response.text, toolCalls: calls,
          ...(response.providerState ? { providerState: response.providerState } : {}) });
        completedRounds = round;

        const finishCalls = calls.filter((call) => call.name === FINISH_TURN_TOOL_NAME);
        const businessCalls = calls.filter((call) => call.name !== FINISH_TURN_TOOL_NAME);
        if (this.config.terminationProtocol === "explicit" && finishCalls.length > 0) {
          if (finishCalls.length !== 1 || businessCalls.length > 0) {
            const reason = "finish_turn must be the only tool call in its model response";
            emit({ type: "completion_rejected", reason });
            messages.push(...calls.map((call) => ({
              role: "tool" as const,
              name: call.name,
              toolCallId: call.id,
              content: call.name === FINISH_TURN_TOOL_NAME ? reason : `not executed: ${reason}`,
            })));
            continue;
          }
          const declaration = parseTurnDisposition(finishCalls[0]!);
          if (!declaration) {
            const reason = "finish_turn declaration is invalid";
            emit({ type: "completion_rejected", reason });
            messages.push({ role: "tool", name: FINISH_TURN_TOOL_NAME, toolCallId: finishCalls[0]!.id, content: reason });
            continue;
          }
          const validation = validateTurnCompletion({ declaration, assistantText: response.text, trustedEvidence: completionEvidence });
          if (!validation.accepted || !validation.disposition) {
            const reason = validation.reason ?? "finish_turn declaration was rejected";
            emit({ type: "completion_rejected", reason });
            messages.push({ role: "tool", name: FINISH_TURN_TOOL_NAME, toolCallId: finishCalls[0]!.id, content: reason });
            continue;
          }
          const disposition = validation.disposition;
          const output = response.text.trim() || (disposition.state === "waiting_input" ? disposition.question : disposition.state === "blocked" ? disposition.blocker : "");
          const reason = disposition.state === "completed" ? "completed" : disposition.state;
          return complete(reason, round, handoffs, output, disposition);
        }

        if (calls.length > 0 && usage.totalTokens >= this.config.maxTotalTokens) {
          emit({ type: "token_budget_exhausted", limit: this.config.maxTotalTokens, used: usage.totalTokens });
          return complete("token_budget_exhausted", round, handoffs, response.text);
        }

        if (calls.length === 0) {
          if (this.config.terminationProtocol === "explicit") {
            const reason = "This task requires an explicit finish_turn call before the turn can end.";
            emit({ type: "completion_rejected", reason });
            messages.push({ role: "user", content: `[Turn protocol] ${reason}` });
            continue;
          }
          const disposition = legacyTurnDisposition(response.text);
          return disposition.state === "completed"
            ? complete("completed", round, handoffs, response.text, disposition)
            : complete("blocked", round, handoffs, "", disposition);
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
        const execution = await this.executeTools(
          runId,
          input.sessionId,
          calls,
          controller.signal,
          emit,
          input.metadata,
          destructiveState,
        );
        messages.push(...execution.messages);
        completionEvidence.push(...execution.evidence);
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
  ): Promise<{ messages: AgentMessage[]; evidence: AgentCompletionEvidence[] }> {
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
    const messages: AgentMessage[] = results.map((result, index) => ({
      role: "tool",
      name: calls[index]!.name,
      toolCallId: calls[index]!.id,
      content: result.isError
        ? `${result.content}\n\n[Reflect] Identify the cause and change your approach before retrying.`
        : result.content,
    }));
    const evidence = results.flatMap((result, index): AgentCompletionEvidence[] => {
      const call = calls[index]!;
      const tool = this.tools.find((item) => item.definition.name === call.name);
      const receipts: AgentCompletionEvidence[] = tool?.definition.effect === "write" && result.writeAttempted
        ? [result.isError
          ? { kind: "tool_attempt", ref: `tool:${call.id}`, tool: call.name, effect: "write" }
          : { kind: "tool_receipt", ref: `tool:${call.id}`, tool: call.name, effect: "write" }]
        : [];
      if (result.isError) return receipts;
      for (const ref of result.artifactRefs ?? []) {
        const clean = String(ref).trim();
        if (clean) receipts.push({ kind: "artifact", ref: clean });
      }
      return receipts;
    });
    return { messages, evidence };
  }

  private modelTools(includeBusinessTools: boolean): AgentTool["definition"][] {
    const tools = includeBusinessTools ? this.tools.map((tool) => tool.definition) : [];
    return this.config.terminationProtocol === "explicit" ? [...tools, finishTurnToolDefinition()] : tools;
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
  let used = system ? messageChars(system) : 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const item = messages[index]!;
    if (item.role === "system") continue;
    if (used + messageChars(item) > maxChars && kept.length > 0) break;
    kept.unshift(item);
    used += messageChars(item);
  }
  while (kept[0]?.role === "tool") kept.shift();
  return system ? [system, ...kept] : kept;
}

function historyChars(messages: readonly AgentMessage[]): number {
  return messages.reduce((sum, item) => sum + messageChars(item), 0);
}

function messageChars(message: AgentMessage): number {
  return message.content.length + (message.providerState ? JSON.stringify(message.providerState).length : 0);
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
  disposition: AgentTurnDisposition = dispositionForStop(reason, output),
): AgentRunResult {
  emit({ type: "run_end", reason, rounds });
  return { runId, sessionId, output, reason, rounds, handoffs, messages, usage: { ...usage }, disposition };
}

function dispositionForStop(
  reason: AgentStopReason,
  output: string,
  evidence: readonly AgentCompletionEvidence[] = [],
): AgentTurnDisposition {
  if (reason === "cancelled") return { state: "cancelled", ...(evidence.length ? { evidence: evidence.map((item) => structuredClone(item)) } : {}) };
  if (reason === "waiting_input") return { state: "waiting_input", question: output.trim() || "User input is required." };
  if (reason === "completed") return legacyTurnDisposition(output);
  return {
    state: "blocked",
    blocker: `The run stopped before a verified completion (${reason}).`,
    ...(output.trim() ? { partialOutput: output.trim() } : {}),
    ...(evidence.length ? { evidence: evidence.map((item) => structuredClone(item)) } : {}),
  };
}

function cancelledDisposition(
  signal: AbortSignal,
  evidence: readonly AgentCompletionEvidence[] = [],
): AgentTurnDisposition {
  const reason = signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "").trim();
  return {
    state: "cancelled",
    ...(reason ? { reason } : {}),
    ...(evidence.length ? { evidence: evidence.map((item) => structuredClone(item)) } : {}),
  };
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
