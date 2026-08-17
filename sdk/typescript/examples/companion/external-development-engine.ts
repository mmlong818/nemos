import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CompanionModelConnection } from "./model-connection.js";
import type { DevelopmentReasoning } from "./capabilities.js";
import type { DevelopmentEngine } from "./development-engine-contract.js";
import type { DevelopmentSessionMode, DevelopmentTelemetryEvent } from "./pi-development.js";
import { decodeDevelopmentSessionReference, encodeDevelopmentSessionReference } from "./development-session-reference.js";
import { DevelopmentProposalStore, type DevelopmentProposalSession } from "./development-proposals.js";
import {
  currentDevelopmentRevision,
  detectDevelopmentChecks,
  developmentFileReceipt,
  developmentProposalSummary,
  developmentRisks,
  runDevelopmentCheck,
  validateDevelopmentWorkspace,
  type DevelopmentAccessMode,
  type DevelopmentCheck,
  type DevelopmentCheckReceipt,
  type DevelopmentContextReceipt,
  type PiDevelopmentResult,
} from "./pi-development.js";
import { preparePersistentDevelopmentIsolation } from "./development-persistent-isolation.js";
import {
  detectDevelopmentDependencies,
  installDevelopmentDependencies,
  type DevelopmentDependencyReceipt,
} from "./development-dependencies.js";
import { collectDshWorkspaceChanges, stageDshWorkspaceChanges } from "./dsh-development.js";
import {
  shouldAutoApplyDevelopmentProposal,
  type DevelopmentApprovalPolicy,
} from "./development-approval.js";

const READ_ONLY_CHECKS = new Set<DevelopmentCheck>(["git_status", "git_diff"]);

export interface ExternalDevelopmentInput {
  workspacePath: string;
  instruction: string;
  accessMode: DevelopmentAccessMode;
  approvalPolicy?: DevelopmentApprovalPolicy;
  installDependencies?: boolean;
  connection: CompanionModelConnection;
  reasoning?: DevelopmentReasoning;
  agentDir: string;
  signal?: AbortSignal;
  onProgress?: (message: string, percent: number) => void;
  onTelemetry?: (event: DevelopmentTelemetryEvent) => void;
  sessionMode?: DevelopmentSessionMode;
  sessionFile?: string;
  proposalStore?: DevelopmentProposalStore;
}

export interface ExternalEngineRunOutput {
  reply: string;
  sessionId?: string;
  sessionFile?: string;
  toolCalls: number;
  telemetry: Record<string, number>;
}

export interface ExternalDevelopmentEngine {
  id: string;
  name: string;
  run(input: {
    workspace: string;
    runHome: string;
    instruction: string;
    accessMode: DevelopmentAccessMode;
    connection: CompanionModelConnection;
    reasoning: DevelopmentReasoning;
    signal?: AbortSignal;
    onTelemetry?: (event: DevelopmentTelemetryEvent) => void;
    sessionId?: string;
  }): Promise<ExternalEngineRunOutput>;
}

export async function runExternalDevelopment(
  input: ExternalDevelopmentInput,
  engine: ExternalDevelopmentEngine,
): Promise<PiDevelopmentResult> {
  if (input.signal?.aborted) throw new Error(`${engine.name} 任务已取消。`);
  const workspace = validateDevelopmentWorkspace(input.workspacePath);
  const baseRevision = await currentDevelopmentRevision(workspace);
  mkdirSync(input.agentDir, { recursive: true });
  const runId = `${engine.id}-${randomUUID()}`;
  const resume = input.sessionMode === "resume"
    ? decodeDevelopmentSessionReference(input.sessionFile, engine.id as "pi" | "dsh" | "kilo" | "opencode" | "codex", input.agentDir)
    : undefined;
  if (input.sessionMode === "resume" && !resume) throw new Error(`${engine.name} 的会话引用无效或已经不可用。`);
  const runHome = resume?.runHome ?? resolve(input.agentDir, "runs", runId);
  mkdirSync(runHome, { recursive: true });

  const isolation = await preparePersistentDevelopmentIsolation({ workspace, agentDir: input.agentDir, runHome, accessMode: input.accessMode });
  if (input.accessMode === "develop" && !isolation.isolated) {
    await isolation.cleanup();
    throw new Error(isolation.reason === "not-a-repo"
      ? `${engine.name} 需要在已有的 Git 项目中开发；当前目录还不是 Git 项目，全新项目请切换为 Pi Agent。`
      : `${engine.name} 为避免覆盖现有修改，只能在干净的 Git 项目中直接开发。当前项目请先提交已有改动，或切换为 Pi Agent。`);
  }

  const executionWorkspace = isolation.workspace;
  let proposalSession: DevelopmentProposalSession | undefined;
  try {
    const dependencyReceipts = await installDependenciesIfRequested(input, executionWorkspace);
    const proposalStore = input.proposalStore ?? new DevelopmentProposalStore(resolve(input.agentDir, "proposals"));
    proposalSession = input.accessMode === "develop"
      ? proposalStore.begin(workspace, baseRevision, executionWorkspace)
      : undefined;
    const contextReceipts = [workspaceContextReceipt(executionWorkspace)];
    input.onProgress?.(input.accessMode === "inspect" ? `${engine.name} 正在检查项目` : `${engine.name} 正在隔离环境中开发`, 20);
    const output = await engine.run({
      workspace: executionWorkspace,
      runHome,
      instruction: developmentInstructionForReasoning(input.instruction, input.reasoning),
      accessMode: input.accessMode,
      connection: input.connection,
      reasoning: input.reasoning === "fast" ? "fast" : input.reasoning === "deep" ? "deep" : "balanced",
      signal: input.signal,
      onTelemetry: input.onTelemetry,
      sessionId: resume?.sessionId,
    });
    if (!output.reply.trim()) throw new Error(`${engine.name} 已结束，但没有返回可交付结果。`);

    if (input.accessMode === "inspect") {
      input.onProgress?.("正在整理检查结果", 90);
      return { ...baseResult(input, workspace, baseRevision, contextReceipts, dependencyReceipts, output, runId, runHome, engine.id, Boolean(resume)), isolatedWorkspace: true };
    }

    input.onProgress?.("正在收集修改并运行项目检查", 82);
    const checks: DevelopmentCheckReceipt[] = [];
    const plannedChecks = detectDevelopmentChecks(executionWorkspace, "develop")
      .filter((check) => !READ_ONLY_CHECKS.has(check))
      .slice(0, 4);
    for (const check of plannedChecks) checks.push(await runDevelopmentCheck(executionWorkspace, check));
    const changes = await collectDshWorkspaceChanges(executionWorkspace, baseRevision);
    stageDshWorkspaceChanges(proposalSession!, executionWorkspace, changes);
    const proposal = proposalSession!.finalize();
    const completedProposal = proposal.state === "pending" && shouldAutoApplyDevelopmentProposal(input.approvalPolicy ?? "request", checks)
      ? proposalStore.apply(proposal.id)
      : proposal;
    const changedFiles = proposal.files.map((file) => file.path);
    return {
      ...baseResult(input, workspace, baseRevision, contextReceipts, dependencyReceipts, output, runId, runHome, engine.id, Boolean(resume)),
      changedFiles,
      fileReceipts: changedFiles.map((path) => developmentFileReceiptFromProposal(proposal, path)),
      checks,
      unverifiedRisks: developmentRisks(input.accessMode, checks),
      proposal: developmentProposalSummary(completedProposal),
      isolatedWorkspace: true,
    };
  } catch (error) {
    proposalSession?.fail(error);
    throw error;
  } finally {
    await isolation.cleanup();
  }
}

function developmentInstructionForReasoning(instruction: string, reasoning?: DevelopmentReasoning): string {
  const guidance = reasoning === "fast"
    ? "执行深度：快速。优先完成最直接的实现与必要检查，避免扩展任务范围。"
    : reasoning === "deep"
      ? "执行深度：深入。先核对架构、边界与相关影响，再实现并运行更完整的检查。"
      : "执行深度：标准。先理解相关代码，再完成实现与最相关的验证。";
  return `${instruction.trim()}\n\n${guidance}`;
}

function baseResult(
  input: ExternalDevelopmentInput,
  workspace: string,
  baseRevision: string | undefined,
  contextReceipts: DevelopmentContextReceipt[],
  dependencyReceipts: DevelopmentDependencyReceipt[],
  output: ExternalEngineRunOutput,
  runId: string,
  runHome: string,
  engine: string,
  sessionResumed: boolean,
): PiDevelopmentResult {
  return {
    reply: output.reply,
    workspacePath: workspace,
    accessMode: input.accessMode,
    approvalPolicy: input.accessMode === "inspect" ? "request" : input.approvalPolicy ?? "request",
    changedFiles: [],
    baseRevision,
    fileReceipts: [],
    checks: [],
    contextReceipts,
    unverifiedRisks: [],
    toolCalls: output.toolCalls,
    sessionId: output.sessionId || runId,
    sessionFile: output.sessionId ? encodeDevelopmentSessionReference(engine as DevelopmentEngine, runHome, output.sessionId) : output.sessionFile,
    sessionResumed,
    loadedSkills: 0,
    loadedPromptTemplates: 0,
    telemetry: output.telemetry,
    dependencyReceipts,
    isolatedWorkspace: false,
  };
}

async function installDependenciesIfRequested(
  input: ExternalDevelopmentInput,
  workspace: string,
): Promise<DevelopmentDependencyReceipt[]> {
  if (input.accessMode !== "develop" || !input.installDependencies) return [];
  const plans = detectDevelopmentDependencies(workspace).filter((plan) => plan.needed);
  if (!plans.length) return [];
  input.onProgress?.(`正在补齐 ${plans.map((plan) => plan.ecosystem).join("、")} 项目依赖`, 8);
  const receipts = await installDevelopmentDependencies(workspace, plans);
  const failed = receipts.find((receipt) => !receipt.passed);
  if (failed) throw new Error(`${failed.label}失败：${failed.output.slice(0, 800)}`);
  return receipts;
}

function workspaceContextReceipt(workspace: string): DevelopmentContextReceipt {
  const entries = readdirSync(workspace, { withFileTypes: true }).filter((item) => item.name !== ".git");
  return {
    kind: "directory",
    path: ".",
    anchor: entries.slice(0, 40).map((item) => `${item.isDirectory() ? "目录" : "文件"}:${item.name}`).join(" | ") || "空目录",
    confidence: "exact",
    truncated: entries.length > 40,
  };
}

function developmentFileReceiptFromProposal(
  proposal: ReturnType<DevelopmentProposalSession["finalize"]>,
  path: string,
) {
  const file = proposal.files.find((item) => item.path === path);
  if (!file) return developmentFileReceipt(proposal.workspacePath, path);
  return { path, state: "present" as const, sha256: file.proposedHash, byteLength: file.byteLength };
}
