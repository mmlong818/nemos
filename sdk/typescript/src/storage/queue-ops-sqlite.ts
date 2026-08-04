// storage/queue-ops-sqlite.ts — SQLite 后端的 ingest_queue 表 CRUD

import type Database from "better-sqlite3";
import type { IngestStatus } from "../types.js";
import type { IngestQueueRow } from "./types.js";

type QueueInsert = Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count" | "next_attempt_at">;

export function enqueueIngest(db: Database.Database, row: QueueInsert): IngestQueueRow {
  const full: IngestQueueRow = {
    ...row,
    updated_at: row.created_at,
    completed_at: null,
    derived_count: null,
    next_attempt_at: row.created_at,
  };
  db.prepare(
    `INSERT INTO ingest_queue
      (id, tenant_id, user_id, archival_id, scope, content,
       scenario_json, origin_agent, content_date, perspectives_json,
       status, attempts, last_error, created_at, updated_at,
       completed_at, derived_count, next_attempt_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    full.id, full.tenant_id, full.user_id, full.archival_id, full.scope, full.content,
    full.scenario_json, full.origin_agent, full.content_date, full.perspectives_json,
    full.status, full.attempts, full.last_error, full.created_at, full.updated_at,
    full.completed_at, full.derived_count, full.next_attempt_at,
  );
  return full;
}

export function getQueueRow(db: Database.Database, id: string): IngestQueueRow | null {
  return (db.prepare(`SELECT * FROM ingest_queue WHERE id = ?`).get(id) as IngestQueueRow | undefined) ?? null;
}

export function takeNextQueued(db: Database.Database, readyAt = new Date().toISOString()): IngestQueueRow | null {
  const row = db.prepare(
    `UPDATE ingest_queue
        SET status = 'analyzing', updated_at = ?
      WHERE id = (
        SELECT id FROM ingest_queue
        WHERE status = 'queued' AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC, created_at ASC LIMIT 1
      )
      RETURNING *`,
  ).get(readyAt, readyAt) as IngestQueueRow | undefined;
  return row ?? null;
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
    next_attempt_at?: string;
  },
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  sets.push("updated_at = ?");
  params.push(new Date().toISOString(), id);
  db.prepare(`UPDATE ingest_queue SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function resetStaleAnalyzing(db: Database.Database, leaseMs = 0): number {
  const now = new Date().toISOString();
  if (leaseMs > 0) {
    const cutoff = new Date(Date.now() - leaseMs).toISOString();
    return db.prepare(
      `UPDATE ingest_queue SET status='queued', updated_at=?, next_attempt_at=?
       WHERE status='analyzing' AND updated_at < ?`,
    ).run(now, now, cutoff).changes;
  }
  return db.prepare(
    `UPDATE ingest_queue SET status='queued', updated_at=?, next_attempt_at=? WHERE status='analyzing'`,
  ).run(now, now).changes;
}

export function listPendingByUser(
  db: Database.Database,
  tenantId: string,
  userId: string,
): IngestQueueRow[] {
  return db.prepare(
    `SELECT * FROM ingest_queue
     WHERE tenant_id=? AND user_id=? AND status IN ('queued','analyzing','failed')
     ORDER BY created_at ASC`,
  ).all(tenantId, userId) as IngestQueueRow[];
}