import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { FileDeliveryOutbox } from "../../examples/companion/delivery-outbox.js";
import { FileAgentJobQueue } from "../../src/agent/job-queue.js";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("chat delivery HTTP validates ownership before writing either store and recovers a committed receipt after restart", { timeout: 60_000 }, async () => {
  const h = await startModelHarness();
  const queueFile = join(h.dir, "agent-jobs.json");
  const outboxFile = join(h.dir, "delivery-outbox.json");
  const files = () => [readFileSync(queueFile, "utf8"), readFileSync(outboxFile, "utf8")];
  const call = async (path: string, expected: number, body?: Record<string, unknown>) => {
    const res = await fetch(h.base + path, body ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {});
    const data = await res.json() as any;
    assert.equal(res.status, expected, JSON.stringify(data));
    return data;
  };
  const complete = (action: "ack" | "fail", body: Record<string, unknown>, expected = 200) =>
    call("/api/agent/delivery/" + action, expected, body);
  const readJob = async (id: string) => (await call("/api/agent/job?id=" + encodeURIComponent(id), 200)).job;
  const jobIds: Record<string, string> = {};
  const deliveryIds: Record<string, string> = {};
  let recoveredReceiptTime: string | undefined;

  try {
    await h.restart(() => {
      const queue = new FileAgentJobQueue(queueFile);
      const outbox = new FileDeliveryOutbox(outboxFile);
      const seedJob = (
        key: string,
        { surface = "chat", deliveryRequired = true, succeed = true } = {},
      ) => {
        const job = queue.enqueue({ type: "capability-task", payload: { surface }, deliveryRequired, maxAttempts: 1 });
        assert.equal(queue.claimNext("fixture")?.id, job.id);
        if (succeed) queue.complete(job.id, "fixture", { summary: "Test result", data: { text: "Synthetic output" } });
        else queue.fail(job.id, "fixture", "Synthetic failure");
        jobIds[key] = job.id;
      };
      const seedDelivery = (key: string, jobKey: string, sourceType = "agent-job", channel = "chat") => {
        const entry = outbox.enqueue({
          dedupeKey: key === jobKey ? "agent-job:" + jobIds[jobKey] : "fixture:" + key,
          sourceType,
          sourceId: jobIds[jobKey]!,
          channel,
          payload: {},
          maxAttempts: 1,
        });
        deliveryIds[key] = entry.id;
      };

      seedJob("foreignLease");
      seedDelivery("foreignLease", "foreignLease");
      assert.equal(outbox.claimPending("browser:someone-else")[0]?.id, deliveryIds.foreignLease);
      for (const key of ["matching", "legacyFail", "legacyAck", "interrupted"]) {
        seedJob(key);
        seedDelivery(key, key);
      }
      seedJob("failed", { succeed: false });
      seedDelivery("failed", "failed");
      seedJob("ordinary", { deliveryRequired: false });
      seedDelivery("ordinary", "ordinary");
      seedJob("office", { surface: "office" });
      seedDelivery("otherChannel", "matching", "agent-job", "email");
      seedDelivery("otherSourceType", "matching", "unrelated", "chat");
      seedDelivery("officeSource", "office", "unrelated", "chat");

      const browserClaims = outbox.claimPending("browser:me", { channel: "chat", limit: 20 });
      assert.ok(browserClaims.some((entry) => entry.id === deliveryIds.interrupted));
      const receipt = outbox.acknowledge(deliveryIds.interrupted!, "browser:me", "committed-interrupted");
      recoveredReceiptTime = receipt.deliveredAt;
      assert.equal(queue.get(jobIds.interrupted!)?.deliveredAt, undefined);
    });

    const recovered = await readJob(jobIds.interrupted!);
    assert.ok(recovered.deliveredAt, "startup repairs the queue marker without a repeated browser request");
    assert.equal(recovered.delivery.status, "delivered");
    assert.equal(recovered.delivery.deliveredAt, recoveredReceiptTime);
    assert.equal(recovered.delivery.receiptId, "committed-interrupted");

    const before = files();
    for (const action of ["ack", "fail"] as const) {
      await complete(action, { id: jobIds.legacyFail, deliveryId: deliveryIds.legacyAck }, 409);
      await complete(action, { id: jobIds.matching, deliveryId: deliveryIds.otherChannel }, 409);
      await complete(action, { id: jobIds.matching, deliveryId: deliveryIds.otherSourceType }, 409);
      await complete(action, { id: jobIds.foreignLease, deliveryId: deliveryIds.foreignLease }, 409);
      await complete(action, { id: jobIds.failed, deliveryId: deliveryIds.failed }, 409);
      await complete(action, { id: jobIds.ordinary, deliveryId: deliveryIds.ordinary }, 409);
      await complete(action, { id: jobIds.office, deliveryId: deliveryIds.officeSource }, 409);
      await complete(action, { deliveryId: deliveryIds.legacyAck }, 400);
      await complete(action, { id: "missing", deliveryId: deliveryIds.legacyAck }, 404);
    }
    assert.deepEqual(files(), before, "rejected requests leave both durable stores byte-for-byte unchanged");

    const delivered = await complete("ack", { id: jobIds.matching, deliveryId: deliveryIds.matching, receiptId: "first-receipt" });
    assert.equal(delivered.delivery.sourceId, jobIds.matching);
    assert.equal(delivered.delivery.status, "delivered");
    assert.ok(delivered.job.deliveredAt);
    const afterAck = files();
    const duplicate = await complete("ack", { id: jobIds.matching, deliveryId: deliveryIds.matching, receiptId: "ignored-repeat" });
    assert.equal(duplicate.delivery.receiptId, "first-receipt");
    await complete("fail", { id: jobIds.matching, deliveryId: deliveryIds.matching }, 409);
    assert.deepEqual(files(), afterAck);

    const failed = await complete("fail", { id: jobIds.legacyFail, error: "Local display failed" });
    assert.equal(failed.delivery.status, "failed");
    assert.equal(failed.delivery.lastError, "Local display failed");
    assert.equal((await readJob(jobIds.legacyFail!)).deliveredAt, undefined);
    const legacy = await complete("ack", { id: jobIds.legacyAck });
    assert.equal(legacy.delivery.sourceId, jobIds.legacyAck);
    assert.equal(legacy.delivery.status, "delivered");
    assert.deepEqual(h.requests, []);
  } finally {
    await h.stop();
  }
});
