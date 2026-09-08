import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type RunningTaskMessageMode = "merge" | "redirect";
export interface RunningTaskMessage { id: string; jobId: string; userId: string; mode: RunningTaskMessageMode; text: string; revision: number; acceptedAt: string; }
interface StoredState { version: 1; messages: RunningTaskMessage[]; }

export class RunningTaskSteeringStore {
  private state: StoredState = { version: 1, messages: [] };
  constructor(private readonly file: string) { this.load(); }
  append(input: { id?: string; jobId: string; userId: string; mode: RunningTaskMessageMode; text: string }): RunningTaskMessage {
    const id = clean(input.id, 120); const jobId = clean(input.jobId, 120); const userId = clean(input.userId, 120); const text = clean(input.text, 4000);
    if (!jobId || !userId || !text || !["merge", "redirect"].includes(input.mode)) throw new RunningTaskSteeringError("追加消息无效");
    const previous = id && this.state.messages.find((item) => item.id === id && item.jobId === jobId && item.userId === userId);
    if (previous) { if (previous.mode !== input.mode || previous.text !== text) throw new RunningTaskSteeringError("同一消息编号的内容已改变"); return structuredClone(previous); }
    if (this.state.messages.length >= 500) throw new RunningTaskSteeringError("运行中消息收件箱已满；本次未记录，请等待已接收消息处理后再试", 409);
    const revision = Math.max(0, ...this.state.messages.filter((item) => item.jobId === jobId).map((item) => item.revision)) + 1;
    const value = { id: id || `steer-${randomUUID()}`, jobId, userId, mode: input.mode, text, revision, acceptedAt: new Date().toISOString() } satisfies RunningTaskMessage;
    this.state.messages.push(value); this.save(); return structuredClone(value);
  }
  /** The eligibility check and durable append contain no await, so a worker checkpoint cannot interleave them. */
  accept(input: { id?: string; jobId: string; userId: string; mode: RunningTaskMessageMode; text: string }, task: {
    status: string; stage?: { id?: string; name?: string; state?: string };
  }): { message: RunningTaskMessage; effective: string } {
    if (!['queued', 'running'].includes(task.status)) throw new RunningTaskSteeringError("任务已结束，追加消息不会生效", 409);
    if (task.stage?.id === 'final') throw new RunningTaskSteeringError("任务已进入最终核验，现在追加无法保证生效；本次未记录", 409);
    const message = this.append(input);
    return { message, effective: task.status === 'queued' ? '执行开始时生效' : `当前 ${task.stage?.name || 'Bot'} 阶段结束后尝试纳入` };
  }
  snapshot(jobId: string, userId: string): RunningTaskMessage[] { return this.state.messages.filter((item) => item.jobId === jobId && item.userId === userId).map((item) => structuredClone(item)); }
  private load() { if (!existsSync(this.file)) return; try { const value = JSON.parse(readFileSync(this.file, "utf8")); if (value?.version === 1 && Array.isArray(value.messages)) this.state = { version: 1, messages: value.messages.filter(valid).slice(-500) }; } catch { /* damaged inbox grants nothing */ } }
  private save() { mkdirSync(dirname(this.file), { recursive: true }); const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8"); renameSync(temporary, this.file); }
}
export class RunningTaskSteeringError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
function clean(value: unknown, limit: number) { const text = String(value || "").trim(); if (text.length > limit) throw new RunningTaskSteeringError(`追加消息不能超过 ${limit} 字符`); return text; }
function valid(value: unknown): value is RunningTaskMessage { const item = value as RunningTaskMessage; return !!item && typeof item.id === "string" && typeof item.jobId === "string" && typeof item.userId === "string" && ["merge", "redirect"].includes(item.mode) && typeof item.text === "string" && Number.isSafeInteger(item.revision) && item.revision > 0 && typeof item.acceptedAt === "string"; }
