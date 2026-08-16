import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { buildDevelopmentCodeMap, renderDevelopmentCodeMap, selectRelevantCodeMapFiles } from "./development-code-map.js";
import { listDevelopmentWorkspace, readDevelopmentWorkspaceFile } from "./development-workspace.js";

export const DEVELOPMENT_CONTEXT_KINDS = ["instruction", "project", "code_map", "file", "diff", "decision", "attachment", "summary"] as const;
export type DevelopmentContextKind = typeof DEVELOPMENT_CONTEXT_KINDS[number];

export interface DevelopmentContextItem {
  id: string;
  kind: DevelopmentContextKind;
  label: string;
  content: string;
  path?: string;
  fingerprint: string;
  tokenEstimate: number;
  truncated: boolean;
}

export interface DevelopmentContextBundle {
  version: 1;
  createdAt: string;
  workspacePath: string;
  budgetTokens: number;
  tokenEstimate: number;
  itemCount: number;
  selectedPaths: string[];
  autoSelectedPaths?: string[];
  includeGitDiff: boolean;
  autoSelect?: boolean;
  items: DevelopmentContextItem[];
}

export interface DevelopmentContextSelection {
  selectedPaths?: unknown;
  includeGitDiff?: unknown;
  autoSelect?: unknown;
}

const MAX_SELECTED_FILES = 12;
const MAX_FILE_CHARS = 48_000;
const MAX_DIFF_CHARS = 72_000;
const DEFAULT_BUDGET_TOKENS = 32_000;

export function normalizeDevelopmentContextSelection(value: unknown): { selectedPaths: string[]; includeGitDiff: boolean; autoSelect: boolean } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const selectedPaths = Array.isArray(record.selectedPaths)
    ? [...new Set(record.selectedPaths.map((item) => String(item).replace(/\\/g, "/").trim()).filter(Boolean))].slice(0, MAX_SELECTED_FILES)
    : [];
  return { selectedPaths, includeGitDiff: record.includeGitDiff !== false, autoSelect: record.autoSelect !== false };
}

export function buildDevelopmentContextBundle(input: {
  workspacePath: string;
  instruction: string;
  selection?: DevelopmentContextSelection;
  decisions?: string[];
  budgetTokens?: number;
}): DevelopmentContextBundle {
  const selection = normalizeDevelopmentContextSelection(input.selection);
  const budgetTokens = clampBudget(input.budgetTokens);
  const items: DevelopmentContextItem[] = [];
  appendItem(items, "instruction", "用户目标", String(input.instruction || "").trim(), undefined, false);
  appendItem(items, "project", `项目：${basename(input.workspacePath) || "当前项目"}`, projectSummary(input.workspacePath), undefined, false);
  const codeMap = buildDevelopmentCodeMap(input.workspacePath);
  appendItem(items, "code_map", "项目代码地图", renderDevelopmentCodeMap(codeMap), undefined, false);

  for (const path of selection.selectedPaths) {
    try {
      const file = readDevelopmentWorkspaceFile(input.workspacePath, path);
      const content = file.content.slice(0, MAX_FILE_CHARS);
      appendItem(items, "file", path, content, path, file.content.length > content.length);
    } catch {
      // 文件可能在用户确认到任务真正启动之间发生变化；跳过失效项，不用旧内容冒充当前上下文。
    }
  }

  const autoSelectedPaths = selection.autoSelect
    ? selectRelevantCodeMapFiles(codeMap, input.instruction, selection.selectedPaths)
    : [];
  for (const path of autoSelectedPaths) {
    try {
      const file = readDevelopmentWorkspaceFile(input.workspacePath, path);
      const content = file.content.slice(0, MAX_FILE_CHARS);
      appendItem(items, "file", `自动选择：${path}`, content, path, file.content.length > content.length);
    } catch {
      // 自动选择仅使用当前仍可安全读取的文件。
    }
  }

  if (selection.includeGitDiff) {
    const diff = gitDiff(input.workspacePath);
    if (diff) appendItem(items, "diff", "当前 Git 差异", diff.content, undefined, diff.truncated);
  }

  const decisions = Array.isArray(input.decisions)
    ? input.decisions.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : [];
  if (decisions.length) appendItem(items, "decision", "已确认决定", decisions.map((item) => `- ${item}`).join("\n"), undefined, false);

  const fitted = fitItemsToBudget(items, budgetTokens);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    workspacePath: input.workspacePath,
    budgetTokens,
    tokenEstimate: fitted.reduce((sum, item) => sum + item.tokenEstimate, 0),
    itemCount: fitted.length,
    selectedPaths: fitted.filter((item) => item.kind === "file" && item.path && !item.label.startsWith("自动选择：")).map((item) => item.path!),
    autoSelectedPaths: fitted.filter((item) => item.kind === "file" && item.path && item.label.startsWith("自动选择：")).map((item) => item.path!),
    includeGitDiff: fitted.some((item) => item.kind === "diff"),
    autoSelect: selection.autoSelect,
    items: fitted,
  };
}

export function renderDevelopmentContextBundle(bundle: DevelopmentContextBundle | undefined): string {
  if (!bundle?.items?.length) return "";
  const sections = bundle.items.map((item) => {
    const location = item.path ? `（${item.path}）` : "";
    const truncated = item.truncated ? "\n\n[内容因上下文额度已截断]" : "";
    return `### ${item.label}${location}\n\n${item.content}${truncated}`;
  });
  return [
    "## 本次上下文包",
    "以下内容由用户选择或由当前项目实时生成。项目文件本身仍是最终事实来源；如两者冲突，先重新读取项目。",
    ...sections,
  ].join("\n\n");
}

export function developmentContextSummary(bundle: DevelopmentContextBundle | undefined): {
  itemCount: number;
  tokenEstimate: number;
  budgetTokens: number;
  usageRatio: number;
  selectedPaths: string[];
  autoSelectedPaths: string[];
  includesDiff: boolean;
  fingerprints: string[];
  codeMapFiles: number;
} {
  const tokenEstimate = Number(bundle?.tokenEstimate || 0);
  const budgetTokens = Number(bundle?.budgetTokens || DEFAULT_BUDGET_TOKENS);
  return {
    itemCount: Number(bundle?.itemCount || 0),
    tokenEstimate,
    budgetTokens,
    usageRatio: budgetTokens ? Math.min(1, tokenEstimate / budgetTokens) : 0,
    selectedPaths: Array.isArray(bundle?.selectedPaths) ? [...bundle.selectedPaths] : [],
    autoSelectedPaths: Array.isArray(bundle?.autoSelectedPaths) ? [...bundle.autoSelectedPaths] : [],
    includesDiff: bundle?.includeGitDiff === true,
    fingerprints: Array.isArray(bundle?.items) ? bundle.items.map((item) => item.fingerprint) : [],
    codeMapFiles: Number(bundle?.items?.find((item) => item.kind === "code_map")?.content.match(/分析 (\d+) 个主要源文件/)?.[1] || 0),
  };
}

function appendItem(
  target: DevelopmentContextItem[],
  kind: DevelopmentContextKind,
  label: string,
  content: string,
  path: string | undefined,
  truncated: boolean,
): void {
  const normalized = content.trim();
  if (!normalized) return;
  const fingerprint = createHash("sha256").update(normalized).digest("hex");
  target.push({
    id: `${kind}:${fingerprint.slice(0, 16)}`,
    kind,
    label,
    content: normalized,
    path,
    fingerprint,
    tokenEstimate: estimateTokens(normalized),
    truncated,
  });
}

function projectSummary(workspacePath: string): string {
  try {
    const listing = listDevelopmentWorkspace(workspacePath);
    const files = listing.files.slice(0, 160).map((file) => file.path);
    return [
      `项目目录：${workspacePath}`,
      `可见文件：${listing.files.length}${listing.truncated ? "（列表已截断）" : ""}`,
      files.length ? `目录概览：\n${files.map((path) => `- ${path}`).join("\n")}` : "当前目录还没有可见文件。",
    ].join("\n");
  } catch {
    return `项目目录：${workspacePath}`;
  }
}

function gitDiff(workspacePath: string): { content: string; truncated: boolean } | undefined {
  try {
    const raw = execFileSync("git", ["diff", "--no-ext-diff", "--unified=3", "--", "."], {
      cwd: workspacePath,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 2_000_000,
      encoding: "utf8",
    });
    const value = String(raw || "").trim();
    if (!value) return undefined;
    return { content: value.slice(0, MAX_DIFF_CHARS), truncated: value.length > MAX_DIFF_CHARS };
  } catch {
    return undefined;
  }
}

function fitItemsToBudget(items: DevelopmentContextItem[], budgetTokens: number): DevelopmentContextItem[] {
  const fitted: DevelopmentContextItem[] = [];
  let remaining = budgetTokens;
  for (const item of items) {
    if (remaining < 64) break;
    if (item.tokenEstimate <= remaining) {
      fitted.push(item);
      remaining -= item.tokenEstimate;
      continue;
    }
    const content = item.content.slice(0, Math.max(200, remaining * 3));
    const tokenEstimate = estimateTokens(content);
    fitted.push({ ...item, content, tokenEstimate, truncated: true });
    remaining -= tokenEstimate;
  }
  return fitted;
}

function estimateTokens(value: string): number {
  const latin = (value.match(/[\x00-\xff]/g) || []).length;
  const nonLatin = value.length - latin;
  return Math.max(1, Math.ceil(latin / 4 + nonLatin / 1.6));
}

function clampBudget(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(128_000, Math.max(4_000, Math.round(parsed))) : DEFAULT_BUDGET_TOKENS;
}
