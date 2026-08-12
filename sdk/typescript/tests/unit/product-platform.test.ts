import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewQueue, DOMAIN_CAPABILITY_PACKS, platformConnectorStatuses } from "../../examples/companion/product-platform.js";

test("only reports a connector ready when an enabled extension actually provides it", () => {
    const statuses = platformConnectorStatuses([
      { enabled: true, manifest: { id: "github-mcp", capabilities: ["repository.read"] } },
      { enabled: false, manifest: { id: "calendar-mcp", tools: [{ name: "calendar.events" }] } },
    ]);
  assert.equal(statuses.find((item) => item.id === "github")?.state, "ready");
  assert.equal(statuses.find((item) => item.id === "calendar")?.state, "available");
  assert.equal(statuses.find((item) => item.id === "email")?.state, "not-installed");
});

test("provides five domain packs with explicit quality gates", () => {
  assert.deepEqual(DOMAIN_CAPABILITY_PACKS.map((pack) => pack.id), ["research", "office", "development", "operations", "finance"]);
  assert.equal(DOMAIN_CAPABILITY_PACKS.every((pack) => pack.quality.length >= 3), true);
});

test("puts uncertain side effects and conflicts first in the review queue", () => {
    const items = buildReviewQueue({
      approvals: [{ id: "a1", description: "发送邮件" }],
      jobs: [{ id: "j1", status: "failed", title: "日报" }, { id: "j2", status: "running", delivery: { status: "uncertain" } }],
      proposals: [{ id: "p1", state: "conflicted", workspacePath: "C:/work" }],
    });
  assert.deepEqual(items.slice(0, 2).map((item) => item.priority), [0, 0]);
  assert.equal(items.some((item) => item.kind === "approval"), true);
});
