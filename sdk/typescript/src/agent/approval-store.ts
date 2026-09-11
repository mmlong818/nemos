import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  AgentToolAuthorizationInput,
  AgentToolAuthorizationResult,
  AgentToolCall,
  AgentToolDefinition,
} from "./types.js";

export type AgentApprovalStatus = "pending" | "approved" | "denied" | "consumed" | "expired" | "cancelled";

/**
 * 批准的作用范围。
 *
 * - `once`：只放行这一次调用（默认，与原有行为一致）。
 * - `session`：同一会话内，同名工具的后续调用不再询问。
 *
 * 比 work-guidelines 的 `allow-automatically` 保守：那个跨会话永久生效，这个随会话结束失效。
 * 更严格的 `never` 仍在准则层先判定，会话级授权到不了那里，挡不住它。
 */
export type AgentApprovalScope = "once" | "session";

export interface AgentApprovalSessionGrant {
  sessionId: string;
  tool: string;
  /** 产生这条授权的那次批准，用于溯源。 */
  approvalId: string;
  grantedAt: string;
}

export interface AgentApprovalRecord {
  id: string;
  fingerprint: string;
  runId: string;
  sessionId: string;
  call: AgentToolCall;
  tool: AgentToolDefinition;
  metadata?: Record<string, string>;
  status: AgentApprovalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decidedAt?: string;
  consumedAt?: string;
  reason?: string;
}

export interface AgentApprovalSummary extends AgentApprovalRecord {
  active: boolean;
}

export interface AgentApprovalStoreEvent {
  action: "requested" | "approved" | "denied" | "consumed" | "expired" | "cancelled";
  approval: Pick<AgentApprovalRecord, "id" | "runId" | "sessionId" | "status" | "updatedAt">;
}

export interface FileAgentApprovalStoreOptions {
  ttlMs?: number;
  maxApprovals?: number;
  maxSessionGrants?: number;
  onChange?: (event: AgentApprovalStoreEvent) => void;
}

interface ApprovalFile {
  version: 1;
  approvals: AgentApprovalRecord[];
  // 会话级授权是后加的字段，故意不升 version：旧版本读到会忽略它、退回逐次询问，
  // 那是偏保守的方向；升 version 反而让旧版本整份拒读，连待处理审批一起丢。
  sessionGrants?: AgentApprovalSessionGrant[];
}

interface ApprovalWaiter {
  resolve: (result: AgentToolAuthorizationResult) => void;
  cleanup: () => void;
}

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_APPROVALS = 1_000;
const DEFAULT_MAX_SESSION_GRANTS = 500;

/** 持久化工具审批。运行中等待用户决定，批准只允许匹配的调用执行一次。 */
export class FileAgentApprovalStore {
  private readonly approvals = new Map<string, AgentApprovalRecord>();
  private readonly waiters = new Map<string, ApprovalWaiter>();
  /** sessionId -> 工具名 -> 授权。 */
  private readonly sessionGrants = new Map<string, Map<string, AgentApprovalSessionGrant>>();
  private readonly ttlMs: number;
  private readonly maxApprovals: number;
  private readonly maxSessionGrants: number;
  private readonly onChange?: FileAgentApprovalStoreOptions["onChange"];

  constructor(private readonly file: string, options: FileAgentApprovalStoreOptions = {}) {
    this.ttlMs = Math.min(60 * 60_000, Math.max(30_000, options.ttlMs ?? DEFAULT_TTL_MS));
    this.maxApprovals = Math.min(10_000, Math.max(10, options.maxApprovals ?? DEFAULT_MAX_APPROVALS));
    this.maxSessionGrants = Math.min(5_000, Math.max(10, options.maxSessionGrants ?? DEFAULT_MAX_SESSION_GRANTS));
    this.onChange = options.onChange;
    mkdirSync(dirname(file), { recursive: true });
    this.load();
    this.expireDue();
  }

  authorize(input: AgentToolAuthorizationInput): Promise<AgentToolAuthorizationResult> {
    this.expireDue();
    // 会话级授权优先于指纹匹配：指纹含 runId 与具体参数，只能让同一次调用免于重复询问，
    // 覆盖不了"这个会话里这个工具换个参数再来一次"。
    const granted = this.sessionGrants.get(input.sessionId)?.get(input.call.name);
    if (granted) {
      return Promise.resolve({
        allowed: true,
        approvalId: granted.approvalId,
        reason: "allowed for this session by user",
      });
    }
    const fingerprint = approvalFingerprint(input);
    const reusable = [...this.approvals.values()].find((item) =>
      item.fingerprint === fingerprint && item.status === "approved" && !isExpired(item));
    if (reusable) return Promise.resolve(this.consume(reusable));

    const existing = [...this.approvals.values()].find((item) =>
      item.fingerprint === fingerprint && item.status === "pending" && !isExpired(item));
    const approval = existing ?? this.create(input, fingerprint);
    if (this.waiters.has(approval.id)) {
      return Promise.resolve({
        allowed: false,
        approvalId: approval.id,
        reason: "an identical tool call is already waiting for approval",
      });
    }
    return this.wait(approval, input.signal);
  }

  decide(id: string, allowed: boolean, reason?: string, scope: AgentApprovalScope = "once"): AgentApprovalSummary {
    this.expireDue();
    const approval = this.require(id);
    if (approval.status !== "pending") throw new Error(`Approval is not pending: ${approval.status}`);

    const now = new Date().toISOString();
    approval.status = allowed ? "approved" : "denied";
    approval.updatedAt = now;
    approval.decidedAt = now;
    approval.reason = cleanText(reason || (allowed ? "approved by user" : "denied by user"));
    if (allowed && scope === "session") this.grantSession(approval);
    this.save();
    this.emit(allowed ? "approved" : "denied", approval);

    const waiter = this.waiters.get(id);
    waiter?.resolve({ allowed, approvalId: id, reason: approval.reason });
    return this.summary(approval);
  }

  list(options: { status?: AgentApprovalStatus; limit?: number } = {}): AgentApprovalSummary[] {
    this.expireDue();
    const limit = Math.min(500, Math.max(1, options.limit ?? 50));
    return [...this.approvals.values()]
      .filter((item) => !options.status || item.status === options.status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((item) => this.summary(item));
  }

  get(id: string): AgentApprovalSummary | null {
    this.expireDue();
    const item = this.approvals.get(id);
    return item ? this.summary(item) : null;
  }

  /** 当前生效的会话级授权，新的在前。不传 sessionId 就返回全部。 */
  listSessionGrants(sessionId?: string): AgentApprovalSessionGrant[] {
    const all = [...this.sessionGrants.values()].flatMap((tools) => [...tools.values()]);
    return all
      .filter((grant) => !sessionId || grant.sessionId === sessionId)
      .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
  }

  private grantSession(approval: AgentApprovalRecord): void {
    const tools = this.sessionGrants.get(approval.sessionId) ?? new Map<string, AgentApprovalSessionGrant>();
    tools.set(approval.call.name, {
      sessionId: approval.sessionId,
      tool: approval.call.name,
      approvalId: approval.id,
      grantedAt: approval.updatedAt,
    });
    this.sessionGrants.set(approval.sessionId, tools);
    this.pruneSessionGrants();
  }

  private pruneSessionGrants(): void {
    const ordered = this.listSessionGrants();
    if (ordered.length <= this.maxSessionGrants) return;
    for (const stale of ordered.slice(this.maxSessionGrants)) {
      const tools = this.sessionGrants.get(stale.sessionId);
      tools?.delete(stale.tool);
      if (tools && tools.size === 0) this.sessionGrants.delete(stale.sessionId);
    }
  }

  private create(input: AgentToolAuthorizationInput, fingerprint: string): AgentApprovalRecord {
    const now = new Date();
    const approval: AgentApprovalRecord = {
      id: randomUUID(),
      fingerprint,
      runId: input.runId,
      sessionId: input.sessionId,
      call: sanitizeCall(input.call),
      tool: sanitizeTool(input.tool),
      metadata: sanitizeMetadata(input.metadata),
      status: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
    };
    this.approvals.set(approval.id, approval);
    this.prune();
    this.save();
    this.emit("requested", approval);
    return approval;
  }

  private wait(approval: AgentApprovalRecord, signal: AbortSignal): Promise<AgentToolAuthorizationResult> {
    if (signal.aborted) {
      this.cancel(approval, "tool call cancelled before approval");
      return Promise.resolve({ allowed: false, approvalId: approval.id, reason: "cancelled" });
    }

    return new Promise((resolve) => {
      let finished = false;
      let timer: NodeJS.Timeout;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        this.waiters.delete(approval.id);
      };
      const finish = (result: AgentToolAuthorizationResult): void => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(result.allowed ? this.consume(approval) : result);
      };
      const onAbort = (): void => {
        this.cancel(approval, "tool call cancelled while waiting for approval");
        finish({ allowed: false, approvalId: approval.id, reason: "cancelled" });
      };
      timer = setTimeout(() => {
        this.expire(approval);
        finish({ allowed: false, approvalId: approval.id, reason: "approval expired" });
      }, Math.max(1, Date.parse(approval.expiresAt) - Date.now()));
      timer.unref?.();
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.set(approval.id, { resolve: finish, cleanup });
    });
  }

  private consume(approval: AgentApprovalRecord): AgentToolAuthorizationResult {
    if (approval.status !== "approved") {
      return { allowed: false, approvalId: approval.id, reason: approval.reason ?? approval.status };
    }
    const now = new Date().toISOString();
    approval.status = "consumed";
    approval.updatedAt = now;
    approval.consumedAt = now;
    this.save();
    this.emit("consumed", approval);
    return { allowed: true, approvalId: approval.id, reason: approval.reason };
  }

  private cancel(approval: AgentApprovalRecord, reason: string): void {
    if (approval.status !== "pending") return;
    approval.status = "cancelled";
    approval.reason = reason;
    approval.updatedAt = new Date().toISOString();
    this.save();
    this.emit("cancelled", approval);
  }

  private expireDue(): void {
    let changed = false;
    for (const approval of this.approvals.values()) {
      if ((approval.status === "pending" || approval.status === "approved") && isExpired(approval)) {
        this.expire(approval, false);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private expire(approval: AgentApprovalRecord, save = true): void {
    if (approval.status !== "pending" && approval.status !== "approved") return;
    approval.status = "expired";
    approval.reason = "approval expired";
    approval.updatedAt = new Date().toISOString();
    if (save) this.save();
    this.emit("expired", approval);
  }

  private require(id: string): AgentApprovalRecord {
    const item = this.approvals.get(id);
    if (!item) throw new Error("Agent approval not found");
    return item;
  }

  private summary(item: AgentApprovalRecord): AgentApprovalSummary {
    return { ...structuredClone(item), active: this.waiters.has(item.id) };
  }

  private prune(): void {
    const ordered = [...this.approvals.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const item of ordered.slice(this.maxApprovals)) {
      if (!this.waiters.has(item.id)) this.approvals.delete(item.id);
    }
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as ApprovalFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.approvals)) return;
      for (const grant of Array.isArray(parsed.sessionGrants) ? parsed.sessionGrants : []) {
        if (!grant?.sessionId || !grant.tool || !grant.approvalId) continue;
        const tools = this.sessionGrants.get(grant.sessionId) ?? new Map<string, AgentApprovalSessionGrant>();
        tools.set(grant.tool, grant);
        this.sessionGrants.set(grant.sessionId, tools);
      }
      for (const item of parsed.approvals) {
        if (!item?.id) continue;
        const normalized = {
          ...item,
          runId: item.runId || item.sessionId,
        };
        this.approvals.set(item.id, normalized);
      }
    } catch {
      // 审批记录损坏不阻塞客户端启动，新请求会重建有效文件。
    }
  }

  private save(): void {
    this.prune();
    const temp = `${this.file}.${process.pid}.tmp`;
    const payload: ApprovalFile = {
      version: 1,
      approvals: [...this.approvals.values()],
      sessionGrants: this.listSessionGrants(),
    };
    writeFileSync(temp, JSON.stringify(payload, null, 2));
    renameSync(temp, this.file);
  }

  private emit(action: AgentApprovalStoreEvent["action"], approval: AgentApprovalRecord): void {
    try {
      this.onChange?.({
        action,
        approval: {
          id: approval.id,
          runId: approval.runId,
          sessionId: approval.sessionId,
          status: approval.status,
          updatedAt: approval.updatedAt,
        },
      });
    } catch {
      // UI 事件失败不改变审批结论。
    }
  }
}

function approvalFingerprint(input: AgentToolAuthorizationInput): string {
  const stable = stableJson({
    runId: input.runId,
    name: input.call.name,
    arguments: input.call.arguments,
    effect: input.tool.effect ?? "write",
  });
  return createHash("sha256").update(stable).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sanitizeCall(call: AgentToolCall): AgentToolCall {
  return { ...call, arguments: sanitizeValue(call.arguments) as Record<string, unknown> };
}

function sanitizeTool(tool: AgentToolDefinition): AgentToolDefinition {
  return {
    ...tool,
    description: cleanText(tool.description),
    inputSchema: sanitizeValue(tool.inputSchema) as Record<string, unknown>,
  };
}

function sanitizeMetadata(value?: Readonly<Record<string, string>>): Record<string, string> | undefined {
  return value ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanText(item)])) : undefined;
}

function sanitizeValue<T>(value: T): T {
  return JSON.parse(cleanText(JSON.stringify(value))) as T;
}

function cleanText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2");
}

function isExpired(item: AgentApprovalRecord): boolean {
  return Date.parse(item.expiresAt) <= Date.now();
}
