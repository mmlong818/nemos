import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { CompanionModelConnection } from "./model-connection.js";
import type { DevelopmentReasoning } from "./capabilities.js";
import {
  runExternalDevelopment,
  type ExternalDevelopmentInput,
  type ExternalEngineRunOutput,
} from "./external-development-engine.js";
import {
  currentDevelopmentRevision,
  detectDevelopmentChecks,
  developmentFileReceipt,
  developmentRisks,
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
import type { DevelopmentApprovalPolicy } from "./development-approval.js";

const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_RUN_MS = 30 * 60_000;
const execFileAsync = promisify(execFile);
const READ_ONLY_CHECKS = new Set<DevelopmentCheck>(["git_status", "git_diff"]);

export type CodexDevelopmentInput = ExternalDevelopmentInput;

export function runCodexDevelopment(input: CodexDevelopmentInput): Promise<PiDevelopmentResult> {
  if (input.connection.protocol !== "openai-compatible") {
    throw new Error("Codex CLI 目前只支持 Responses API 兼容连接；当前模型连接是 Anthropic 协议，请改用 Pi Agent、DeepSeek Harness、Kilo Code 或 OpenCode。");
  }
  const entrypoint = resolveCodexEntrypoint();
  if (!entrypoint) throw new Error("Codex CLI 尚未安装完整，请重新安装小丑鱼项目依赖。");
  if (input.approvalPolicy === "full") return runCodexFullControl(input, entrypoint);
  return runExternalDevelopment(input, {
    id: "codex",
    name: "Codex",
    run: ({ workspace, runHome, instruction, accessMode, connection, reasoning, signal }) => runCodexProcess({
      entrypoint,
      workspace,
      runHome,
      task: buildCodexTask(instruction, accessMode),
      accessMode,
      approvalPolicy: input.approvalPolicy ?? "request",
      connection,
      reasoning,
      signal,
    }),
  });
}

export function buildCodexConfig(
  connection: CompanionModelConnection,
  accessMode: DevelopmentAccessMode,
  approvalPolicy: DevelopmentApprovalPolicy = "request",
  reasoning: DevelopmentReasoning = "balanced",
): string {
  const sandbox = approvalPolicy === "full" ? "danger-full-access" : accessMode === "inspect" ? "read-only" : "workspace-write";
  return [
    `model = ${tomlString(connection.model)}`,
    `model_reasoning_effort = ${tomlString(reasoning === "fast" ? "low" : reasoning === "deep" ? "high" : "medium")}`,
    'model_provider = "clownfish"',
    'approval_policy = "never"',
    `sandbox_mode = ${tomlString(sandbox)}`,
    'web_search = "disabled"',
    "disable_response_storage = true",
    "",
    "[model_providers.clownfish]",
    'name = "小丑鱼模型连接"',
    `base_url = ${tomlString(connection.baseUrl)}`,
    'env_key = "CLOWNFISH_CODEX_API_KEY"',
    'wire_api = "responses"',
    "request_max_retries = 2",
    "stream_max_retries = 2",
    "stream_idle_timeout_ms = 300000",
    "",
  ].join("\n");
}

function buildCodexTask(
  instruction: string,
  accessMode: DevelopmentAccessMode,
  approvalPolicy: DevelopmentApprovalPolicy = "request",
): string {
  const policy = accessMode === "inspect"
    ? "只读检查，不得创建、修改、删除任何文件，也不得安装依赖或执行会改变项目状态的命令。"
    : approvalPolicy === "full"
      ? "直接在当前项目完成修改并运行最相关的构建、类型或测试检查。可以按任务需要创建、修改、删除、移动或重命名项目文件。"
      : "实际完成修改并运行最相关的构建、类型或测试检查。当前提案只支持创建和修改文件，不得删除、移动或重命名文件。";
  return [
    "你是小丑鱼应用调用的 Codex 开发执行引擎。",
    policy,
    "先阅读项目内的规则和相关代码。禁止提交、推送、切换分支或操作工作区之外的文件。",
    "最后用中文简洁说明完成内容、实际检查及仍未验证的风险。",
    "",
    "用户目标：",
    instruction.trim(),
  ].join("\n");
}

async function runCodexFullControl(input: CodexDevelopmentInput, entrypoint: string): Promise<PiDevelopmentResult> {
  if (input.accessMode !== "develop") throw new Error("完全控制只适用于修改项目；只读检查不需要更改权限。");
  const workspace = validateDevelopmentWorkspace(input.workspacePath);
  const baseRevision = await requireCleanGitWorkspace(workspace);
  const runId = `codex-full-${randomUUID()}`;
  const runHome = resolve(input.agentDir, "runs", runId);
  mkdirSync(runHome, { recursive: true });

  const dependencyReceipts = await installCodexDependenciesIfRequested(input, workspace);
  input.onProgress?.("Codex 正在直接处理当前项目", 20);
  let output: ExternalEngineRunOutput;
  try {
    output = await runCodexProcess({
      entrypoint,
      workspace,
      runHome,
      task: buildCodexTask(input.instruction, "develop", "full"),
      accessMode: "develop",
      approvalPolicy: "full",
      connection: input.connection,
      reasoning: input.reasoning === "fast" ? "fast" : input.reasoning === "deep" ? "deep" : "balanced",
      signal: input.signal,
    });
  } catch (error) {
    throw new Error(`Codex 完全控制运行未完成；项目中可能已经存在部分修改，请先查看 Git 差异。${error instanceof Error ? ` ${error.message}` : ""}`);
  }

  input.onProgress?.("正在核对修改并运行项目检查", 84);
  const checks: DevelopmentCheckReceipt[] = [];
  const plannedChecks = detectDevelopmentChecks(workspace, "develop")
    .filter((check) => !READ_ONLY_CHECKS.has(check))
    .slice(0, 4);
  for (const check of plannedChecks) checks.push(await runDevelopmentCheck(workspace, check));
  const changedFiles = await directWorkspaceChanges(workspace, baseRevision);
  return {
    reply: output.reply,
    workspacePath: workspace,
    accessMode: "develop",
    approvalPolicy: "full",
    changedFiles,
    baseRevision,
    fileReceipts: changedFiles.map((path) => developmentFileReceipt(workspace, path)),
    checks,
    contextReceipts: [workspaceContextReceipt(workspace)],
    unverifiedRisks: developmentRisks("develop", checks),
    toolCalls: output.toolCalls,
    sessionId: output.sessionId || runId,
    sessionFile: output.sessionFile,
    sessionResumed: false,
    loadedSkills: 0,
    loadedPromptTemplates: 0,
    telemetry: output.telemetry,
    dependencyReceipts,
    isolatedWorkspace: false,
  };
}

async function requireCleanGitWorkspace(workspace: string): Promise<string> {
  const baseRevision = await currentDevelopmentRevision(workspace);
  if (!baseRevision) throw new Error("完全控制只允许在可回退的 Git 项目中使用；请先初始化并提交项目。");
  const status = await gitOutput(workspace, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.trim()) throw new Error("完全控制只允许从干净的 Git 项目开始；请先提交或处理现有修改。");
  return baseRevision;
}

async function installCodexDependenciesIfRequested(
  input: CodexDevelopmentInput,
  workspace: string,
): Promise<DevelopmentDependencyReceipt[]> {
  if (!input.installDependencies) return [];
  const plans = detectDevelopmentDependencies(workspace).filter((plan) => plan.needed);
  if (!plans.length) return [];
  input.onProgress?.(`正在补齐 ${plans.map((plan) => plan.ecosystem).join("、")} 项目依赖`, 8);
  const receipts = await installDevelopmentDependencies(workspace, plans);
  const failed = receipts.find((receipt) => !receipt.passed);
  if (failed) throw new Error(`${failed.label}失败：${failed.output.slice(0, 800)}`);
  return receipts;
}

async function directWorkspaceChanges(workspace: string, baseRevision: string): Promise<string[]> {
  const tracked = await gitOutput(workspace, ["diff", "--name-only", "--no-renames", "-z", baseRevision, "--"]);
  const untracked = await gitOutput(workspace, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set([...tracked.split("\0"), ...untracked.split("\0")].map((path) => path.trim()).filter(Boolean))].slice(0, 200);
}

async function gitOutput(workspace: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: workspace,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1_500_000,
    encoding: "utf8",
  });
  return String(result.stdout || "");
}

function workspaceContextReceipt(workspace: string): DevelopmentContextReceipt {
  const entries = readdirSync(workspace, { withFileTypes: true }).filter((entry) => entry.name !== ".git");
  return {
    kind: "directory",
    path: ".",
    anchor: entries.slice(0, 40).map((entry) => `${entry.isDirectory() ? "目录" : "文件"}:${entry.name}`).join(" | ") || "空目录",
    confidence: "exact",
    truncated: entries.length > 40,
  };
}

export function resolveCodexEntrypoint(start = process.cwd()): string | undefined {
  const seen = new Set<string>();
  for (const root of [resolve(start), resolve(__dirname, "..", "..")]) {
    let cursor = root;
    while (!seen.has(cursor)) {
      seen.add(cursor);
      const candidate = resolve(cursor, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return undefined;
}

export function codexDevelopmentEnvironment(): { available: boolean; version: string } {
  const entrypoint = resolveCodexEntrypoint();
  if (!entrypoint) return { available: false, version: "" };
  try {
    const packageFile = resolve(dirname(dirname(entrypoint)), "package.json");
    const value = JSON.parse(readFileSync(packageFile, "utf8")) as { version?: string };
    return { available: true, version: value.version ? `Codex ${value.version}` : "Codex" };
  } catch {
    return { available: true, version: "Codex" };
  }
}

async function runCodexProcess(input: {
  entrypoint: string;
  workspace: string;
  runHome: string;
  task: string;
  accessMode: DevelopmentAccessMode;
  approvalPolicy: DevelopmentApprovalPolicy;
  connection: CompanionModelConnection;
  reasoning: DevelopmentReasoning;
  signal?: AbortSignal;
}): Promise<ExternalEngineRunOutput> {
  mkdirSync(input.runHome, { recursive: true });
  writeFileSync(resolve(input.runHome, "config.toml"), buildCodexConfig(input.connection, input.accessMode, input.approvalPolicy, input.reasoning), "utf8");
  const sandbox = input.approvalPolicy === "full" ? "danger-full-access" : input.accessMode === "inspect" ? "read-only" : "workspace-write";
  return new Promise((accept, reject) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    const child = spawn(process.execPath, [
      input.entrypoint,
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox", sandbox,
      "--cd", input.workspace,
      "--skip-git-repo-check",
      "--model", input.connection.model,
      input.task,
    ], {
      cwd: input.workspace,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_HOME: input.runHome,
        CLOWNFISH_CODEX_API_KEY: input.connection.apiKey || "local-model",
      },
    });
    const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>) => {
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
      else accept(parseCodexOutput(redactCredential(stdout.toString("utf8"), input.connection.apiKey)));
    };
    const abort = () => { child.kill(); finish(new Error("Codex 任务已取消。")); };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Codex 运行超过 30 分钟，已停止本轮任务。")); }, MAX_RUN_MS);
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(new Error(`Codex 无法启动：${error.message}`)));
    child.once("close", (code) => {
      const raw = redactCredential(stdout.toString("utf8"), input.connection.apiKey);
      const detail = redactCredential(stderr.toString("utf8").trim(), input.connection.apiKey);
      if (code !== 0) return finish(new Error(`Codex 执行失败（退出码 ${code ?? "未知"}）：${(detail || raw || "没有返回错误详情").slice(0, 4_000)}`));
      try {
        if (!parseCodexOutput(raw).reply) throw new Error("Codex 已结束，但没有返回可交付结果。");
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export function parseCodexOutput(raw: string): ExternalEngineRunOutput {
  const replies: string[] = [];
  const telemetry: Record<string, number> = {};
  let sessionId: string | undefined;
  let toolCalls = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; thread_id?: unknown; item?: { type?: unknown; text?: unknown } };
      const type = typeof event.type === "string" ? event.type : "codex/event";
      telemetry[type] = (telemetry[type] ?? 0) + 1;
      if (typeof event.thread_id === "string") sessionId = event.thread_id;
      const itemType = typeof event.item?.type === "string" ? event.item.type : "";
      if (type === "item.completed" && ["command_execution", "file_change", "mcp_tool_call"].includes(itemType)) toolCalls += 1;
      if (type === "item.completed" && itemType === "agent_message" && typeof event.item?.text === "string" && event.item.text.trim()) {
        replies.push(event.item.text.trim());
      }
    } catch {
      telemetry["codex/unparsed"] = (telemetry["codex/unparsed"] ?? 0) + 1;
    }
  }
  return { reply: replies.join("\n\n").trim(), sessionId, toolCalls, telemetry };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function redactCredential(value: string, credential: string): string {
  if (!credential || credential === "local-model") return value;
  return value.split(credential).join("[已隐藏密钥]");
}
