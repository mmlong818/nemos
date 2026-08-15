import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recoverAgentJobStorage } from "../../examples/companion/agent-job-storage-migration.js";

test("restores a queue whose jobs key was mistaken for an expert identity", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-job-recovery-"));
  writeFileSync(join(root, "agent-jobs.json"), JSON.stringify({
    version: 1,
    product_lead: [{ id: "current", updatedAt: "2026-08-14T00:00:00.000Z" }],
  }));

  assert.equal(recoverAgentJobStorage(root), 1);
  const restored = JSON.parse(readFileSync(join(root, "agent-jobs.json"), "utf8"));
  assert.deepEqual(restored.jobs.map((job: { id: string }) => job.id), ["current"]);
  assert.equal("product_lead" in restored, false);
});

test("merges legacy and current queues without duplicating task ids", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-job-merge-"));
  const current = join(root, "current");
  const legacy = join(root, "legacy");
  mkdirSync(current);
  mkdirSync(legacy);
  writeFileSync(join(current, "agent-jobs.json"), JSON.stringify({
    version: 1,
    jobs: [
      { id: "shared", updatedAt: "2026-08-14T00:00:00.000Z", source: "current" },
      { id: "current", updatedAt: "2026-08-14T00:00:00.000Z" },
    ],
  }));
  writeFileSync(join(legacy, "agent-jobs.json"), JSON.stringify({
    version: 1,
    product_lead: [
      { id: "shared", updatedAt: "2026-08-12T00:00:00.000Z", source: "legacy" },
      { id: "legacy", updatedAt: "2026-08-12T00:00:00.000Z" },
    ],
  }));

  assert.equal(recoverAgentJobStorage(current, legacy), 3);
  const restored = JSON.parse(readFileSync(join(current, "agent-jobs.json"), "utf8"));
  assert.deepEqual(restored.jobs.map((job: { id: string }) => job.id), ["shared", "legacy", "current"]);
  assert.equal(restored.jobs.find((job: { id: string }) => job.id === "shared").source, "current");
});
