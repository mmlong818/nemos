import { DOMAIN_PACK_QUALITY_CASES } from "./domain-pack-quality.js";

export type PlatformConnectorId = "files" | "browser" | "github" | "email" | "calendar" | "enterprise-docs";

export interface PlatformConnectorStatus {
  id: PlatformConnectorId;
  name: string;
  purpose: string;
  state: "ready" | "available" | "not-installed";
  reason: "ready" | "disabled" | "not-connected" | "runtime-error" | "blocked" | "not-installed";
  detail: string;
  provider: "built-in" | "extension";
  extensionId?: string;
  missingCapabilities: string[];
  readOnlyDefault: true;
  minimumPermissions: string[];
  fallback: string;
}

const CONNECTORS: Array<{ id: PlatformConnectorId; name: string; purpose: string; tokens: string[]; minimumPermissions: string[]; fallback: string }> = [
  { id: "files", name: "本地文件", purpose: "读取用户明确选择的文件和资料；不会扫描未授权目录。", tokens: ["local-file", "filesystem", "file.read"], minimumPermissions: ["用户明确选择的文件", "应用资料库"], fallback: "仍可粘贴文字或在任务中单独上传文件。" },
  { id: "github", name: "GitHub", purpose: "读取仓库、问题和合并请求；写入、评论和合并必须再次确认。", tokens: ["github", "repository", "pull_request"], minimumPermissions: ["仓库内容只读", "议题与合并请求只读"], fallback: "仍可在本地项目文件夹中开发和生成补丁。" },
  { id: "browser", name: "浏览器", purpose: "打开已授权域名、采集资料并保留网页证据。", tokens: ["browser", "playwright", "web"], minimumPermissions: ["当前任务授权的域名", "页面读取"], fallback: "用户可粘贴网页内容或导入本地文件。" },
  { id: "email", name: "邮箱", purpose: "检索和整理邮件；发送、移动和删除必须再次确认。", tokens: ["email", "mail", "gmail", "outlook"], minimumPermissions: ["邮件只读", "指定账号"], fallback: "用户可导出或粘贴邮件内容进行整理。" },
  { id: "calendar", name: "日历", purpose: "查询日程并发现冲突；新建和修改日程必须再次确认。", tokens: ["calendar", "schedule", "event"], minimumPermissions: ["日历事件只读", "指定日历"], fallback: "用户可导出日历或手动提供时间安排。" },
  { id: "enterprise-docs", name: "企业文档", purpose: "读取已授权的团队文档和知识库；编辑、移动或分享必须再次确认。", tokens: ["feishu", "lark", "notion", "confluence", "enterprise-docs", "knowledge-base"], minimumPermissions: ["指定知识库只读", "指定组织空间"], fallback: "可先导出文件，再导入本地资料库。" },
];

interface ExtensionLike {
  enabled?: boolean;
  providerAttached?: boolean;
  runtimeError?: string | null;
  executionSecurity?: string;
  manifest?: { id?: string; name?: string; capabilities?: string[]; tools?: Array<{ name?: string }> };
}

export function extensionRuntimeReady(extension: ExtensionLike): boolean {
  return extension.enabled === true && extension.providerAttached === true
    && !extension.runtimeError && extension.executionSecurity !== "blocked";
}

export function platformConnectorStatuses(
  extensions: ExtensionLike[],
  builtIns: Partial<Record<PlatformConnectorId, boolean>> = { files: true },
): PlatformConnectorStatus[] {
  return CONNECTORS.map((connector) => {
    const matches = extensions.filter((extension) => {
      const manifest = extension.manifest ?? {};
      const haystack = [manifest.id, manifest.name, ...(manifest.capabilities ?? []), ...(manifest.tools ?? []).map((tool) => tool.name)]
        .filter(Boolean).join(" ").toLowerCase();
      return connector.tokens.some((token) => haystack.includes(token));
    });
    const match = matches.find(extensionRuntimeReady) ?? matches[0];
    const builtInReady = builtIns[connector.id] === true;
    const ready = builtInReady || Boolean(match && extensionRuntimeReady(match));
    const reason: PlatformConnectorStatus["reason"] = ready ? "ready"
      : !match ? "not-installed"
      : match.executionSecurity === "blocked" ? "blocked"
      : !match.enabled ? "disabled"
      : match.runtimeError ? "runtime-error" : "not-connected";
    const detail = {
      ready: "运行时已连接；账号权限和具体操作可用性仍以测试结果为准。",
      "not-installed": "尚未安装对应连接器。",
      blocked: "扩展缺少执行授权，当前不可调用。",
      disabled: "连接器已安装，但尚未启用。",
      "runtime-error": "连接器启动或连接失败，请检查扩展状态后重新连接。",
      "not-connected": "连接器已安装，但运行时尚未连接。",
    }[reason];
    return {
      id: connector.id,
      name: connector.name,
      purpose: connector.purpose,
      state: ready ? "ready" : match ? "available" : "not-installed",
      reason,
      detail: builtInReady ? "本机入口可用，仅访问你明确提供或授权的资料。" : detail,
      provider: builtInReady ? "built-in" : "extension",
      extensionId: builtInReady ? undefined : match?.manifest?.id,
      missingCapabilities: ready ? [] : connector.tokens.slice(0, 1),
      readOnlyDefault: true,
      minimumPermissions: [...connector.minimumPermissions],
      fallback: connector.fallback,
    };
  });
}

export const DOMAIN_CAPABILITY_PACKS = [
  { id: "research", name: "研究", abilities: ["research-brief", "thinking-workbench", "decision-brief"], deliverables: ["html", "doc", "md"], quality: ["来源可追溯", "事实与判断分开", "保留不确定性"] },
  { id: "office", name: "办公", abilities: ["document-draft", "presentation-builder", "meeting-minutes"], deliverables: ["doc", "pptx", "xlsx", "pdf"], quality: ["结构可编辑", "版式可复用", "导出前检查"] },
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
    return {
      ...pack,
      state,
      missingAbilities,
      verifiedAbilities,
      approvedAbilities,
      qualitySampleCount: DOMAIN_PACK_QUALITY_CASES.filter((item) => item.packId === pack.id).length,
    };
  });
}

export interface ReviewQueueSource {
  approvals: Array<{ id: string; runId?: string; status?: string; expiresAt?: string; createdAt?: string; description?: string; tool?: { name?: string; description?: string } }>;
  jobs: Array<{ id: string; status: string; title?: string; updatedAt?: string; error?: string; delivery?: { status?: string } | null; payload?: Record<string, unknown>; deliveryRequired?: boolean; deliveredAt?: string }>;
  runs?: Array<{ runId: string; status: string; updatedAt?: string; error?: string; resumable?: boolean; metadata?: Record<string, string> }>;
}

export interface ReviewQueueItem {
  id: string;
  groupId: string;
  kind: "approval" | "job" | "run" | "delivery";
  priority: number;
  title: string;
  nextAction: string;
  sourceId: string;
  at?: string;
}

export function buildReviewQueue(source: ReviewQueueSource, now = Date.now()): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];
  for (const item of source.approvals) {
    if (item.status && item.status !== "pending") continue;
    if (item.expiresAt && (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= now)) continue;
    items.push({ id: `approval:${item.id}`, groupId: item.runId ? `run:${item.runId}` : `approval:${item.id}`,
      kind: "approval", priority: 1, title: item.description || item.tool?.description || item.tool?.name || "待确认操作",
      nextAction: "查看操作内容后决定允许或拒绝。", sourceId: item.id, at: item.createdAt });
  }
  for (const item of source.jobs) {
    const uncertain = item.status === "uncertain" || item.delivery?.status === "uncertain";
    const delivery = item.status === "succeeded" && item.deliveryRequired === true && !item.deliveredAt;
    if (!uncertain && item.status !== "failed" && !delivery) continue;
    items.push({ id: `job:${item.id}`, groupId: `job:${item.id}`, kind: delivery && !uncertain ? "delivery" : "job",
      priority: uncertain ? 0 : delivery ? 3 : 2,
      title: item.title || (typeof item.payload?.title === "string" ? item.payload.title : "") || "后台任务",
      nextAction: uncertain ? "先核对实际执行结果，不要直接重试。" : delivery ? "任务已完成，等待送达对话；可先查看运行结果。" : "查看失败原因，再决定是否重试。",
      sourceId: item.id, at: item.updatedAt });
  }
  for (const item of source.runs ?? []) {
    if (!["failed", "interrupted", "paused"].includes(item.status)) continue;
    items.push({ id: `run:${item.runId}`, groupId: `run:${item.runId}`, kind: "run", priority: 2,
      title: item.metadata?.objective || item.metadata?.title || "需要处理的执行",
      nextAction: item.resumable ? "执行已中断，可查看记录后恢复。" : "查看执行记录，核对中断原因及已产生的结果。",
      sourceId: item.runId, at: item.updatedAt });
  }
  // Stable source IDs prevent repeated snapshots from multiplying attention items.
  const unique = new Map<string, ReviewQueueItem>();
  for (const item of items) {
    const previous = unique.get(item.id);
    if (!previous || String(item.at || "") >= String(previous.at || "")) unique.set(item.id, item);
  }
  return [...unique.values()].sort((a, b) => a.priority - b.priority
    || String(b.at || "").localeCompare(String(a.at || "")) || a.id.localeCompare(b.id));
}

/** Buzz inbox-inspired stable grouping; approvals keep their individual IDs/decisions. */
export function groupReviewQueue(items: ReviewQueueItem[]) {
  const groups = new Map<string, { id: string; title: string; priority: number; items: ReviewQueueItem[] }>();
  for (const item of items) {
    const group = groups.get(item.groupId) ?? { id: item.groupId, title: item.title, priority: item.priority, items: [] };
    group.items.push(item);
    groups.set(item.groupId, group);
  }
  return [...groups.values()];
}
