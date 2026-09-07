import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewQueue, capabilityPackStatuses, DOMAIN_CAPABILITY_PACKS, platformConnectorStatuses } from "../../examples/companion/product-platform.js";

test("only reports a connector ready when an enabled extension actually provides it", () => {
    const statuses = platformConnectorStatuses([
      { enabled: true, providerAttached: true, manifest: { id: "github-mcp", capabilities: ["repository.read"] } },
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

test("only marks a built-in connector ready when its runtime is explicitly available", () => {
  assert.equal(platformConnectorStatuses([], { files: true }).find((item) => item.id === "browser")?.state, "not-installed");
  const browser = platformConnectorStatuses([], { files: true, browser: true }).find((item) => item.id === "browser");
  assert.equal(browser?.state, "ready");
  assert.equal(browser?.provider, "built-in");
});

test("启用不等于连接成功，缺失运行时、启动错误和未授权都不能报告就绪", () => {
  for (const input of [
    { enabled: true, reason: "not-connected" },
    { enabled: true, providerAttached: false, reason: "not-connected" },
    { enabled: true, providerAttached: true, runtimeError: "failure", reason: "runtime-error" },
    { enabled: true, providerAttached: true, executionSecurity: "blocked", reason: "blocked" },
    { enabled: false, providerAttached: true, reason: "disabled" },
  ]) {
    const status = platformConnectorStatuses([{ ...input, manifest: { id: "github-mcp" } }]).find((item) => item.id === "github")!;
    assert.equal(status.state, "available");
    assert.equal(status.reason, input.reason);
    assert.ok(status.detail.length > 0);
    assert.ok(status.missingCapabilities.length > 0);
  }
});

test("同类多个连接器优先选真正就绪的，内置能力不误用扩展编号", () => {
  const statuses = platformConnectorStatuses([
    { enabled: true, providerAttached: false, manifest: { id: "github-broken" } },
    { enabled: true, providerAttached: true, manifest: { id: "github-connected" } },
    { enabled: true, providerAttached: false, manifest: { id: "filesystem-broken" } },
  ]);
  const github = statuses.find((item) => item.id === "github")!;
  assert.equal(github.state, "ready");
  assert.equal(github.extensionId, "github-connected");
  assert.equal(statuses.find((item) => item.id === "files")!.extensionId, undefined);
});

test("provides active domain packs with explicit quality gates", () => {
  assert.deepEqual(DOMAIN_CAPABILITY_PACKS.map((pack) => pack.id), ["research", "office", "operations", "finance"]);
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

test("puts uncertain deliveries before approvals in the review queue", () => {
    const items = buildReviewQueue({
      approvals: [{ id: "a1", description: "发送邮件" }],
      jobs: [{ id: "j1", status: "failed", title: "日报" }, { id: "j2", status: "running", delivery: { status: "uncertain" } }],
    });
  assert.deepEqual(items.slice(0, 2).map((item) => item.priority), [0, 1]);
  assert.equal(items.some((item) => item.kind === "approval"), true);
});
