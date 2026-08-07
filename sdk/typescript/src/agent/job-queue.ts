import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type AgentJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "uncertain";

export type AgentJobReconciliationOutcome = "succeeded" | "not_applied";

export interface AgentJobReconciliation {
  outcome: AgentJobReconciliationOutcome;
  note: string;
  reconciledAt: string;
}

export interface AgentJobInput {
  type: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, string>;
  priority?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  sideEffectRisk?: boolean;
  idempotencyKey?: string;
  /** 成功结果需要由客户端投递到角色会话，并由服务端持久确认。 */
  deliveryRequired?: boolean;
}

export interface AgentJobResult {
  summary: string;
  artifactRefs?: string[];
  data?: unknown;
}

export interface AgentJobCheckpoint {
  at: string;
  progress?: number;
  status: string;
  data?: unknown;
}

export interface AgentJobRecord extends AgentJobInput {
  id: string;
  status: AgentJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  workerId?: string;
  leaseUntil?: string;
  startedAt?: string;
  completedAt?: string;
  cancellationRequested?: boolean;
  error?: string;
  result?: AgentJobResult;
  checkpoints: AgentJobCheckpoint[];
  deliveredAt?: string;
  uncertainAt?: string;
  reconciliation?: AgentJobReconciliation;
}

export interface FileAgentJobQueueOptions {
  leaseMs?: number;
  maxJobs?: number;
  retryBaseDelayMs?: number;
  onChange?: (event: AgentJobQueueEvent) => void;
}

export interface AgentJobQueueEvent {
  action: "enqueued" | "claimed" | "checkpoint" | "completed" | "failed" | "cancelled" | "retried" | "recovered" | "uncertain" | "reconciled" | "delivered";
  job: Pick<AgentJobRecord, "id" | "status" | "updatedAt">;
}

interface JobFile {
  version: 1;
  jobs: AgentJobRecord[];
}

const DEFAULTS: Required<Omit<FileAgentJobQueueOptions, "onChange">> = {
  leaseMs: 5 * 60_000,
  maxJobs: 1_000,
  retryBaseDelayMs: 2_000,
};
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60_000;

/** 持久任务队列。高副作用任务崩溃后转人工复核，不会无条件自动重放。 */
export class FileAgentJobQueue {
  private readonly options: Required<Omit<FileAgentJobQueueOptions, "onChange">>;
  private readonly onChange?: FileAgentJobQueueOptions["onChange"];
  private readonly jobs = new Map<string, AgentJobRecord>();

  constructor(private readonly file: string, options: FileAgentJobQueueOptions = {}) {
    this.options = {
      leaseMs: options.leaseMs ?? DEFAULTS.leaseMs,
      maxJobs: options.maxJobs ?? DEFAULTS.maxJobs,
      retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs,
    };
    this.onChange = options.onChange;
    mkdirSync(dirname(file), { recursive: true });
    this.load();
    // 进程启动时，文件中的 running 一定属于上一个 Worker；不能等旧租约自然过期。
    this.recoverStale(new Date(), true);
  }

  enqueue(input: AgentJobInput): AgentJobRecord {
    if (!input.type.trim()) throw new Error("Agent job type is required");
    if (input.idempotencyKey) {
      const existing = [...this.jobs.values()].find((job) =>
        job.idempotencyKey === input.idempotencyKey &&
        (job.status === "queued" || job.status === "running" || job.status === "succeeded" || job.status === "uncertain"));
      if (existing) return structuredClone(existing);
    }
    const now = new Date().toISOString();
    const job: AgentJobRecord = {
      ...input,
      payload: sanitizeValue(input.payload),
      metadata: input.metadata ? sanitizeValue(input.metadata) : undefined,
      id: randomUUID(),
      status: "queued",
      attempts: 0,
      priority: finiteNumber(input.priority, 0),
      maxAttempts: Math.min(10, Math.max(1, finiteNumber(input.maxAttempts, 3))),
      timeoutMs: Math.min(24 * 60 * 60_000, Math.max(1_000, finiteNumber(input.timeoutMs, DEFAULT_JOB_TIMEOUT_MS))),
      sideEffectRisk: input.sideEffectRisk ?? false,
      createdAt: now,
      updatedAt: now,
      availableAt: now,
      checkpoints: [],
    };
    this.jobs.set(job.id, job);
    this.prune();
    this.save();
    this.emitChange("enqueued", job);
    return structuredClone(job);
  }

  claimNext(workerId: string, now = new Date()): AgentJobRecord | null {
    const next = [...this.jobs.values()]
      .filter((job) => job.status === "queued" && Date.parse(job.availableAt) <= now.getTime())
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return null;
    const nowIso = now.toISOString();
    next.status = "running";
    next.workerId = workerId;
    next.attempts++;
    next.startedAt = nowIso;
    next.updatedAt = nowIso;
    next.leaseUntil = new Date(now.getTime() + this.options.leaseMs).toISOString();
    next.cancellationRequested = false;
    delete next.error;
    this.save();
    this.emitChange("claimed", next);
    return structuredClone(next);
  }

  heartbeat(id: string, workerId: string, checkpoint?: Omit<AgentJobCheckpoint, "at">): void {
    const job = this.requireRunning(id, workerId);
    const now = new Date();
    job.updatedAt = now.toISOString();
    job.leaseUntil = new Date(now.getTime() + this.options.leaseMs).toISOString();
    if (checkpoint) {
      job.checkpoints.push({ ...checkpoint, data: sanitizeValue(checkpoint.data), at: now.toISOString() });
      if (job.checkpoints.length > 100) job.checkpoints.splice(0, job.checkpoints.length - 100);
    }
    this.save();
    this.emitChange("checkpoint", job);
  }

  complete(id: string, workerId: string, result: AgentJobResult): AgentJobRecord {
    const job = this.requireRunning(id, workerId);
    const now = new Date().toISOString();
    job.status = "succeeded";
    job.result = sanitizeValue(result);
    job.updatedAt = now;
    job.completedAt = now;
    delete job.leaseUntil;
    this.save();
    this.emitChange("completed", job);
    return structuredClone(job);
  }

  fail(id: string, workerId: string, error: unknown): AgentJobRecord {
    const job = this.requireRunning(id, workerId);
    const now = new Date();
    job.error = redactText(error instanceof Error ? error.message : String(error));
    job.updatedAt = now.toISOString();
    delete job.leaseUntil;
    if (!job.cancellationRequested && job.sideEffectRisk) {
      job.status = "uncertain";
      job.uncertainAt = now.toISOString();
      delete job.completedAt;
    } else if (!job.cancellationRequested && job.attempts < (job.maxAttempts ?? 1)) {
      job.status = "queued";
      const delay = this.options.retryBaseDelayMs * Math.pow(2, Math.max(0, job.attempts - 1));
      job.availableAt = new Date(now.getTime() + delay).toISOString();
    } else {
      job.status = job.cancellationRequested ? "cancelled" : "failed";
      job.completedAt = now.toISOString();
    }
    this.save();
    this.emitChange(job.status === "uncertain" ? "uncertain" : "failed", job);
    return structuredClone(job);
  }

  cancel(id: string): AgentJobRecord {
    const job = this.require(id);
    const now = new Date().toISOString();
    job.cancellationRequested = true;
    job.updatedAt = now;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.completedAt = now;
    }
    this.save();
    this.emitChange("cancelled", job);
    return structuredClone(job);
  }

  retry(id: string, options: { confirmSideEffect?: boolean } = {}): AgentJobRecord {
    const job = this.require(id);
    if (job.status !== "failed" && job.status !== "cancelled") {
      if (job.status === "uncertain") throw new Error("Uncertain jobs must be reconciled before retry");
      throw new Error("Only failed or cancelled jobs can be retried");
    }
    if (job.sideEffectRisk && !options.confirmSideEffect) {
      throw new Error("Retrying this side-effecting job requires explicit confirmation");
    }
    const now = new Date().toISOString();
    job.status = "queued";
    job.attempts = 0;
    job.updatedAt = now;
    job.availableAt = now;
    job.cancellationRequested = false;
    delete job.completedAt;
    delete job.workerId;
    delete job.leaseUntil;
    delete job.result;
    delete job.deliveredAt;
    delete job.error;
    delete job.uncertainAt;
    delete job.reconciliation;
    this.save();
    this.emitChange("retried", job);
    return structuredClone(job);
  }

  reconcile(
    id: string,
    outcome: AgentJobReconciliationOutcome,
    note: string,
    result?: AgentJobResult,
  ): AgentJobRecord {
    const job = this.require(id);
    if (job.status !== "uncertain") throw new Error("Only uncertain jobs can be reconciled");
    const cleanNote = redactText(note.trim());
    if (!cleanNote) throw new Error("A reconciliation note is required");
    const now = new Date().toISOString();
    job.reconciliation = { outcome, note: cleanNote, reconciledAt: now };
    job.updatedAt = now;
    job.completedAt = now;
    delete job.leaseUntil;
    if (outcome === "succeeded") {
      job.status = "succeeded";
      if (result) job.result = sanitizeValue(result);
      delete job.error;
    } else {
      job.status = "failed";
      job.error = "Reconciliation confirmed that the side effect was not applied";
    }
    this.save();
    this.emitChange("reconciled", job);
    return structuredClone(job);
  }
  recoverStale(now = new Date(), includeUnexpired = false): number {
    let count = 0;
    const recovered: AgentJobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== "running") continue;
      if (!includeUnexpired && (!job.leaseUntil || Date.parse(job.leaseUntil) > now.getTime())) continue;
      count++;
      recovered.push(job);
      job.updatedAt = now.toISOString();
      delete job.leaseUntil;
      if (job.sideEffectRisk) {
        job.status = "uncertain";
        job.uncertainAt = now.toISOString();
        delete job.completedAt;
        job.error = includeUnexpired
          ? "Worker stopped before a side-effecting job finished; reconcile the outcome before retry"
          : "Worker lease expired after a side-effecting step; reconcile the outcome before retry";
      } else {
        job.status = "queued";
        job.availableAt = now.toISOString();
        job.error = includeUnexpired ? "Recovered after worker restart" : "Recovered after worker lease expired";
      }
    }
    if (count) {
      this.save();
      for (const job of recovered) this.emitChange("recovered", job);
    }
    return count;
  }

  get(id: string): AgentJobRecord | null {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  list(options: { status?: AgentJobStatus; limit?: number } = {}): AgentJobRecord[] {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    return [...this.jobs.values()]
      .filter((job) => !options.status || job.status === options.status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  listPendingDeliveries(options: { limit?: number } = {}): AgentJobRecord[] {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    return [...this.jobs.values()]
      .filter((job) =>
        job.deliveryRequired === true &&
        job.status === "succeeded" &&
        Boolean(job.result?.data) &&
        !job.deliveredAt)
      .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  acknowledgeDelivery(id: string): AgentJobRecord {
    const job = this.require(id);
    if (job.deliveryRequired !== true || job.status !== "succeeded" || !job.result?.data) {
      throw new Error("Only successful jobs with a deliverable result can be acknowledged");
    }
    if (job.deliveredAt) return structuredClone(job);
    const now = new Date().toISOString();
    job.deliveredAt = now;
    job.updatedAt = now;
    this.save();
    this.emitChange("delivered", job);
    return structuredClone(job);
  }

  private require(id: string): AgentJobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown Agent job: ${id}`);
    return job;
  }

  private requireRunning(id: string, workerId: string): AgentJobRecord {
    const job = this.require(id);
    if (job.status !== "running" || job.workerId !== workerId) {
      throw new Error(`Agent job ${id} is not owned by worker ${workerId}`);
    }
    return job;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as JobFile;
      if (data.version !== 1 || !Array.isArray(data.jobs)) return;
      for (const job of data.jobs) if (job?.id) this.jobs.set(job.id, job);
    } catch {
      // 损坏队列不阻塞主应用；下一次写入会生成有效文件。
    }
  }

  private prune(): void {
    const terminal = [...this.jobs.values()]
      .filter((job) => job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const overflow = Math.max(0, this.jobs.size - this.options.maxJobs);
    if (overflow === 0) return;
    for (const job of terminal.slice(-overflow)) this.jobs.delete(job.id);
  }

  private save(): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, jobs: [...this.jobs.values()] }, null, 2));
    renameSync(temp, this.file);
  }

  private emitChange(action: AgentJobQueueEvent["action"], job: AgentJobRecord): void {
    try {
      this.onChange?.({ action, job: { id: job.id, status: job.status, updatedAt: job.updatedAt } });
    } catch {
      // 进度订阅失败不能影响持久队列。
    }
  }
}

export interface AgentJobHandlerContext {
  signal: AbortSignal;
  checkpoint: (status: string, progress?: number, data?: unknown) => void;
}

export type AgentJobHandler = (
  job: AgentJobRecord,
  context: AgentJobHandlerContext,
) => Promise<AgentJobResult>;

export interface AgentJobWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
}

export class AgentJobWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly active = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;

  constructor(
    private readonly queue: FileAgentJobQueue,
    private readonly handlers: Readonly<Record<string, AgentJobHandler>>,
    options: AgentJobWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 500);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<AgentJobRecord | null> {
    const job = this.queue.claimNext(this.workerId);
    if (!job) return null;
    const handler = this.handlers[job.type];
    if (!handler) return this.queue.fail(job.id, this.workerId, `No handler registered for Agent job type: ${job.type}`);
    const controller = new AbortController();
    this.active.set(job.id, controller);
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Agent job timed out after ${job.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS}ms`));
    }, job.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS);
    try {
      const result = await handler(job, {
        signal: controller.signal,
        checkpoint: (status, progress, data) => this.queue.heartbeat(job.id, this.workerId, { status, progress, data }),
      });
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("cancelled");
      return this.queue.complete(job.id, this.workerId, result);
    } catch (error) {
      return this.queue.fail(job.id, this.workerId, error);
    } finally {
      clearTimeout(timeout);
      this.active.delete(job.id);
    }
  }

  cancel(id: string): AgentJobRecord {
    const job = this.queue.cancel(id);
    this.active.get(id)?.abort(new Error("Agent job cancelled"));
    return job;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        const job = await this.runOnce();
        this.schedule(job ? 0 : this.pollIntervalMs);
      } catch {
        this.schedule(this.pollIntervalMs);
      }
    }, delay);
    this.timer.unref?.();
  }
}

function sanitizeValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(redactText(JSON.stringify(value))) as T;
}

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2");
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
