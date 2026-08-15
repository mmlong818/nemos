import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileDeliveryOutbox } from "../../examples/companion/delivery-outbox.js";

function fixture(options: ConstructorParameters<typeof FileDeliveryOutbox>[1] = {}) {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-delivery-outbox-"));
  const file = join(dir, "deliveries.json");
  return { dir, file, outbox: new FileDeliveryOutbox(file, options) };
}

test("运行结果与投递状态分开保存，重复登记不会重复发送", () => {
  const item = fixture();
  try {
    const first = item.outbox.enqueue({
      dedupeKey: "agent-job:job-1",
      sourceType: "agent-job",
      sourceId: "job-1",
      channel: "chat",
      payload: { jobId: "job-1", apiKey: "private-value" },
    });
    const duplicate = item.outbox.enqueue({
      dedupeKey: "agent-job:job-1",
      sourceType: "agent-job",
      sourceId: "job-1",
      channel: "chat",
      payload: { jobId: "job-1" },
    });
    assert.equal(duplicate.id, first.id);
    assert.equal(first.status, "pending");
    assert.equal(first.payload.apiKey, "[REDACTED]");
    assert.match(first.payloadHash, /^[a-f0-9]{64}$/);
    assert.equal(new FileDeliveryOutbox(item.file).get(first.id)?.status, "pending");
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test("投递必须由持有租约的接收方确认，并保存独立回执", () => {
  const item = fixture();
  try {
    const queued = item.outbox.enqueue({ dedupeKey: "d1", sourceType: "agent-job", sourceId: "job-1", channel: "chat", payload: {} });
    const [claimed] = item.outbox.claimPending("browser:me", { channel: "chat" });
    assert.equal(claimed?.id, queued.id);
    assert.equal(claimed?.status, "leased");
    const [reclaimed] = item.outbox.claimPending("browser:me", { channel: "chat" });
    assert.equal(reclaimed?.id, queued.id);
    assert.equal(reclaimed?.attempts, 1);
    assert.throws(() => item.outbox.acknowledge(queued.id, "browser:other"), /not leased/);
    const delivered = item.outbox.acknowledge(queued.id, "browser:me", "receipt-1");
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.receiptId, "receipt-1");
    assert.ok(delivered.deliveredAt);
    assert.deepEqual(item.outbox.claimPending("browser:me"), []);
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test("投递失败按退避重试，达到上限后不伪装成已完成", () => {
  const item = fixture({ retryBaseDelayMs: 100 });
  try {
    const queued = item.outbox.enqueue({ dedupeKey: "d1", sourceType: "agent-job", sourceId: "job-1", channel: "chat", payload: {}, maxAttempts: 2 });
    const base = new Date(Date.parse(queued.nextAttemptAt) + 1);
    item.outbox.claimPending("browser:me", { now: base });
    const retry = item.outbox.fail(queued.id, "browser:me", "页面写入失败", base);
    assert.equal(retry.status, "pending");
    assert.deepEqual(item.outbox.claimPending("browser:me", { now: new Date(base.getTime() + 99) }), []);
    item.outbox.claimPending("browser:me", { now: new Date(base.getTime() + 100) });
    const failed = item.outbox.fail(queued.id, "browser:me", "仍未送达", new Date(base.getTime() + 100));
    assert.equal(failed.status, "failed");
    assert.equal(failed.attempts, 2);
    assert.ok(failed.failedAt);
    assert.equal(failed.deliveredAt, undefined);
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test("进程重启后过期租约恢复，且不会产生第二份投递", () => {
  const item = fixture({ leaseMs: 1_000 });
  try {
    const queued = item.outbox.enqueue({ dedupeKey: "d1", sourceType: "agent-job", sourceId: "job-1", channel: "chat", payload: {} });
    const claimedAt = new Date(Date.parse(queued.nextAttemptAt) + 1);
    item.outbox.claimPending("browser:me", { now: claimedAt });
    const restarted = new FileDeliveryOutbox(item.file, { leaseMs: 1_000 });
    const recovered = restarted.claimPending("browser:me", { now: new Date(claimedAt.getTime() + 2_000) });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.id, queued.id);
    assert.equal(recovered[0]?.attempts, 2);
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});
