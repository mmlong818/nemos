import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CompanionModelConnection } from "./model-connection.js";
import {
  runExternalDevelopment,
  type ExternalDevelopmentInput,
  type ExternalEngineRunOutput,
} from "./external-development-engine.js";
import type { DevelopmentAccessMode, PiDevelopmentResult } from "./pi-development.js";

const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_RUN_MS = 30 * 60_000;

export type OpenCodeDevelopmentInput = ExternalDevelopmentInput;

export function runOpenCodeDevelopment(input: OpenCodeDevelopmentInput): Promise<PiDevelopmentResult> {
  const entrypoint = resolveOpenCodeEntrypoint();
  if (!entrypoint) throw new Error("OpenCode 尚未安装完整，请重新安装小丑鱼项目依赖。");
  return runExternalDevelopment(input, {
    id: "opencode",
    name: "OpenCode",
    run: ({ workspace, runHome, instruction, accessMode, connection, signal }) => runOpenCodeProcess({
      entrypoint,
      workspace,
      runHome,
      task: buildOpenCodeTask(instruction, accessMode),
      accessMode,
      connection,
      signal,
    }),
  });
}

export function buildOpenCodeConfig(connection: CompanionModelConnection, accessMode: DevelopmentAccessMode): string {
  const provider = "clownfish";
  const permission = accessMode === "inspect"
    ? { "*": "allow", edit: "deny", bash: "deny", external_directory: "deny", webfetch: "deny", websearch: "deny", task: "deny" }
    : { "*": "allow", external_directory: "deny" };
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: `${provider}/${connection.model}`,
    provider: {
      [provider]: {
        npm: connection.protocol === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible",
        name: "小丑鱼模型连接",
        options: {
          apiKey: "{env:CLOWNFISH_OPENCODE_API_KEY}",
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
  });
}

function buildOpenCodeTask(instruction: string, accessMode: DevelopmentAccessMode): string {
  const policy = accessMode === "inspect"
    ? "只读检查，不得创建、修改、删除任何文件，也不得安装依赖或执行命令。"
    : "实际完成修改并运行最相关的构建、类型或测试检查。当前提案只支持创建和修改文件，不得删除、移动或重命名文件。";
  return [
    "你是小丑鱼应用调用的 OpenCode 开发执行引擎。",
    policy,
    "先阅读项目内的规则和相关代码。禁止提交、推送、切换分支或操作工作区之外的文件。",
    "最后用中文简洁说明完成内容、实际检查及仍未验证的风险。",
    "",
    "用户目标：",
    instruction.trim(),
  ].join("\n");
}

export function resolveOpenCodeEntrypoint(start = process.cwd()): string | undefined {
  const seen = new Set<string>();
  for (const root of [resolve(start), resolve(__dirname, "..", "..")]) {
    let cursor = root;
    while (!seen.has(cursor)) {
      seen.add(cursor);
      const candidate = resolve(cursor, "node_modules", "opencode-ai", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return undefined;
}

export function openCodeDevelopmentEnvironment(): { available: boolean; version: string } {
  const entrypoint = resolveOpenCodeEntrypoint();
  if (!entrypoint) return { available: false, version: "" };
  try {
    const packageFile = resolve(dirname(dirname(entrypoint)), "package.json");
    const value = JSON.parse(readFileSync(packageFile, "utf8")) as { version?: string };
    return { available: true, version: value.version ? `OpenCode ${value.version}` : "OpenCode" };
  } catch {
    return { available: true, version: "OpenCode" };
  }
}

async function runOpenCodeProcess(input: {
  entrypoint: string;
  workspace: string;
  runHome: string;
  task: string;
  accessMode: DevelopmentAccessMode;
  connection: CompanionModelConnection;
  signal?: AbortSignal;
}): Promise<ExternalEngineRunOutput> {
  for (const name of ["data", "config", "cache", "state"]) mkdirSync(resolve(input.runHome, name), { recursive: true });
  const configFile = resolve(input.runHome, "config", "opencode.json");
  writeFileSync(configFile, buildOpenCodeConfig(input.connection, input.accessMode), "utf8");
  return new Promise((accept, reject) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    const child = spawn(input.entrypoint, [
      "run",
      "--auto",
      "--format", "json",
      "--dir", input.workspace,
      "--model", `clownfish/${input.connection.model}`,
      "--agent", input.accessMode === "inspect" ? "plan" : "build",
      input.task,
    ], {
      cwd: input.workspace,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        XDG_DATA_HOME: resolve(input.runHome, "data"),
        XDG_CONFIG_HOME: resolve(input.runHome, "config"),
        XDG_CACHE_HOME: resolve(input.runHome, "cache"),
        XDG_STATE_HOME: resolve(input.runHome, "state"),
        OPENCODE_CONFIG: configFile,
        CLOWNFISH_OPENCODE_API_KEY: input.connection.apiKey || "local-model",
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
      else accept(parseOpenCodeOutput(redactCredential(stdout.toString("utf8"), input.connection.apiKey)));
    };
    const abort = () => { child.kill(); finish(new Error("OpenCode 任务已取消。")); };
    const timer = setTimeout(() => { child.kill(); finish(new Error("OpenCode 运行超过 30 分钟，已停止本轮任务。")); }, MAX_RUN_MS);
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(new Error(`OpenCode 无法启动：${error.message}`)));
    child.once("close", (code) => {
      const raw = redactCredential(stdout.toString("utf8"), input.connection.apiKey);
      const detail = redactCredential(stderr.toString("utf8").trim(), input.connection.apiKey);
      if (code !== 0) return finish(new Error(`OpenCode 执行失败（退出码 ${code ?? "未知"}）：${(detail || raw || "没有返回错误详情").slice(0, 4_000)}`));
      try {
        if (!parseOpenCodeOutput(raw).reply) throw new Error("OpenCode 已结束，但没有返回可交付结果。");
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export function parseOpenCodeOutput(raw: string): ExternalEngineRunOutput {
  const replies: string[] = [];
  const telemetry: Record<string, number> = {};
  let sessionId: string | undefined;
  let toolCalls = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; sessionID?: unknown; session_id?: unknown; part?: { type?: unknown; text?: unknown } };
      const type = typeof event.type === "string" ? event.type : "opencode/event";
      telemetry[type] = (telemetry[type] ?? 0) + 1;
      if (typeof event.sessionID === "string") sessionId = event.sessionID;
      else if (typeof event.session_id === "string") sessionId = event.session_id;
      if (type.includes("tool") || event.part?.type === "tool") toolCalls += 1;
      if (typeof event.part?.text === "string" && event.part.text.trim()) replies.push(event.part.text.trim());
    } catch {
      telemetry["opencode/unparsed"] = (telemetry["opencode/unparsed"] ?? 0) + 1;
    }
  }
  return { reply: replies.join("\n\n").trim(), sessionId, toolCalls, telemetry };
}

function redactCredential(value: string, credential: string): string {
  if (!credential || credential === "local-model") return value;
  return value.split(credential).join("[已隐藏密钥]");
}
