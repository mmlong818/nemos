// storage/queue-ops-sqlite.ts — SQLite 后端的 ingest_queue 表 CRUD（v0.3）

import type Database from "better-sqlite3";
import type { IngestStatus } from "../types.js";
import type { IngestQueueRow } from "./types.js";

export function enqueueIngest(
  db: Database.Database,
  row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count">,
): IngestQueueRow {
  const full: IngestQueueRow = {
    ...row,
    updated_at: row.created_at,
    completed_at: null,
    derived_count: null,
  };
  db.prepare(
    `INSERT INTO ingest_queue
      (id, tenant_id, user_id, archival_id, scope, content,
       scenario_json, origin_agent, content_date, perspectives_json,
       status, attempts, last_error, created_at, updated_at,
       completed_at, derived_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    full.id,
    full.tenant_id,
    full.user_id,
    full.archival_id,
    full.scope,
    full.content,
    full.scenario_json,
    full.origin_agent,
    full.content_date,
    full.perspectives_json,
    full.status,
    full.attempts,
    full.last_error,
    full.created_at,
    full.updated_at,
    full.completed_at,
    full.derived_count,
  );
  return full;
}

export function getQueueRow(db: Database.Database, id: string): IngestQueueRow | null {
  const r = db
    .prepare(`SELECT * FROM ingest_queue WHERE id = ?`)
    .get(id) as IngestQueueRow | undefined;
  return r ?? null;
}

export function takeNextQueued(db: Database.Database): IngestQueueRow | null {
  // 原子认领：SELECT 后再翻状态的两步写法在多 worker 下会重复处理同一任务；
  // UPDATE..RETURNING 把「挑选 + 标 analyzing」并成单语句。
  const r = db
    .prepare(
      `UPDATE ingest_queue
          SET status = 'analyzing', updated_at = ?
        WHERE id = (
          SELECT id FROM ingest_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1
        )
        RETURNING *`,
    )
    .get(new Date().toISOString()) as IngestQueueRow | undefined;
  return r ?? null;
}

export function updateQueueStatus(
  db: Database.Database,
  id: string,
  patch: {
    status?: IngestStatus;
    attempts?: number;
    last_error?: string | null;
    completed_at?: string | null;
    derived_count?: number | null;
  },
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.attempts !== undefined) {
    sets.push("attempts = ?");
    params.push(patch.attempts);
  }
  if (patch.last_error !== undefined) {
    sets.push("last_error = ?");
    params.push(patch.last_error);
  }
  if (patch.completed_at !== undefined) {
    sets.push("completed_at = ?");
    params.push(patch.completed_at);
  }
  if (patch.derived_count !== undefined) {
    sets.push("derived_count = ?");
    params.push(patch.derived_count);
  }
  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);
  db.prepare(`UPDATE ingest_queue SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function resetStaleAnalyzing(db: Database.Database, leaseMs = 0): number {
  // leaseMs=0（默认）：重置全部 analyzing——单实例启动时该 DB 只属于自己，
  // 任何 analyzing 都必然是上次崩溃残留。
  // leaseMs>0：只重置 updated_at 早于租约窗口的行——多实例共库时避免抢走
  // 兄弟实例正在处理的任务。
  const now = new Date().toISOString();
  if (leaseMs > 0) {
    const cutoff = new Date(Date.now() - leaseMs).toISOString();
    const r = db
      .prepare(
        `UPDATE ingest_queue SET status = 'queued', updated_at = ? WHERE status = 'analyzing' AND updated_at < ?`,
      )
      .run(now, cutoff);
    return r.changes;
  }
  const r = db
    .prepare(
      `UPDATE ingest_queue SET status = 'queued', updated_at = ? WHERE status = 'analyzing'`,
    )
    .run(now);
  return r.changes;
}

export function listPendingByUser(
  db: Database.Database,
  tenantId: string,
  userId: string,
): IngestQueueRow[] {
  return db
    .prepare(
      `SELECT * FROM ingest_queue
       WHERE tenant_id = ? AND user_id = ?
         AND status IN ('queued','analyzing','failed')
       ORDER BY created_at ASC`,
    )
    .all(tenantId, userId) as IngestQueueRow[];
}
