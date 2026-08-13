import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DevelopmentDependencyStep { id: string; label: string; command: string; args: string[] }
export interface DevelopmentDependencyPlan { ecosystem: string; needed: boolean; reason: string; steps: DevelopmentDependencyStep[] }
export interface DevelopmentDependencyReceipt { id: string; label: string; passed: boolean; output: string; installedAt: string }

function command(file: string, args: string[]): [string, string[]] {
  const commandShims = new Set(["npm", "pnpm", "yarn", "npx"]);
  return process.platform === "win32" && commandShims.has(file)
    ? ["cmd.exe", ["/d", "/s", "/c", `${file}.cmd`, ...args]]
    : [file, args];
}

export function detectDevelopmentDependencies(workspace: string): DevelopmentDependencyPlan[] {
  const has = (name: string) => existsSync(join(workspace, name));
  const plans: DevelopmentDependencyPlan[] = [];
  if (has("package.json")) {
    const installed = has("node_modules");
    const step = has("pnpm-lock.yaml")
      ? { id: "pnpm-install", label: "安装 pnpm 项目依赖", command: "pnpm", args: ["install", "--frozen-lockfile"] }
      : has("yarn.lock")
        ? { id: "yarn-install", label: "安装 Yarn 项目依赖", command: "yarn", args: ["install", "--immutable"] }
        : has("package-lock.json")
          ? { id: "npm-ci", label: "安装 npm 锁定依赖", command: "npm", args: ["ci"] }
          : { id: "npm-install", label: "安装 npm 项目依赖", command: "npm", args: ["install"] };
    plans.push({ ecosystem: "node", needed: !installed, reason: installed ? "node_modules 已存在" : "项目依赖目录不存在", steps: installed ? [] : [step] });
  }
  const pythonMarker = has("requirements.txt") || has("pyproject.toml");
  if (pythonMarker) {
    const venv = has(".venv");
    const python = process.platform === "win32" ? "python" : "python3";
    const venvPython = process.platform === "win32" ? join(".venv", "Scripts", "python.exe") : join(".venv", "bin", "python");
    const steps: DevelopmentDependencyStep[] = [];
    if (!venv) steps.push({ id: "python-venv", label: "建立项目 Python 虚拟环境", command: python, args: ["-m", "venv", ".venv"] });
    if (!venv) steps.push(has("requirements.txt")
      ? { id: "python-requirements", label: "安装 Python 锁定依赖", command: venvPython, args: ["-m", "pip", "install", "-r", "requirements.txt"] }
      : { id: "python-project", label: "安装 Python 项目依赖", command: venvPython, args: ["-m", "pip", "install", "-e", "."] });
    plans.push({ ecosystem: "python", needed: !venv, reason: venv ? ".venv 已存在" : "项目虚拟环境不存在", steps });
  }
  const dotnetProjects = readdirSync(workspace, { withFileTypes: true }).some((entry) => entry.isFile() && /\.(sln|csproj)$/.test(entry.name));
  if (dotnetProjects) {
    const restored = has("obj");
    plans.push({ ecosystem: "dotnet", needed: !restored, reason: restored ? "还原目录已存在" : "项目尚未还原 NuGet 依赖", steps: restored ? [] : [{ id: "dotnet-restore", label: "还原 .NET 项目依赖", command: "dotnet", args: ["restore"] }] });
  }
  if (has("Cargo.toml")) {
    const fetched = has("target");
    plans.push({ ecosystem: "rust", needed: !fetched, reason: fetched ? "target 已存在" : "Rust 依赖尚未拉取", steps: fetched ? [] : [{ id: "cargo-fetch", label: "拉取 Rust 项目依赖", command: "cargo", args: ["fetch", "--locked"] }] });
  }
  return plans;
}

export async function installDevelopmentDependencies(workspace: string, plans = detectDevelopmentDependencies(workspace)): Promise<DevelopmentDependencyReceipt[]> {
  const receipts: DevelopmentDependencyReceipt[] = [];
  for (const step of plans.flatMap((plan) => plan.steps)) {
    const [file, args] = command(step.command, step.args);
    try {
      const result = await execFileAsync(file, args, { cwd: workspace, windowsHide: true, timeout: 10 * 60_000, maxBuffer: 2_000_000 });
      receipts.push({ id: step.id, label: step.label, passed: true, output: [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, 20_000) || "依赖安装完成。", installedAt: new Date().toISOString() });
    } catch (error) {
      const detail = error as Error & { stdout?: string; stderr?: string };
      receipts.push({ id: step.id, label: step.label, passed: false, output: [detail.message, detail.stdout, detail.stderr].filter(Boolean).join("\n").slice(0, 20_000), installedAt: new Date().toISOString() });
      break;
    }
  }
  return receipts;
}
