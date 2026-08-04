import type Database from "better-sqlite3";
import type {
  EventMetadata,
  LifecycleStage,
  LifecycleStageRecord,
  ReflectionState,
} from "../types.js";

interface EventRow extends Omit<EventMetadata, "source_event_ids"> {
  source_event_ids_json: string;
}

function toEvent(row: EventRow): EventMetadata {
  return { ...row, source_event_ids: JSON.parse(row.source_event_ids_json) as string[] };
}

export function ensureEventMetadata(
  db: Database.Database,
  input: Omit<EventMetadata, "event_seq">,
): EventMetadata {
  const existing = getEventMetadata(db, input.event_id);
  if (existing) {
    if (existing.tenant_id !== input.tenant_id || existing.user_id !== input.user_id || existing.space_id !== input.space_id) {
      throw new Error(`[nemos] event ${input.event_id} ownership mismatch`);
    }
    return existing;
  }
  db.prepare(`INSERT OR IGNORE INTO nemos_space_sequences
    (tenant_id,user_id,space_id,last_event_seq) VALUES (?,?,?,0)`)
    .run(input.tenant_id, input.user_id, input.space_id);
  const seq = db.prepare(`UPDATE nemos_space_sequences SET last_event_seq=last_event_seq+1
    WHERE tenant_id=? AND user_id=? AND space_id=? RETURNING last_event_seq`)
    .get(input.tenant_id, input.user_id, input.space_id) as { last_event_seq: number };
  db.prepare(`INSERT INTO nemos_event_metadata
    (event_id,tenant_id,user_id,space_id,event_seq,generation,source_event_ids_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      input.event_id, input.tenant_id, input.user_id, input.space_id, seq.last_event_seq,
      input.generation, JSON.stringify(input.source_event_ids), input.created_at,
    );
  return { ...input, event_seq: seq.last_event_seq };
}

export function getEventMetadata(db: Database.Database, eventId: string): EventMetadata | null {
  const row = db.prepare(`SELECT * FROM nemos_event_metadata WHERE event_id=?`).get(eventId) as EventRow | undefined;
  return row ? toEvent(row) : null;
}

export function getLatestEventSeq(db: Database.Database, tenantId: string, userId: string, spaceId: string): number {
  const row = db.prepare(`SELECT last_event_seq FROM nemos_space_sequences
    WHERE tenant_id=? AND user_id=? AND space_id=?`).get(tenantId, userId, spaceId) as { last_event_seq: number } | undefined;
  return row?.last_event_seq ?? 0;
}

export function upsertLifecycleStage(db: Database.Database, record: LifecycleStageRecord): void {
  db.prepare(`INSERT INTO nemos_lifecycle_stages
    (event_id,stage,algorithm_version,idempotency_key,status,generation,metadata_json,started_at,updated_at,completed_at,last_error)
    VALUES (@event_id,@stage,@algorithm_version,@idempotency_key,@status,@generation,@metadata_json,@started_at,@updated_at,@completed_at,@last_error)
    ON CONFLICT(event_id,stage,algorithm_version) DO UPDATE SET
      idempotency_key=excluded.idempotency_key,status=excluded.status,generation=excluded.generation,
      metadata_json=excluded.metadata_json,updated_at=excluded.updated_at,
      completed_at=excluded.completed_at,last_error=excluded.last_error`).run(record);
}

export function getLifecycleStage(
  db: Database.Database,
  eventId: string,
  stage: LifecycleStage,
  algorithmVersion: string,
): LifecycleStageRecord | null {
  return (db.prepare(`SELECT * FROM nemos_lifecycle_stages WHERE event_id=? AND stage=? AND algorithm_version=?`)
    .get(eventId, stage, algorithmVersion) as LifecycleStageRecord | undefined) ?? null;
}

export function listLifecycleStages(db: Database.Database, eventId: string): LifecycleStageRecord[] {
  return db.prepare(`SELECT * FROM nemos_lifecycle_stages WHERE event_id=? ORDER BY started_at,stage`)
    .all(eventId) as LifecycleStageRecord[];
}

export function getReflectionState(
  db: Database.Database,
  tenantId: string,
  userId: string,
  spaceId: string,
  algorithmVersion: string,
): ReflectionState {
  const row = db.prepare(`SELECT * FROM nemos_reflection_state WHERE tenant_id=? AND user_id=? AND space_id=?`)
    .get(tenantId, userId, spaceId) as ReflectionState | undefined;
  return row ?? {
    tenant_id: tenantId, user_id: userId, space_id: spaceId, last_event_seq: 0,
    last_run_at: null, algorithm_version: algorithmVersion, lease_owner: null,
    lease_until: null, last_error: null,
  };
}

export function tryAcquireReflectionLease(
  db: Database.Database,
  tenantId: string,
  userId: string,
  spaceId: string,
  owner: string,
  leaseUntil: string,
  now: string,
  algorithmVersion: string,
): boolean {
  db.prepare(`INSERT OR IGNORE INTO nemos_reflection_state
    (tenant_id,user_id,space_id,last_event_seq,last_run_at,algorithm_version,lease_owner,lease_until,last_error)
    VALUES (?,?,?,0,NULL,?,NULL,NULL,NULL)`).run(tenantId, userId, spaceId, algorithmVersion);
  const result = db.prepare(`UPDATE nemos_reflection_state SET lease_owner=?,lease_until=?,algorithm_version=?
    WHERE tenant_id=? AND user_id=? AND space_id=?
      AND (lease_owner IS NULL OR lease_until IS NULL OR lease_until<=? OR lease_owner=?)`)
    .run(owner, leaseUntil, algorithmVersion, tenantId, userId, spaceId, now, owner);
  return result.changes === 1;
}

export function updateReflectionState(db: Database.Database, state: ReflectionState): void {
  db.prepare(`INSERT INTO nemos_reflection_state
    (tenant_id,user_id,space_id,last_event_seq,last_run_at,algorithm_version,lease_owner,lease_until,last_error)
    VALUES (@tenant_id,@user_id,@space_id,@last_event_seq,@last_run_at,@algorithm_version,@lease_owner,@lease_until,@last_error)
    ON CONFLICT(tenant_id,user_id,space_id) DO UPDATE SET
      last_event_seq=excluded.last_event_seq,last_run_at=excluded.last_run_at,
      algorithm_version=excluded.algorithm_version,lease_owner=excluded.lease_owner,
      lease_until=excluded.lease_until,last_error=excluded.last_error`).run(state);
}