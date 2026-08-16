import assert from "node:assert/strict";
import test from "node:test";
import { compareDevelopmentRuns } from "../../examples/companion/development-run-comparison.js";

test("开发结果比较保留文件、检查、上下文和会话变化", () => {
  const comparison = compareDevelopmentRuns({
    artifactId: "artifact-1",
    engine: "pi",
    changedFiles: ["src/a.ts", "src/old.ts"],
    checks: [{ passed: true }],
    contextFingerprints: ["goal", "old-context"],
  }, {
    artifactId: "artifact-2",
    engine: "pi",
    changedFiles: ["src/a.ts", "src/new.ts"],
    checks: [{ passed: true }, { passed: true }],
    contextFingerprints: ["goal", "new-context"],
    sessionResumed: true,
  });
  assert.deepEqual(comparison.addedFiles, ["src/new.ts"]);
  assert.deepEqual(comparison.removedFiles, ["src/old.ts"]);
  assert.deepEqual(comparison.retainedFiles, ["src/a.ts"]);
  assert.equal(comparison.checkDelta, 1);
  assert.equal(comparison.contextAdded, 1);
  assert.equal(comparison.contextRemoved, 1);
  assert.equal(comparison.sessionResumed, true);
  assert.match(comparison.summary, /沿用原开发会话/);
});
