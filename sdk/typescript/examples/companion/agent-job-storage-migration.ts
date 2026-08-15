import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type StoredJob = { id?: unknown; updatedAt?: unknown } & Record<string, unknown>;

interface StoredQueue {
  version?: unknown;
  jobs?: unknown;
  product_lead?: unknown;
}

function readStoredJobs(file: string): { jobs: StoredJob[]; canonical: boolean } {
  if (!existsSync(file)) return { jobs: [], canonical: true };
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as StoredQueue;
    if (Array.isArray(value.jobs)) return { jobs: value.jobs as StoredJob[], canonical: true };
    // 旧版身份迁移曾把队列根键 jobs 误当成专家代号，任务内容本身仍然完整。
    if (Array.isArray(value.product_lead)) return { jobs: value.product_lead as StoredJob[], canonical: false };
  } catch {
    // 损坏文件交给队列原有的容错逻辑处理，避免覆盖无法解析的数据。
  }
  return { jobs: [], canonical: true };
}

function updatedAt(job: StoredJob): string {
  return typeof job.updatedAt === "string" ? job.updatedAt : "";
}

function mergeJobs(legacy: StoredJob[], current: StoredJob[]): StoredJob[] {
  const merged = new Map<string, StoredJob>();
  for (const job of [...legacy, ...current]) {
    const id = typeof job.id === "string" ? job.id : "";
    if (!id) continue;
    const existing = merged.get(id);
    if (!existing || updatedAt(job) >= updatedAt(existing)) merged.set(id, job);
  }
  return [...merged.values()];
}

export function recoverAgentJobStorage(dataDir: string, legacyDataDir?: string): number {
  const currentFile = join(dataDir, "agent-jobs.json");
  const current = readStoredJobs(currentFile);
  const legacyFile = legacyDataDir && resolve(legacyDataDir) !== resolve(dataDir)
    ? join(legacyDataDir, "agent-jobs.json")
    : "";
  const legacy = legacyFile ? readStoredJobs(legacyFile).jobs : [];
  const jobs = mergeJobs(legacy, current.jobs);
  const changed = !current.canonical || JSON.stringify(jobs) !== JSON.stringify(current.jobs);
  if (!changed) return jobs.length;

  const temp = `${currentFile}.${process.pid}.migration.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, jobs }, null, 2), "utf8");
  renameSync(temp, currentFile);
  return jobs.length;
}
