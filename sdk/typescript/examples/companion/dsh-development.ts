import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { CompanionModelConnection } from "./model-connection.js";
import { DevelopmentProposalStore, type DevelopmentProposalSession } from "./development-proposals.js";
import {
  currentDevelopmentRevision,
  detectDevelopmentChecks,
  developmentFileReceipt,
  developmentProposalSummary,
  developmentRisks,
  prepareIsolatedDevelopmentWorkspace,
  runDevelopmentCheck,
  validateDevelopmentWorkspace,
  type DevelopmentAccessMode,
  type DevelopmentCheck,
  type DevelopmentCheckReceipt,
  type DevelopmentContextReceipt,
  type PiDevelopmentResult,
} from "./pi-development.js";
import {
  detectDevelopmentDependencies,
  installDevelopmentDependencies,
  type DevelopmentDependencyReceipt,
} from "./development-dependencies.js";
import {
  shouldAutoApplyDevelopmentProposal,
  type DevelopmentApprovalPolicy,
} from "./development-approval.js";

const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_RUN_MS = 30 * 60_000;
const MAX_CAPTURE_FILES = 100;
const MAX_CAPTURE_BYTES = 5_000_000;
const READ_ONLY_CHECKS = new Set<DevelopmentCheck>(["git_status", "git_diff"]);

export interface DshDevelopmentInput {
  workspacePath: string;
  instruction: string;
  accessMode: DevelopmentAccessMode;
  approvalPolicy?: DevelopmentApprovalPolicy;
  installDependencies?: boolean;
  connection: CompanionModelConnection;
  agentDir: string;
  signal?: AbortSignal;
  onProgress?: (message: string, percent: number) => void;
  proposalStore?: DevelopmentProposalStore;
}

export type DshWorkspaceChange = { path: string; operation: "create" | "update" };

export async function runDshDevelopment(input: DshDevelopmentInput): Promise<PiDevelopmentResult> {
  if (input.signal?.aborted) throw new Error("隔离开发引擎任务已取消。");
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("隔离开发引擎需要 Node.js 22.19 或更高版本。");
  const workspace = validateDevelopmentWorkspace(input.workspacePath);
  const entrypoint = resolveDshEntrypoint();
  if (!entrypoint) throw new Error("隔离开发引擎尚未安装完整，请重新安装小丑鱼项目依赖。");

  mkdirSync(input.agentDir, { recursive: true });
  const runId = `dsh-${randomUUID()}`;
  const runHome = resolve(input.agentDir, "runs", runId);
  mkdirSync(runHome, { recursive: true });
  writeFileSync(resolve(runHome, "settings.yaml"), buildDshSettings(input.connection), "utf8");

  const baseRevision = await currentDevelopmentRevision(workspace);
  const isolation = input.accessMode === "develop"
    ? await prepareIsolatedDevelopmentWorkspace(workspace, input.agentDir)
    : { workspace, isolated: false, cleanup: async () => undefined };
  if (input.accessMode === "develop" && !isolation.isolated) {
    await isolation.cleanup();
    throw new Error(isolation.reason === "not-a-repo"
      ? "隔离开发引擎需要在已有的 Git 项目中开发；当前目录还不是 Git 项目，全新项目请切换为内置引擎。"
      : "隔离开发引擎为避免覆盖现有修改，只能在干净的 Git 项目中直接开发。当前项目请先提交已有改动，或切换为内置引擎。");
  }

  const executionWorkspace = isolation.workspace;
  let proposalSession: DevelopmentProposalSession | undefined;
  try {
    const dependencyReceipts = await installDependenciesIfRequested(input, executionWorkspace);
    const proposalStore = input.proposalStore ?? new DevelopmentProposalStore(resolve(input.agentDir, "proposals"));
    proposalSession = input.accessMode === "develop"
      ? proposalStore.begin(workspace, baseRevision, executionWorkspace)
      : undefined;
    const statusBefore = input.accessMode === "inspect" ? await gitStatusSnapshot(workspace) : "";
    const contextReceipts: DevelopmentContextReceipt[] = [workspaceContextReceipt(executionWorkspace)];
    input.onProgress?.(input.accessMode === "inspect" ? "隔离开发引擎正在检查项目" : "正在隔离环境中开发", 20);
    const output = await runDshProcess({
      entrypoint,
      cwd: executionWorkspace,
      home: runHome,
      task: buildDshTask(input.instruction, input.accessMode),
      apiKey: input.connection.apiKey || "local-model",
      baseEnvironment: process.env,
      accessMode: input.accessMode,
      signal: input.signal,
    });
    const sessionFile = newestSessionFile(resolve(runHome, "sessions"));
    const telemetry = sessionTelemetry(sessionFile);
    const toolCalls = Object.entries(telemetry)
      .filter(([type]) => type.toLowerCase().includes("tool"))
      .reduce((total, [, count]) => total + count, 0);

    if (input.accessMode === "inspect") {
      const statusAfter = await gitStatusSnapshot(workspace);
      if (statusAfter !== statusBefore) throw new Error("只检查模式检测到工作区发生变化，已拒绝把本轮当作有效结果。");
      input.onProgress?.("正在整理检查结果", 90);
      return {
        reply: output,
        workspacePath: workspace,
        accessMode: input.accessMode,
        approvalPolicy: "request",
        changedFiles: [],
        baseRevision,
        fileReceipts: [],
        checks: [],
        contextReceipts,
        unverifiedRisks: [],
        toolCalls,
        sessionId: runId,
        sessionFile,
        sessionResumed: false,
        loadedSkills: 0,
        loadedPromptTemplates: 0,
        telemetry: { ...telemetry, "dsh/process/succeeded": 1 },
        dependencyReceipts,
        isolatedWorkspace: false,
      };
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
      reply: output,
      workspacePath: workspace,
      accessMode: input.accessMode,
      approvalPolicy: input.approvalPolicy ?? "request",
      changedFiles,
      baseRevision,
      fileReceipts: changedFiles.map((path) => developmentFileReceiptFromProposal(proposal, path)),
      checks,
      contextReceipts,
      unverifiedRisks: developmentRisks(input.accessMode, checks),
      proposal: developmentProposalSummary(completedProposal),
      toolCalls,
      sessionId: runId,
      sessionFile,
      sessionResumed: false,
      loadedSkills: 0,
      loadedPromptTemplates: 0,
      telemetry: { ...telemetry, "dsh/process/succeeded": 1 },
      dependencyReceipts,
      isolatedWorkspace: true,
    };
  } catch (error) {
    proposalSession?.fail(error);
    throw error;
  } finally {
    await isolation.cleanup();
  }
}

async function installDependenciesIfRequested(
  input: DshDevelopmentInput,
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

export function buildDshSettings(connection: CompanionModelConnection): string {
  const protocol = connection.protocol === "anthropic" ? "anthropic-messages" : "openai-completions";
  const model = yamlString(connection.model);
  return [
    "agent-default-model:",
    "  provider: clownfish",
    `  model: ${model}`,
    "llm-pi-ai:",
    "  providers:",
    "    clownfish:",
    `      displayName: ${yamlString("小丑鱼模型连接")}`,
    "      apiKeyEnv: CLOWNFISH_DSH_API_KEY",
    `      api: ${protocol}`,
    `      baseURL: ${yamlString(connection.baseUrl)}`,
    "      defaultContextWindow: 128000",
    "      defaultMaxTokens: 16384",
    "      models:",
    `        - id: ${model}`,
    `          name: ${model}`,
    "          contextWindow: 128000",
    "          maxTokens: 16384",
    "          input:",
    "            - text",
    "            - image",
    "",
  ].join("\n");
}

function buildDshTask(instruction: string, accessMode: DevelopmentAccessMode): string {
  const policy = accessMode === "inspect"
    ? "只读检查，不得创建、修改、删除任何文件，也不得安装依赖。"
    : "实际完成修改并运行最相关的构建、类型或测试检查。当前提案只支持创建和修改文件，不得删除、移动或重命名文件。";
  return [
    "你是小丑鱼应用调用的独立开发执行引擎。",
    policy,
    "先阅读项目内的规则和相关代码，再做判断。禁止提交、推送、切换分支或操作工作区之外的文件。",
    "最后用中文简洁说明完成内容、实际检查及仍未验证的风险。",
    "",
    "用户目标：",
    instruction.trim(),
  ].join("\n");
}

export function resolveDshEntrypoint(start = process.cwd()): string | undefined {
  const roots = [resolve(start), resolve(__dirname, "..", "..")];
  const seen = new Set<string>();
  for (const root of roots) {
    let cursor = root;
    while (!seen.has(cursor)) {
      seen.add(cursor);
      const candidate = resolve(cursor, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return undefined;
}

export function dshDevelopmentEnvironment(): { available: boolean; version: string } {
  const entrypoint = resolveDshEntrypoint();
  if (!entrypoint) return { available: false, version: "" };
  try {
    const packageFile = resolve(dirname(dirname(entrypoint)), "package.json");
    const value = JSON.parse(readFileSync(packageFile, "utf8")) as { version?: string };
    return { available: true, version: value.version ? `DeepSeek Harness ${value.version}` : "DeepSeek Harness" };
  } catch {
    return { available: true, version: "DeepSeek Harness" };
  }
}

async function runDshProcess(input: {
  entrypoint: string;
  cwd: string;
  home: string;
  task: string;
  apiKey: string;
  baseEnvironment: NodeJS.ProcessEnv;
  accessMode: DevelopmentAccessMode;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise((accept, reject) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    const child = spawn(process.execPath, [input.entrypoint, "--profile", "headless", input.task], {
      cwd: input.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...input.baseEnvironment,
        DSH_HOME: input.home,
        DSH_PERMISSION_MODE: dshPermissionMode(input.accessMode),
        DSH_TELEMETRY_DISABLED: "1",
        CLOWNFISH_DSH_API_KEY: input.apiKey,
      },
    });
    const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
      const next = Buffer.concat([current, chunk]);
      return next.byteLength <= MAX_OUTPUT_BYTES ? next : next.subarray(next.byteLength - MAX_OUTPUT_BYTES);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else accept(redactCredential(stdout.toString("utf8").trim(), input.apiKey));
    };
    const abort = () => {
      child.kill();
      finish(new Error("隔离开发引擎任务已取消。"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("隔离开发引擎运行超过 30 分钟，已停止本轮任务。"));
    }, MAX_RUN_MS);
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(new Error(`隔离开发引擎无法启动：${error.message}`)));
    child.once("close", (code) => {
      const reply = redactCredential(stdout.toString("utf8").trim(), input.apiKey);
      const detail = redactCredential(stderr.toString("utf8").trim(), input.apiKey);
      if (code !== 0) {
        finish(new Error(`隔离开发引擎执行失败（退出码 ${code ?? "未知"}）：${(detail || reply || "没有返回错误详情").slice(0, 4_000)}`));
        return;
      }
      if (!reply) {
        finish(new Error("隔离开发引擎已结束，但没有返回可交付结果。"));
        return;
      }
      finish();
    });
  });
}

export function dshPermissionMode(accessMode: DevelopmentAccessMode): "read-only" | "workspace-write" {
  return accessMode === "inspect" ? "read-only" : "workspace-write";
}

// 运行产物不进审阅：Python 字节码缓存、依赖目录、构建输出、系统垃圾文件。
// 与 Pi 引擎的 SKIPPED_DIRECTORIES 约定保持一致。
const GENERATED_ARTIFACT_PATTERN = /(?:^|\/)(?:__pycache__|node_modules|\.next|dist|build|coverage)(?:\/|$)|\.(?:pyc|pyo)$|(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/;

export function isGeneratedArtifactPath(path: string): boolean {
  return GENERATED_ARTIFACT_PATTERN.test(path);
}

export async function collectDshWorkspaceChanges(workspace: string, baseRevision?: string): Promise<DshWorkspaceChange[]> {
  if (!baseRevision) throw new Error("隔离开发引擎直接开发需要可读取的 Git 基线版本。");
  const tracked = await gitOutput(workspace, ["diff", "--name-status", "--no-renames", baseRevision, "--"]);
  const untracked = await gitOutput(workspace, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const changes = new Map<string, DshWorkspaceChange>();
  for (const line of tracked.split(/\r?\n/).filter(Boolean)) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const status = line.slice(0, tab);
    const path = normalizeWorkspacePath(line.slice(tab + 1));
    if (isGeneratedArtifactPath(path)) continue;
    if (status.startsWith("D")) throw new Error(`隔离开发引擎删除了文件，当前安全提案不接受删除操作：${path}`);
    changes.set(path, { path, operation: status.startsWith("A") ? "create" : "update" });
  }
  for (const item of untracked.split("\0").filter(Boolean)) {
    const path = normalizeWorkspacePath(item);
    if (isGeneratedArtifactPath(path)) continue;
    changes.set(path, { path, operation: "create" });
  }
  if (changes.size > MAX_CAPTURE_FILES) throw new Error(`隔离开发引擎修改了 ${changes.size} 个文件，超过单次提案上限 ${MAX_CAPTURE_FILES}。`);
  return [...changes.values()];
}

export function stageDshWorkspaceChanges(
  session: DevelopmentProposalSession,
  workspace: string,
  changes: DshWorkspaceChange[],
): void {
  let totalBytes = 0;
  for (const change of changes) {
    const file = resolveWorkspaceFile(workspace, change.path);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`隔离开发引擎的修改结果不是可读取文件：${change.path}`);
    const content = readFileSync(file);
    totalBytes += content.byteLength;
    if (totalBytes > MAX_CAPTURE_BYTES) throw new Error("隔离开发引擎修改内容超过 5 MB，请缩小本次任务范围。");
    if (content.includes(0)) throw new Error(`隔离开发引擎修改了二进制文件，当前安全提案无法审阅：${change.path}`);
    session.write(file, content.toString("utf8"));
  }
}

function resolveWorkspaceFile(workspace: string, path: string): string {
  const root = resolve(workspace);
  const file = resolve(root, path);
  if (file !== root && !file.startsWith(root + sep)) throw new Error("隔离开发引擎返回了工作区之外的文件路径。");
  return file;
}

function normalizeWorkspacePath(path: string): string {
  const value = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!value || value === ".." || value.startsWith("../") || value.includes("\0")) throw new Error("隔离开发引擎返回了无效的文件路径。");
  return value;
}

async function gitOutput(workspace: string, args: string[]): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn("git", args, { cwd: workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? accept(stdout) : reject(new Error(stderr.trim() || `git ${args[0]} 执行失败`)));
  });
}

async function gitStatusSnapshot(workspace: string): Promise<string> {
  try {
    return await gitOutput(workspace, ["status", "--porcelain=v1", "--untracked-files=all"]);
  } catch {
    return "";
  }
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

function newestSessionFile(root: string): string | undefined {
  if (!existsSync(root)) return undefined;
  let newest: { file: string; mtime: number } | undefined;
  const visit = (directory: string, depth: number) => {
    if (depth > 5) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const mtime = statSync(path).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file: path, mtime };
      }
    }
  };
  visit(root, 0);
  return newest?.file;
}

function sessionTelemetry(file?: string): Record<string, number> {
  if (!file || !existsSync(file)) return {};
  const result: Record<string, number> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as { type?: unknown };
      const type = typeof item.type === "string" ? item.type : "dsh/session/event";
      result[type] = (result[type] ?? 0) + 1;
    } catch {
      result["dsh/session/unparsed"] = (result["dsh/session/unparsed"] ?? 0) + 1;
    }
  }
  return result;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function redactCredential(value: string, credential: string): string {
  if (!credential || credential === "local-model") return value;
  return value.split(credential).join("[已隐藏密钥]");
}
