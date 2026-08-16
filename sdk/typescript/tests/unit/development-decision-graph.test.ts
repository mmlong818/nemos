import assert from "node:assert/strict";
import test from "node:test";
import { buildDevelopmentDecisionGraph } from "../../examples/companion/development-decision-graph.js";

test("开发决定图把上下文、修改和检查连成可追溯依据链", () => {
  const graph = buildDevelopmentDecisionGraph({
    instruction: "修复登录并保留现有接口",
    artifactId: "artifact-1",
    context: {
      version: 1, createdAt: new Date().toISOString(), workspacePath: "C:/project", budgetTokens: 1000, tokenEstimate: 20, itemCount: 2,
      selectedPaths: ["src/login.ts"], includeGitDiff: false,
      items: [
        { id: "file:a", kind: "file", label: "src/login.ts", content: "source", path: "src/login.ts", fingerprint: "a".repeat(64), tokenEstimate: 2, truncated: false },
        { id: "decision:b", kind: "decision", label: "已确认决定", content: "保留接口", fingerprint: "b".repeat(64), tokenEstimate: 2, truncated: false },
      ],
    },
    development: {
      workspacePath: "C:/project", accessMode: "develop", changedFiles: ["src/login.ts"], fileReceipts: [],
      checks: [{ command: "typecheck", passed: true, output: "ok", checkedAt: "2026-08-16T00:00:00.000Z" }],
      unverifiedRisks: [], toolCalls: 2,
    },
  });
  assert.deepEqual(graph.summary, { contexts: 1, decisions: 1, files: 1, checks: 1, failedChecks: 0 });
  assert.ok(graph.edges.some((edge) => edge.kind === "changes"));
  assert.ok(graph.edges.some((edge) => edge.kind === "validates"));
  assert.ok(graph.nodes.some((node) => node.kind === "result"));
});
