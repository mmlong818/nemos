import type { FileAgentJobQueue } from "../../src/index.js";
import type { CapabilityRuntime } from "./capabilities.js";

/** Scheduling only enqueues work; the existing worker and authorization gates execute it. */
export function enqueueScheduledCapabilities(
  capabilities: CapabilityRuntime,
  queue: FileAgentJobQueue,
  userId: string,
  trigger: "time" | "turn",
) {
  const existingByKey = new Map(queue.list({ limit: 1_000 })
    .filter((job) => job.idempotencyKey).map((job) => [job.idempotencyKey!, job]));
  return capabilities.dueTaskRuns(trigger).map((due) => {
    const idempotencyKey = `scheduled-capability:${due.occurrenceKey}`;
    // Failed/cancelled occurrences also need explicit user retry, not a timer retry.
    const job = existingByKey.get(idempotencyKey) ?? queue.enqueue({
      type: "capability-task",
      payload: { taskId: due.taskId, trigger },
      metadata: {
        userId, workTaskId: due.taskId, personaId: due.personaId,
        capabilityId: due.capabilityId, scheduled: "true",
      },
      deliveryRequired: true,
      sideEffectRisk: true,
      maxAttempts: 1,
      timeoutMs: 30 * 60_000,
      idempotencyKey,
    });
    existingByKey.set(idempotencyKey, job);
    // Persist AFTER queue persistence. If interrupted between the two writes,
    // the queue's idempotency key recovers the same job on the next tick.
    if (trigger === "time") capabilities.recordScheduledOccurrence(due.taskId, due.occurrenceKey);
    return job;
  });
}

export class BackgroundScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private lastTickAt?: string;
  private failedTasks: string[] = [];

  constructor(
    private readonly tasks: ReadonlyArray<{ name: string; run: () => void }>,
    private readonly intervalMs = 15_000,
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error("Invalid scheduler interval");
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    this.timer.unref?.();
    this.runOnce(); // Catch today's missed occurrence at startup, without a browser.
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  runOnce(): void {
    this.failedTasks = [];
    for (const task of this.tasks) {
      try { task.run(); }
      catch { this.failedTasks.push(task.name); }
    }
    this.lastTickAt = new Date().toISOString();
  }

  status() {
    return { running: Boolean(this.timer), intervalMs: this.intervalMs, lastTickAt: this.lastTickAt ?? null, failedTasks: [...this.failedTasks] };
  }
}
