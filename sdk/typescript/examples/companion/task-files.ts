import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TaskFileOwnerKind = "conversation" | "task" | "artifact" | "office";

export interface TaskFileOwner {
  kind: TaskFileOwnerKind;
  id: string;
  linkedAt: string;
}

export interface TaskFileRecord {
  id: string;
  sourceKey: string;
  sourceKeys: string[];
  ownerKind: TaskFileOwnerKind;
  ownerId: string;
  owners: TaskFileOwner[];
  displayName: string;
  extension: string;
  byteLength: number;
  contentHash: string;
  storageRef: string;
  status: "active" | "trashed";
  createdAt: string;
  updatedAt: string;
}

type TaskFileRegistration = Omit<TaskFileRecord, "id" | "sourceKeys" | "owners" | "status" | "createdAt" | "updatedAt"> & {
  fileId?: string;
};

export class TaskFileRegistry {
  private readonly records = new Map<string, TaskFileRecord>();

  constructor(private readonly file: string) {
    this.load();
  }

  register(input: TaskFileRegistration): TaskFileRecord {
    const requestedId = typeof input.fileId === "string" && /^file-[a-f0-9-]{36}$/i.test(input.fileId) ? input.fileId : "";
    const existing = (requestedId && this.records.get(requestedId))
      || [...this.records.values()].find((item) => item.sourceKeys.includes(input.sourceKey));
    const timestamp = new Date().toISOString();
    const owner = normalizeOwner(input.ownerKind, input.ownerId, timestamp);
    const record: TaskFileRecord = existing ? {
      ...existing,
      sourceKey: existing.sourceKey || input.sourceKey,
      sourceKeys: unique([...existing.sourceKeys, input.sourceKey], 40),
      ownerKind: existing.ownerKind,
      ownerId: existing.ownerId,
      owners: mergeOwner(existing.owners, owner),
      displayName: input.displayName,
      extension: input.extension,
      byteLength: input.byteLength,
      contentHash: input.contentHash,
      storageRef: input.storageRef,
      status: "active",
      updatedAt: timestamp,
    } : {
      ...input,
      id: requestedId || `file-${randomUUID()}`,
      sourceKeys: [input.sourceKey],
      owners: [owner],
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    delete (record as TaskFileRecord & { fileId?: string }).fileId;
    this.records.set(record.id, record);
    this.persist();
    return structuredClone(record);
  }

  link(id: string, ownerKind: TaskFileOwnerKind, ownerId: string, sourceKey?: string): TaskFileRecord {
    const record = this.require(id);
    const timestamp = new Date().toISOString();
    record.owners = mergeOwner(record.owners, normalizeOwner(ownerKind, ownerId, timestamp));
    if (sourceKey) record.sourceKeys = unique([...record.sourceKeys, sourceKey], 40);
    record.status = "active";
    record.updatedAt = timestamp;
    this.persist();
    return structuredClone(record);
  }

  get(id: string): TaskFileRecord | undefined {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  setStatus(id: string, status: TaskFileRecord["status"]): TaskFileRecord {
    const record = this.require(id);
    record.status = status;
    record.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(record);
  }

  refreshStorage(storageRef: string, input: Pick<TaskFileRecord, "byteLength" | "contentHash">): TaskFileRecord | undefined {
    const record = [...this.records.values()].find((item) => item.storageRef === storageRef);
    if (!record) return undefined;
    record.byteLength = Math.max(0, Number(input.byteLength || 0));
    record.contentHash = String(input.contentHash || "").slice(0, 128);
    record.status = "active";
    record.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(record);
  }

  list(ownerKind?: TaskFileOwnerKind, ownerId?: string, includeTrashed = false): TaskFileRecord[] {
    return [...this.records.values()]
      .filter((item) => includeTrashed || item.status === "active")
      .filter((item) => !ownerKind || item.owners.some((owner) => owner.kind === ownerKind && (!ownerId || owner.id === ownerId)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((item) => structuredClone(item));
  }

  private require(id: string): TaskFileRecord {
    if (!/^file-[a-f0-9-]{36}$/i.test(id)) throw new Error("文件编号无效");
    const record = this.records.get(id);
    if (!record) throw new Error("文件不存在或已经清理");
    return record;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const values = JSON.parse(readFileSync(this.file, "utf8"));
      if (!Array.isArray(values)) return;
      for (const value of values) {
        const record = normalizeRecord(value);
        if (record) this.records.set(record.id, record);
      }
    } catch {
      // A damaged registry is ignored; it never grants filesystem access.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.records.values()].slice(-1000), null, 2), "utf8");
    renameSync(temporary, this.file);
  }
}

function normalizeOwner(kind: TaskFileOwnerKind, id: string, linkedAt: string): TaskFileOwner {
  if (!["conversation", "task", "artifact", "office"].includes(kind)) throw new Error("文件归属类型无效");
  const normalizedId = String(id || "").trim().slice(0, 180);
  if (!normalizedId) throw new Error("文件归属编号不能为空");
  return { kind, id: normalizedId, linkedAt };
}

function mergeOwner(owners: TaskFileOwner[], next: TaskFileOwner): TaskFileOwner[] {
  const current = owners.find((owner) => owner.kind === next.kind && owner.id === next.id);
  return current ? owners : [...owners, next].slice(-80);
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(-limit);
}

function normalizeRecord(value: unknown): TaskFileRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<TaskFileRecord>;
  if (typeof item.id !== "string" || !/^file-[a-f0-9-]{36}$/i.test(item.id) || typeof item.sourceKey !== "string") return undefined;
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString();
  let owners: TaskFileOwner[] = [];
  if (Array.isArray(item.owners)) {
    owners = item.owners.flatMap((owner) => {
      try {
        return owner && typeof owner === "object"
          ? [normalizeOwner(owner.kind, owner.id, typeof owner.linkedAt === "string" ? owner.linkedAt : createdAt)]
          : [];
      } catch {
        return [];
      }
    });
  }
  if (!owners.length && item.ownerKind && item.ownerId) {
    try { owners = [normalizeOwner(item.ownerKind, item.ownerId, createdAt)]; } catch { return undefined; }
  }
  if (!owners.length) return undefined;
  const primary = owners[0]!;
  return {
    id: item.id,
    sourceKey: item.sourceKey,
    sourceKeys: unique([item.sourceKey, ...(Array.isArray(item.sourceKeys) ? item.sourceKeys : [])], 40),
    ownerKind: primary.kind,
    ownerId: primary.id,
    owners,
    displayName: String(item.displayName || "文件").slice(0, 180),
    extension: String(item.extension || "file").slice(0, 16),
    byteLength: Math.max(0, Number(item.byteLength || 0)),
    contentHash: String(item.contentHash || "").slice(0, 128),
    storageRef: String(item.storageRef || "").slice(0, 300),
    status: item.status === "trashed" ? "trashed" : "active",
    createdAt,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt,
  };
}
