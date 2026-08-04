import type Database from "better-sqlite3";
import type {
  BeliefState,
  ClaimIndexEntry,
  IdentityOperation,
  Layer,
  MemoryOperation,
  ProvenanceEdge,
} from "../types.js";
import { nowIso } from "../utils/id.js";
import { rowToMemory, type RowMemory } from "./row-mapper.js";

export function listClaimEntries(
  db: Database.Database,
  tenantId: string,
  userId: string,
  spaceId: string,
  claimKey: string,
): ClaimIndexEntry[] {
  const canonical = resolveCanonicalClaimKey(db, claimKey);
  return db.prepare(`SELECT * FROM nemos_claim_index
    WHERE tenant_id=? AND user_id=? AND space_id=? AND claim_key=?
    ORDER BY event_seq, memory_id`).all(tenantId, userId, spaceId, canonical) as ClaimIndexEntry[];
}

export function upsertClaimEntry(db: Database.Database, entry: ClaimIndexEntry): void {
  db.prepare(`INSERT INTO nemos_claim_index
    (tenant_id,user_id,space_id,claim_key,memory_id,layer,canonical_object_hash,event_seq,valid_from,trust_tier,status,updated_at)
    VALUES (@tenant_id,@user_id,@space_id,@claim_key,@memory_id,@layer,@canonical_object_hash,@event_seq,@valid_from,@trust_tier,@status,@updated_at)
    ON CONFLICT(tenant_id,user_id,memory_id) DO UPDATE SET
      space_id=excluded.space_id, claim_key=excluded.claim_key, layer=excluded.layer,
      canonical_object_hash=excluded.canonical_object_hash, event_seq=excluded.event_seq,
      valid_from=excluded.valid_from, trust_tier=excluded.trust_tier,
      status=excluded.status, updated_at=excluded.updated_at`).run(entry);
}

export function updateMemoryBeliefState(
  db: Database.Database,
  tenantId: string,
  userId: string,
  layer: Layer,
  id: string,
  state: BeliefState | undefined,
  opts: { invalidAt?: string; expiredAt?: string; correctedBy?: string; supersedes?: string } = {},
): void {
  if (layer === "archival") return;
  const row = db.prepare(`SELECT corrected_by_json FROM ${layer}
    WHERE id=? AND tenant_id=? AND user_id=?`).get(id, tenantId, userId) as { corrected_by_json: string | null } | undefined;
  if (!row) return;
  let correctedBy: string[] = [];
  try {
    const parsed = row.corrected_by_json ? JSON.parse(row.corrected_by_json) : [];
    if (Array.isArray(parsed)) correctedBy = parsed;
  } catch {
    correctedBy = [];
  }
  if (opts.correctedBy) correctedBy = [...new Set([...correctedBy, opts.correctedBy])];
  db.prepare(`UPDATE ${layer} SET belief_state=?,
    invalid_at=COALESCE(?,invalid_at), expired_at=COALESCE(?,expired_at),
    corrected_by_json=?, supersedes=COALESCE(?,supersedes)
    WHERE id=? AND tenant_id=? AND user_id=?`).run(
      state ?? "active",
      opts.invalidAt ?? null,
      opts.expiredAt ?? null,
      correctedBy.length > 0 ? JSON.stringify(correctedBy) : null,
      opts.supersedes ?? null,
      id,
      tenantId,
      userId,
    );
  db.prepare(`UPDATE nemos_claim_index SET status=?,updated_at=?
    WHERE tenant_id=? AND user_id=? AND memory_id=?`).run(state ?? "active", nowIso(), tenantId, userId, id);
}

export function addMemorySourceEvent(
  db: Database.Database,
  tenantId: string,
  userId: string,
  layer: Layer,
  id: string,
  sourceEventId: string,
): void {
  if (layer === "archival") return;
  const row = db.prepare(`SELECT source_event_ids_json FROM ${layer}
    WHERE id=? AND tenant_id=? AND user_id=?`).get(id, tenantId, userId) as { source_event_ids_json: string | null } | undefined;
  if (!row) return;
  let ids: string[] = [];
  try {
    const parsed = row.source_event_ids_json ? JSON.parse(row.source_event_ids_json) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    ids = [];
  }
  ids = [...new Set([...ids, sourceEventId])];
  db.prepare(`UPDATE ${layer} SET source_event_ids_json=?
    WHERE id=? AND tenant_id=? AND user_id=?`).run(JSON.stringify(ids), id, tenantId, userId);

  const updated = db.prepare(`SELECT * FROM ${layer}
    WHERE id=? AND tenant_id=? AND user_id=?`).get(id, tenantId, userId) as RowMemory | undefined;
  if (!updated) return;
  const memory = rowToMemory(updated);
  db.prepare(`UPDATE ${layer} SET salience_json=?, evidence_coverage=?, evidence_count=?
    WHERE id=? AND tenant_id=? AND user_id=?`).run(
      JSON.stringify(memory.salience),
      memory.evidence_coverage ?? null,
      memory.evidence_count ?? 0,
      id,
      tenantId,
      userId,
    );
}

export function rekeyMemoryClaim(
  db: Database.Database,
  tenantId: string,
  userId: string,
  layer: Layer,
  id: string,
  claimKey: string,
): void {
  if (layer === "archival") return;
  db.prepare(`UPDATE ${layer} SET claim_key=? WHERE id=? AND tenant_id=? AND user_id=?`).run(claimKey, id, tenantId, userId);
  db.prepare(`UPDATE nemos_claim_index SET claim_key=?,updated_at=?
    WHERE tenant_id=? AND user_id=? AND memory_id=?`).run(claimKey, nowIso(), tenantId, userId, id);
}
export function recordClaimKeyAlias(
  db: Database.Database,
  oldClaimKey: string,
  canonicalClaimKey: string,
  operationId: string,
  createdAt: string,
): void {
  db.prepare(`INSERT INTO nemos_claim_key_aliases(old_claim_key,canonical_claim_key,operation_id,created_at)
    VALUES (?,?,?,?) ON CONFLICT(old_claim_key) DO UPDATE SET
      canonical_claim_key=excluded.canonical_claim_key,operation_id=excluded.operation_id,created_at=excluded.created_at`).run(
        oldClaimKey, canonicalClaimKey, operationId, createdAt,
      );
}

export function resolveCanonicalClaimKey(db: Database.Database, claimKey: string): string {
  let current = claimKey;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const row = db.prepare(`SELECT canonical_claim_key FROM nemos_claim_key_aliases WHERE old_claim_key=?`).get(current) as { canonical_claim_key: string } | undefined;
    if (!row) break;
    current = row.canonical_claim_key;
  }
  return current;
}
export function insertMemoryOperation(db: Database.Database, operation: MemoryOperation): void {
  db.prepare(`INSERT OR IGNORE INTO nemos_memory_operations
    (id,tenant_id,user_id,space_id,claim_key,kind,subject_memory_ids_json,source_event_id,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      operation.id, operation.tenant_id, operation.user_id, operation.space_id,
      operation.claim_key, operation.kind, JSON.stringify(operation.subject_memory_ids),
      operation.source_event_id, operation.reason, operation.created_at,
    );
}

export function listMemoryOperations(
  db: Database.Database,
  tenantId: string,
  userId: string,
  claimKey?: string,
): MemoryOperation[] {
  const rows = (claimKey
    ? db.prepare(`SELECT * FROM nemos_memory_operations WHERE tenant_id=? AND user_id=? AND claim_key=? ORDER BY created_at`).all(tenantId, userId, claimKey)
    : db.prepare(`SELECT * FROM nemos_memory_operations WHERE tenant_id=? AND user_id=? ORDER BY created_at`).all(tenantId, userId)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id), tenant_id: String(row.tenant_id), user_id: String(row.user_id),
    space_id: String(row.space_id), claim_key: row.claim_key === null ? null : String(row.claim_key),
    kind: row.kind as MemoryOperation["kind"],
    subject_memory_ids: JSON.parse(String(row.subject_memory_ids_json)) as string[],
    source_event_id: String(row.source_event_id), reason: String(row.reason), created_at: String(row.created_at),
  }));
}

export function insertProvenanceEdge(db: Database.Database, edge: ProvenanceEdge): void {
  db.prepare(`INSERT OR IGNORE INTO nemos_provenance_edges
    (tenant_id,user_id,source_id,derived_id,relation,created_at) VALUES (?,?,?,?,?,?)`).run(
      edge.tenant_id, edge.user_id, edge.source_id, edge.derived_id, edge.relation, edge.created_at,
    );
}

export function listProvenanceFrom(db: Database.Database, tenantId: string, userId: string, sourceId: string): ProvenanceEdge[] {
  return db.prepare(`SELECT * FROM nemos_provenance_edges
    WHERE tenant_id=? AND user_id=? AND source_id=?`).all(tenantId, userId, sourceId) as ProvenanceEdge[];
}

export function listProvenanceTo(db: Database.Database, tenantId: string, userId: string, derivedId: string): ProvenanceEdge[] {
  return db.prepare(`SELECT * FROM nemos_provenance_edges
    WHERE tenant_id=? AND user_id=? AND derived_id=?`).all(tenantId, userId, derivedId) as ProvenanceEdge[];
}

export function resolveCanonicalSubject(
  db: Database.Database,
  tenantId: string,
  userId: string,
  spaceId: string,
  subjectId: string,
): string {
  const row = db.prepare(`SELECT canonical_subject_id FROM nemos_identities
    WHERE tenant_id=? AND user_id=? AND space_id=? AND subject_id=? AND status='active'`).get(
      tenantId, userId, spaceId, subjectId,
    ) as { canonical_subject_id: string } | undefined;
  return row?.canonical_subject_id ?? subjectId;
}

export function applyIdentityOperation(db: Database.Database, operation: IdentityOperation): void {
  db.prepare(`INSERT OR IGNORE INTO nemos_identity_operations
    (id,tenant_id,user_id,space_id,kind,subject_ids_json,canonical_subject_id,reverses_operation_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
      operation.id, operation.tenant_id, operation.user_id, operation.space_id, operation.kind,
      JSON.stringify(operation.subject_ids), operation.canonical_subject_id,
      operation.reverses_operation_id ?? null, operation.created_at,
    );
  if (operation.kind === "MERGE") {
    const stmt = db.prepare(`INSERT INTO nemos_identities
      (tenant_id,user_id,space_id,subject_id,canonical_subject_id,status,updated_at)
      VALUES (?,?,?,?,?,'active',?)
      ON CONFLICT(tenant_id,user_id,space_id,subject_id) DO UPDATE SET
        canonical_subject_id=excluded.canonical_subject_id,status='active',updated_at=excluded.updated_at`);
    for (const subjectId of operation.subject_ids) {
      stmt.run(operation.tenant_id, operation.user_id, operation.space_id, subjectId, operation.canonical_subject_id, operation.created_at);
    }
    return;
  }
  if (!operation.reverses_operation_id) return;
  const reversed = getIdentityOperation(db, operation.tenant_id, operation.user_id, operation.reverses_operation_id);
  const stmt = db.prepare(`UPDATE nemos_identities SET status='split',updated_at=?
    WHERE tenant_id=? AND user_id=? AND space_id=? AND subject_id=?`);
  for (const subjectId of reversed?.subject_ids ?? operation.subject_ids) {
    stmt.run(operation.created_at, operation.tenant_id, operation.user_id, operation.space_id, subjectId);
  }
}

export function getIdentityOperation(
  db: Database.Database,
  tenantId: string,
  userId: string,
  operationId: string,
): IdentityOperation | null {
  const row = db.prepare(`SELECT * FROM nemos_identity_operations
    WHERE id=? AND tenant_id=? AND user_id=?`).get(operationId, tenantId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), tenant_id: String(row.tenant_id), user_id: String(row.user_id), space_id: String(row.space_id),
    kind: row.kind as IdentityOperation["kind"], subject_ids: JSON.parse(String(row.subject_ids_json)) as string[],
    canonical_subject_id: String(row.canonical_subject_id),
    reverses_operation_id: row.reverses_operation_id ? String(row.reverses_operation_id) : undefined,
    created_at: String(row.created_at),
  };
}