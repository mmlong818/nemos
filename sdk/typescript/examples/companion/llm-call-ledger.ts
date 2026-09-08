import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type LlmCallPurpose = "task_turn" | "team_plan" | "team_worker" | "team_review" | "team_final" | "memory_extract" | "completion_verify" | "other";
export type LlmCallStatus = "in_progress" | "completed" | "failed" | "cancelled" | "interrupted";
export interface LlmCallUsage {
  reported: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}
export interface LlmCallRecord {
  id: string;
  runId: string | null;
  taskId: string | null;
  purpose: LlmCallPurpose;
  provider: string;
  model: string;
  status: LlmCallStatus;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  usage: LlmCallUsage;
  errorKind: string | null;
}
export interface LlmCallLedgerInput {
  runId?: string;
  taskId?: string;
  purpose?: LlmCallPurpose;
  provider: string;
  model: string;
  startedAt?: string;
}
export interface LlmCallOutcome {
  status: Exclude<LlmCallStatus, "in_progress" | "interrupted">;
  finishedAt?: string;
  usage?: Partial<Omit<LlmCallUsage, "reported">> & { reported?: boolean };
  error?: unknown;
}

/** Local, bounded metadata only. Prompts, responses, endpoint URLs and credentials never enter this store. */
export class FileLlmCallLedger {
  private records: LlmCallRecord[];
  constructor(private readonly file: string, private readonly cap = 500) {
    this.records = this.read();
    let changed = false;
    for (const record of this.records) {
      if (record.status === "in_progress") { record.status = "interrupted"; changed = true; }
    }
    if (changed) this.persist();
  }
  start(input: LlmCallLedgerInput): { id: string; finish: (outcome: LlmCallOutcome) => void } {
    const record: LlmCallRecord = {
      id: randomUUID(), runId: cleanId(input.runId), taskId: cleanId(input.taskId),
      purpose: input.purpose ?? "other", provider: boundedLabel(input.provider, "unknown"), model: boundedLabel(input.model, "unknown"),
      status: "in_progress", startedAt: validTime(input.startedAt) ?? new Date().toISOString(), finishedAt: null, latencyMs: null,
      usage: unknownUsage(), errorKind: null,
    };
    this.records.push(record); this.trim(); this.persist();
    return { id: record.id, finish: (outcome) => this.finish(record.id, outcome) };
  }
  finish(id: string, outcome: LlmCallOutcome): void {
    const record = this.records.find((item) => item.id === id);
    if (!record || record.status !== "in_progress") return;
    const finishedAt = validTime(outcome.finishedAt) ?? new Date().toISOString();
    record.status = outcome.status;
    record.finishedAt = finishedAt;
    const elapsed = Date.parse(finishedAt) - Date.parse(record.startedAt);
    record.latencyMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
    record.usage = normalizeUsage(outcome.usage);
    record.errorKind = outcome.status === "failed" ? classifyError(outcome.error) : null;
    this.trim(); this.persist();
  }
  list(options: { limit?: number; runId?: string; taskId?: string; purpose?: LlmCallPurpose } = {}): LlmCallRecord[] {
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50)));
    return this.records.filter((record) => (!options.runId || record.runId === options.runId)
      && (!options.taskId || record.taskId === options.taskId) && (!options.purpose || record.purpose === options.purpose))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(copyRecord);
  }
  summarize(options: { runId?: string; taskId?: string } = {}) {
    const records = this.list({ ...options, limit: 500 });
    const byPurpose: Partial<Record<LlmCallPurpose, number>> = {};
    const byStatus: Partial<Record<LlmCallStatus, number>> = {};
    let knownInputTokens = 0, knownOutputTokens = 0, knownTotalTokens = 0, unknownUsageCalls = 0;
    for (const item of records) {
      byPurpose[item.purpose] = (byPurpose[item.purpose] ?? 0) + 1;
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
      if (!item.usage.reported) unknownUsageCalls++;
      else { knownInputTokens += item.usage.inputTokens ?? 0; knownOutputTokens += item.usage.outputTokens ?? 0; knownTotalTokens += item.usage.totalTokens ?? 0; }
    }
    return { calls: records.length, byPurpose, byStatus, knownUsage: { inputTokens: knownInputTokens, outputTokens: knownOutputTokens, totalTokens: knownTotalTokens }, unknownUsageCalls };
  }
  private read(): LlmCallRecord[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      return Array.isArray(raw) ? raw.flatMap(normalizeRecord).slice(-this.cap) : [];
    } catch { return []; }
  }
  private trim(): void { this.records = this.records.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(-this.cap); }
  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.records, null, 2) + "\n", "utf8");
    renameSync(temporary, this.file);
  }
}

function normalizeRecord(value: unknown): LlmCallRecord[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Partial<LlmCallRecord>;
  if (typeof row.id !== "string" || !validTime(row.startedAt) || typeof row.provider !== "string" || typeof row.model !== "string") return [];
  const status: LlmCallStatus = ["in_progress", "completed", "failed", "cancelled", "interrupted"].includes(String(row.status)) ? row.status as LlmCallStatus : "interrupted";
  const purpose: LlmCallPurpose = ["task_turn", "team_plan", "team_worker", "team_review", "team_final", "memory_extract", "completion_verify", "other"].includes(String(row.purpose)) ? row.purpose as LlmCallPurpose : "other";
  return [{ id: row.id, runId: cleanId(row.runId), taskId: cleanId(row.taskId), purpose, provider: boundedLabel(row.provider, "unknown"), model: boundedLabel(row.model, "unknown"), status, startedAt: row.startedAt!, finishedAt: validTime(row.finishedAt), latencyMs: typeof row.latencyMs === "number" && row.latencyMs >= 0 ? row.latencyMs : null, usage: normalizeUsage(row.usage), errorKind: typeof row.errorKind === "string" ? boundedLabel(row.errorKind, "error") : null }];
}
function normalizeUsage(value: unknown): LlmCallUsage {
  const row = value && typeof value === "object" ? value as Partial<LlmCallUsage> : {};
  const inputTokens = token(row.inputTokens), outputTokens = token(row.outputTokens), totalTokens = token(row.totalTokens);
  return { reported: row.reported === true || inputTokens !== null || outputTokens !== null || totalTokens !== null, inputTokens, outputTokens, totalTokens };
}
function unknownUsage(): LlmCallUsage { return { reported: false, inputTokens: null, outputTokens: null, totalTokens: null }; }
function token(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null; }
function cleanId(value: unknown): string | null { return typeof value === "string" && /^[\w:/.-]{1,240}$/.test(value) ? value : null; }
function boundedLabel(value: unknown, fallback: string): string { return typeof value === "string" && /^[\w.-]{1,120}$/.test(value) ? value : fallback; }
function validTime(value: unknown): string | null { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null; }
function classifyError(error: unknown): string { if (error && typeof error === "object" && "name" in error && typeof error.name === "string") return boundedLabel(error.name, "error"); return "error"; }
function copyRecord(record: LlmCallRecord): LlmCallRecord { return { ...record, usage: { ...record.usage } }; }
