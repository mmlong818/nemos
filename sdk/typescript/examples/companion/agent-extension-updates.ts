import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentExtensionManifest,
  AgentExtensionProvider,
  AgentExtensionRegistry,
} from "../../src/index.js";
import {
  requiresUnsandboxedExecutionApproval,
  validateAgentExtensionManifest,
} from "../../src/index.js";

export type AgentExtensionUpdateRisk = "compatible" | "review" | "manual";

export interface AgentExtensionUpdateItem {
  id: string;
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  risk: AgentExtensionUpdateRisk;
  reasons: string[];
  checkedAt: string;
}

export interface AgentExtensionUpdateSnapshot {
  checking: boolean;
  checkedAt: string | null;
  items: AgentExtensionUpdateItem[];
  error?: string;
}

type FetchManifest = (url: string, signal: AbortSignal) => Promise<{ manifest: AgentExtensionManifest; raw: string }>;

/**
 * 检查以 URL 发布的能力扩展。内置和纯本地扩展不会被后台替换，只提示手动维护。
 * 真正升级前会再次下载、校验完整性并比较权限，避免使用过期检查结果。
 */
export class AgentExtensionUpdateService {
  #snapshot: AgentExtensionUpdateSnapshot;
  #upgrading = false;

  constructor(private readonly options: {
    registry: AgentExtensionRegistry;
    stateFile: string;
    createProvider: (manifest: AgentExtensionManifest) => AgentExtensionProvider | undefined;
    fetchManifest?: FetchManifest;
    now?: () => Date;
  }) {
    this.#snapshot = this.load();
  }

  snapshot(): AgentExtensionUpdateSnapshot {
    return structuredClone(this.#snapshot);
  }

  async check(): Promise<AgentExtensionUpdateSnapshot> {
    const checkedAt = (this.options.now?.() ?? new Date()).toISOString();
    this.#snapshot = { ...this.#snapshot, checking: true, error: undefined };
    try {
      const items = await Promise.all(this.options.registry.list().map((record) => this.checkRecord(record.manifest, checkedAt)));
      this.#snapshot = { checking: false, checkedAt, items };
    } catch (error) {
      this.#snapshot = {
        ...this.#snapshot,
        checking: false,
        checkedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.save();
    return this.snapshot();
  }

  async upgrade(input: {
    id: string;
    latestVersion: string;
    acceptRisk?: boolean;
    confirmPermissionExpansion?: boolean;
    confirmUnsandboxed?: boolean;
  }): Promise<{ restartRequired: false; item: AgentExtensionUpdateItem }> {
    if (this.#upgrading) throw new Error("另一个扩展正在升级，请等待完成。");
    const known = this.#snapshot.items.find((item) => item.id === input.id && item.latestVersion === input.latestVersion && item.updateAvailable);
    if (!known) throw new Error("扩展升级信息已经变化，请重新检查。");
    if (known.risk === "review" && !input.acceptRisk) throw new Error("扩展权限或运行结构发生变化，需要明确确认。 ");
    const current = this.options.registry.get(input.id);
    if (!current) throw new Error(`未知扩展：${input.id}`);
    this.#upgrading = true;
    try {
      const fetched = await this.fetchCandidate(current.manifest);
      if (fetched.manifest.version !== input.latestVersion) throw new Error("远端版本在确认后发生变化，请重新检查。");
      const expansion = this.options.registry.accessExpansion(fetched.manifest);
      if (expansion.length && !input.confirmPermissionExpansion) {
        throw new Error(`新版本增加权限，需要明确确认：${expansion.join("、")}`);
      }
      const needsUnsafe = requiresUnsandboxedExecutionApproval(fetched.manifest);
      if (needsUnsafe && !input.confirmUnsandboxed) throw new Error("新版本需要在未隔离环境中启动，必须明确确认。");
      const provider = this.options.createProvider(fetched.manifest);
      this.options.registry.upgrade(fetched.manifest, provider, {
        approvePermissionExpansion: expansion.length > 0,
        allowUnsandboxed: needsUnsafe,
      });
      const item = { ...known, currentVersion: known.latestVersion, updateAvailable: false, reasons: ["升级校验通过并已启用。"] };
      this.#snapshot = { ...this.#snapshot, items: this.#snapshot.items.map((candidate) => candidate.id === input.id ? item : candidate) };
      this.save();
      return { restartRequired: false, item };
    } finally {
      this.#upgrading = false;
    }
  }

  private async checkRecord(current: AgentExtensionManifest, checkedAt: string): Promise<AgentExtensionUpdateItem> {
    if (!isRemoteManifestSource(current)) {
      return {
        id: current.id,
        name: current.name,
        currentVersion: current.version,
        latestVersion: current.version,
        updateAvailable: false,
        risk: "manual",
        reasons: [current.source.type === "builtin" ? "内置扩展随小丑鱼版本更新。" : "本地扩展不会被后台自动替换。"],
        checkedAt,
      };
    }
    try {
      const { manifest } = await this.fetchCandidate(current);
      return analyzeExtensionUpdate(current, manifest, this.options.registry.accessExpansion(manifest), checkedAt);
    } catch (error) {
      return {
        id: current.id,
        name: current.name,
        currentVersion: current.version,
        latestVersion: current.version,
        updateAvailable: false,
        risk: "manual",
        reasons: [`版本检查失败：${error instanceof Error ? error.message : String(error)}`],
        checkedAt,
      };
    }
  }

  private async fetchCandidate(current: AgentExtensionManifest): Promise<{ manifest: AgentExtensionManifest; raw: string }> {
    if (!isRemoteManifestSource(current)) throw new Error("该扩展没有可检查的远端清单地址。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const result = await (this.options.fetchManifest ?? fetchRemoteManifest)(current.source.location, controller.signal);
      if (result.manifest.id !== current.id) throw new Error("远端扩展 id 与已安装扩展不一致。");
      const errors = validateAgentExtensionManifest(result.manifest);
      if (errors.length) throw new Error(`远端清单无效：${errors.join("；")}`);
      verifyIntegrity(current.source.integrity, result.raw);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  private load(): AgentExtensionUpdateSnapshot {
    try {
      const parsed = JSON.parse(readFileSync(this.options.stateFile, "utf8")) as AgentExtensionUpdateSnapshot;
      return Array.isArray(parsed.items) ? { ...parsed, checking: false } : { checking: false, checkedAt: null, items: [] };
    } catch {
      return { checking: false, checkedAt: null, items: [] };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.options.stateFile), { recursive: true });
    writeFileSync(this.options.stateFile, JSON.stringify(this.#snapshot, null, 2));
  }
}

export function analyzeExtensionUpdate(
  current: AgentExtensionManifest,
  latest: AgentExtensionManifest,
  permissionExpansion: string[],
  checkedAt: string,
): AgentExtensionUpdateItem {
  const updateAvailable = compareVersions(latest.version, current.version) > 0;
  const reasons: string[] = [];
  let risk: AgentExtensionUpdateRisk = "compatible";
  if (updateAvailable) {
    if (major(latest.version) !== major(current.version)) reasons.push("主版本发生变化，接口可能不兼容。");
    if (permissionExpansion.length) reasons.push(`新增权限：${permissionExpansion.join("、")}`);
    if (latest.runtime.type !== current.runtime.type || latest.runtime.entry !== current.runtime.entry) reasons.push("运行入口发生变化。");
    if (latest.source.location !== current.source.location) reasons.push("发布地址发生变化。");
    if (reasons.length) risk = "review";
    else reasons.push("权限、运行入口和主版本保持兼容。");
  } else {
    reasons.push("已经是当前发布版本。");
  }
  return {
    id: current.id,
    name: current.name,
    currentVersion: current.version,
    latestVersion: latest.version,
    updateAvailable,
    risk,
    reasons,
    checkedAt,
  };
}

function isRemoteManifestSource(manifest: AgentExtensionManifest): boolean {
  return (manifest.source.type === "url" || manifest.source.type === "registry") && /^https:\/\//i.test(manifest.source.location);
}

async function fetchRemoteManifest(url: string, signal: AbortSignal): Promise<{ manifest: AgentExtensionManifest; raw: string }> {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal });
  if (!response.ok) throw new Error(`远端清单请求失败（${response.status}）。`);
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("远端清单超过 2 MB 限制。");
  return { manifest: JSON.parse(raw) as AgentExtensionManifest, raw };
}

function verifyIntegrity(expected: string | undefined, raw: string): void {
  if (!expected) return;
  const digest = createHash("sha256").update(raw).digest();
  const actual = expected.startsWith("sha256-") ? `sha256-${digest.toString("base64")}` : digest.toString("hex");
  if (actual !== expected) throw new Error("远端清单完整性校验失败。");
}

function major(value: string): number {
  return Number(value.replace(/^v/, "").split(".")[0] || 0);
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return 0;
}
