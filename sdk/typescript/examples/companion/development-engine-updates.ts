import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { DevelopmentEngine } from "./development-engine-contract.js";
import type { DevelopmentEnginePluginRegistry } from "./development-engine-plugins.js";

const execFileAsync = promisify(execFile);
const CHECK_TIMEOUT_MS = 8_000;
const UPDATE_TARGETS: Record<DevelopmentEngine, { bin: string; optional: boolean; testFile: string }> = {
  pi: { bin: "pi", optional: false, testFile: "companion-pi-development.test.ts" },
  dsh: { bin: "dsh", optional: false, testFile: "companion-dsh-development.test.ts" },
  kilo: { bin: "kilo", optional: true, testFile: "companion-kilo-development.test.ts" },
  opencode: { bin: "opencode", optional: true, testFile: "companion-opencode-development.test.ts" },
  codex: { bin: "codex", optional: true, testFile: "companion-codex-development.test.ts" },
};

export type DevelopmentEngineUpdateRisk = "compatible" | "review";

export interface DevelopmentEngineUpdateItem {
  engine: DevelopmentEngine;
  name: string;
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  risk: DevelopmentEngineUpdateRisk;
  reasons: string[];
  checkedAt: string;
  deprecated?: string;
}

export interface DevelopmentEngineUpdateSnapshot {
  checking: boolean;
  checkedAt: string | null;
  error?: string;
  items: DevelopmentEngineUpdateItem[];
}

interface RegistryMetadata {
  name?: string;
  version?: string;
  deprecated?: string;
  engines?: { node?: string };
  bin?: string | Record<string, string>;
}

type FetchMetadata = (packageName: string, signal: AbortSignal) => Promise<RegistryMetadata>;
type CommandRunner = (file: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

export class DevelopmentEngineUpdateService {
  #snapshot: DevelopmentEngineUpdateSnapshot;
  #upgrading = false;

  constructor(private readonly options: {
    registry: DevelopmentEnginePluginRegistry;
    stateFile: string;
    packageRoot: string;
    fetchMetadata?: FetchMetadata;
    runCommand?: CommandRunner;
    now?: () => Date;
  }) {
    this.#snapshot = this.load();
  }

  snapshot(): DevelopmentEngineUpdateSnapshot {
    return structuredClone(this.#snapshot);
  }

  async check(): Promise<DevelopmentEngineUpdateSnapshot> {
    this.#snapshot = { ...this.#snapshot, checking: true, error: undefined };
    const checkedAt = (this.options.now?.() ?? new Date()).toISOString();
    try {
      const readiness = this.options.registry.readiness();
      const items = await Promise.all(this.options.registry.list().map(async (manifest) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
        try {
          const metadata = await (this.options.fetchMetadata ?? fetchNpmMetadata)(manifest.packageName, controller.signal);
          const currentVersion = versionFromReadiness(readiness[manifest.id].version);
          return analyzeDevelopmentEngineUpdate({
            engine: manifest.id,
            name: manifest.name,
            packageName: manifest.packageName,
            currentVersion,
            metadata,
            expectedBin: UPDATE_TARGETS[manifest.id].bin,
            checkedAt,
          });
        } finally {
          clearTimeout(timer);
        }
      }));
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

  async upgrade(engine: DevelopmentEngine, latestVersion: string, acceptRisk: boolean): Promise<{ restartRequired: true; item: DevelopmentEngineUpdateItem }> {
    if (this.#upgrading) throw new Error("另一个开发引擎正在升级，请等待完成。");
    const item = this.#snapshot.items.find((candidate) => candidate.engine === engine && candidate.latestVersion === latestVersion && candidate.updateAvailable);
    if (!item) throw new Error("升级信息已经变化，请重新检查后再试。");
    if (item.risk === "review" && !acceptRisk) throw new Error("这个版本存在兼容风险，需要明确确认后才能升级。");

    const target = UPDATE_TARGETS[engine];
    const packageFiles = ["package.json", "package-lock.json"].map((name) => join(this.options.packageRoot, name)).filter(existsSync);
    if (!packageFiles.some((file) => basename(file) === "package.json")) throw new Error("找不到小丑鱼的依赖清单，无法安全升级。");
    const backupDir = join(tmpdir(), `clownfish-engine-update-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(backupDir, { recursive: true });
    for (const file of packageFiles) copyFileSync(file, join(backupDir, basename(file)));
    this.#upgrading = true;
    const run = this.options.runCommand ?? runCommand;
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    try {
      const installArgs = ["install", `${item.packageName}@${item.latestVersion}`, "--save-exact"];
      if (target.optional) installArgs.push("--save-optional");
      await run(npm, installArgs, this.options.packageRoot);
      await run(npm, ["run", "build"], this.options.packageRoot);
      await run(process.platform === "win32" ? "npx.cmd" : "npx", [
        "tsx", "--test",
        "tests/unit/development-engine-plugins.test.ts",
        `tests/unit/${target.testFile}`,
      ], this.options.packageRoot);
    } catch (error) {
      for (const file of packageFiles) copyFileSync(join(backupDir, basename(file)), file);
      try { await run(npm, ["install"], this.options.packageRoot); } catch { /* 保留原始升级错误。 */ }
      throw new Error(`升级验证失败，已经恢复原版本：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      rmSync(backupDir, { recursive: true, force: true });
      this.#upgrading = false;
    }

    const updated = { ...item, currentVersion: item.latestVersion, updateAvailable: false, reasons: ["升级验证通过，重启小丑鱼后启用。"] };
    this.#snapshot = { ...this.#snapshot, items: this.#snapshot.items.map((candidate) => candidate.engine === engine ? updated : candidate) };
    this.save();
    return { restartRequired: true, item: updated };
  }

  private load(): DevelopmentEngineUpdateSnapshot {
    try {
      const parsed = JSON.parse(readFileSync(this.options.stateFile, "utf8")) as DevelopmentEngineUpdateSnapshot;
      return Array.isArray(parsed.items) ? { ...parsed, checking: false } : { checking: false, checkedAt: null, items: [] };
    } catch {
      return { checking: false, checkedAt: null, items: [] };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.options.stateFile), { recursive: true });
    writeFileSync(this.options.stateFile, JSON.stringify(this.#snapshot, null, 2), "utf8");
  }
}

export function analyzeDevelopmentEngineUpdate(input: {
  engine: DevelopmentEngine;
  name: string;
  packageName: string;
  currentVersion: string;
  metadata: RegistryMetadata;
  expectedBin: string;
  checkedAt: string;
}): DevelopmentEngineUpdateItem {
  const latestVersion = normalizeVersion(input.metadata.version);
  if (!latestVersion) throw new Error(`${input.name} 的版本信息无效。`);
  const updateAvailable = compareVersions(latestVersion, input.currentVersion) > 0;
  const reasons: string[] = [];
  let risk: DevelopmentEngineUpdateRisk = "compatible";
  if (updateAvailable) {
    const current = versionParts(input.currentVersion);
    const latest = versionParts(latestVersion);
    if (!current || !latest || current.major !== latest.major) {
      risk = "review";
      reasons.push("主版本发生变化，可能包含不兼容修改。");
    }
    if (current?.major === 0 && latest?.major === 0 && current.minor !== latest.minor) {
      risk = "review";
      reasons.push("0.x 阶段的次版本发生变化，发布方可能调整未稳定接口。");
    }
    if (Boolean(current?.prerelease) !== Boolean(latest?.prerelease)) {
      risk = "review";
      reasons.push("稳定版与预发布版通道发生变化。");
    }
    if (!hasExpectedBin(input.metadata.bin, input.expectedBin)) {
      risk = "review";
      reasons.push(`新包未声明现有的 ${input.expectedBin} 启动入口。`);
    }
    if (!supportsCurrentNode(input.metadata.engines?.node, Number(process.versions.node.split(".")[0]))) {
      risk = "review";
      reasons.push(`新包要求的 Node.js 版本与当前运行环境不兼容。`);
    }
    if (input.metadata.deprecated) {
      risk = "review";
      reasons.push(`发布方已标记弃用：${input.metadata.deprecated}`);
    }
    if (!reasons.length) reasons.push("主版本、运行环境和命令入口均保持兼容；升级后仍会执行构建与引擎测试。");
  } else {
    reasons.push("已经是当前发布版本。");
  }
  return {
    engine: input.engine,
    name: input.name,
    packageName: input.packageName,
    currentVersion: input.currentVersion,
    latestVersion,
    updateAvailable,
    risk,
    reasons,
    checkedAt: input.checkedAt,
    deprecated: input.metadata.deprecated,
  };
}

async function fetchNpmMetadata(packageName: string, signal: AbortSignal): Promise<RegistryMetadata> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`${packageName} 版本检查失败（${response.status}）。`);
  return await response.json() as RegistryMetadata;
}

async function runCommand(file: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(file, args, {
      cwd,
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      // Windows 不能直接 CreateProcess npm.cmd / npx.cmd；通过系统命令解释器执行固定参数。
      shell: process.platform === "win32",
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string };
    throw new Error([detail.message, detail.stdout, detail.stderr].filter(Boolean).join("\n").slice(0, 4_000));
  }
}

function versionFromReadiness(value: string): string {
  return normalizeVersion(value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0]) || "0.0.0";
}

function normalizeVersion(value: unknown): string {
  return String(value || "").trim().replace(/^v/, "");
}

function versionParts(value: string): { major: number; minor: number; patch: number; prerelease: string } | undefined {
  const match = normalizeVersion(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || "" } : undefined;
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return left.localeCompare(right);
  for (const key of ["major", "minor", "patch"] as const) if (a[key] !== b[key]) return a[key] - b[key];
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function hasExpectedBin(bin: RegistryMetadata["bin"], expected: string): boolean {
  if (typeof bin === "string") return true;
  return Boolean(bin && typeof bin === "object" && Object.hasOwn(bin, expected));
}

function supportsCurrentNode(range: string | undefined, currentMajor: number): boolean {
  if (!range) return true;
  const minimum = range.match(/>=\s*(\d+)/)?.[1];
  return !minimum || currentMajor >= Number(minimum);
}
