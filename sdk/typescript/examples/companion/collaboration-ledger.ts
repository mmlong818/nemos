import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityArtifact, CapabilityTask } from "./capabilities.js";
import { expertAssignmentPrompt, expertContract, type ExpertAssignmentPlan } from "./expert-contracts.js";
import { LONG_FORM_EXPERT_IDS } from "./experts.js";
import { BUILTIN_SKILL_CONTRACTS, snapshotSkillContract, type SkillContractSnapshot } from "./skill-contract.js";

export interface CollaborationStep {
  stepId: string;
  title: string;
  personaId: string;
  capabilityId: string;
  format: "md";
  instruction: string;
  contract: SkillContractSnapshot;
  materialBoundary: string;
  outputRequirement: string;
}
export interface CollaborationPlan {
  version: 1;
  taskId: string;
  taskHash: string;
  planHash: string;
  reason: string;
  steps: CollaborationStep[];
}
export type CollaborationStepStatus = "running" | "succeeded" | "failed" | "uncertain" | "invalid" | "pending" | "unresolved";
export interface CollaborationReceipt {
  version: 1;
  planHash: string;
  stepId: string;
  jobId: string;
  /** Optional for backward-compatible reads of pre-M2 journals. */
  rootRequestId?: string;
  actionRunId?: string;
  invocationId?: string;
  attempt: number;
  status: "running" | "succeeded" | "failed";
  at: string;
  artifactId?: string;
  artifactContentHash?: string;
  proofLevel?: string;
  contractDigest?: string;
  error?: string;
  unresolved?: string[];
}
export interface CollaborationStepView extends CollaborationStep {
  status: CollaborationStepStatus;
  receipt?: CollaborationReceipt;
}

const RECEIPT_STATUSES = new Set(["running", "succeeded", "failed"]);
const PROOF_LEVELS = new Set(["produced", "validated", "verified", "approved"]);

const hash = (value: unknown): string => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");

export function makeCollaborationPlan(task: CapabilityTask): CollaborationPlan {
  if (!task.instruction.trim()) throw new Error("协作需要明确任务要求");
  if (!["md", "html", "txt"].includes(task.format)) throw new Error("当前技能协作仅支持文字任务");
  const assignments: ExpertAssignmentPlan[] = [
    { personaId: "research_verification", capabilityId: "research-brief", responsibility: "核查本次材料的证据与缺口", format: "md", memoryMode: "off", contract: expertContract("research_verification")! },
    { personaId: "decision_analysis", capabilityId: "decision-brief", responsibility: "比较方案、风险与待决问题", format: "md", memoryMode: "off", contract: expertContract("decision_analysis")! },
  ];
  if (assignments.some((item) => !item.contract || !LONG_FORM_EXPERT_IDS.has(item.personaId))) throw new Error("协作专家配置不可用");
  const steps: CollaborationStep[] = assignments.map((assignment, index) => {
    const contract = BUILTIN_SKILL_CONTRACTS[assignment.capabilityId];
    if (!contract) throw new Error(`技能 ${assignment.capabilityId} 缺少可验收契约`);
    const instruction = expertAssignmentPrompt(assignment, task.instruction);
    const snapshot = snapshotSkillContract(assignment.capabilityId, contract, "md", instruction);
    return {
      stepId: `expert-${index + 1}`,
      title: assignment.responsibility,
      personaId: assignment.personaId,
      capabilityId: assignment.capabilityId,
      format: "md",
      instruction,
      contract: snapshot,
      materialBoundary: "仅本任务要求及本次明确提交的材料；不继承其他任务或专家输出",
      outputRequirement: contract.output,
    };
  });
  const taskHash = hash([task.id, task.instruction, task.capabilityId, task.format]);
  const base = { version: 1 as const, taskId: task.id, taskHash, reason: "先核查材料与证据，再比较方案及风险", steps };
  return { ...base, planHash: hash(base) };
}

export function verifyCollaborationPlan(plan: CollaborationPlan): boolean {
  const { planHash, ...body } = plan;
  return plan.version === 1 && plan.steps.length === 2 && plan.steps.every((step, index) =>
    step.stepId === `expert-${index + 1}` && step.contract.inputState === "ready" &&
    step.contract.id === step.capabilityId && step.contract.expectedFormat === "md") && hash(body) === planHash;
}

export function currentCollaborationPlanMatches(plan: CollaborationPlan, task: CapabilityTask): boolean {
  return verifyCollaborationPlan(plan) && makeCollaborationPlan(task).planHash === plan.planHash &&
    plan.steps.every((step) => {
      const contract = BUILTIN_SKILL_CONTRACTS[step.capabilityId];
      return contract && snapshotSkillContract(step.capabilityId, contract, "md", step.instruction).digest === step.contract.digest;
    });
}

/** One append-only journal per frozen plan. An unmatched running receipt is deliberately uncertain. */
export class CollaborationLedger {
  constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true }); }
  private file(plan: CollaborationPlan): string { return join(this.directory, `${plan.taskId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${plan.planHash}.jsonl`); }
  read(plan: CollaborationPlan): CollaborationReceipt[] {
    if (!verifyCollaborationPlan(plan)) throw new Error("协作计划指纹不匹配");
    const file = this.file(plan);
    if (!existsSync(file)) return [];
    const receipts = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
      const receipt = JSON.parse(line) as CollaborationReceipt;
      const step = plan.steps.find((item) => item.stepId === receipt.stepId);
      if (receipt.version !== 1 || receipt.planHash !== plan.planHash || !step ||
          typeof receipt.jobId !== "string" || !receipt.jobId || !Number.isSafeInteger(receipt.attempt) || receipt.attempt < 1 ||
          (receipt.rootRequestId !== undefined && (typeof receipt.rootRequestId !== "string" || receipt.rootRequestId.length > 100)) ||
          (receipt.actionRunId !== undefined && (typeof receipt.actionRunId !== "string" || receipt.actionRunId.length > 160)) ||
          (receipt.invocationId !== undefined && (typeof receipt.invocationId !== "string" || receipt.invocationId.length > 200)) ||
          !RECEIPT_STATUSES.has(receipt.status) || receipt.contractDigest !== step.contract.digest || typeof receipt.at !== "string") {
        throw new Error("协作回执损坏，已停止执行");
      }
      return receipt;
    });
    const histories = new Map<string, Pick<CollaborationReceipt, "attempt" | "jobId" | "rootRequestId" | "actionRunId" | "invocationId" | "status">>();
    for (const receipt of receipts) {
      const previous = histories.get(receipt.stepId);
      if (!previous) {
        if (receipt.status !== "running" || receipt.attempt !== 1) throw new Error("协作回执尝试顺序损坏，已停止执行");
      } else if (previous.status === "running") {
        if (receipt.status === "running" || receipt.attempt !== previous.attempt || receipt.jobId !== previous.jobId ||
            receipt.rootRequestId !== previous.rootRequestId || receipt.actionRunId !== previous.actionRunId || receipt.invocationId !== previous.invocationId) {
          throw new Error("协作回执尝试顺序损坏，已停止执行");
        }
      } else if (previous.status === "succeeded" || receipt.status !== "running" || receipt.attempt !== previous.attempt + 1) {
        throw new Error("协作回执尝试顺序损坏，已停止执行");
      }
      if (receipt.status === "succeeded") {
        if (typeof receipt.artifactId !== "string" || !receipt.artifactId || !/^[a-f0-9]{64}$/.test(receipt.artifactContentHash || "") ||
            !PROOF_LEVELS.has(receipt.proofLevel || "")) throw new Error("协作成果回执不完整，已停止执行");
      }
      if (receipt.status === "failed" && (typeof receipt.error !== "string" || !receipt.error)) throw new Error("协作失败回执不完整，已停止执行");
      histories.set(receipt.stepId, { attempt: receipt.attempt, jobId: receipt.jobId, rootRequestId: receipt.rootRequestId,
        actionRunId: receipt.actionRunId, invocationId: receipt.invocationId, status: receipt.status });
    }
    return receipts;
  }
  append(plan: CollaborationPlan, receipt: Omit<CollaborationReceipt, "version" | "planHash" | "at">): CollaborationReceipt {
    this.read(plan);
    const value: CollaborationReceipt = { version: 1, planHash: plan.planHash, at: new Date().toISOString(), ...receipt };
    const fd = openSync(this.file(plan), "a");
    try { appendFileSync(fd, `${JSON.stringify(value)}\n`, "utf8"); fsyncSync(fd); }
    finally { closeSync(fd); }
    return value;
  }
  view(
    plan: CollaborationPlan,
    findArtifact: (id: string) => CapabilityArtifact | undefined,
    artifactBelongsToStep: (artifact: CapabilityArtifact, step: CollaborationStep, receipt: CollaborationReceipt) => boolean,
  ): CollaborationStepView[] {
    const receipts = this.read(plan);
    return plan.steps.map((step) => {
      const receipt = [...receipts].reverse().find((item) => item.stepId === step.stepId);
      if (!receipt) return { ...step, status: "pending" };
      if (receipt.status === "running") return { ...step, receipt, status: "uncertain" };
      if (receipt.status === "failed") return { ...step, receipt, status: "failed" };
      const artifact = receipt.artifactId && findArtifact(receipt.artifactId);
      if (!artifact || !artifact.proof || artifact.proof.contentHash !== receipt.artifactContentHash ||
          artifact.capabilityId !== step.capabilityId || artifact.personaId !== step.personaId || artifact.format !== step.format ||
          artifact.proof.level !== receipt.proofLevel || receipt.contractDigest !== step.contract.digest || !artifactBelongsToStep(artifact, step, receipt) ||
          artifact.metadata?.skillContract?.digest !== step.contract.digest ||
          !["skill-contract", "skill-content", "skill-format"].every((id) => artifact.proof!.checks.some((check) => check.id === id && check.status === "passed")) ||
          !existsSync(artifact.file) || hash(readFileSync(artifact.file)) !== receipt.artifactContentHash) {
        return { ...step, receipt, status: "invalid" };
      }
      return { ...step, receipt, status: receipt.unresolved?.length ? "unresolved" : "succeeded" };
    });
  }
}

export async function executeCollaboration(input: {
  plan: CollaborationPlan;
  jobId: string;
  rootRequestId?: string;
  actionRunId?: string;
  ledger: CollaborationLedger;
  findArtifact: (id: string) => CapabilityArtifact | undefined;
  artifactBelongsToStep: (artifact: CapabilityArtifact, step: CollaborationStep, receipt: CollaborationReceipt) => boolean;
  runStep: (step: CollaborationStep) => Promise<CapabilityArtifact>;
  onStep?: (step: CollaborationStepView) => void;
  signal?: AbortSignal;
}): Promise<CollaborationStepView[]> {
  const { plan, jobId, ledger, findArtifact, artifactBelongsToStep } = input;
  if (!verifyCollaborationPlan(plan)) throw new Error("协作计划已损坏");
  for (const step of plan.steps) {
    const state = ledger.view(plan, findArtifact, artifactBelongsToStep).find((item) => item.stepId === step.stepId)!;
    if (state.status === "succeeded") { input.onStep?.(state); continue; }
    if (state.status === "uncertain" || state.status === "invalid" || state.status === "unresolved") { input.onStep?.(state); continue; }
    if (input.signal?.aborted) break;
    const attempt = (state.receipt?.attempt ?? 0) + 1;
    const invocationId = `collaboration-${jobId}-${step.stepId}`;
    const correlation = { rootRequestId: input.rootRequestId, actionRunId: input.actionRunId, invocationId };
    ledger.append(plan, { stepId: step.stepId, jobId, ...correlation, attempt, status: "running", contractDigest: step.contract.digest });
    try {
      const artifact = await input.runStep(step);
      if (!artifact.proof || !artifact.proof.contentHash || artifact.metadata?.skillContract?.digest !== step.contract.digest ||
          artifact.capabilityId !== step.capabilityId || artifact.personaId !== step.personaId ||
          artifact.format !== step.format || !artifactBelongsToStep(artifact, step, { version: 1, planHash: plan.planHash, stepId: step.stepId, jobId, ...correlation, attempt, status: "succeeded", at: new Date().toISOString(), contractDigest: step.contract.digest }) ||
          !existsSync(artifact.file) || hash(readFileSync(artifact.file)) !== artifact.proof.contentHash ||
          !["skill-contract", "skill-content", "skill-format"].every((id) => artifact.proof!.checks.some((check) => check.id === id && check.status === "passed"))) {
        throw new Error("成果缺少有效文件、契约或机械检查回执");
      }
      const unresolved = readFileSync(artifact.file, "utf8").split(/\r?\n/)
        .filter((line) => /^\s*(?:[-*]\s*)?(?:冲突|待决)[:：]/.test(line)).map((line) => line.trim().slice(0, 300)).slice(0, 10);
      ledger.append(plan, { stepId: step.stepId, jobId, ...correlation, attempt, status: "succeeded", artifactId: artifact.id,
        artifactContentHash: artifact.proof.contentHash, proofLevel: artifact.proof.level, contractDigest: step.contract.digest, unresolved });
    } catch (error) {
      ledger.append(plan, { stepId: step.stepId, jobId, ...correlation, attempt, status: "failed", contractDigest: step.contract.digest,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
    }
    input.onStep?.(ledger.view(plan, findArtifact, artifactBelongsToStep).find((item) => item.stepId === step.stepId)!);
  }
  return ledger.view(plan, findArtifact, artifactBelongsToStep);
}
