import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewQueue, capabilityPackStatuses, DOMAIN_CAPABILITY_PACKS, platformConnectorStatuses } from "../../examples/companion/product-platform.js";

test("only reports a connector ready when an enabled extension actually provides it", () => {
    const statuses = platformConnectorStatuses([
      { enabled: true, manifest: { id: "github-mcp", capabilities: ["repository.read"] } },
      { enabled: false, manifest: { id: "calendar-mcp", tools: [{ name: "calendar.events" }] } },
    ]);
  assert.equal(statuses.find((item) => item.id === "github")?.state, "ready");
  assert.equal(statuses.find((item) => item.id === "files")?.state, "ready");
  assert.equal(statuses.find((item) => item.id === "files")?.provider, "built-in");
  assert.equal(statuses.find((item) => item.id === "calendar")?.state, "available");
  assert.equal(statuses.find((item) => item.id === "email")?.state, "not-installed");
  assert.equal(statuses.every((item) => item.readOnlyDefault), true);
  assert.equal(statuses.every((item) => item.minimumPermissions.length > 0 && item.fallback.length > 0), true);
  assert.deepEqual(statuses.map((item) => item.id), ["files", "github", "browser", "email", "calendar", "enterprise-docs"]);
});

test("only marks built-in browser ready when live search is configured", () => {
  assert.equal(platformConnectorStatuses([], { files: true }).find((item) => item.id === "browser")?.state, "not-installed");
  const browser = platformConnectorStatuses([], { files: true, browser: true }).find((item) => item.id === "browser");
  assert.equal(browser?.state, "ready");
  assert.equal(browser?.provider, "built-in");
});

test("provides five domain packs with explicit quality gates", () => {
  assert.deepEqual(DOMAIN_CAPABILITY_PACKS.map((pack) => pack.id), ["research", "office", "development", "operations", "finance"]);
  assert.equal(DOMAIN_CAPABILITY_PACKS.every((pack) => pack.quality.length >= 3), true);
});

test("领域能力包状态来自真实产物证明而不是固定宣传文案", () => {
  const abilities = DOMAIN_CAPABILITY_PACKS.flatMap((pack) => pack.abilities).map((id) => ({ id }));
  const available = capabilityPackStatuses(abilities, []);
  assert.equal(available.every((pack) => pack.state === "available"), true);
  const research = DOMAIN_CAPABILITY_PACKS.find((pack) => pack.id === "research")!;
  const verifiedArtifacts = research.abilities.map((capabilityId) => ({ capabilityId, proof: { level: "verified" } }));
  assert.equal(capabilityPackStatuses(abilities, verifiedArtifacts).find((pack) => pack.id === "research")?.state, "verified");
  assert.equal(capabilityPackStatuses(abilities.slice(1), []).some((pack) => pack.state === "experimental"), true);
});

test("puts uncertain side effects and conflicts first in the review queue", () => {
    const items = buildReviewQueue({
      approvals: [{ id: "a1", description: "发送邮件" }],
      jobs: [{ id: "j1", status: "failed", title: "日报" }, { id: "j2", status: "running", delivery: { status: "uncertain" } }],
      proposals: [
        { id: "p1", state: "conflicted", workspacePath: "C:/work" },
        { id: "p2", state: "pending", workspacePath: "C:/ready" },
        { id: "p3", state: "applied", workspacePath: "C:/done" },
      ],
    });
  assert.deepEqual(items.slice(0, 2).map((item) => item.priority), [0, 0]);
  assert.equal(items.some((item) => item.kind === "approval"), true);
  assert.equal(items.some((item) => item.sourceId === "p2"), true, "等待确认的开发修改必须进入审阅队列");
  assert.equal(items.some((item) => item.sourceId === "p3"), false, "已经写入的修改不应继续等待审阅");
});
