import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".cache", ".venv", "venv"]);
const SENSITIVE_NAMES = new Set([".env", ".npmrc", ".pypirc", "id_rsa", "id_ed25519", "credentials.json", "secrets.json"]);
const TEXT_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".md", ".mjs", ".php", ".ps1", ".py", ".rb", ".rs", ".scss", ".sh", ".sql", ".svelte", ".swift", ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml"]);
const MAX_TREE_FILES = 2_000;
const MAX_READ_BYTES = 1_000_000;

export interface DevelopmentWorkspaceFile {
  path: string;
  byteLength: number;
  readable: boolean;
}

export function listDevelopmentWorkspace(workspacePath: string): { files: DevelopmentWorkspaceFile[]; truncated: boolean } {
  const workspace = safeWorkspaceRoot(workspacePath);
  const files: DevelopmentWorkspaceFile[] = [];
  const visit = (directory: string): void => {
    if (files.length >= MAX_TREE_FILES) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= MAX_TREE_FILES) return;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile()) continue;
      const path = relative(workspace, absolute).replace(/\\/g, "/");
      if (isSensitivePath(path)) continue;
      const size = statSync(absolute).size;
      files.push({ path, byteLength: size, readable: size <= MAX_READ_BYTES && isTextPath(path) });
    }
  };
  visit(workspace);
  return { files, truncated: files.length >= MAX_TREE_FILES };
}

export function readDevelopmentWorkspaceFile(workspacePath: string, requestedPath: string): { path: string; content: string; byteLength: number } {
  const workspace = safeWorkspaceRoot(workspacePath);
  const normalized = String(requestedPath || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || isSensitivePath(normalized)) {
    throw new Error("这个文件不在可读取的项目范围内。");
  }
  const target = resolve(workspace, normalized);
  assertInside(workspace, target);
  if (!existsSync(target) || !statSync(target).isFile() || statSync(target).isSymbolicLink()) throw new Error("找不到这个项目文件。");
  const realTarget = realpathSync(target);
  assertInside(workspace, realTarget);
  const byteLength = statSync(realTarget).size;
  if (byteLength > MAX_READ_BYTES) throw new Error("文件超过 1 MB，请在本机编辑器中打开。");
  if (!isTextPath(normalized)) throw new Error("这个文件不适合在网页中按文本查看。");
  return { path: normalized, content: readFileSync(realTarget, "utf8"), byteLength };
}

function safeWorkspaceRoot(workspacePath: string): string {
  const resolved = resolve(String(workspacePath || ""));
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error("项目文件夹已经不存在。");
  return realpathSync(resolved);
}

function assertInside(workspace: string, target: string): void {
  const normalizedRoot = workspace.endsWith(sep) ? workspace : `${workspace}${sep}`;
  if (target !== workspace && !target.startsWith(normalizedRoot)) throw new Error("文件超出项目范围。");
}

function isSensitivePath(path: string): boolean {
  return path.split("/").some((part) => SENSITIVE_NAMES.has(part.toLowerCase()) || part.toLowerCase().startsWith(".env."));
}

function isTextPath(path: string): boolean {
  const name = path.toLowerCase();
  if (["dockerfile", "makefile", "license", "readme"].includes(name.split("/").pop() || "")) return true;
  const dot = name.lastIndexOf(".");
  return dot >= 0 && TEXT_EXTENSIONS.has(name.slice(dot));
}
