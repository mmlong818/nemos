import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import type { CompanionModelConnection } from "./model-connection.js";

const execFileAsync = promisify(execFile);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

export type DevelopmentAccessMode = "inspect" | "develop";

export interface PiDevelopmentInput {
  workspacePath: string;
  instruction: string;
  accessMode: DevelopmentAccessMode;
  connection: CompanionModelConnection;
  agentDir: string;
  signal?: AbortSignal;
  onProgress?: (message: string, percent: number) => void;
}

export interface PiDevelopmentResult {
  reply: string;
  workspacePath: string;
  accessMode: DevelopmentAccessMode;
  changedFiles: string[];
  toolCalls: number;
}

type PiModule = typeof import("@earendil-works/pi-coding-agent");

export async function runPiDevelopment(input: PiDevelopmentInput): Promise<PiDevelopmentResult> {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("开发能力需要 Node.js 22.19 或更高版本。");
  const workspace = validateDevelopmentWorkspace(input.workspacePath);
  mkdirSync(input.agentDir, { recursive: true });
  input.onProgress?.("正在读取项目规则和目录", 12);

  const pi = await nativeImport<PiModule>("@earendil-works/pi-coding-agent");
  const modelRuntime = await pi.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
  const providerId = "clownfish-model";
  modelRuntime.registerProvider(providerId, {
    name: "小丑鱼模型连接",
    baseUrl: input.connection.baseUrl,
    api: input.connection.protocol === "anthropic" ? "anthropic-messages" : "openai-completions",
    models: [{
      id: input.connection.model,
      name: input.connection.model,
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    }],
  });
  await modelRuntime.setRuntimeApiKey(providerId, input.connection.apiKey || "local-model");
  const model = modelRuntime.getModel(providerId, input.connection.model);
  if (!model) throw new Error("开发能力无法使用当前模型连接。");

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: workspace,
    agentDir: input.agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: developmentSystemPrompt(workspace, input.accessMode),
  });
  await resourceLoader.reload();
  const { session } = await pi.createAgentSession({
    cwd: workspace,
    agentDir: input.agentDir,
    modelRuntime,
    model,
    thinkingLevel: "medium",
    noTools: "builtin",
    customTools: createDevelopmentTools(workspace, input.accessMode) as never,
    resourceLoader,
    sessionManager: pi.SessionManager.inMemory(workspace),
  });

  let toolCalls = 0;
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "tool_execution_start") return;
    toolCalls += 1;
    input.onProgress?.(`正在执行：${developmentToolLabel(String(event.toolName || ""))}`, Math.min(78, 22 + toolCalls * 8));
  });
  const abort = () => { void session.abort(); };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    input.onProgress?.(input.accessMode === "inspect" ? "正在检查项目" : "正在开发并验证", 20);
    await session.prompt(buildDevelopmentPrompt(input.instruction, workspace, input.accessMode), { source: "sdk" });
    if (toolCalls === 0) throw new Error("开发能力未实际读取项目，已拒绝把模型文字当作执行结果。");
    const reply = lastAssistantText(session.messages);
    if (!reply) throw new Error("开发能力没有生成可交付结果。");
    input.onProgress?.("正在整理修改和验证结果", 88);
    return { reply, workspacePath: workspace, accessMode: input.accessMode, changedFiles: await changedFiles(workspace), toolCalls };
  } finally {
    input.signal?.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}

export function validateDevelopmentWorkspace(value: string): string {
  const requested = String(value || "").trim();
  if (!requested || !isAbsolute(requested)) throw new Error("请填写完整的项目文件夹路径。");
  if (!existsSync(requested) || !statSync(requested).isDirectory()) throw new Error("项目文件夹不存在或无法访问。");
  const workspace = realpathSync(resolve(requested));
  if (workspace.toLowerCase() === parse(workspace).root.toLowerCase()) throw new Error("不能把整个磁盘作为开发范围。");
  if (workspace.toLowerCase() === realpathSync(homedir()).toLowerCase()) throw new Error("不能把整个用户目录作为开发范围。");
  return workspace;
}

function createDevelopmentTools(workspace: string, accessMode: DevelopmentAccessMode): Array<Record<string, unknown>> {
  const readOnlyTools = [
    {
      name: "list_files", label: "查看文件",
      description: "List project files under a relative directory. Dependencies and build outputs are skipped.",
      parameters: Type.Object({ path: Type.Optional(Type.String()), depth: Type.Optional(Type.Number({ minimum: 1, maximum: 5 })) }),
      execute: async (_id: string, params: { path?: string; depth?: number }) => textResult(listWorkspaceFiles(workspace, params.path || ".", params.depth || 3)),
    },
    {
      name: "read_file", label: "读取文件",
      description: "Read a UTF-8 text file inside the selected project.",
      parameters: Type.Object({ path: Type.String(), startLine: Type.Optional(Type.Number({ minimum: 1 })), endLine: Type.Optional(Type.Number({ minimum: 1 })) }),
      execute: async (_id: string, params: { path: string; startLine?: number; endLine?: number }) => textResult(readWorkspaceFile(workspace, params)),
    },
    {
      name: "search_text", label: "搜索代码",
      description: "Search text in project files and return matching file names and line numbers.",
      parameters: Type.Object({ query: Type.String({ minLength: 1 }), path: Type.Optional(Type.String()) }),
      execute: async (_id: string, params: { query: string; path?: string }) => textResult(searchWorkspaceText(workspace, params.query, params.path || ".")),
    },
    {
      name: "run_check", label: "运行检查",
      description: "Run one approved project inspection or verification command in the selected project.",
      parameters: Type.Object({ command: Type.Union([
        Type.Literal("git_status"), Type.Literal("git_diff"), Type.Literal("npm_test"), Type.Literal("npm_build"), Type.Literal("npm_typecheck"), Type.Literal("npm_check"),
        Type.Literal("pnpm_test"), Type.Literal("pnpm_build"), Type.Literal("pnpm_typecheck"), Type.Literal("pnpm_check"), Type.Literal("pytest"), Type.Literal("dotnet_test"), Type.Literal("cargo_test"), Type.Literal("cargo_check"),
      ]) }),
      execute: async (_id: string, params: { command: DevelopmentCheck }) => textResult(await runDevelopmentCheck(workspace, params.command)),
    },
  ];
  if (accessMode === "inspect") return readOnlyTools;
  return [...readOnlyTools,
    {
      name: "edit_file", label: "修改文件",
      description: "Replace one exact, unique text block in a project file. Use this for precise edits.",
      parameters: Type.Object({ path: Type.String(), oldText: Type.String({ minLength: 1 }), newText: Type.String() }),
      execute: async (_id: string, params: { path: string; oldText: string; newText: string }) => textResult(editWorkspaceFile(workspace, params)),
    },
    {
      name: "write_file", label: "写入文件",
      description: "Create or fully replace one text file inside the selected project. Prefer edit_file for existing files.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id: string, params: { path: string; content: string }) => textResult(writeWorkspaceFile(workspace, params.path, params.content)),
    },
  ];
}

function developmentSystemPrompt(workspace: string, mode: DevelopmentAccessMode): string {
  return [
    "你是小丑鱼的独立开发能力，负责在用户明确选择的项目范围内完成真实的软件工作。",
    `项目范围：${workspace}`,
    `权限：${mode === "develop" ? "允许读取、精确修改、创建文本文件并运行受控检查" : "只读检查，不得修改文件"}。`,
    "先阅读项目规则与相关文件，再定位根因或实现位置；保持修改精准，不重写无关代码。",
    "必须使用工具取得证据，不能假装读取、修改、构建或测试过。",
    "不得访问项目范围外的路径，不得读取密钥文件，不得删除文件、改写 Git 历史、推送、发布、部署或发送外部消息。",
    "开发模式下，完成修改后运行最相关的检查。检查失败时继续修复，直到通过或说明真实阻碍。",
    "最终用中文交付：完成了什么、关键修改、验证结果、未验证项和剩余风险。不要输出寒暄。",
  ].join("\n");
}

function buildDevelopmentPrompt(instruction: string, workspace: string, mode: DevelopmentAccessMode): string {
  return [
    `用户任务：\n${instruction.trim()}`, "", `工作目录：${workspace}`,
    `本次模式：${mode === "develop" ? "开发并验证" : "只读检查"}`,
    "完整完成本次任务。若输入中包含上一步能力的原文与提要，把它们作为需求和材料继承，不要要求用户重复说明。",
  ].join("\n");
}

function resolveWorkspacePath(workspace: string, value: string, allowMissing = false): string {
  const candidate = resolve(workspace, String(value || "."));
  const rel = relative(workspace, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("路径超出所选项目范围。");
  if (isSensitivePath(rel)) throw new Error("该文件可能包含密钥或私人凭证，开发能力不会读取或改写它。");
  if (existsSync(candidate)) {
    const real = realpathSync(candidate);
    const realRel = relative(workspace, real);
    if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) throw new Error("符号链接指向项目范围之外。");
    return real;
  }
  if (!allowMissing) throw new Error("文件不存在。");
  const realParent = realpathSync(nearestExistingParent(dirname(candidate)));
  const parentRel = relative(workspace, realParent);
  if (parentRel === ".." || parentRel.startsWith(`..${sep}`) || isAbsolute(parentRel)) throw new Error("目标路径超出项目范围。");
  return candidate;
}

function isSensitivePath(value: string): boolean {
  return value.replace(/\\/g, "/").toLowerCase().split("/").some((part) => {
    if (/^\.env(?:\..+)?$/.test(part) && !/(example|sample|template)$/.test(part)) return true;
    return /^(id_rsa|id_ed25519|credentials\.json|auth\.json)$/.test(part) || /\.(pem|p12|pfx|key)$/.test(part);
  });
}

function nearestExistingParent(start: string): string {
  let current = start;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function listWorkspaceFiles(workspace: string, path: string, depth: number): string {
  const start = resolveWorkspacePath(workspace, path);
  if (!statSync(start).isDirectory()) throw new Error("所选路径不是文件夹。");
  const lines: string[] = [];
  const walk = (dir: string, level: number): void => {
    if (lines.length >= 500 || level > depth) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const file = join(dir, entry.name);
      lines.push(relative(workspace, file).replace(/\\/g, "/") + (entry.isDirectory() ? "/" : ""));
      if (entry.isDirectory()) walk(file, level + 1);
      if (lines.length >= 500) break;
    }
  };
  walk(start, 1);
  return lines.join("\n") || "（空文件夹）";
}

function readWorkspaceFile(workspace: string, params: { path: string; startLine?: number; endLine?: number }): string {
  const file = resolveWorkspacePath(workspace, params.path);
  if (!statSync(file).isFile()) throw new Error("所选路径不是文件。");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const start = Math.max(1, params.startLine || 1);
  const end = Math.min(lines.length, params.endLine || Math.min(lines.length, start + 499));
  return lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n").slice(0, 120_000);
}

function searchWorkspaceText(workspace: string, query: string, path: string): string {
  const start = resolveWorkspacePath(workspace, path);
  const results: string[] = [];
  const visit = (file: string): void => {
    if (results.length >= 200) return;
    const info = statSync(file);
    if (info.isDirectory()) {
      for (const entry of readdirSync(file, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name))) continue;
        visit(join(file, entry.name));
        if (results.length >= 200) break;
      }
      return;
    }
    if (!info.isFile() || info.size > 1_000_000 || isSensitivePath(relative(workspace, file))) return;
    let raw = "";
    try { raw = readFileSync(file, "utf8"); } catch { return; }
    raw.split(/\r?\n/).forEach((line, index) => {
      if (results.length < 200 && line.toLowerCase().includes(query.toLowerCase())) {
        results.push(`${relative(workspace, file).replace(/\\/g, "/")}:${index + 1}: ${line.trim().slice(0, 260)}`);
      }
    });
  };
  visit(start);
  return results.join("\n") || "没有找到匹配内容。";
}

function editWorkspaceFile(workspace: string, params: { path: string; oldText: string; newText: string }): string {
  const file = resolveWorkspacePath(workspace, params.path);
  const raw = readFileSync(file, "utf8");
  const first = raw.indexOf(params.oldText);
  if (first < 0) throw new Error("没有找到要替换的原文，请先重新读取文件。");
  if (raw.indexOf(params.oldText, first + params.oldText.length) >= 0) throw new Error("要替换的原文出现多次，请提供更完整的唯一片段。");
  const next = raw.slice(0, first) + params.newText + raw.slice(first + params.oldText.length);
  if (next.length > 2_000_000) throw new Error("修改后的文件过大，已停止写入。");
  writeFileSync(file, next, "utf8");
  return `已修改 ${relative(workspace, file).replace(/\\/g, "/")}`;
}

function writeWorkspaceFile(workspace: string, path: string, content: string): string {
  if (content.length > 500_000) throw new Error("单次写入内容过大。");
  const file = resolveWorkspacePath(workspace, path, true);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return `已写入 ${relative(workspace, file).replace(/\\/g, "/")}`;
}

type DevelopmentCheck = "git_status" | "git_diff" | "npm_test" | "npm_build" | "npm_typecheck" | "npm_check" | "pnpm_test" | "pnpm_build" | "pnpm_typecheck" | "pnpm_check" | "pytest" | "dotnet_test" | "cargo_test" | "cargo_check";

async function runDevelopmentCheck(workspace: string, command: DevelopmentCheck): Promise<string> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const commands: Record<DevelopmentCheck, [string, string[]]> = {
    git_status: ["git", ["status", "--short"]], git_diff: ["git", ["diff", "--"]],
    npm_test: [npm, ["test", "--"]], npm_build: [npm, ["run", "build"]], npm_typecheck: [npm, ["run", "typecheck"]], npm_check: [npm, ["run", "check"]],
    pnpm_test: [pnpm, ["test"]], pnpm_build: [pnpm, ["build"]], pnpm_typecheck: [pnpm, ["typecheck"]], pnpm_check: [pnpm, ["check"]],
    pytest: ["pytest", []], dotnet_test: ["dotnet", ["test"]], cargo_test: ["cargo", ["test"]], cargo_check: ["cargo", ["check"]],
  };
  const [file, args] = commands[command];
  try {
    const result = await execFileAsync(file, args, { cwd: workspace, windowsHide: true, timeout: 120_000, maxBuffer: 1_500_000 });
    return [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "检查通过（无额外输出）。";
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string };
    return [`检查失败：${detail.message}`, detail.stdout, detail.stderr].filter(Boolean).join("\n").slice(0, 1_500_000);
  }
}

async function changedFiles(workspace: string): Promise<string[]> {
  try {
    const result = await execFileAsync("git", ["status", "--short"], { cwd: workspace, windowsHide: true, timeout: 10_000, maxBuffer: 300_000 });
    return result.stdout.split(/\r?\n/).map((line) => line.slice(3).trim()).filter(Boolean).slice(0, 200);
  } catch {
    return [];
  }
}

function lastAssistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown };
    if (message?.role !== "assistant") continue;
    if (typeof message.content === "string") return message.content.trim();
    if (!Array.isArray(message.content)) continue;
    const text = message.content.map((part) => {
      if (!part || typeof part !== "object") return "";
      const block = part as { type?: string; text?: string };
      return block.type === "text" ? block.text || "" : "";
    }).join("").trim();
    if (text) return text;
  }
  return "";
}

function developmentToolLabel(name: string): string {
  return ({ list_files: "查看目录", read_file: "读取文件", search_text: "搜索代码", edit_file: "修改文件", write_file: "写入文件", run_check: "运行检查" } as Record<string, string>)[name] || name;
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

function nativeImport<T>(specifier: string): Promise<T> {
  return Function("specifier", "return import(specifier)")(specifier) as Promise<T>;
}
