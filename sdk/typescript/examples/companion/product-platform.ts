import { execFileSync } from "node:child_process";

export type PlatformConnectorId = "github" | "browser" | "email" | "calendar";

export interface PlatformConnectorStatus {
  id: PlatformConnectorId;
  name: string;
  purpose: string;
  state: "ready" | "available" | "not-installed";
  extensionId?: string;
  missingCapabilities: string[];
}

const CONNECTORS: Array<{ id: PlatformConnectorId; name: string; purpose: string; tokens: string[] }> = [
  { id: "github", name: "GitHub", purpose: "读取仓库、问题和合并请求，并把开发结果交回仓库。", tokens: ["github", "repository", "pull_request"] },
  { id: "browser", name: "浏览器", purpose: "打开网页、采集资料并验证网页操作。", tokens: ["browser", "playwright", "web"] },
  { id: "email", name: "邮箱", purpose: "检索邮件、整理往来，并在发送前请求确认。", tokens: ["email", "mail", "gmail", "outlook"] },
  { id: "calendar", name: "日历", purpose: "查询日程、发现冲突，并在写入前请求确认。", tokens: ["calendar", "schedule", "event"] },
];

interface ExtensionLike {
  enabled?: boolean;
  manifest?: { id?: string; name?: string; capabilities?: string[]; tools?: Array<{ name?: string }> };
}

export function platformConnectorStatuses(extensions: ExtensionLike[]): PlatformConnectorStatus[] {
  return CONNECTORS.map((connector) => {
    const match = extensions.find((extension) => {
      const manifest = extension.manifest ?? {};
      const haystack = [manifest.id, manifest.name, ...(manifest.capabilities ?? []), ...(manifest.tools ?? []).map((tool) => tool.name)]
        .filter(Boolean).join(" ").toLowerCase();
      return connector.tokens.some((token) => haystack.includes(token));
    });
    return {
      id: connector.id,
      name: connector.name,
      purpose: connector.purpose,
      state: match?.enabled ? "ready" : match ? "available" : "not-installed",
      extensionId: match?.manifest?.id,
      missingCapabilities: match?.enabled ? [] : connector.tokens.slice(0, 1),
    };
  });
}

export function developmentEnvironment() {
  return {
    node: commandVersion(process.execPath, ["--version"]),
    git: commandVersion("git", ["--version"]),
    python: commandVersion(process.platform === "win32" ? "python" : "python3", ["--version"]),
  };
}

function commandVersion(command: string, args: string[]) {
  try {
    const version = execFileSync(command, args, { encoding: "utf8", timeout: 3_000, windowsHide: true }).trim();
    return { available: true, version };
  } catch {
    return { available: false, version: "" };
  }
}

export const DOMAIN_CAPABILITY_PACKS = [
  { id: "research", name: "研究", abilities: ["research-brief", "thinking-workbench", "decision-brief"], deliverables: ["html", "doc", "md"], quality: ["来源可追溯", "事实与判断分开", "保留不确定性"] },
  { id: "office", name: "办公", abilities: ["document-draft", "presentation-builder", "meeting-minutes"], deliverables: ["doc", "pptx", "xlsx", "pdf"], quality: ["结构可编辑", "版式可复用", "导出前检查"] },
  { id: "development", name: "开发", abilities: ["project-development"], deliverables: ["workspace", "patch", "check-report"], quality: ["限定工作区", "真实检查", "可回滚提案"] },
  { id: "operations", name: "运营", abilities: ["html-report", "market-opportunity", "business-deal"], deliverables: ["html", "doc", "xlsx"], quality: ["目标受众明确", "行动项可执行", "指标口径一致"] },
  { id: "finance", name: "财务", abilities: ["market-briefing", "decision-brief"], deliverables: ["html", "xlsx", "pdf"], quality: ["数据注明时间", "不替用户做交易", "风险单独呈现"] },
] as const;

export interface ReviewQueueSource {
  approvals: Array<{ id: string; createdAt?: string; description?: string }>;
  jobs: Array<{ id: string; status: string; title?: string; updatedAt?: string; error?: string; delivery?: { status?: string } }>;
  proposals: Array<{ id: string; state: string; createdAt?: string; workspacePath?: string }>;
}

export function buildReviewQueue(source: ReviewQueueSource) {
  const items = [
    ...source.approvals.map((item) => ({ id: `approval:${item.id}`, kind: "approval", priority: 1, title: item.description || "待确认操作", sourceId: item.id, at: item.createdAt })),
    ...source.jobs.filter((item) => item.status === "failed" || item.status === "uncertain" || item.delivery?.status === "uncertain")
      .map((item) => ({ id: `job:${item.id}`, kind: "job", priority: item.status === "uncertain" || item.delivery?.status === "uncertain" ? 0 : 2, title: item.title || item.error || "需要处理的运行", sourceId: item.id, at: item.updatedAt })),
    ...source.proposals.filter((item) => item.state === "proposed" || item.state === "conflicted")
      .map((item) => ({ id: `proposal:${item.id}`, kind: "development-proposal", priority: item.state === "conflicted" ? 0 : 1, title: item.workspacePath || "开发修改待审阅", sourceId: item.id, at: item.createdAt })),
  ];
  return items.sort((a, b) => a.priority - b.priority || String(b.at || "").localeCompare(String(a.at || "")));
}
