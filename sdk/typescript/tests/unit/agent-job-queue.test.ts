import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentJobWorker, FileAgentJobQueue, type AgentJobQueueEvent } from "../../src/agent/index.js";

function temporaryQueue(options: ConstructorParameters<typeof FileAgentJobQueue>[1] = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-jobs-"));
  return {
    dir,
    file: join(dir, "jobs.json"),
    queue: new FileAgentJobQueue(join(dir, "jobs.json"), options),
  };
}

test("persists queued jobs and executes them through a registered worker handler", async () => {
  const events: AgentJobQueueEvent[] = [];
  const fixture = temporaryQueue({ onChange: (event) => events.push(event) });
  try {
    const queued = fixture.queue.enqueue({
      type: "research",
      payload: { topic: "agent" },
      idempotencyKey: "research-agent",
    });
    const duplicate = fixture.queue.enqueue({
      type: "research",
      payload: { topic: "agent" },
      idempotencyKey: "research-agent",
    });
    assert.equal(duplicate.id, queued.id);

    const worker = new AgentJobWorker(fixture.queue, {
      research: async (job, context) => {
        context.checkpoint("researching", 50);
        return { summary: `done:${String(job.payload.topic)}`, artifactRefs: ["artifact://result"] };
      },
    }, { workerId: "worker-a" });
    const completed = await worker.runOnce();

    assert.equal(completed?.status, "succeeded");
    assert.equal(completed?.result?.summary, "done:agent");
    assert.equal(completed?.checkpoints[0]?.progress, 50);
    assert.equal(new FileAgentJobQueue(fixture.file).get(queued.id)?.status, "succeeded");
    assert.deepEqual(events.map((event) => event.action), ["enqueued", "claimed", "checkpoint", "completed"]);
    assert.equal("payload" in events[0]!.job, false);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("retries read-only failures but does not automatically replay side-effecting jobs", async () => {
  const fixture = temporaryQueue({ retryBaseDelayMs: 1 });
  try {
    const readJob = fixture.queue.enqueue({ type: "read", payload: {}, maxAttempts: 2 });
    const writeJob = fixture.queue.enqueue({ type: "write", payload: {}, maxAttempts: 2, sideEffectRisk: true });
    const base = Date.now();
    const read = fixture.queue.claimNext("worker-a", new Date(base + 1_000));
    assert.equal(read?.id, readJob.id);
    const readFailure = fixture.queue.fail(read!.id, "worker-a", new Error("temporary"));
    assert.equal(readFailure.status, "queued");

    const retriedRead = fixture.queue.claimNext("worker-a", new Date(base + 2_000));
    assert.equal(retriedRead?.id, readJob.id);
    fixture.queue.complete(retriedRead!.id, "worker-a", { summary: "read recovered" });
    const write = fixture.queue.claimNext("worker-a", new Date(base + 3_000));
    assert.equal(write?.id, writeJob.id);
    const writeFailure = fixture.queue.fail(write!.id, "worker-a", new Error("unknown commit state"));
    assert.equal(writeFailure.status, "uncertain");
    assert.throws(() => fixture.queue.retry(write!.id), /reconciled/);
    assert.equal(fixture.queue.reconcile(write!.id, "not_applied", "target record is absent").status, "failed");
    assert.equal(fixture.queue.retry(write!.id, { confirmSideEffect: true }).status, "queued");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("recovers expired leases and keeps side-effecting jobs stopped for manual review", () => {
  const fixture = temporaryQueue({ leaseMs: 10 });
  try {
    const read = fixture.queue.enqueue({ type: "read", payload: {} });
    const base = Date.now();
    fixture.queue.claimNext("worker-a", new Date(base + 1_000));
    const write = fixture.queue.enqueue({ type: "write", payload: {}, sideEffectRisk: true });
    fixture.queue.claimNext("worker-b", new Date(base + 1_000));

    fixture.queue.recoverStale(new Date(base + 2_000));
    assert.equal(fixture.queue.get(read.id)?.status, "queued");
    assert.equal(fixture.queue.get(write.id)?.status, "uncertain");
    assert.match(fixture.queue.get(write.id)?.error ?? "", /reconcile/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("recovers jobs immediately when a new queue opens before the old lease expires", () => {
  const fixture = temporaryQueue({ leaseMs: 60_000 });
  try {
    const read = fixture.queue.enqueue({ type: "read", payload: {} });
    fixture.queue.claimNext("old-worker");
    const write = fixture.queue.enqueue({ type: "write", payload: {}, sideEffectRisk: true });
    fixture.queue.claimNext("old-worker");

    const restarted = new FileAgentJobQueue(fixture.file, { leaseMs: 60_000 });
    assert.equal(restarted.get(read.id)?.status, "queued");
    assert.equal(restarted.get(write.id)?.status, "uncertain");
    assert.match(restarted.get(write.id)?.error ?? "", /reconcile/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("reconciles a side-effecting job as already completed without replaying it", () => {
  const fixture = temporaryQueue();
  try {
    const queued = fixture.queue.enqueue({ type: "write", payload: {}, sideEffectRisk: true });
    fixture.queue.claimNext("worker-a");
    fixture.queue.fail(queued.id, "worker-a", new Error("connection lost after commit"));

    const reconciled = fixture.queue.reconcile(
      queued.id,
      "succeeded",
      "verified the target record exists",
      { summary: "already applied", artifactRefs: ["record://123"] },
    );
    assert.equal(reconciled.status, "succeeded");
    assert.equal(reconciled.result?.summary, "already applied");
    assert.equal(reconciled.reconciliation?.outcome, "succeeded");
    assert.throws(() => fixture.queue.retry(queued.id), /failed or cancelled/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
test("cancels a cooperative handler when its execution timeout is reached", async () => {
  const fixture = temporaryQueue();
  try {
    fixture.queue.enqueue({ type: "slow", payload: {}, timeoutMs: 1_000, maxAttempts: 1 });
    const worker = new AgentJobWorker(fixture.queue, {
      slow: async (_job, context) => new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      }),
    });
    const completed = await worker.runOnce();
    assert.equal(completed?.status, "failed");
    assert.match(completed?.error ?? "", /timed out/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("redacts credentials from persisted payloads, checkpoints, results, and errors", () => {
  const fixture = temporaryQueue();
  try {
    const queued = fixture.queue.enqueue({
      type: "safe-log",
      payload: { apiKey: "test-api-key-private-value", authorization: "Bearer token-value" },
    });
    assert.equal(queued.payload.apiKey, "[REDACTED]");
    assert.equal(queued.payload.authorization, "Bearer [REDACTED]");

    const running = fixture.queue.claimNext("worker-a")!;
    fixture.queue.heartbeat(running.id, "worker-a", { status: "working", data: { password: "private-value" } });
    const completed = fixture.queue.complete(running.id, "worker-a", {
      summary: "used Bearer private-token",
      data: { access_token: "private-value" },
    });
    assert.match(completed.result?.summary ?? "", /Bearer \[REDACTED\]/);
    assert.equal((completed.result?.data as { access_token: string }).access_token, "[REDACTED]");
    assert.equal((completed.checkpoints[0]?.data as { password: string }).password, "[REDACTED]");

    const failed = fixture.queue.enqueue({ type: "safe-error", payload: {} });
    fixture.queue.claimNext("worker-b");
    assert.equal(fixture.queue.fail(failed.id, "worker-b", "secret='private-value'").error, "secret='[REDACTED]'");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("persists pending chat deliveries and removes them only after client acknowledgement", () => {
  const events: AgentJobQueueEvent[] = [];
  const fixture = temporaryQueue({ onChange: (event) => events.push(event) });
  try {
    const deliverable = fixture.queue.enqueue({
      type: "deliverable",
      payload: {},
      deliveryRequired: true,
    });
    const ordinary = fixture.queue.enqueue({
      type: "ordinary",
      payload: {},
    });

    const first = fixture.queue.claimNext("worker-a")!;
    fixture.queue.complete(first.id, "worker-a", {
      summary: "ready",
      data: { personaId: "clownfish", reply: "结果已完成" },
    });
    const second = fixture.queue.claimNext("worker-a")!;
    fixture.queue.complete(second.id, "worker-a", {
      summary: "internal",
      data: { personaId: "clownfish", reply: "不应投递" },
    });

    const restarted = new FileAgentJobQueue(fixture.file);
    assert.deepEqual(restarted.listPendingDeliveries().map((job) => job.id), [deliverable.id]);
    assert.equal(restarted.listPendingDeliveries().some((job) => job.id === ordinary.id), false);

    const acknowledged = restarted.acknowledgeDelivery(deliverable.id);
    assert.ok(acknowledged.deliveredAt);
    assert.deepEqual(restarted.listPendingDeliveries(), []);
    assert.ok(new FileAgentJobQueue(fixture.file).get(deliverable.id)?.deliveredAt);
    assert.throws(() => restarted.acknowledgeDelivery(ordinary.id), /deliverable result/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
