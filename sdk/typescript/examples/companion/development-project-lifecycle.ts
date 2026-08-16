import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { AgentJobRecord } from "../../src/index.js";

export interface DevelopmentProjectArchiveRecord {
  rootJobId: string;
  title: string;
  workspacePath: string;
  archivedAt: string;
}

interface ArchiveFile {
  version: 1;
  projects: DevelopmentProjectArchiveRecord[];
}

export interface DevelopmentProjectThread {
  root: AgentJobRecord;
  latest: AgentJobRecord;
  turns: AgentJobRecord[];
}

export class DevelopmentProjectArchiveStore {
  private readonly records = new Map<string, DevelopmentProjectArchiveRecord>();

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.load();
  }

  list(): DevelopmentProjectArchiveRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
      .map((record) => structuredClone(record));
  }

  get(rootJobId: string): DevelopmentProjectArchiveRecord | undefined {
    const record = this.records.get(rootJobId);
    return record ? structuredClone(record) : undefined;
  }

  archive(input: Omit<DevelopmentProjectArchiveRecord, "archivedAt">): DevelopmentProjectArchiveRecord {
    const existing = this.records.get(input.rootJobId);
    const record: DevelopmentProjectArchiveRecord = {
      rootJobId: input.rootJobId,
      title: cleanText(input.title, "开发项目", 120),
      workspacePath: cleanText(input.workspacePath, "", 2_000),
      archivedAt: existing?.archivedAt ?? new Date().toISOString(),
    };
    this.records.set(record.rootJobId, record);
    this.save();
    return structuredClone(record);
  }

  restore(rootJobId: string): boolean {
    const removed = this.records.delete(rootJobId);
    if (removed) this.save();
    return removed;
  }

  remove(rootJobId: string): boolean {
    return this.restore(rootJobId);
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as ArchiveFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) return;
      for (const record of parsed.projects) {
        if (!record?.rootJobId || !record.archivedAt) continue;
        this.records.set(record.rootJobId, {
          rootJobId: cleanText(record.rootJobId, "", 160),
          title: cleanText(record.title, "开发项目", 120),
          workspacePath: cleanText(record.workspacePath, "", 2_000),
          archivedAt: record.archivedAt,
        });
      }
    } catch {
      // 归档索引损坏时不影响开发任务本身；下一次归档会重新生成有效文件。
    }
  }

  private save(): void {
    const temporary = `${this.file}.${process.pid}.tmp`;
    const data: ArchiveFile = { version: 1, projects: [...this.records.values()] };
    writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
    renameSync(temporary, this.file);
  }
}

export function developmentProjectThreads(jobs: AgentJobRecord[]): DevelopmentProjectThread[] {
  const developmentJobs = jobs.filter((job) => job.payload?.capabilityId === "project-development");
  const byId = new Map(developmentJobs.map((job) => [job.id, job]));
  const rootFor = (job: AgentJobRecord): AgentJobRecord => {
    const visited = new Set<string>();
    let current = job;
    while (typeof current.payload.parentJobId === "string" && current.payload.parentJobId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = byId.get(current.payload.parentJobId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const grouped = new Map<string, AgentJobRecord[]>();
  for (const job of developmentJobs) {
    const root = rootFor(job);
    grouped.set(root.id, [...(grouped.get(root.id) ?? []), job]);
  }
  return [...grouped.entries()].map(([rootId, turns]) => {
    turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { root: byId.get(rootId)!, latest: turns.at(-1)!, turns };
  }).sort((a, b) => b.latest.updatedAt.localeCompare(a.latest.updatedAt));
}

export function managedDevelopmentWorkspace(projectsRoot: string, workspacePath: string): string | undefined {
  if (!workspacePath || !existsSync(workspacePath)) return undefined;
  const root = realpathSync(resolve(projectsRoot));
  const target = realpathSync(resolve(workspacePath));
  const child = relative(root, target);
  if (!child || child === ".." || child.startsWith(`..\\`) || child.startsWith("../") || isAbsolute(child)) return undefined;
  if (lstatSync(target).isSymbolicLink()) return undefined;
  return target;
}

// rmSync(recursive) 在这台 Windows 上删除部分中文目录名会让进程直接中止；
// 手动递归（readdir + unlink + rmdir）没有这个问题。
function removeDirectoryQuietly(target: string): void {
  if (!existsSync(target)) return;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = join(target, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      removeDirectoryQuietly(child);
    } else {
      try {
        unlinkSync(child);
      } catch {
        // 单个文件删除失败不中断整体清理
      }
    }
  }
  try {
    rmdirSync(target);
  } catch {
    // 目录删除失败按 force 语义忽略
  }
}

export function deleteManagedDevelopmentWorkspace(projectsRoot: string, workspacePath: string): boolean {
  const target = managedDevelopmentWorkspace(projectsRoot, workspacePath);
  if (!target) return false;
  removeDirectoryQuietly(target);
  return !existsSync(target);
}

function cleanText(value: unknown, fallback: string, limit: number): string {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
  return cleaned || fallback;
}
