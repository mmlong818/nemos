import { createHash } from "node:crypto";
import type { CapabilityDevelopmentReceipt } from "./capabilities.js";
import type { DevelopmentContextBundle } from "./development-context.js";

export type DevelopmentDecisionNodeKind = "goal" | "context" | "decision" | "file" | "check" | "result";
export type DevelopmentDecisionEdgeKind = "supports" | "constrains" | "changes" | "validates" | "produces";

export interface DevelopmentDecisionGraph {
  version: 1;
  nodes: Array<{ id: string; kind: DevelopmentDecisionNodeKind; label: string; state: "input" | "observed" | "passed" | "failed" | "output" }>;
  edges: Array<{ from: string; to: string; kind: DevelopmentDecisionEdgeKind }>;
  summary: { contexts: number; decisions: number; files: number; checks: number; failedChecks: number };
}

export function buildDevelopmentDecisionGraph(input: {
  instruction: string;
  artifactId: string;
  context?: DevelopmentContextBundle;
  development: CapabilityDevelopmentReceipt;
}): DevelopmentDecisionGraph {
  const nodes: DevelopmentDecisionGraph["nodes"] = [];
  const edges: DevelopmentDecisionGraph["edges"] = [];
  const goalId = id("goal", input.instruction);
  const resultId = `result:${input.artifactId}`;
  nodes.push({ id: goalId, kind: "goal", label: compact(input.instruction, 120) || "本轮开发目标", state: "input" });

  for (const item of input.context?.items || []) {
    if (item.kind === "instruction" || item.kind === "project") continue;
    const kind: DevelopmentDecisionNodeKind = item.kind === "decision" ? "decision" : "context";
    const nodeId = `${kind}:${item.fingerprint.slice(0, 16)}`;
    nodes.push({ id: nodeId, kind, label: compact(item.label, 100), state: "observed" });
    edges.push({ from: nodeId, to: goalId, kind: kind === "decision" ? "constrains" : "supports" });
  }

  const fileNodes = clean(input.development.changedFiles).map((path) => {
    const nodeId = id("file", path);
    nodes.push({ id: nodeId, kind: "file", label: path, state: "output" });
    edges.push({ from: goalId, to: nodeId, kind: "changes" });
    return nodeId;
  });

  for (const check of input.development.checks || []) {
    const nodeId = id("check", `${check.command}:${check.checkedAt}`);
    nodes.push({ id: nodeId, kind: "check", label: String(check.command), state: check.passed ? "passed" : "failed" });
    if (fileNodes.length) for (const fileId of fileNodes) edges.push({ from: fileId, to: nodeId, kind: "validates" });
    else edges.push({ from: goalId, to: nodeId, kind: "validates" });
    edges.push({ from: nodeId, to: resultId, kind: "supports" });
  }

  nodes.push({ id: resultId, kind: "result", label: "本轮开发结果", state: "output" });
  edges.push({ from: goalId, to: resultId, kind: "produces" });
  return {
    version: 1,
    nodes,
    edges,
    summary: {
      contexts: nodes.filter((node) => node.kind === "context").length,
      decisions: nodes.filter((node) => node.kind === "decision").length,
      files: fileNodes.length,
      checks: (input.development.checks || []).length,
      failedChecks: (input.development.checks || []).filter((check) => !check.passed).length,
    },
  };
}

function id(kind: DevelopmentDecisionNodeKind, value: string): string {
  return `${kind}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function clean(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map((value) => String(value).trim()).filter(Boolean))] : [];
}

function compact(value: string, limit: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
