import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";

import {
  AgentCredentialProxy,
  type AgentCredentialBinding,
  type AgentCredentialLease,
} from "./credential-proxy.js";
import {
  createMcpExtensionProvider,
  type AgentExtensionManifest,
  type AgentExtensionProvider,
  type AgentExtensionSandbox,
  type McpClientAdapter,
  type McpRemoteTool,
} from "./extensions.js";

export interface StdioMcpClientAdapterOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: string[];
  credentials?: AgentCredentialBinding[];
  credentialProvider?: (sourceEnv: string) => string | undefined;
  toolPolicy?: Record<string, Pick<McpRemoteTool, "effect" | "tags">>;
  maxSessions?: number;
  sessionIdleMs?: number;
  requestTimeoutMs?: number;
  maxBufferSize?: number;
  sandbox?: AgentExtensionSandbox;
  sandboxNodeCommand?: string;
  sandboxNodeVersion?: string;
  sandboxHostCommand?: string;
  sandboxPythonCommand?: string;
  sandboxPythonVersion?: string;
}

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  credentialLease?: AgentCredentialLease;
}

interface RunSlot {
  connection: Promise<McpConnection>;
  lastUsed: number;
  active: number;
  timer?: NodeJS.Timeout;
}

const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_SESSION_IDLE_MS = 5 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;

/**
 * Official MCP stdio client with one child process per Agent run.
 * Environment inheritance is restricted to the SDK safe defaults plus manifest-declared names.
 */
export class StdioMcpClientAdapter implements McpClientAdapter {
  private readonly runs = new Map<string, RunSlot>();
  private readonly maxSessions: number;
  private readonly sessionIdleMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxBufferSize: number;
  private readonly processSpec: { command: string; args?: string[] };
  private readonly credentialProxy?: AgentCredentialProxy;

  constructor(private readonly options: StdioMcpClientAdapterOptions) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.processSpec = createMcpProcessSpec(options);
    if (options.credentials?.length) {
      this.credentialProxy = new AgentCredentialProxy(options.credentials, {
        credentialProvider: options.credentialProvider,
      });
    }
  }

  get activeRunCount(): number {
    return this.runs.size;
  }

  /** @deprecated Use activeRunCount. */
  get activeSessionCount(): number {
    return this.activeRunCount;
  }

  async listTools(signal: AbortSignal): Promise<McpRemoteTool[]> {
    const connection = await this.openConnection(signal, "tool-discovery");
    try {
      const result = await connection.client.listTools(undefined, {
        signal,
        timeout: this.requestTimeoutMs,
        cacheMode: "bypass",
      });
      return result.tools.flatMap((tool) => {
        const policy = this.options.toolPolicy?.[tool.name];
        if (this.options.toolPolicy && !policy) return [];
        return [{
          name: tool.name,
          description: tool.description,
          inputSchema: isRecord(tool.inputSchema)
            ? tool.inputSchema
            : { type: "object", additionalProperties: true },
          effect: policy?.effect ?? "write",
          tags: policy?.tags,
        }];
      });
    } finally {
      await closeConnection(connection);
    }
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    context: { runId: string; sessionId: string; signal: AbortSignal },
  ): Promise<{ content: string; isError?: boolean; data?: unknown }> {
    if (!context.runId.trim()) throw new Error("MCP tool calls require a runId");
    if (this.options.toolPolicy && !this.options.toolPolicy[name]) {
      throw new Error("MCP tool is not allowed by the extension manifest: " + name);
    }

    const slot = this.acquireRun(context.runId, context.signal);
    try {
      const connection = await waitForSignal(slot.connection, context.signal);
      const result = await connection.client.callTool(
        { name, arguments: input },
        {
          signal: context.signal,
          timeout: this.requestTimeoutMs,
          maxTotalTimeout: this.requestTimeoutMs,
        },
      );
      return {
        content: renderMcpContent(result.content),
        isError: result.isError,
        data: result.structuredContent !== undefined ? result.structuredContent : result.content,
      };
    } catch (error) {
      await this.dropRun(context.runId, slot);
      throw error;
    } finally {
      slot.active = Math.max(0, slot.active - 1);
      if (this.runs.get(context.runId) === slot) this.touch(slot, context.runId);
    }
  }

  async close(): Promise<void> {
    const slots = [...this.runs.values()];
    this.runs.clear();
    for (const slot of slots) {
      if (slot.timer) clearTimeout(slot.timer);
    }
    await Promise.allSettled(slots.map(async (slot) => closeConnection(await slot.connection)));
    await this.credentialProxy?.close();
  }

  private acquireRun(runId: string, signal: AbortSignal): RunSlot {
    const existing = this.runs.get(runId);
    if (existing) {
      existing.active++;
      this.touch(existing, runId);
      return existing;
    }

    this.evictForCapacity();
    const slot: RunSlot = {
      connection: Promise.resolve(undefined as never),
      lastUsed: Date.now(),
      active: 1,
    };
    slot.connection = this.openConnection(signal, runId).catch((error) => {
      if (this.runs.get(runId) === slot) this.runs.delete(runId);
      throw error;
    });
    this.runs.set(runId, slot);
    this.touch(slot, runId);
    return slot;
  }

  private evictForCapacity(): void {
    if (this.runs.size < this.maxSessions) return;
    const idle = [...this.runs.entries()]
      .filter(([, slot]) => slot.active === 0)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
    if (!idle) throw new Error("MCP run capacity reached; all runs are busy");
    const [runId, slot] = idle;
    this.runs.delete(runId);
    if (slot.timer) clearTimeout(slot.timer);
    void slot.connection.then(closeConnection).catch(() => undefined);
  }

  private touch(slot: RunSlot, runId: string): void {
    slot.lastUsed = Date.now();
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      if (slot.active > 0) {
        this.touch(slot, runId);
        return;
      }
      void this.dropRun(runId, slot);
    }, this.sessionIdleMs);
    slot.timer.unref?.();
  }

  private async dropRun(runId: string, expected: RunSlot): Promise<void> {
    if (this.runs.get(runId) !== expected) return;
    this.runs.delete(runId);
    if (expected.timer) clearTimeout(expected.timer);
    try {
      await closeConnection(await expected.connection);
    } catch {
      // A failed connection has no remaining process state to preserve.
    }
  }

  private async openConnection(signal: AbortSignal, runId: string): Promise<McpConnection> {
    const credentialLease = this.credentialProxy
      ? await this.credentialProxy.acquire(runId)
      : undefined;
    const transport = new StdioClientTransport({
      command: this.processSpec.command,
      args: this.processSpec.args,
      cwd: this.options.cwd,
      env: {
        ...inheritedEnvironment(this.options.env),
        ...(credentialLease?.env ?? {}),
      },
      stderr: "ignore",
      maxBufferSize: this.maxBufferSize,
    });
    const client = new Client({ name: "nemos-companion", version: "0.2.19" });
    try {
      await client.connect(transport, { signal, timeout: this.requestTimeoutMs });
      return { client, transport, credentialLease };
    } catch (error) {
      await closeConnection({ client, transport, credentialLease });
      throw error;
    }
  }
}

export function createMcpProviderFromManifest(
  manifest: AgentExtensionManifest,
): AgentExtensionProvider | undefined {
  if (manifest.kind !== "mcp" || manifest.runtime.type !== "mcp" || !manifest.runtime.entry) return undefined;
  const toolPolicy = Object.fromEntries(manifest.tools.map((tool) => [
    tool.name,
    { effect: tool.effect, tags: tool.tags },
  ]));
  const adapter = new StdioMcpClientAdapter({
    command: manifest.runtime.entry,
    args: manifest.runtime.args,
    cwd: manifest.runtime.cwd,
    env: manifest.runtime.env,
    credentials: manifest.runtime.credentials,
    toolPolicy,
    maxSessions: manifest.runtime.maxSessions,
    sessionIdleMs: manifest.runtime.sessionIdleMs,
    requestTimeoutMs: manifest.runtime.requestTimeoutMs,
    maxBufferSize: manifest.runtime.maxBufferSize,
    sandbox: manifest.runtime.sandbox,
    sandboxNodeCommand: process.env.NEMOS_MCP_SANDBOX_NODE,
    sandboxNodeVersion: process.env.NEMOS_MCP_SANDBOX_NODE_VERSION,
    sandboxHostCommand: process.env.NEMOS_MCP_SANDBOX_HOST,
    sandboxPythonCommand: process.env.NEMOS_MCP_SANDBOX_PYTHON,
    sandboxPythonVersion: process.env.NEMOS_MCP_SANDBOX_PYTHON_VERSION,
  });
  return createMcpExtensionProvider(manifest.id, adapter);
}

function createMcpProcessSpec(options: StdioMcpClientAdapterOptions): { command: string; args?: string[] } {
  const sandbox = options.sandbox;
  if (!sandbox) return { command: options.command, args: options.args };
  if (sandbox.type === "windows-appcontainer") {
    return createWindowsAppContainerProcessSpec(options, sandbox);
  }
  return createNodePermissionProcessSpec(options, sandbox);
}

function createNodePermissionProcessSpec(
  options: StdioMcpClientAdapterOptions,
  sandbox: Extract<AgentExtensionSandbox, { type: "node-permission" }>,
): { command: string; args?: string[] } {
  const requestedCommand = options.command.trim();
  const currentExecutable = resolve(process.execPath).toLowerCase();
  const usesCurrentNode = requestedCommand.toLowerCase() === "node" ||
    requestedCommand.toLowerCase() === "node.exe" ||
    resolve(requestedCommand).toLowerCase() === currentExecutable;
  if (!usesCurrentNode) {
    throw new Error("node-permission sandbox must use the Nemos-managed Node runtime");
  }
  if (!options.args?.length || options.args[0]?.startsWith("-")) {
    throw new Error("node-permission sandbox requires the MCP script as the first argument");
  }
  if (options.env?.includes("NODE_OPTIONS")) {
    throw new Error("node-permission sandbox cannot inherit NODE_OPTIONS");
  }

  let command = process.execPath;
  let nodeVersion = process.versions.node;
  if (sandbox.network === "deny" && options.sandboxNodeCommand) {
    command = resolve(options.sandboxNodeCommand);
    if (!existsSync(command)) {
      throw new Error("configured MCP sandbox Node runtime does not exist: " + command);
    }
    if (!options.sandboxNodeVersion?.trim()) {
      throw new Error("configured MCP sandbox Node runtime requires a verified version");
    }
    nodeVersion = verifySandboxNodeVersion(command, options.sandboxNodeVersion.trim());
  }

  const versionParts = nodeVersion.split(".").map(Number);
  const major = versionParts[0];
  const minor = versionParts[1];
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new Error("invalid MCP sandbox Node version: " + nodeVersion);
  }
  const stablePermissionFlag = major > 22 || (major === 22 && minor >= 13);
  if (sandbox.network === "deny" && major < 25) {
    throw new Error(
      "network-denied Node MCP sandbox requires Node 25 or newer; selected runtime is " + nodeVersion,
    );
  }

  const cwd = options.cwd ?? process.cwd();
  const args = [stablePermissionFlag ? "--permission" : "--experimental-permission"];
  for (const path of sandbox.filesystemRead ?? []) {
    args.push("--allow-fs-read=" + resolve(cwd, path));
  }
  for (const path of sandbox.filesystemWrite ?? []) {
    args.push("--allow-fs-write=" + resolve(cwd, path));
  }
  if (sandbox.network === "unrestricted" && major >= 25) args.push("--allow-net");
  args.push("--", ...options.args);
  return { command, args };
}

function createWindowsAppContainerProcessSpec(
  options: StdioMcpClientAdapterOptions,
  sandbox: Extract<AgentExtensionSandbox, { type: "windows-appcontainer" }>,
): { command: string; args?: string[] } {
  if (process.platform !== "win32") {
    throw new Error("windows-appcontainer sandbox is only available on Windows");
  }
  if (options.credentials?.length) {
    throw new Error("windows-appcontainer sandbox cannot use the loopback HTTP credential proxy");
  }

  const host = resolveRequiredFile(
    options.sandboxHostCommand,
    "configured Windows AppContainer sandbox host",
  );
  const cwd = resolve(options.cwd ?? process.cwd());
  const readPaths = new Set((sandbox.filesystemRead ?? []).map((path) => resolve(cwd, path)));
  const writePaths = new Set((sandbox.filesystemWrite ?? []).map((path) => resolve(cwd, path)));
  let childCommand: string;

  if (options.command.trim().toLowerCase() === "nemos-python") {
    childCommand = resolveRequiredFile(
      options.sandboxPythonCommand,
      "configured Nemos sandbox Python runtime",
    );
    verifySandboxPythonVersion(childCommand, options.sandboxPythonVersion);
    readPaths.add(dirname(childCommand));
  } else {
    childCommand = resolveRequiredFile(
      resolve(cwd, options.command),
      "Windows AppContainer MCP executable",
    );
  }

  for (const path of readPaths) {
    if (!existsSync(path)) throw new Error("Windows AppContainer read path does not exist: " + path);
  }
  for (const path of writePaths) {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error("Windows AppContainer write path must be an existing directory: " + path);
    }
  }

  const args = ["--network", sandbox.network];
  for (const path of readPaths) args.push("--read", path);
  for (const path of writePaths) args.push("--write", path);
  args.push("--", childCommand, ...(options.args ?? []));
  return { command: host, args };
}

function resolveRequiredFile(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(label + " is not configured");
  const path = resolve(value);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(label + " does not exist: " + path);
  }
  return path;
}

function verifySandboxPythonVersion(command: string, expectedVersion: string | undefined): void {
  if (!expectedVersion?.trim()) {
    throw new Error("configured Nemos sandbox Python runtime requires a verified version");
  }
  let output: string;
  try {
    output = execFileSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new Error("cannot verify the configured Nemos sandbox Python runtime", { cause: error });
  }
  const actualVersion = output.replace(/^Python\s+/i, "");
  if (actualVersion !== expectedVersion.trim()) {
    throw new Error(
      "configured Nemos sandbox Python version mismatch: expected " +
      expectedVersion.trim() + ", got " + actualVersion,
    );
  }
}
function verifySandboxNodeVersion(command: string, expectedVersion: string): string {
  let actualVersion: string;
  try {
    actualVersion = execFileSync(command, ["-p", "process.versions.node"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new Error("cannot verify the configured MCP sandbox Node runtime", { cause: error });
  }
  if (actualVersion !== expectedVersion) {
    throw new Error(
      "configured MCP sandbox Node version mismatch: expected " + expectedVersion + ", got " + actualVersion,
    );
  }
  return actualVersion;
}
function inheritedEnvironment(names: readonly string[] | undefined): Record<string, string> {
  const environment = getDefaultEnvironment();
  for (const name of names ?? []) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function renderMcpContent(content: unknown): string {
  if (!Array.isArray(content)) return safeJson(content);
  const rendered = content.map((block) => {
    if (!isRecord(block)) return safeJson(block);
    if (block.type === "text" && typeof block.text === "string") return block.text;
    if (block.type === "resource" && isRecord(block.resource)) {
      if (typeof block.resource.text === "string") return block.resource.text;
      if (typeof block.resource.uri === "string") return block.resource.uri;
    }
    if (typeof block.uri === "string") return block.uri;
    return safeJson(block);
  }).filter(Boolean);
  return rendered.join("\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error("Aborted");
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function closeConnection(connection: McpConnection): Promise<void> {
  try {
    await connection.client.close();
  } catch {
    await connection.transport.close().catch(() => undefined);
  } finally {
    connection.credentialLease?.close();
  }
}
