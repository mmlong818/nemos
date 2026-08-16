import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  collectDshWorkspaceChanges,
  stageDshWorkspaceChanges,
} from "./dsh-development.js";
import {
  shouldAutoApplyDevelopmentProposal,
  type DevelopmentApprovalPolicy,
} from "./development-approval.js";

const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_RUN_MS = 30 * 60_000;
const READ_ONLY_CHECKS = new Set<DevelopmentCheck>(["git_status", "git_diff"]);

export interface KiloDevelopmentInput {
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

interface KiloRunOutput {
  reply: string;
  sessionId?: string;
  toolCalls: number;
  telemetry: Record<string, number>;
}

export async function runKiloDevelopment(input: KiloDevelopmentInput): Promise<PiDevelopmentResult> {
  if (input.signal?.aborted) throw new Error("Kilo Code 任务已取消。");
  const workspace = validateDevelopmentWorkspace(input.workspacePath);
  const entrypoint = resolveKiloEntrypoint();
  if (!entrypoint) throw new Error("Kilo Code 尚未安装完整，请重新安装小丑鱼项目依赖。");

  mkdirSync(input.agentDir, { recursive: true });
  const runId = `kilo-${randomUUID()}`;
  const runHome = resolve(input.agentDir, "runs", runId);
  for (const name of ["data", "config", "cache", "state"]) mkdirSync(resolve(runHome, name), { recursive: true });

  const baseRevision = await currentDevelopmentRevision(workspace);
  const isolation = input.accessMode === "develop"
    ? await prepareIsolatedDevelopmentWorkspace(workspace, input.agentDir)
    : { workspace, isolated: false, cleanup: async () => undefined };
  if (input.accessMode === "develop" && !isolation.isolated) {
    await isolation.cleanup();
    throw new Error(isolation.reason === "not-a-repo"
      ? "Kilo Code 需要在已有的 Git 项目中开发；当前目录还不是 Git 项目，全新项目请切换为内置引擎。"
      : "Kilo Code 为避免覆盖现有修改，只能在干净的 Git 项目中直接开发。当前项目请先提交已有改动，或切换为内置引擎。");
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
    input.onProgress?.(input.accessMode === "inspect" ? "Kilo Code 正在检查项目" : "Kilo Code 正在隔离环境中开发", 20);
    const output = await runKiloProcess({
      entrypoint,
      cwd: executionWorkspace,
      runHome,
      task: buildKiloTask(input.instruction, input.accessMode),
      config: buildKiloConfig(input.connection, input.accessMode),
      model: kiloModelReference(input.connection),
      agent: input.accessMode === "inspect" ? "ask" : "code",
      apiKey: input.connection.apiKey || "local-model",
      baseEnvironment: process.env,
      signal: input.signal,
    });

    if (input.accessMode === "inspect") {
      const statusAfter = await gitStatusSnapshot(workspace);
      if (statusAfter !== statusBefore) throw new Error("只检查模式检测到工作区发生变化，已拒绝把本轮当作有效结果。");
      input.onProgress?.("正在整理检查结果", 90);
      return {
        reply: output.reply,
        workspacePath: workspace,
        accessMode: input.accessMode,
        approvalPolicy: "request",
        changedFiles: [],
        baseRevision,
        fileReceipts: [],
        checks: [],
        contextReceipts,
        unverifiedRisks: [],
        toolCalls: output.toolCalls,
        sessionId: output.sessionId || runId,
        sessionResumed: false,
        loadedSkills: 0,
        loadedPromptTemplates: 0,
        telemetry: output.telemetry,
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
      reply: output.reply,
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
      toolCalls: output.toolCalls,
      sessionId: output.sessionId || runId,
      sessionResumed: false,
      loadedSkills: 0,
      loadedPromptTemplates: 0,
      telemetry: output.telemetry,
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
  input: KiloDevelopmentInput,
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

export function buildKiloConfig(
  connection: CompanionModelConnection,
  accessMode: DevelopmentAccessMode,
): string {
  const provider = kiloProvider(connection);
  const permission = accessMode === "inspect"
    ? { "*": "allow", edit: "deny", write: "deny", apply_patch: "deny", bash: "deny", external_directory: "deny", webfetch: "deny", websearch: "deny" }
    : { "*": "allow", external_directory: "deny" };
  return JSON.stringify({
    $schema: "https://app.kilo.ai/config.json",
    model: `${provider}/${connection.model}`,
    enabled_providers: [provider],
    provider: {
      [provider]: {
        options: {
          apiKey: "{env:CLOWNFISH_KILO_API_KEY}",
          baseURL: connection.baseUrl,
          timeout: 300_000,
        },
        models: {
          [connection.model]: {
            name: connection.model,
            tool_call: true,
            limit: { context: 128_000, output: 16_384 },
          },
        },
      },
    },
    permission,
    share: "disabled",
    autoupdate: false,
    experimental: { openTelemetry: false },
  });
}

function kiloModelReference(connection: CompanionModelConnection): string {
  return `${kiloProvider(connection)}/${connection.model}`;
}

function kiloProvider(connection: CompanionModelConnection): "anthropic" | "openai-compatible" {
  if (connection.protocol === "anthropic") return "anthropic";
  return "openai-compatible";
}

function buildKiloTask(instruction: string, accessMode: DevelopmentAccessMode): string {
  const policy = accessMode === "inspect"
    ? "只读检查，不得创建、修改、删除任何文件，也不得安装依赖或执行命令。"
    : "实际完成修改并运行最相关的构建、类型或测试检查。当前提案只支持创建和修改文件，不得删除、移动或重命名文件。";
  return [
    "你是小丑鱼应用调用的 Kilo Code 开发执行引擎。",
    policy,
    "先阅读项目内的规则和相关代码，再做判断。禁止提交、推送、切换分支或操作工作区之外的文件。",
    "最后用中文简洁说明完成内容、实际检查及仍未验证的风险。",
    "",
    "用户目标：",
    instruction.trim(),
  ].join("\n");
}

export function resolveKiloEntrypoint(start = process.cwd()): string | undefined {
  const roots = [resolve(start), resolve(__dirname, "..", "..")];
  const seen = new Set<string>();
  for (const root of roots) {
    let cursor = root;
    while (!seen.has(cursor)) {
      seen.add(cursor);
      const candidate = resolve(cursor, "node_modules", "@kilocode", "cli", "bin", "kilo");
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return undefined;
}

export function kiloDevelopmentEnvironment(): { available: boolean; version: string } {
  const entrypoint = resolveKiloEntrypoint();
  if (!entrypoint) return { available: false, version: "" };
  try {
    const packageFile = resolve(dirname(dirname(entrypoint)), "package.json");
    const value = JSON.parse(readFileSync(packageFile, "utf8")) as { version?: string };
    return { available: true, version: value.version ? `Kilo Code ${value.version}` : "Kilo Code" };
  } catch {
    return { available: true, version: "Kilo Code" };
  }
}

async function runKiloProcess(input: {
  entrypoint: string;
  cwd: string;
  runHome: string;
  task: string;
  config: string;
  model: string;
  agent: "ask" | "code";
  apiKey: string;
  baseEnvironment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<KiloRunOutput> {
  return new Promise((accept, reject) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    const child = spawn(process.execPath, [
      input.entrypoint,
      "run",
      "--pure",
      "--auto",
      "--format", "json",
      "--dir", input.cwd,
      "--model", input.model,
      "--agent", input.agent,
      input.task,
    ], {
      cwd: input.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...input.baseEnvironment,
        XDG_DATA_HOME: resolve(input.runHome, "data"),
        XDG_CONFIG_HOME: resolve(input.runHome, "config"),
        XDG_CACHE_HOME: resolve(input.runHome, "cache"),
        XDG_STATE_HOME: resolve(input.runHome, "state"),
        KILO_CONFIG_CONTENT: input.config,
        KILO_DISABLE_AUTOUPDATE: "1",
        CLOWNFISH_KILO_API_KEY: input.apiKey,
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
      else accept(parseKiloOutput(redactCredential(stdout.toString("utf8"), input.apiKey)));
    };
    const abort = () => {
      child.kill();
      finish(new Error("Kilo Code 任务已取消。"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Kilo Code 运行超过 30 分钟，已停止本轮任务。"));
    }, MAX_RUN_MS);
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(new Error(`Kilo Code 无法启动：${error.message}`)));
    child.once("close", (code) => {
      const raw = redactCredential(stdout.toString("utf8"), input.apiKey);
      const detail = redactCredential(stderr.toString("utf8").trim(), input.apiKey);
      if (code !== 0) {
        finish(new Error(`Kilo Code 执行失败（退出码 ${code ?? "未知"}）：${(detail || raw || "没有返回错误详情").slice(0, 4_000)}`));
        return;
      }
      try {
        const parsed = parseKiloOutput(raw);
        if (!parsed.reply) throw new Error("Kilo Code 已结束，但没有返回可交付结果。");
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export function parseKiloOutput(raw: string): KiloRunOutput {
  const replies: string[] = [];
  const telemetry: Record<string, number> = {};
  let sessionId: string | undefined;
  let toolCalls = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; sessionID?: unknown; part?: { text?: unknown } };
      const type = typeof event.type === "string" ? event.type : "kilo/event";
      telemetry[type] = (telemetry[type] ?? 0) + 1;
      if (typeof event.sessionID === "string") sessionId = event.sessionID;
      if (type === "tool_use") toolCalls += 1;
      if (type === "text" && typeof event.part?.text === "string" && event.part.text.trim()) replies.push(event.part.text.trim());
    } catch {
      telemetry["kilo/unparsed"] = (telemetry["kilo/unparsed"] ?? 0) + 1;
    }
  }
  return { reply: replies.join("\n\n").trim(), sessionId, toolCalls, telemetry };
}

async function gitStatusSnapshot(workspace: string): Promise<string> {
  return new Promise((accept) => {
    const child = spawn("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: workspace,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", () => accept(""));
    child.once("close", (code) => accept(code === 0 ? stdout : ""));
  });
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

function redactCredential(value: string, credential: string): string {
  if (!credential || credential === "local-model") return value;
  return value.split(credential).join("[已隐藏密钥]");
}
