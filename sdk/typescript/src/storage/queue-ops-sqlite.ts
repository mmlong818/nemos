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
  const r = db
    .prepare(
      `SELECT * FROM ingest_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as IngestQueueRow | undefined;
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

export function resetStaleAnalyzing(db: Database.Database): number {
  const r = db
    .prepare(
      `UPDATE ingest_queue SET status = 'queued', updated_at = ? WHERE status = 'analyzing'`,
    )
    .run(new Date().toISOString());
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
