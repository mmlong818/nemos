import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  AgentMessage,
  AgentRunCheckpoint,
  AgentRunEvent,
  AgentRunInput,
  AgentRunObserver,
  AgentRunResult,
  AgentStopReason,
  AgentToolCall,
} from "./types.js";

export type AgentStoredRunStatus = AgentStopReason | "running" | "failed" | "interrupted";
export type AgentStoreToolResultMode = "full" | "summary" | "metadata";

export interface AgentStoredEvent {
  sequence: number;
  at: string;
  event: AgentRunEvent;
}

export interface AgentStoredCheckpoint extends AgentRunCheckpoint {
  at: string;
  eventSequence: number;
}

export interface AgentStoredRun {
  runId: string;
  sessionId: string;
  status: AgentStoredRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  resumedAt?: string;
  resumeCount: number;
  systemPrompt: string;
  prompt: string;
  metadata?: Record<string, string>;
  rounds: number;
  handoffs: number;
  usage: AgentRunResult["usage"];
  output: string;
  messages: AgentMessage[];
  events: AgentStoredEvent[];
  checkpoint?: AgentStoredCheckpoint;
  error?: string;
  resumable?: boolean;
  resumeBlockedReason?: string;
}

export interface AgentStoredRunSummary {
  runId: string;
  sessionId: string;
  status: AgentStoredRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  resumedAt?: string;
  resumeCount: number;
  metadata?: Record<string, string>;
  rounds: number;
  usage: AgentRunResult["usage"];
  outputPreview: string;
  error?: string;
  resumable: boolean;
  resumeBlockedReason?: string;
}

export interface AgentRunResumeAssessment {
  resumable: boolean;
  checkpoint?: AgentRunCheckpoint;
  reason?: string;
}

export interface FileAgentRunStoreOptions {
  maxRuns?: number;
  maxEventsPerRun?: number;
  maxMessageChars?: number;
  toolResultMode?: AgentStoreToolResultMode;
  maxToolResultChars?: number;
  maxLogRecords?: number;
}

interface LegacyStoredFile {
  version: 1;
  runs: AgentStoredRun[];
}

type AgentRunLogRecord =
  | {
      version: 2;
      kind: "started";
      runId?: string;
      sessionId: string;
      at: string;
      payload: {
        systemPrompt: string;
        prompt: string;
        metadata?: Record<string, string>;
        messages: AgentMessage[];
      };
    }
  | {
      version: 2;
      kind: "resumed";
      runId?: string;
      sessionId: string;
      at: string;
      payload: { checkpoint: AgentRunCheckpoint };
    }
  | {
      version: 2;
      kind: "event";
      runId?: string;
      sessionId: string;
      at: string;
      payload: { event: AgentRunEvent };
    }
  | {
      version: 2;
      kind: "checkpoint";
      runId?: string;
      sessionId: string;
      at: string;
      payload: { checkpoint: AgentStoredCheckpoint };
    }
  | {
      version: 2;
      kind: "completed";
      runId?: string;
      sessionId: string;
      at: string;
      payload: { result: AgentRunResult };
    }
  | {
      version: 2;
      kind: "failed" | "interrupted";
      runId?: string;
      sessionId: string;
      at: string;
      payload: { error: string };
    }
  | {
      version: 2;
      kind: "snapshot";
      runId?: string;
      sessionId: string;
      at: string;
      payload: { run: AgentStoredRun };
    };

const DEFAULTS: Required<FileAgentRunStoreOptions> = {
  maxRuns: 500,
  maxEventsPerRun: 2_000,
  maxMessageChars: 200_000,
  toolResultMode: "summary",
  maxToolResultChars: 2_000,
  maxLogRecords: 25_000,
};

/**
 * 追加式 Agent 运行事件日志。内存状态是日志投影；重启时从 JSONL 重建，
 * 仅在达到保留上限时压缩为每个 run 一条快照。
 */
export class FileAgentRunStore implements AgentRunObserver {
  private readonly options: Required<FileAgentRunStoreOptions>;
  private readonly runs = new Map<string, AgentStoredRun>();
  private recordCount = 0;

  constructor(private readonly file: string, options: FileAgentRunStoreOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    mkdirSync(dirname(file), { recursive: true });
    this.load();

    const interrupted = [...this.runs.values()].filter((run) => run.status === "running");
    for (const run of interrupted) {
      this.append({
        version: 2,
        kind: "interrupted",
        runId: run.runId,
        sessionId: run.sessionId,
        at: new Date().toISOString(),
        payload: { error: "Process stopped before the run emitted a terminal event" },
      }, false);
    }
    if (this.runs.size > this.options.maxRuns || this.recordCount > this.options.maxLogRecords) {
      this.compact();
    }
  }

  onStart(input: AgentRunInput, messages: readonly AgentMessage[]): void {
    const now = new Date().toISOString();
    this.append({
      version: 2,
      kind: "started",
      runId: input.runId ?? input.sessionId,
      sessionId: input.sessionId,
      at: now,
      payload: {
        systemPrompt: bounded(redactText(input.systemPrompt), this.options.maxMessageChars),
        prompt: bounded(redactText(input.prompt), this.options.maxMessageChars),
        metadata: sanitizeMetadata(input.metadata),
        messages: sanitizeMessages(messages, this.options),
      },
    });
  }

  onResume(input: AgentRunInput, checkpoint: AgentRunCheckpoint): void {
    this.append({
      version: 2,
      kind: "resumed",
      runId: input.runId ?? input.sessionId,
      sessionId: input.sessionId,
      at: new Date().toISOString(),
      payload: { checkpoint: sanitizeCheckpoint(checkpoint, this.options) },
    });
  }

  onEvent(runId: string, event: AgentRunEvent): void {
    this.append({
      version: 2,
      kind: "event",
      runId,
      sessionId: this.runs.get(runId)?.sessionId ?? runId,
      at: new Date().toISOString(),
      payload: { event: sanitizeEvent(event, this.options) },
    });
  }

  onCheckpoint(runId: string, checkpoint: AgentRunCheckpoint): void {
    const run = this.runs.get(runId);
    const now = new Date().toISOString();
    this.append({
      version: 2,
      kind: "checkpoint",
      runId,
      sessionId: run?.sessionId ?? runId,
      at: now,
      payload: {
        checkpoint: {
          ...sanitizeCheckpoint(checkpoint, this.options),
          at: now,
          eventSequence: run?.events.at(-1)?.sequence ?? 0,
        },
      },
    });
  }

  onComplete(runId: string, result: AgentRunResult): void {
    this.append({
      version: 2,
      kind: "completed",
      runId,
      sessionId: result.sessionId,
      at: new Date().toISOString(),
      payload: { result: sanitizeResult(result, this.options) },
    });
  }

  onError(runId: string, error: Error): void {
    this.append({
      version: 2,
      kind: "failed",
      runId,
      sessionId: this.runs.get(runId)?.sessionId ?? runId,
      at: new Date().toISOString(),
      payload: { error: redactText(error.message) },
    });
  }

  list(options: { limit?: number; status?: AgentStoredRunStatus } = {}): AgentStoredRunSummary[] {
    const limit = Math.min(500, Math.max(1, options.limit ?? 50));
    return [...this.runs.values()]
      .filter((run) => !options.status || run.status === options.status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((run) => {
        const recovery = this.assessResume(run);
        return {
          runId: run.runId,
          sessionId: run.sessionId,
          status: run.status,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          resumedAt: run.resumedAt,
          resumeCount: run.resumeCount,
          metadata: run.metadata ? { ...run.metadata } : undefined,
          rounds: run.rounds,
          usage: { ...run.usage },
          outputPreview: run.output.slice(0, 240),
          error: run.error,
          resumable: recovery.resumable,
          resumeBlockedReason: recovery.reason,
        };
      });
  }

  get(runId: string): AgentStoredRun | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    const recovery = this.assessResume(run);
    return structuredClone({
      ...run,
      resumable: recovery.resumable,
      resumeBlockedReason: recovery.reason,
    });
  }

  getResumeState(runId: string): AgentRunResumeAssessment {
    const run = this.runs.get(runId);
    if (!run) return { resumable: false, reason: "Agent run not found" };
    return this.assessResume(run);
  }

  private append(record: AgentRunLogRecord, allowCompact = true): void {
    appendFileSync(this.file, JSON.stringify(record) + "\n", "utf8");
    this.recordCount++;
    this.apply(record);
    if (
      allowCompact &&
      (this.recordCount > this.options.maxLogRecords || this.runs.size > this.options.maxRuns)
    ) {
      this.compact();
    }
  }

  private apply(record: AgentRunLogRecord): void {
    const runId = record.runId ?? record.sessionId;
    if (record.kind === "snapshot") {
      this.runs.set(runId, normalizeStoredRun({ ...record.payload.run, runId }));
      return;
    }
    if (record.kind === "started") {
      this.runs.set(runId, {
        runId,
        sessionId: record.sessionId,
        status: "running",
        startedAt: record.at,
        updatedAt: record.at,
        resumeCount: 0,
        systemPrompt: record.payload.systemPrompt,
        prompt: record.payload.prompt,
        metadata: record.payload.metadata,
        rounds: 0,
        handoffs: 0,
        usage: emptyUsage(),
        output: "",
        messages: record.payload.messages,
        events: [],
      });
      return;
    }

    const run = this.runs.get(runId);
    if (!run) return;
    run.updatedAt = record.at;

    if (record.kind === "resumed") {
      run.status = "running";
      run.completedAt = undefined;
      run.error = undefined;
      run.resumedAt = record.at;
      run.resumeCount = (run.resumeCount ?? 0) + 1;
      run.checkpoint = {
        ...record.payload.checkpoint,
        at: record.at,
        eventSequence: run.events.at(-1)?.sequence ?? 0,
      };
      run.messages = structuredClone(record.payload.checkpoint.messages);
      run.rounds = Math.max(run.rounds, record.payload.checkpoint.round);
      run.handoffs = record.payload.checkpoint.handoffs;
      run.usage = normalizeUsage(record.payload.checkpoint.usage);
      return;
    }

    if (record.kind === "event") {
      run.events.push({
        sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
        at: record.at,
        event: record.payload.event,
      });
      if (run.events.length > this.options.maxEventsPerRun) {
        run.events.splice(0, run.events.length - this.options.maxEventsPerRun);
      }
      if (record.payload.event.type === "round_start") {
        run.rounds = Math.max(run.rounds, record.payload.event.round);
      }
      if (record.payload.event.type === "handoff") run.handoffs = record.payload.event.count;
      if (record.payload.event.type === "model_end") {
        const inputTokens = normalizeCount(record.payload.event.inputTokens);
        const outputTokens = normalizeCount(record.payload.event.outputTokens);
        run.usage = {
          inputTokens: run.usage.inputTokens + inputTokens,
          outputTokens: run.usage.outputTokens + outputTokens,
          totalTokens: run.usage.totalTokens + inputTokens + outputTokens,
          modelCalls: run.usage.modelCalls + 1,
        };
      }
      return;
    }

    if (record.kind === "checkpoint") {
      run.checkpoint = record.payload.checkpoint;
      run.rounds = Math.max(run.rounds, record.payload.checkpoint.round);
      run.handoffs = record.payload.checkpoint.handoffs;
      run.usage = normalizeUsage(record.payload.checkpoint.usage);
      run.messages = structuredClone(record.payload.checkpoint.messages);
      return;
    }

    if (record.kind === "completed") {
      run.status = record.payload.result.reason;
      run.completedAt = record.at;
      run.rounds = record.payload.result.rounds;
      run.handoffs = record.payload.result.handoffs;
      run.usage = normalizeUsage(record.payload.result.usage);
      run.output = record.payload.result.output;
      run.messages = record.payload.result.messages;
      return;
    }

    run.status = record.kind === "failed" ? "failed" : "interrupted";
    run.completedAt = record.at;
    run.error = record.payload.error;
  }

  private assessResume(run: AgentStoredRun): AgentRunResumeAssessment {
    if (run.status !== "interrupted" && run.status !== "failed") {
      return { resumable: false, reason: "Only interrupted or failed runs can resume" };
    }

    const checkpoint = run.checkpoint
      ? structuredClone(run.checkpoint) as AgentStoredCheckpoint
      : initialResumeCheckpoint(run);
    const after = run.events.filter((item) => item.sequence > checkpoint.eventSequence);
    if (checkpoint.phase === "after_tools") {
      return { resumable: true, checkpoint: stripStoredCheckpoint(checkpoint) };
    }

    const calls = checkpoint.pendingToolCalls ?? pendingCallsFromMessages(checkpoint.messages);
    if (calls.length === 0) {
      return { resumable: false, reason: "Checkpoint has no pending tool calls" };
    }

    const completed = new Map<string, Extract<AgentRunEvent, { type: "tool_end" }>>();
    const allowed = new Set<string>();
    for (const item of after) {
      if (item.event.type === "tool_end") completed.set(item.event.call.id, item.event);
      if (item.event.type === "tool_authorization" && item.event.allowed) {
        allowed.add(item.event.call.id);
      }
    }

    const missing = calls.filter((call) => !completed.has(call.id));
    if (missing.some((call) => allowed.has(call.id))) {
      return {
        resumable: false,
        reason: "A write tool may have executed before interruption; review its side effect before retrying",
      };
    }

    if (completed.size > 0 && missing.length > 0) {
      const completedWrite = calls.some((call) => completed.has(call.id) && allowed.has(call.id));
      if (completedWrite) {
        return {
          resumable: false,
          reason: "A partial tool batch contains a completed write; automatic replay is unsafe",
        };
      }
      return {
        resumable: true,
        checkpoint: {
          ...stripStoredCheckpoint(checkpoint),
          pendingToolCalls: structuredClone(calls),
        },
      };
    }

    if (missing.length === 0) {
      const messages = structuredClone(checkpoint.messages);
      for (const call of calls) {
        const event = completed.get(call.id)!;
        messages.push({
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: event.result.isError
            ? `${event.result.content}\n\n[Reflect] Identify the cause and change your approach before retrying.`
            : event.result.content,
        });
      }
      return {
        resumable: true,
        checkpoint: {
          ...stripStoredCheckpoint(checkpoint),
          phase: "after_tools",
          nextRound: checkpoint.round + 1,
          messages,
          pendingToolCalls: undefined,
        },
      };
    }

    return {
      resumable: true,
      checkpoint: {
        ...stripStoredCheckpoint(checkpoint),
        pendingToolCalls: structuredClone(calls),
      },
    };
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    const raw = readFileSync(this.file, "utf8");
    if (!raw.trim()) return;

    try {
      const parsed = JSON.parse(raw) as LegacyStoredFile;
      if (parsed.version === 1 && Array.isArray(parsed.runs)) {
        for (const run of parsed.runs) {
          if (run?.sessionId) {
            const normalized = normalizeStoredRun(run);
            this.runs.set(normalized.runId, normalized);
          }
        }
        this.compact();
        return;
      }
    } catch {
      // JSONL 不是单个 JSON 文档，继续逐行回放。
    }

    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as AgentRunLogRecord;
        if (record.version !== 2 || !record.sessionId || !record.kind) continue;
        this.recordCount++;
        this.apply(record);
      } catch {
        // 崩溃可能只留下最后一条不完整记录；已有完整事件仍可恢复。
      }
    }
  }

  private compact(): void {
    const ordered = [...this.runs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.runs.clear();
    for (const run of ordered.slice(0, this.options.maxRuns)) {
      this.runs.set(run.runId, run);
    }

    const lines = [...this.runs.values()].map((run): string => JSON.stringify({
      version: 2,
      kind: "snapshot",
      runId: run.runId,
      sessionId: run.sessionId,
      at: run.updatedAt,
      payload: { run },
    } satisfies AgentRunLogRecord));
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, lines.length ? lines.join("\n") + "\n" : "", "utf8");
    renameSync(temp, this.file);
    this.recordCount = lines.length;
  }
}

function initialResumeCheckpoint(run: AgentStoredRun): AgentStoredCheckpoint {
  return {
    phase: "after_tools",
    round: 0,
    nextRound: 1,
    messages: structuredClone(run.messages),
    handoffs: run.handoffs,
    previousToolCallSignature: "",
    repeatedToolCallCount: 0,
    usage: { ...run.usage },
    at: run.startedAt,
    eventSequence: 0,
  };
}

function stripStoredCheckpoint(checkpoint: AgentStoredCheckpoint): AgentRunCheckpoint {
  const { at: _at, eventSequence: _eventSequence, ...runtime } = checkpoint;
  return runtime;
}

function pendingCallsFromMessages(messages: readonly AgentMessage[]): AgentToolCall[] {
  const assistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0);
  return structuredClone(assistant?.toolCalls ?? []);
}

function normalizeStoredRun(run: AgentStoredRun): AgentStoredRun {
  return {
    ...run,
    runId: run.runId || run.sessionId,
    resumeCount: run.resumeCount ?? 0,
    usage: normalizeUsage(run.usage),
    messages: Array.isArray(run.messages) ? run.messages : [],
    events: Array.isArray(run.events) ? run.events : [],
  };
}

function emptyUsage(): AgentRunResult["usage"] {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0 };
}

function normalizeUsage(usage?: Partial<AgentRunResult["usage"]>): AgentRunResult["usage"] {
  const inputTokens = normalizeCount(usage?.inputTokens);
  const outputTokens = normalizeCount(usage?.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    modelCalls: normalizeCount(usage?.modelCalls),
  };
}

function normalizeCount(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : 0;
}

function sanitizeResult(
  result: AgentRunResult,
  options: Required<FileAgentRunStoreOptions>,
): AgentRunResult {
  return {
    ...result,
    output: bounded(redactText(result.output), options.maxMessageChars),
    messages: sanitizeMessages(result.messages, options),
  };
}

function sanitizeCheckpoint(
  checkpoint: AgentRunCheckpoint,
  options: Required<FileAgentRunStoreOptions>,
): AgentRunCheckpoint {
  return {
    ...checkpoint,
    messages: sanitizeMessages(checkpoint.messages, options),
    pendingToolCalls: checkpoint.pendingToolCalls?.map((call) => ({
      ...call,
      arguments: sanitizeObject(call.arguments),
    })),
  };
}

function sanitizeMessages(
  messages: readonly AgentMessage[],
  options: Required<FileAgentRunStoreOptions>,
): AgentMessage[] {
  return messages.map((message) => {
    const isTool = message.role === "tool";
    const content = isTool && options.toolResultMode === "metadata"
      ? "[tool result omitted]"
      : isTool && options.toolResultMode === "summary"
        ? bounded(redactText(message.content), options.maxToolResultChars)
        : bounded(redactText(message.content), options.maxMessageChars);
    return {
      ...message,
      content,
      toolCalls: message.toolCalls?.map((call) => ({
        ...call,
        arguments: sanitizeObject(call.arguments),
      })),
    };
  });
}

function sanitizeEvent(
  event: AgentRunEvent,
  options: Required<FileAgentRunStoreOptions>,
): AgentRunEvent {
  if (event.type === "tool_end") {
    const content = options.toolResultMode === "metadata"
      ? "[tool result omitted]"
      : options.toolResultMode === "summary"
        ? bounded(redactText(event.result.content), options.maxToolResultChars)
        : redactText(event.result.content);
    return {
      ...event,
      call: { ...event.call, arguments: sanitizeObject(event.call.arguments) },
      result: { ...event.result, content, data: undefined },
    };
  }
  if (event.type === "tool_start" || event.type === "tool_authorization") {
    return { ...event, call: { ...event.call, arguments: sanitizeObject(event.call.arguments) } };
  }
  if (event.type === "run_start") return { ...event, metadata: sanitizeMetadata(event.metadata) };
  if (event.type === "run_error") return { ...event, message: redactText(event.message) };
  return { ...event };
}

function sanitizeMetadata(value?: Readonly<Record<string, string>>): Record<string, string> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactText(item)]));
}

function sanitizeObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactText(JSON.stringify(value))) as Record<string, unknown>;
}

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2");
}

function bounded(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}\n...[stored value truncated]`;
}
