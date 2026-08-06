import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createSourceFreshnessReceipt,
  sourceReceiptFreshness,
} from "../../examples/companion/source-verification.js";

test("外部结果回执包含时间、内容摘要和新鲜度", () => {
  const checkedAt = new Date("2026-08-07T00:00:00.000Z");
  const receipt = createSourceFreshnessReceipt({ availability: "available", content: "result", checkedAt, maxAgeMs: 60_000 });
  assert.equal(receipt.contentDigest, createHash("sha256").update("result").digest("hex"));
  assert.equal(sourceReceiptFreshness(receipt, new Date("2026-08-07T00:00:30.000Z")), "fresh");
  assert.equal(sourceReceiptFreshness(receipt, new Date("2026-08-07T00:02:00.000Z")), "stale");
});

test("网络失败和确实无结果使用不同回执", () => {
  const network = createSourceFreshnessReceipt({ availability: "network-failure" });
  const empty = createSourceFreshnessReceipt({ availability: "no-results" });
  assert.equal(network.errorKind, "network");
  assert.equal(empty.errorKind, "no-results");
  assert.equal(network.freshness, "unknown");
  assert.equal(empty.freshness, "unknown");
});
