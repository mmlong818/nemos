import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TaskFileOwnerKind = "conversation" | "task" | "artifact" | "office";

export interface TaskFileRecord {
  id: string;
  sourceKey: string;
  ownerKind: TaskFileOwnerKind;
  ownerId: string;
  displayName: string;
  extension: string;
  byteLength: number;
  contentHash: string;
  storageRef: string;
  status: "active" | "trashed";
  createdAt: string;
  updatedAt: string;
}

export class TaskFileRegistry {
  private readonly records = new Map<string, TaskFileRecord>();

  constructor(private readonly file: string) {
    this.load();
  }

  register(input: Omit<TaskFileRecord, "id" | "status" | "createdAt" | "updatedAt">): TaskFileRecord {
    const existing = [...this.records.values()].find((item) => item.sourceKey === input.sourceKey);
    const timestamp = new Date().toISOString();
    const record: TaskFileRecord = existing ? {
      ...existing,
      ...input,
      status: "active",
      updatedAt: timestamp,
    } : {
      ...input,
      id: `file-${randomUUID()}`,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.set(record.id, record);
    this.persist();
    return structuredClone(record);
  }

  list(ownerKind?: TaskFileOwnerKind, ownerId?: string): TaskFileRecord[] {
    return [...this.records.values()]
      .filter((item) => item.status === "active" && (!ownerKind || item.ownerKind === ownerKind) && (!ownerId || item.ownerId === ownerId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((item) => structuredClone(item));
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const values = JSON.parse(readFileSync(this.file, "utf8"));
      if (!Array.isArray(values)) return;
      for (const value of values) {
        if (value && typeof value.id === "string" && typeof value.sourceKey === "string") this.records.set(value.id, value as TaskFileRecord);
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
