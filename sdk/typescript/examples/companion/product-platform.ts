import { execFileSync } from "node:child_process";

export type PlatformConnectorId = "github" | "browser" | "email" | "calendar";

export interface PlatformConnectorStatus {
  id: PlatformConnectorId;
  name: string;
  purpose: string;
  state: "ready" | "available" | "not-installed";
  extensionId?: string;
  missingCapabilities: string[];
  readOnlyDefault: true;
  minimumPermissions: string[];
  fallback: string;
}

const CONNECTORS: Array<{ id: PlatformConnectorId; name: string; purpose: string; tokens: string[]; minimumPermissions: string[]; fallback: string }> = [
  { id: "github", name: "GitHub", purpose: "读取仓库、问题和合并请求；写入、评论和合并必须再次确认。", tokens: ["github", "repository", "pull_request"], minimumPermissions: ["仓库内容只读", "议题与合并请求只读"], fallback: "仍可在本地项目文件夹中开发和生成补丁。" },
  { id: "browser", name: "浏览器", purpose: "打开已授权域名、采集资料并保留网页证据。", tokens: ["browser", "playwright", "web"], minimumPermissions: ["当前任务授权的域名", "页面读取"], fallback: "用户可粘贴网页内容或导入本地文件。" },
  { id: "email", name: "邮箱", purpose: "检索和整理邮件；发送、移动和删除必须再次确认。", tokens: ["email", "mail", "gmail", "outlook"], minimumPermissions: ["邮件只读", "指定账号"], fallback: "用户可导出或粘贴邮件内容进行整理。" },
  { id: "calendar", name: "日历", purpose: "查询日程并发现冲突；新建和修改日程必须再次确认。", tokens: ["calendar", "schedule", "event"], minimumPermissions: ["日历事件只读", "指定日历"], fallback: "用户可导出日历或手动提供时间安排。" },
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
      readOnlyDefault: true,
      minimumPermissions: [...connector.minimumPermissions],
      fallback: connector.fallback,
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

export function capabilityPackStatuses(
  abilities: Array<{ id: string }>,
  artifacts: Array<{ capabilityId: string; proof?: { level?: string } }>,
) {
  const abilityIds = new Set(abilities.map((item) => item.id));
  return DOMAIN_CAPABILITY_PACKS.map((pack) => {
    const missingAbilities = pack.abilities.filter((id) => !abilityIds.has(id));
    const verifiedAbilities = pack.abilities.filter((id) => artifacts.some((artifact) => artifact.capabilityId === id && ["verified", "approved"].includes(String(artifact.proof?.level || ""))));
    const approvedAbilities = pack.abilities.filter((id) => artifacts.some((artifact) => artifact.capabilityId === id && artifact.proof?.level === "approved"));
    const state = missingAbilities.length
      ? "experimental"
      : approvedAbilities.length === pack.abilities.length
        ? "production-ready"
        : verifiedAbilities.length === pack.abilities.length
          ? "verified"
          : "available";
    return { ...pack, state, missingAbilities, verifiedAbilities, approvedAbilities };
  });
}

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
    ...source.proposals.filter((item) => item.state === "pending" || item.state === "conflicted")
      .map((item) => ({ id: `proposal:${item.id}`, kind: "development-proposal", priority: item.state === "conflicted" ? 0 : 1, title: item.workspacePath || "开发修改待审阅", sourceId: item.id, at: item.createdAt })),
  ];
  return items.sort((a, b) => a.priority - b.priority || String(b.at || "").localeCompare(String(a.at || "")));
}
