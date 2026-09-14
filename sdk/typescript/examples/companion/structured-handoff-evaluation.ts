import { createHash } from "node:crypto";

import { validateExecutionPlan } from "./execution-plan.js";
import { promptSafeJson } from "./memory-evidence.js";
import {
  createFailedStepReceipt,
  createSucceededStepReceipt,
  mergeStepReceipts,
  observedMaterialEvidence,
  renderStructuredMergeContext,
  ruleHash,
  structuredPlanHash,
  type StepClaimV1,
  type StepEvidenceRefV1,
  type StepReceiptV1,
} from "./structured-handoff.js";

export type EvaluationArm = "A" | "B" | "C" | "D";
export interface EvaluationBudgetV1 { transportChars: number; maxModelCalls: number; maxTotalTokens: number }
export interface EvaluationCandidateV1 {
  summary: string;
  claims: StepClaimV1[];
  evidenceRefs: StepEvidenceRefV1[];
  unresolvedCodes: string[];
  conflictKeys: string[];
  forgedEvidenceRejected: boolean;
}
export interface EvaluationWorkerOutputV1 { stepId: string; output?: string; missing?: true }
export interface EvaluationFixtureV1 {
  version: 1;
  id: string;
  materials: string;
  workers: EvaluationWorkerOutputV1[];
  gold: { claims: Array<{ key: string; canonicalValue: string }>; evidenceRefs: string[]; unresolvedCodes: string[]; conflictKeys: string[]; forgedEvidenceMustBeRejected: boolean };
  syntheticOracle: Record<"A" | "B" | "C", EvaluationCandidateV1>;
}
export interface EvaluationConfigV1 { version: 1; budget: EvaluationBudgetV1; mockAdapter: "fixture-synthetic-oracle-v1" }
interface Metric { earned: number; total: number; rate: number | null }
export interface EvaluationCaseResultV1 {
  fixtureId: string;
  arm: EvaluationArm;
  applicability: "synthetic-single-agent-context-simulation" | "fixed-worker-transmission-ablation";
  comparableTo: EvaluationArm[];
  incomparableReason?: string;
  sourceCorpusHash: string;
  workerCorpusHash: string | null;
  contextHash: string;
  contextChars: number;
  transportTruncated: boolean;
  budget: EvaluationBudgetV1;
  measurements: { status: "not-measured"; modelCalls: null; inputTokens: null; outputTokens: null; cost: null };
  scores: {
    claimPrecision: Metric; claimRecall: Metric; evidenceRetention: Metric; unresolvedHonesty: Metric;
    conflictSurfacing: Metric; forgedEvidenceRejection: Metric; outputDeterminism: Metric;
  };
  candidate: EvaluationCandidateV1;
}
export interface StructuredHandoffEvaluationReportV1 {
  version: 1;
  generatedBy: "offline-deterministic-harness";
  benchmarkClaim: "none";
  config: EvaluationConfigV1;
  cases: EvaluationCaseResultV1[];
  limitations: string[];
}

const ARMS: EvaluationArm[] = ["A", "B", "C", "D"];

export function runStructuredHandoffEvaluation(fixtures: readonly EvaluationFixtureV1[], config: EvaluationConfigV1): StructuredHandoffEvaluationReportV1 {
  validateConfig(config);
  const cases = fixtures.flatMap((fixture) => ARMS.map((arm) => evaluateCase(fixture, arm, config)));
  return {
    version: 1,
    generatedBy: "offline-deterministic-harness",
    benchmarkClaim: "none",
    config: structuredClone(config),
    cases,
    limitations: [
      "A is a synthetic single-agent context simulation and is not causally comparable to the fixed-worker B/C/D transmission ablation.",
      "B/C synthetic oracle outputs test the harness and scoring protocol; they are not observations from a language model.",
      "No model calls, token usage, latency, factual judgment, or monetary cost were measured.",
      "Structural provenance retention does not establish that a claim is factually correct.",
    ],
  };
}

function evaluateCase(fixture: EvaluationFixtureV1, arm: EvaluationArm, config: EvaluationConfigV1): EvaluationCaseResultV1 {
  validateFixture(fixture);
  const built = buildWorkerHistory(fixture);
  const sourceCorpusHash = hashJson({ materials: fixture.materials });
  const workerCorpusHash = arm === "A" ? null : hashJson(fixture.workers);
  const fullContext = armContext(fixture, arm, built);
  const transport = boundedTransport(fullContext, config.budget.transportChars);
  const candidate = arm === "D" ? deterministicCandidate(built.merge, built.forgedRejected, transport.truncated) : structuredClone(fixture.syntheticOracle[arm]);
  const repeatContext = boundedTransport(armContext(fixture, arm, buildWorkerHistory(fixture)), config.budget.transportChars);
  const repeatCandidate = arm === "D" ? deterministicCandidate(buildWorkerHistory(fixture).merge, built.forgedRejected, repeatContext.truncated) : structuredClone(fixture.syntheticOracle[arm]);
  const deterministic = transport.text === repeatContext.text && hashJson(candidate) === hashJson(repeatCandidate);
  return {
    fixtureId: fixture.id,
    arm,
    applicability: arm === "A" ? "synthetic-single-agent-context-simulation" : "fixed-worker-transmission-ablation",
    comparableTo: arm === "A" ? [] : ["B", "C", "D"].filter((item) => item !== arm) as EvaluationArm[],
    ...(arm === "A" ? { incomparableReason: "A receives original materials only; B/C/D receive the same fixed worker-output corpus." } : {}),
    sourceCorpusHash,
    workerCorpusHash,
    contextHash: hashText(transport.text),
    contextChars: transport.text.length,
    transportTruncated: transport.truncated,
    budget: structuredClone(config.budget),
    measurements: { status: "not-measured", modelCalls: null, inputTokens: null, outputTokens: null, cost: null },
    scores: scoreCandidate(candidate, fixture.gold, deterministic, arm !== "A" && workerCorpusContainsForgedArtifact(fixture.workers)),
    candidate,
  };
}

function buildWorkerHistory(fixture: EvaluationFixtureV1) {
  const plan = validateExecutionPlan({
    version: 1, taskId: `eval:${fixture.id}`, revision: 1, finalStepId: "final",
    steps: [
      ...fixture.workers.map((worker) => ({ id: worker.stepId, executorId: worker.stepId, objective: fixture.id, output: "fixed synthetic worker output", dependsOn: [] })),
      { id: "final", executorId: "final", objective: fixture.id, output: "offline evaluation projection", dependsOn: fixture.workers.map((worker) => worker.stepId) },
    ],
  }, new Set([...fixture.workers.map((worker) => worker.stepId), "final"]));
  const planHash = structuredPlanHash(plan), allowedEvidence = observedMaterialEvidence(fixture.materials);
  const receipts: StepReceiptV1[] = [];
  let forgedRejected = false;
  fixture.workers.forEach((worker, index) => {
    if (worker.missing || !worker.output) return;
    const base = { taskId: plan.taskId, planHash, stepId: worker.stepId, attempt: 1, inputHash: hashJson([fixture.id, worker.stepId]),
      producer: { botId: worker.stepId, botRevision: 1, ruleHash: ruleHash(`offline-fixture:${worker.stepId}`), model: "synthetic-not-a-model", tools: "off" as const },
      startedAt: `2026-09-14T00:00:${String(index * 2).padStart(2, "0")}.000Z`, completedAt: `2026-09-14T00:00:${String(index * 2 + 1).padStart(2, "0")}.000Z` };
    try { receipts.push(createSucceededStepReceipt({ ...base, output: worker.output, allowedEvidence })); }
    catch (error) {
      forgedRejected = true;
      receipts.push(createFailedStepReceipt({ ...base, rawOutput: worker.output, error: `forged-evidence-rejected: ${error instanceof Error ? error.message : "invalid evidence"}` }));
    }
  });
  return { plan, receipts, merge: mergeStepReceipts(plan, receipts, fixture.workers.map((worker) => worker.stepId)), forgedRejected };
}

function armContext(fixture: EvaluationFixtureV1, arm: EvaluationArm, built: ReturnType<typeof buildWorkerHistory>): string {
  const header = { fixtureId: fixture.id, arm, materials: fixture.materials };
  if (arm === "A") return promptSafeJson({ ...header, mode: "synthetic single-agent baseline; no worker outputs supplied" });
  const rawCorpus = fixture.workers.map((worker) => ({ stepId: worker.stepId, missing: Boolean(worker.missing), output: worker.output ?? null }));
  if (arm === "B") return promptSafeJson({ ...header, mode: "free-summary transmission", workerOutputs: rawCorpus });
  if (arm === "C") return promptSafeJson({ ...header, mode: "structured-center transmission", workerOutputs: rawCorpus,
    structuredCenter: built.receipts.map((receipt) => receipt.result) });
  return promptSafeJson({ ...header, mode: "program-deterministic-merge transmission", workerOutputs: rawCorpus,
    deterministicMerge: renderStructuredMergeContext(built.merge, 24_000) });
}

function deterministicCandidate(merge: ReturnType<typeof mergeStepReceipts>, forgedRejected: boolean, transportTruncated: boolean): EvaluationCandidateV1 {
  const unresolvedCodes = merge.unresolvedItems.flatMap((item) => {
    if (item.includes("conflicting canonical values")) return [`conflict:${item.split(":")[0]}`];
    if (item.includes("result is missing")) return [`missing:${item.split(":")[0]}`];
    if (item.includes("forged-evidence-rejected")) return ["forged-evidence"];
    return [];
  });
  if (transportTruncated) unresolvedCodes.push("transport-truncated");
  return {
    summary: "Program merge projection; no model narrative was generated.",
    claims: structuredClone(merge.claims), evidenceRefs: structuredClone(merge.evidenceRefs),
    unresolvedCodes: [...new Set(unresolvedCodes)].sort(),
    conflictKeys: merge.unresolvedItems.filter((item) => item.includes("conflicting canonical values")).map((item) => item.split(":")[0]).sort(),
    forgedEvidenceRejected: forgedRejected,
  };
}

function scoreCandidate(candidate: EvaluationCandidateV1, gold: EvaluationFixtureV1["gold"], deterministic: boolean, forgedEvidenceApplicable: boolean) {
  const expectedClaims = new Set(gold.claims.map((claim) => `${claim.key}\u0000${claim.canonicalValue}`));
  const actualClaims = new Set(candidate.claims.map((claim) => `${claim.key}\u0000${claim.canonicalValue}`));
  const matchedClaims = [...actualClaims].filter((claim) => expectedClaims.has(claim)).length;
  const intersection = (actual: readonly string[], expected: readonly string[]) => new Set(actual.filter((item) => expected.includes(item))).size;
  return {
    claimPrecision: metric(matchedClaims, actualClaims.size),
    claimRecall: metric(matchedClaims, expectedClaims.size),
    evidenceRetention: metric(intersection(candidate.evidenceRefs.map((item) => item.ref), gold.evidenceRefs), gold.evidenceRefs.length),
    unresolvedHonesty: metric(intersection(candidate.unresolvedCodes, gold.unresolvedCodes), gold.unresolvedCodes.length),
    conflictSurfacing: metric(intersection(candidate.conflictKeys, gold.conflictKeys), gold.conflictKeys.length),
    forgedEvidenceRejection: forgedEvidenceApplicable ? metric(candidate.forgedEvidenceRejected ? 1 : 0, 1) : metric(0, 0),
    outputDeterminism: metric(deterministic ? 1 : 0, 1),
  };
}

function metric(earned: number, total: number): Metric { return { earned, total, rate: total ? earned / total : null }; }
function boundedTransport(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const marker = "\n[transport-truncated: inspect fixed fixture corpus]";
  return { text: text.slice(0, Math.max(0, limit - marker.length)) + marker, truncated: true };
}
function validateConfig(config: EvaluationConfigV1): void {
  if (config.version !== 1 || config.mockAdapter !== "fixture-synthetic-oracle-v1") throw new Error("Unsupported structured handoff evaluation config");
  for (const [key, value] of Object.entries(config.budget)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid evaluation budget: ${key}`);
  if (config.budget.transportChars < 4_000 || config.budget.transportChars > 24_000) throw new Error("transportChars must be 4000..24000");
}
function validateFixture(fixture: EvaluationFixtureV1): void {
  if (fixture.version !== 1 || !/^[a-z0-9-]{1,80}$/.test(fixture.id) || !fixture.workers.length) throw new Error("Invalid evaluation fixture");
  if (new Set(fixture.workers.map((worker) => worker.stepId)).size !== fixture.workers.length) throw new Error("Duplicate fixture worker step");
  if (fixture.workers.some((worker) => !/^[a-z0-9-]{1,80}$/.test(worker.stepId) || Boolean(worker.missing) === Boolean(worker.output))) throw new Error("Invalid fixed worker output fixture");
  if (!fixture.syntheticOracle?.A || !fixture.syntheticOracle?.B || !fixture.syntheticOracle?.C) throw new Error("Fixture synthetic oracle is incomplete");
  if (fixture.gold.forgedEvidenceMustBeRejected !== workerCorpusContainsForgedArtifact(fixture.workers)) {
    throw new Error("Fixture forged evidence gold does not match its fixed worker corpus");
  }
  const observed = new Set(observedMaterialEvidence(fixture.materials).map((item) => item.ref));
  for (const arm of ["A", "B", "C"] as const) validateSyntheticCandidate(fixture.syntheticOracle[arm], observed);
  if (fixture.gold.evidenceRefs.some((ref) => !observed.has(ref))) throw new Error("Gold fixture cites an unobserved material source");
}
function workerCorpusContainsForgedArtifact(workers: readonly EvaluationWorkerOutputV1[]): boolean {
  return workers.some((worker) => {
    if (!worker.output) return false;
    try {
      const clean = worker.output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(clean) as { claims?: unknown; fields?: unknown };
      const claims = Array.isArray(parsed.claims) ? parsed.claims : Array.isArray(parsed.fields) ? parsed.fields : [];
      return claims.some((claim) => {
        if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
        const raw = claim as { sourceRefs?: unknown; sources?: unknown };
        const refs = Array.isArray(raw.sourceRefs) ? raw.sourceRefs : raw.sources;
        return Array.isArray(refs) && refs.some((ref) => typeof ref === "string" && /^artifact:/i.test(ref.trim()));
      });
    } catch {
      return false;
    }
  });
}
function validateSyntheticCandidate(candidate: EvaluationCandidateV1, observed: ReadonlySet<string>): void {
  const evidenceRefs = new Set(candidate.evidenceRefs.map((item) => item.ref));
  for (const item of candidate.evidenceRefs) {
    if (item.kind !== "material" || item.observed !== true || item.factVerified !== false || !observed.has(item.ref)) throw new Error("Synthetic oracle contains forged evidence");
  }
  for (const claim of candidate.claims) {
    if (claim.canonicalValue !== claim.value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()) throw new Error("Synthetic oracle claim canonical value is invalid");
    if (claim.sourceRefs.some((ref) => !evidenceRefs.has(ref))) throw new Error("Synthetic oracle claim cites evidence outside its observed set");
    if (claim.evidenceState !== (claim.sourceRefs.length ? "source-linked" : "unknown")) throw new Error("Synthetic oracle claim evidence state is invalid");
  }
}
function hashText(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function hashJson(value: unknown): string { return hashText(JSON.stringify(value)); }

export function renderStructuredHandoffEvaluationMarkdown(report: StructuredHandoffEvaluationReportV1): string {
  const lines = [
    "# Structured handoff offline evaluation", "", `Generated by: ${report.generatedBy}`, `Benchmark claim: ${report.benchmarkClaim}`, "",
    "> Synthetic protocol check only. No model quality, token usage, latency, or cost was measured.", "",
    "| Fixture | Arm | Applicability | Comparable to | Precision | Recall | Evidence | Unresolved | Conflict | Forged reject | Determinism | Runtime metrics |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  const rate = (item: Metric) => item.rate === null ? "n/a" : item.rate.toFixed(3);
  for (const item of report.cases) lines.push(`| ${item.fixtureId} | ${item.arm} | ${item.applicability} | ${item.comparableTo.join(",") || "none"} | ${rate(item.scores.claimPrecision)} | ${rate(item.scores.claimRecall)} | ${rate(item.scores.evidenceRetention)} | ${rate(item.scores.unresolvedHonesty)} | ${rate(item.scores.conflictSurfacing)} | ${rate(item.scores.forgedEvidenceRejection)} | ${rate(item.scores.outputDeterminism)} | not-measured |`);
  lines.push("", "## Limitations", "", ...report.limitations.map((item) => `- ${item}`), "");
  return lines.join("\n");
}
