import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DeliveryStatus = "pending" | "leased" | "delivered" | "failed";

export interface DeliveryRecord {
  id: string;
  dedupeKey: string;
  sourceType: string;
  sourceId: string;
  channel: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  leaseOwner?: string;
  leaseUntil?: string;
  receiptId?: string;
  deliveredAt?: string;
  failedAt?: string;
  lastError?: string;
}

interface DeliveryFile {
  version: 1;
  deliveries: DeliveryRecord[];
}

export interface DeliveryOutboxOptions {
  leaseMs?: number;
  retryBaseDelayMs?: number;
  maxRecords?: number;
}

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;

/**
 * 独立于任务运行状态的持久投递外发箱。任务成功只会创建待投递记录；
 * 客户端确认收到后，投递才进入 delivered。
 */
export class FileDeliveryOutbox {
  private readonly records = new Map<string, DeliveryRecord>();
  private readonly leaseMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRecords: number;

  constructor(private readonly file: string, options: DeliveryOutboxOptions = {}) {
    this.leaseMs = bounded(options.leaseMs, DEFAULT_LEASE_MS, 1_000, 10 * 60_000);
    this.retryBaseDelayMs = bounded(options.retryBaseDelayMs, DEFAULT_RETRY_DELAY_MS, 100, 60_000);
    this.maxRecords = bounded(options.maxRecords, 2_000, 100, 20_000);
    mkdirSync(dirname(file), { recursive: true });
    this.load();
    this.recoverExpired(new Date());
  }

  enqueue(input: {
    dedupeKey: string;
    sourceType: string;
    sourceId: string;
    channel: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }): DeliveryRecord {
    const dedupeKey = required(input.dedupeKey, "dedupeKey");
    const existing = [...this.records.values()].find((item) => item.dedupeKey === dedupeKey);
    if (existing) return structuredClone(existing);
    const now = new Date().toISOString();
    const payload = sanitize(input.payload);
    const record: DeliveryRecord = {
      id: randomUUID(),
      dedupeKey,
      sourceType: required(input.sourceType, "sourceType"),
      sourceId: required(input.sourceId, "sourceId"),
      channel: required(input.channel, "channel"),
      payload,
      payloadHash: hash(payload),
      status: "pending",
      attempts: 0,
      maxAttempts: bounded(input.maxAttempts, 5, 1, 20),
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    this.prune();
    this.save();
    return structuredClone(record);
  }

  claimPending(owner: string, options: { channel?: string; limit?: number; now?: Date } = {}): DeliveryRecord[] {
    const leaseOwner = required(owner, "owner");
    const now = options.now ?? new Date();
    this.recoverExpired(now);
    const limit = bounded(options.limit, 100, 1, 500);
    const claimed = [...this.records.values()]
      .filter((item) => (!options.channel || item.channel === options.channel)
        && ((item.status === "pending" && Date.parse(item.nextAttemptAt) <= now.getTime())
          || (item.status === "leased" && item.leaseOwner === leaseOwner)))
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    if (!claimed.length) return [];
    const nowIso = now.toISOString();
    for (const item of claimed) {
      const alreadyLeased = item.status === "leased" && item.leaseOwner === leaseOwner;
      item.status = "leased";
      if (!alreadyLeased) item.attempts += 1;
      item.leaseOwner = leaseOwner;
      item.leaseUntil = new Date(now.getTime() + this.leaseMs).toISOString();
      item.updatedAt = nowIso;
      delete item.lastError;
    }
    this.save();
    return claimed.map((item) => structuredClone(item));
  }

  acknowledge(id: string, owner: string, receiptId?: string): DeliveryRecord {
    const record = this.require(id);
    if (record.status === "delivered") return structuredClone(record);
    if (record.status !== "leased" || record.leaseOwner !== owner) throw new Error("Delivery is not leased by this recipient");
    const now = new Date().toISOString();
    record.status = "delivered";
    record.deliveredAt = now;
    record.updatedAt = now;
    record.receiptId = clean(receiptId) || `${owner}:${now}`;
    delete record.leaseOwner;
    delete record.leaseUntil;
    delete record.failedAt;
    delete record.lastError;
    this.save();
    return structuredClone(record);
  }

  fail(id: string, owner: string, error: unknown, now = new Date()): DeliveryRecord {
    const record = this.require(id);
    if (record.status !== "leased" || record.leaseOwner !== owner) throw new Error("Delivery is not leased by this recipient");
    record.lastError = redact(error instanceof Error ? error.message : String(error));
    record.updatedAt = now.toISOString();
    delete record.leaseOwner;
    delete record.leaseUntil;
    if (record.attempts >= record.maxAttempts) {
      record.status = "failed";
      record.failedAt = now.toISOString();
    } else {
      record.status = "pending";
      const delay = this.retryBaseDelayMs * Math.pow(2, Math.max(0, record.attempts - 1));
      record.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
    }
    this.save();
    return structuredClone(record);
  }

  get(id: string): DeliveryRecord | null {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  getBySource(sourceType: string, sourceId: string): DeliveryRecord | null {
    const record = [...this.records.values()].find((item) => item.sourceType === sourceType && item.sourceId === sourceId);
    return record ? structuredClone(record) : null;
  }

  list(options: { status?: DeliveryStatus; limit?: number } = {}): DeliveryRecord[] {
    const limit = bounded(options.limit, 100, 1, 500);
    return [...this.records.values()]
      .filter((item) => !options.status || item.status === options.status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }

  deleteBySources(sourceType: string, sourceIds: string[]): number {
    const ids = new Set(sourceIds.map((id) => String(id).trim()).filter(Boolean));
    if (!ids.size) return 0;
    const matches = [...this.records.values()].filter((record) => record.sourceType === sourceType && ids.has(record.sourceId));
    for (const record of matches) this.records.delete(record.id);
    if (matches.length) this.save();
    return matches.length;
  }

  private recoverExpired(now: Date): void {
    let changed = false;
    for (const record of this.records.values()) {
      if (record.status !== "leased" || !record.leaseUntil || Date.parse(record.leaseUntil) > now.getTime()) continue;
      changed = true;
      delete record.leaseOwner;
      delete record.leaseUntil;
      record.updatedAt = now.toISOString();
      record.lastError = "投递租约到期，接收方未确认收到";
      if (record.attempts >= record.maxAttempts) {
        record.status = "failed";
        record.failedAt = now.toISOString();
      } else {
        record.status = "pending";
        record.nextAttemptAt = now.toISOString();
      }
    }
    if (changed) this.save();
  }

  private require(id: string): DeliveryRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown delivery: ${id}`);
    return record;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8")) as DeliveryFile;
      if (value.version !== 1 || !Array.isArray(value.deliveries)) return;
      for (const item of value.deliveries) if (item?.id && item?.dedupeKey) this.records.set(item.id, item);
    } catch {
      // 损坏的外发箱不会阻止应用启动；首次写入会生成新的有效文件。
    }
  }

  private prune(): void {
    const overflow = Math.max(0, this.records.size - this.maxRecords);
    if (!overflow) return;
    const terminal = [...this.records.values()]
      .filter((item) => item.status === "delivered" || item.status === "failed")
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const item of terminal.slice(0, overflow)) this.records.delete(item.id);
  }

  private save(): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, deliveries: [...this.records.values()] }, null, 2), "utf8");
    renameSync(temp, this.file);
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sanitize<T>(value: T): T {
  return JSON.parse(redact(JSON.stringify(value))) as T;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2");
}

function required(value: string, name: string): string {
  const result = clean(value);
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function clean(value: string | undefined): string {
  return String(value || "").trim().slice(0, 500);
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.floor(value!) : fallback));
}
