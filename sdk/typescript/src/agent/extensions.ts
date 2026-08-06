import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AgentCredentialBinding } from "./credential-proxy.js";
import { validateAgentCredentialBinding } from "./credential-proxy.js";
import type { AgentTool, AgentToolContext, AgentToolEffect } from "./types.js";

export type AgentExtensionKind = "skill" | "mcp" | "agent-app" | "connector";
export type AgentExtensionPermission =
  | "network"
  | "filesystem-read"
  | "filesystem-write"
  | "memory-read"
  | "memory-write"
  | "process"
  | "external-write";

export interface AgentExtensionToolHint {
  name: string;
  description: string;
  effect: AgentToolEffect;
  tags?: string[];
}

export type AgentExtensionSandbox =
  | {
      type: "node-permission";
      network: "deny" | "unrestricted";
      filesystemRead?: string[];
      filesystemWrite?: string[];
    }
  | {
      type: "windows-appcontainer";
      network: "deny" | "unrestricted";
      filesystemRead?: string[];
      filesystemWrite?: string[];
    };
export interface AgentExtensionManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  kind: AgentExtensionKind;
  source: {
    type: "builtin" | "local" | "url" | "registry";
    location: string;
    integrity?: string;
  };
  runtime: {
    type: "skill-markdown" | "mcp" | "module" | "http";
    entry?: string;
    args?: string[];
    cwd?: string;
    env?: string[];
    credentials?: AgentCredentialBinding[];
    maxSessions?: number;
    sessionIdleMs?: number;
    requestTimeoutMs?: number;
    maxBufferSize?: number;
    sandbox?: AgentExtensionSandbox;
  };
  permissions: AgentExtensionPermission[];
  /** 可由该能力请求的模型标识；空数组表示不能自行选择模型。 */
  models?: string[];
  activation: string[];
  tools: AgentExtensionToolHint[];
}

export interface AgentExtensionToolDescriptor extends AgentExtensionToolHint {
  extensionId: string;
}

export interface AgentExtensionProvider {
  discover: (query: string, signal: AbortSignal) => Promise<AgentExtensionToolDescriptor[]>;
  loadTool: (name: string, signal: AbortSignal) => Promise<AgentTool>;
  close?: () => void | Promise<void>;
}

export interface AgentExtensionAuditRecord {
  at: string;
  action: "install" | "upgrade" | "enable" | "disable" | "uninstall" | "tool-call";
  detail?: string;
}

export type AgentExtensionExecutionSecurity =
  | "not-executable"
  | "builtin-trusted"
  | "restricted"
  | "unsandboxed-confirmed"
  | "blocked";

export interface AgentExtensionExecutionApproval {
  allowUnsandboxed?: boolean;
  approvePermissionExpansion?: boolean;
}

export interface AgentExtensionRecord {
  manifest: AgentExtensionManifest;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  providerAttached: boolean;
  executionSecurity: AgentExtensionExecutionSecurity;
  audit: AgentExtensionAuditRecord[];
}

type PersistedExtensionRecord = Omit<AgentExtensionRecord, "providerAttached" | "executionSecurity"> & {
  unsafeExecutionApproved?: boolean;
};

interface InternalExtensionRecord extends PersistedExtensionRecord {
  provider?: AgentExtensionProvider;
}

interface ExtensionFile {
  version: 1;
  extensions: PersistedExtensionRecord[];
}

export interface AgentExtensionRegistryOptions {
  maxToolsPerRequest?: number;
}

/** 可持久安装、停用、升级和审计的扩展注册表；工具定义只在请求命中后加载。 */
export class AgentExtensionRegistry {
  private readonly entries = new Map<string, InternalExtensionRecord>();
  private readonly maxToolsPerRequest: number;

  constructor(private readonly stateFile?: string, options: AgentExtensionRegistryOptions = {}) {
    this.maxToolsPerRequest = Math.min(32, Math.max(1, options.maxToolsPerRequest ?? 8));
    if (stateFile) {
      mkdirSync(dirname(stateFile), { recursive: true });
      this.load();
    }
  }

  install(
    manifest: AgentExtensionManifest,
    provider?: AgentExtensionProvider,
    approval: AgentExtensionExecutionApproval = {},
  ): AgentExtensionRecord {
    const errors = validateAgentExtensionManifest(manifest);
    if (errors.length) rejectProvider(provider, "Invalid Agent extension manifest: " + errors.join("; "));
    if (this.entries.has(manifest.id)) rejectProvider(provider, "Agent extension is already installed: " + manifest.id);
    const unsafeExecutionApproved = approval.allowUnsandboxed === true;
    try {
      assertExtensionExecutionApproved(manifest, unsafeExecutionApproved);
    } catch (error) {
      if (provider) closeProvider(provider);
      throw error;
    }
    const now = new Date().toISOString();
    const security = getAgentExtensionExecutionSecurity(manifest, unsafeExecutionApproved);
    const record: InternalExtensionRecord = {
      manifest: structuredClone(manifest),
      enabled: true,
      installedAt: now,
      updatedAt: now,
      unsafeExecutionApproved,
      provider,
      audit: [{
        at: now,
        action: "install",
        detail: manifest.version + " from " + manifest.source.location + " security=" + security,
      }],
    };
    this.entries.set(manifest.id, record);
    this.save();
    return publicRecord(record);
  }

  upgrade(
    manifest: AgentExtensionManifest,
    provider?: AgentExtensionProvider,
    approval: AgentExtensionExecutionApproval = {},
  ): AgentExtensionRecord {
    let current: InternalExtensionRecord;
    try {
      current = this.require(manifest.id);
    } catch (error) {
      if (provider) closeProvider(provider);
      throw error;
    }
    const errors = validateAgentExtensionManifest(manifest);
    if (errors.length) rejectProvider(provider, "Invalid Agent extension manifest: " + errors.join("; "));
    if (compareSemver(manifest.version, current.manifest.version) <= 0) {
      rejectProvider(
        provider,
        "Agent extension upgrade must increase the version: " + current.manifest.version + " -> " + manifest.version,
      );
    }
    const expandedAccess = permissionExpansion(current.manifest, manifest);
    if (expandedAccess.length > 0 && approval.approvePermissionExpansion !== true) {
      rejectProvider(
        provider,
        "Agent extension upgrade expands declared access and requires explicit approval: " + expandedAccess.join(", "),
      );
    }
    const unsafeExecutionApproved = approval.allowUnsandboxed === true;
    try {
      assertExtensionExecutionApproved(manifest, unsafeExecutionApproved);
    } catch (error) {
      if (provider) closeProvider(provider);
      throw error;
    }
    const now = new Date().toISOString();
    const previous = current.manifest.version;
    const previousProvider = current.provider;
    const nextProvider = current.enabled ? provider : undefined;
    current.manifest = structuredClone(manifest);
    current.unsafeExecutionApproved = unsafeExecutionApproved;
    current.provider = nextProvider;
    if (previousProvider && nextProvider !== previousProvider) closeProvider(previousProvider);
    if (!current.enabled && provider) closeProvider(provider);
    current.updatedAt = now;
    current.audit.push({
      at: now,
      action: "upgrade",
      detail: previous + " -> " + manifest.version + " security=" +
        getAgentExtensionExecutionSecurity(manifest, unsafeExecutionApproved),
    });
    this.trimAudit(current);
    this.save();
    return publicRecord(current);
  }

  attachProvider(id: string, provider: AgentExtensionProvider): AgentExtensionRecord {
    const record = this.require(id);
    if (!record.enabled) rejectProvider(provider, "Disabled Agent extension cannot attach a provider");
    if (getAgentExtensionExecutionSecurity(record.manifest, record.unsafeExecutionApproved) === "blocked") {
      rejectProvider(provider, "Agent extension execution is blocked until unsandboxed execution is explicitly approved");
    }
    if (record.provider && record.provider !== provider) closeProvider(record.provider);
    record.provider = provider;
    return publicRecord(record);
  }

  setEnabled(
    id: string,
    enabled: boolean,
    provider?: AgentExtensionProvider,
  ): AgentExtensionRecord {
    const record = this.require(id);
    if (enabled && getAgentExtensionExecutionSecurity(record.manifest, record.unsafeExecutionApproved) === "blocked") {
      rejectProvider(provider, "Blocked Agent extension cannot be enabled");
    }
    if (enabled && record.manifest.runtime.entry && !provider && !record.provider) {
      throw new Error("Executable Agent extension requires a provider before it can be enabled");
    }
    if (record.enabled === enabled) {
      if (enabled && provider && provider !== record.provider) {
        const previousProvider = record.provider;
        record.provider = provider;
        if (previousProvider) closeProvider(previousProvider);
      }
      return publicRecord(record);
    }

    const now = new Date().toISOString();
    const previousProvider = record.provider;
    record.enabled = enabled;
    record.provider = enabled ? (provider ?? previousProvider) : undefined;
    if (previousProvider && record.provider !== previousProvider) closeProvider(previousProvider);
    record.updatedAt = now;
    record.audit.push({ at: now, action: enabled ? "enable" : "disable" });
    this.trimAudit(record);
    this.save();
    return publicRecord(record);
  }

  uninstall(id: string): AgentExtensionRecord {
    const record = this.require(id);
    const now = new Date().toISOString();
    const provider = record.provider;
    record.audit.push({ at: now, action: "uninstall" });
    record.enabled = false;
    record.provider = undefined;
    this.entries.delete(id);
    if (provider) closeProvider(provider);
    this.save();
    return publicRecord(record);
  }

  list(): AgentExtensionRecord[] {
    return [...this.entries.values()]
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
      .map(publicRecord);
  }

  get(id: string): AgentExtensionRecord | null {
    const record = this.entries.get(id);
    return record ? publicRecord(record) : null;
  }

  accessExpansion(manifest: AgentExtensionManifest): string[] {
    const current = this.entries.get(manifest.id);
    return current ? permissionExpansion(current.manifest, manifest) : [];
  }
  assertModelAccess(id: string, modelId: string): void {
    const record = this.require(id);
    const allowed = record.manifest.models ?? [];
    if (!allowed.includes(modelId)) {
      throw new Error(`Extension ${id} is not allowed to use model ${modelId}; update the manifest and approve the expanded access`);
    }
  }
  async toolsForRequest(
    query: string,
    options: { signal?: AbortSignal; limit?: number } = {},
  ): Promise<AgentTool[]> {
    const controller = linkedController(options.signal);
    const limit = Math.min(this.maxToolsPerRequest, Math.max(1, options.limit ?? this.maxToolsPerRequest));
    try {
      const candidates: Array<{ descriptor: AgentExtensionToolDescriptor; score: number; record: InternalExtensionRecord }> = [];
      for (const record of this.entries.values()) {
        if (!record.enabled || !record.provider || !matchesActivation(record.manifest, query)) continue;
        const descriptors = await record.provider.discover(query, controller.signal);
        for (const descriptor of descriptors) {
          if (descriptor.extensionId !== record.manifest.id) continue;
          const score = toolScore(descriptor, query);
          if (score > 0) candidates.push({ descriptor, score, record });
        }
      }
      candidates.sort((a, b) => b.score - a.score || a.descriptor.name.localeCompare(b.descriptor.name));
      const selected = candidates.slice(0, limit);
      const tools: AgentTool[] = [];
      for (const item of selected) {
        const provider = item.record.provider;
        if (!item.record.enabled || !provider) continue;
        const tool = await provider.loadTool(item.descriptor.name, controller.signal);
        validateLoadedTool(item.record.manifest, item.descriptor, tool);
        tools.push(this.auditedTool(item.record, provider, tool));
      }
      return tools;
    } finally {
      controller.dispose();
    }
  }

  private auditedTool(
    record: InternalExtensionRecord,
    provider: AgentExtensionProvider,
    tool: AgentTool,
  ): AgentTool {
    return {
      definition: { ...tool.definition },
      execute: async (input, context) => {
        if (!record.enabled || record.provider !== provider) {
          throw new Error("Agent extension is no longer active: " + record.manifest.id);
        }
        const now = new Date().toISOString();
        record.audit.push({ at: now, action: "tool-call", detail: tool.definition.name });
        record.updatedAt = now;
        this.trimAudit(record);
        this.save();
        return tool.execute(input, context);
      },
    };
  }

  private require(id: string): InternalExtensionRecord {
    const record = this.entries.get(id);
    if (!record) throw new Error(`Unknown Agent extension: ${id}`);
    return record;
  }

  private trimAudit(record: InternalExtensionRecord): void {
    if (record.audit.length > 500) record.audit.splice(0, record.audit.length - 500);
  }

  private load(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const data = JSON.parse(readFileSync(this.stateFile, "utf8")) as ExtensionFile;
      if (data.version !== 1 || !Array.isArray(data.extensions)) return;
      for (const item of data.extensions) {
        if (!item?.manifest?.id || validateAgentExtensionManifest(item.manifest).length) continue;
        this.entries.set(item.manifest.id, { ...item });
      }
    } catch {
      // 损坏的扩展状态不阻塞主应用。
    }
  }

  private save(): void {
    if (!this.stateFile) return;
    const extensions = [...this.entries.values()].map(({ provider: _provider, ...record }) => record);
    const temp = `${this.stateFile}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, extensions }, null, 2));
    renameSync(temp, this.stateFile);
  }
}

export function requiresUnsandboxedExecutionApproval(manifest: AgentExtensionManifest): boolean {
  return !!manifest.runtime.entry &&
    manifest.source.type !== "builtin" &&
    !manifest.runtime.sandbox;
}

export function getAgentExtensionExecutionSecurity(
  manifest: AgentExtensionManifest,
  unsafeExecutionApproved = false,
): AgentExtensionExecutionSecurity {
  if (!manifest.runtime.entry) return "not-executable";
  if (manifest.source.type === "builtin") return "builtin-trusted";
  if (manifest.runtime.sandbox) return "restricted";
  return unsafeExecutionApproved ? "unsandboxed-confirmed" : "blocked";
}

function assertExtensionExecutionApproved(
  manifest: AgentExtensionManifest,
  unsafeExecutionApproved: boolean,
): void {
  if (requiresUnsandboxedExecutionApproval(manifest) && !unsafeExecutionApproved) {
    throw new Error(
      "Unsandboxed executable Agent extension requires explicit allowUnsandboxed approval",
    );
  }
}

export function validateAgentExtensionManifest(manifest: AgentExtensionManifest): string[] {
  const errors: string[] = [];
  const sourceTypes = ["builtin", "local", "url", "registry"];
  const runtimeTypes = ["skill-markdown", "mcp", "module", "http"];
  const permissionTypes = [
    "network", "filesystem-read", "filesystem-write", "memory-read",
    "memory-write", "process", "external-write",
  ];
  if (manifest?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(manifest?.id ?? "")) errors.push("id has an invalid format");
  if (!manifest?.name?.trim()) errors.push("name is required");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest?.version ?? "")) errors.push("version must be semantic versioning");
  if (!manifest?.description?.trim()) errors.push("description is required");
  if (!(["skill", "mcp", "agent-app", "connector"] as unknown[]).includes(manifest?.kind)) errors.push("kind is invalid");
  if (!sourceTypes.includes(manifest?.source?.type ?? "")) errors.push("source.type is invalid");
  if (!manifest?.source?.location?.trim()) errors.push("source.location is required");
  if (manifest?.source?.type === "url" && !isHttpUrl(manifest.source.location)) {
    errors.push("url source.location must use http or https");
  }
  if (manifest?.source?.integrity && !/^(?:sha256-[A-Za-z0-9+/=]+|[a-fA-F0-9]{64})$/.test(manifest.source.integrity)) {
    errors.push("source.integrity must be a SHA-256 digest");
  }
  if (!runtimeTypes.includes(manifest?.runtime?.type ?? "")) errors.push("runtime.type is invalid");
  if (manifest?.kind === "mcp" && manifest?.runtime?.type !== "mcp") errors.push("mcp extensions require the mcp runtime");
  if (manifest?.kind === "skill" && !["skill-markdown", "module"].includes(manifest?.runtime?.type ?? "")) {
    errors.push("skill extensions require the skill-markdown or module runtime");
  }
  const runtime = manifest?.runtime;
  if (runtime?.entry !== undefined && (typeof runtime.entry !== "string" || !runtime.entry.trim() || runtime.entry.length > 2048)) {
    errors.push("runtime.entry must be a non-empty string up to 2048 characters");
  }
  if (runtime?.args !== undefined && (!Array.isArray(runtime.args) || runtime.args.length > 64 ||
      runtime.args.some((item) => typeof item !== "string" || item.length > 2048))) {
    errors.push("runtime.args must contain up to 64 strings of at most 2048 characters");
  }
  if (runtime?.args?.some((item) =>
      /^--?(?:api[-_]?key|access[-_]?token|authorization|bearer|client[-_]?secret|password)(?:=|$)/i.test(item))) {
    errors.push("runtime.args must not contain credential flags; declare a runtime.credentials proxy binding");
  }
  if (runtime?.cwd !== undefined && (typeof runtime.cwd !== "string" || !runtime.cwd.trim() || runtime.cwd.length > 2048)) {
    errors.push("runtime.cwd must be a non-empty string up to 2048 characters");
  }
  if (runtime?.env !== undefined && (!Array.isArray(runtime.env) || runtime.env.length > 64 ||
      runtime.env.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) ||
      new Set(runtime.env).size !== runtime.env.length)) {
    errors.push("runtime.env must contain up to 64 unique environment variable names");
  }
  if (runtime?.env?.some(isCredentialEnvironmentName)) {
    errors.push("runtime.env cannot expose credential-like variables; use runtime.credentials");
  }
  if (runtime?.credentials !== undefined) {
    if (!Array.isArray(runtime.credentials) || runtime.credentials.length > 16) {
      errors.push("runtime.credentials must contain up to 16 credential proxy bindings");
    } else {
      const credentialIds = new Set<string>();
      for (const binding of runtime.credentials) {
        for (const error of validateAgentCredentialBinding(binding)) errors.push("runtime.credentials: " + error);
        if (binding?.id && credentialIds.has(binding.id)) errors.push("runtime.credentials ids must be unique");
        if (binding?.id) credentialIds.add(binding.id);
      }
    }
  }
  validateIntegerRange(errors, "runtime.maxSessions", runtime?.maxSessions, 1, 64);
  validateIntegerRange(errors, "runtime.sessionIdleMs", runtime?.sessionIdleMs, 1_000, 3_600_000);
  validateIntegerRange(errors, "runtime.requestTimeoutMs", runtime?.requestTimeoutMs, 1_000, 300_000);
  validateIntegerRange(errors, "runtime.maxBufferSize", runtime?.maxBufferSize, 65_536, 52_428_800);
  const sandbox = runtime?.sandbox;
  if (sandbox !== undefined) {
    if (sandbox?.type !== "node-permission" && sandbox?.type !== "windows-appcontainer") {
      errors.push("runtime.sandbox.type must be node-permission or windows-appcontainer");
    }
    if (manifest?.kind !== "mcp" || runtime?.type !== "mcp") {
      errors.push("runtime.sandbox is only supported for MCP runtimes");
    }
    if (sandbox?.network !== "deny" && sandbox?.network !== "unrestricted") {
      errors.push("runtime.sandbox.network must be deny or unrestricted");
    }
    validateSandboxPaths(errors, "runtime.sandbox.filesystemRead", sandbox?.filesystemRead);
    validateSandboxPaths(errors, "runtime.sandbox.filesystemWrite", sandbox?.filesystemWrite);
    if (sandbox?.network === "deny" && (manifest?.permissions ?? []).includes("network")) {
      errors.push("runtime.sandbox.network deny conflicts with the network permission");
    }
    if (sandbox?.network === "unrestricted" && !(manifest?.permissions ?? []).includes("network")) {
      errors.push("runtime.sandbox.network unrestricted requires the network permission");
    }
    if (sandbox?.network === "deny" && runtime?.credentials?.length) {
      errors.push("runtime.sandbox.network deny cannot use the HTTP credential proxy");
    }
    if (sandbox?.filesystemRead?.length && !(manifest?.permissions ?? []).includes("filesystem-read")) {
      errors.push("runtime.sandbox.filesystemRead requires the filesystem-read permission");
    }
    if (sandbox?.filesystemWrite?.length && !(manifest?.permissions ?? []).includes("filesystem-write")) {
      errors.push("runtime.sandbox.filesystemWrite requires the filesystem-write permission");
    }

    if (sandbox?.type === "node-permission") {
      if (runtime?.entry && !isDirectNodeCommand(runtime.entry)) {
        errors.push("node-permission sandbox requires a direct node executable entry");
      }
      if (!runtime?.args?.length || runtime.args[0]?.startsWith("-")) {
        errors.push("node-permission sandbox requires the MCP script as the first runtime argument");
      }
      if (runtime?.env?.includes("NODE_OPTIONS")) {
        errors.push("node-permission sandbox cannot inherit NODE_OPTIONS");
      }
    }

    if (sandbox?.type === "windows-appcontainer") {
      if (runtime?.credentials?.length) {
        errors.push("windows-appcontainer sandbox cannot use the loopback HTTP credential proxy");
      }
      if (runtime?.entry && /\.(?:cmd|bat|ps1)$/i.test(runtime.entry.trim())) {
        errors.push("windows-appcontainer sandbox requires a direct executable, not a shell script");
      }
    }
  }
  if (manifest?.kind === "mcp" && runtime?.entry && !["builtin", "local"].includes(manifest?.source?.type ?? "")) {
    errors.push("executable MCP extensions require a builtin or local source");
  }
  if (manifest?.kind === "mcp" && runtime?.entry && !(manifest?.permissions ?? []).includes("process")) {
    errors.push("executable MCP extensions require the process permission");
  }
  if (!Array.isArray(manifest?.permissions)) errors.push("permissions must be an array");
  const permissions = manifest?.permissions ?? [];
  for (const permission of permissions) {
    if (!permissionTypes.includes(permission)) errors.push(`permission is invalid: ${permission}`);
  }
  if (new Set(permissions).size !== permissions.length) errors.push("permissions must not contain duplicates");
  if (manifest?.models !== undefined) {
    if (!Array.isArray(manifest.models) || manifest.models.length > 16) {
      errors.push("models must contain up to 16 model ids");
    } else {
      if (manifest.models.some((model) => typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model))) {
        errors.push("models contains an invalid model id");
      }
      if (new Set(manifest.models).size !== manifest.models.length) errors.push("models must not contain duplicates");
    }
  }  if (!Array.isArray(manifest?.activation) || manifest.activation.length === 0) errors.push("activation must contain at least one cue");
  if ((manifest?.activation?.length ?? 0) > 32) errors.push("activation exceeds the 32 cue limit");
  for (const cue of manifest?.activation ?? []) {
    if (typeof cue !== "string" || !cue.trim() || cue.length > 80) errors.push("activation cues must be non-empty strings up to 80 characters");
  }
  if (!Array.isArray(manifest?.tools)) errors.push("tools must be an array");
  if ((manifest?.tools?.length ?? 0) > 64) errors.push("tools exceed the 64 item limit");
  const names = new Set<string>();
  for (const tool of manifest?.tools ?? []) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(tool.name)) errors.push(`tool name is invalid: ${tool.name}`);
    if (names.has(tool.name)) errors.push(`duplicate tool: ${tool.name}`);
    names.add(tool.name);
    if (!tool.description?.trim()) errors.push(`tool description is required: ${tool.name}`);
    if (tool.effect !== "read" && tool.effect !== "write") errors.push(`tool effect is invalid: ${tool.name}`);
    if ((tool.tags?.length ?? 0) > 32 || tool.tags?.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 80)) {
      errors.push(`tool tags are invalid: ${tool.name}`);
    }
    if (tool.effect === "write" && !hasWritePermission(manifest.permissions ?? [])) {
      errors.push(`write tool requires a write permission: ${tool.name}`);
    }
  }
  return errors;
}

function isCredentialEnvironmentName(name: string): boolean {
  return /(?:api_?key|token|secret|password|credential|authorization|cookie)/i.test(name);
}

function isDirectNodeCommand(command: string): boolean {
  return /(?:^|[\\/])node(?:\.exe)?$/i.test(command.trim());
}

function validateSandboxPaths(errors: string[], field: string, paths: string[] | undefined): void {
  if (paths === undefined) return;
  if (!Array.isArray(paths) || paths.length > 64 ||
      paths.some((path) => typeof path !== "string" || !path.trim() || path.length > 2048 || path.includes("\0")) ||
      new Set(paths).size !== paths.length) {
    errors.push(field + " must contain up to 64 unique non-empty paths");
  }
}

function validateIntegerRange(
  errors: string[],
  name: string,
  value: number | undefined,
  minimum: number,
  maximum: number,
): void {
  if (value !== undefined && (!Number.isInteger(value) || value < minimum || value > maximum)) {
    errors.push(name + " must be an integer between " + minimum + " and " + maximum);
  }
}

function rejectProvider(provider: AgentExtensionProvider | undefined, message: string): never {
  if (provider) closeProvider(provider);
  throw new Error(message);
}

function closeProvider(provider: AgentExtensionProvider): void {
  if (!provider.close) return;
  try {
    void Promise.resolve(provider.close()).catch(() => undefined);
  } catch {
    // Extension teardown is best effort; disabling the extension must still succeed.
  }
}
function isHttpUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string): { core: number[]; prerelease: string[] } => {
    const withoutBuild = value.split("+", 1)[0]!;
    const [core, prerelease = ""] = withoutBuild.split("-", 2);
    return { core: core.split(".").map(Number), prerelease: prerelease ? prerelease.split(".") : [] };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference) return difference;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber && rightNumber) return Number(leftPart) - Number(rightPart);
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export interface McpRemoteTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  effect?: AgentToolEffect;
  tags?: string[];
}

export interface McpClientAdapter {
  listTools: (signal: AbortSignal) => Promise<McpRemoteTool[]>;
  callTool: (
    name: string,
    input: Record<string, unknown>,
    context: AgentToolContext,
  ) => Promise<{ content: string; isError?: boolean; data?: unknown }>;
  close?: () => void | Promise<void>;
}

/** MCP 传输无关适配器；只有扩展 activation 命中后才会调用 listTools。 */
export function createMcpExtensionProvider(
  extensionId: string,
  client: McpClientAdapter,
): AgentExtensionProvider {
  let cache: McpRemoteTool[] | undefined;
  const tools = async (signal: AbortSignal): Promise<McpRemoteTool[]> => {
    cache ??= await client.listTools(signal);
    return cache;
  };
  return {
    discover: async (query, signal) => (await tools(signal))
      .map((tool) => ({
        extensionId,
        name: tool.name,
        description: tool.description || tool.name,
        effect: tool.effect ?? "write",
        tags: tool.tags,
      }))
      .filter((tool) => toolScore(tool, query) > 0),
    loadTool: async (name, signal) => {
      const remote = (await tools(signal)).find((tool) => tool.name === name);
      if (!remote) throw new Error(`MCP tool not found: ${name}`);
      return {
        definition: {
          name: remote.name,
          description: remote.description || remote.name,
          inputSchema: remote.inputSchema ?? { type: "object", additionalProperties: true },
          effect: remote.effect ?? "write",
        },
        execute: (input, context) => client.callTool(remote.name, input, context),
      };
    },
    close: client.close ? () => client.close!() : undefined,
  };
}

function validateLoadedTool(
  manifest: AgentExtensionManifest,
  descriptor: AgentExtensionToolDescriptor,
  tool: AgentTool,
): void {
  const declared = manifest.tools.find((item) => item.name === descriptor.name);
  if (!declared) throw new Error(`Tool is not declared by the extension manifest: ${descriptor.name}`);
  if (declared.effect !== descriptor.effect) throw new Error(`Discovered tool effect does not match manifest: ${descriptor.name}`);
  if (tool.definition.name !== descriptor.name) throw new Error(`Loaded tool name does not match descriptor: ${descriptor.name}`);
  if ((tool.definition.effect ?? "write") !== descriptor.effect) throw new Error(`Loaded tool effect does not match descriptor: ${descriptor.name}`);
  if (descriptor.effect === "write" && !hasWritePermission(manifest.permissions)) {
    throw new Error(`Extension is not allowed to load write tool: ${descriptor.name}`);
  }
}

function permissionExpansion(
  current: AgentExtensionManifest,
  next: AgentExtensionManifest,
): string[] {
  const expanded: string[] = [];
  const currentPermissions = new Set(current.permissions);
  for (const permission of next.permissions) {
    if (!currentPermissions.has(permission)) expanded.push("permission:" + permission);
  }
  const currentModels = new Set(current.models ?? []);
  for (const model of next.models ?? []) {
    if (!currentModels.has(model)) expanded.push("model:" + model);
  }
  const currentTools = new Map(current.tools.map((tool) => [tool.name, tool.effect]));
  for (const tool of next.tools) {
    const previous = currentTools.get(tool.name);
    if (!previous) expanded.push("tool:" + tool.name);
    else if (previous === "read" && tool.effect === "write") expanded.push("tool-write:" + tool.name);
  }
  return expanded;
}
function hasWritePermission(permissions: readonly AgentExtensionPermission[]): boolean {
  return permissions.some((permission) => permission === "filesystem-write" || permission === "memory-write" || permission === "external-write");
}

function matchesActivation(manifest: AgentExtensionManifest, query: string): boolean {
  const value = query.toLowerCase();
  return manifest.activation.some((cue) => value.includes(cue.toLowerCase())) ||
    value.includes(manifest.name.toLowerCase()) ||
    value.includes(manifest.id.toLowerCase());
}

function toolScore(tool: AgentExtensionToolHint, query: string): number {
  const value = query.toLowerCase();
  const fields = [tool.name, tool.description, ...(tool.tags ?? [])].map((item) => item.toLowerCase());
  let score = 0;
  for (const field of fields) {
    if (value.includes(field) || field.includes(value)) score += 4;
    for (const token of value.split(/[^\p{L}\p{N}_-]+/u).filter((item) => item.length > 1)) {
      if (field.includes(token)) score++;
    }
  }
  return score;
}

function publicRecord(record: InternalExtensionRecord): AgentExtensionRecord {
  return {
    manifest: structuredClone(record.manifest),
    enabled: record.enabled,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    providerAttached: !!record.provider,
    executionSecurity: getAgentExtensionExecutionSecurity(record.manifest, record.unsafeExecutionApproved),
    audit: structuredClone(record.audit),
  };
}

function linkedController(signal?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (!signal) return { signal: new AbortController().signal, dispose: () => undefined };
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, dispose: () => signal.removeEventListener("abort", abort) };
}
