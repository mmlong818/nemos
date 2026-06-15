// storage/domain-ops-sqlite.ts — v0.5 领域轴 SQLite 操作（RFC 0005）

import type Database from "better-sqlite3";
import type { Domain, DomainAffinity, MemoryDomain } from "../types.js";
import { GLOBAL_DOMAIN_ID } from "../types.js";
import { bufferToFloat32, float32ToBuffer } from "../utils/vector.js";
import { nowIso } from "../utils/id.js";

interface DomainRow {
  id: string;
  tenant_id: string;
  user_id: string;
  label: string;
  prototype_blob: Buffer | null;
  prototype_dim: number | null;
  parent_id: string | null;
  level: number;
  status: string;
  origin: string;
  always_on: number;
  load_count: number;
  retrievability: number;
  last_routed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDomain(r: DomainRow): Domain {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    user_id: r.user_id,
    label: r.label,
    prototype_vec: r.prototype_blob ? bufferToFloat32(r.prototype_blob) : null,
    parent_id: r.parent_id ?? undefined,
    level: r.level,
    status: r.status as Domain["status"],
    origin: r.origin as Domain["origin"],
    always_on: r.always_on === 1,
    load_count: r.load_count,
    retrievability: r.retrievability,
    last_routed_at: r.last_routed_at ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function ensureGlobalDomain(
  db: Database.Database,
  tenantId: string,
  userId: string,
): Domain {
  const existing = getDomain(db, tenantId, userId, GLOBAL_DOMAIN_ID);
  if (existing) return existing;
  const now = nowIso();
  const g: Domain = {
    id: GLOBAL_DOMAIN_ID,
    tenant_id: tenantId,
    user_id: userId,
    label: "GLOBAL",
    prototype_vec: null,
    parent_id: undefined,
    level: 0,
    status: "hot",
    origin: "seed",
    always_on: true,
    load_count: 0,
    retrievability: 1.0,
    last_routed_at: undefined,
    created_at: now,
    updated_at: now,
  };
  upsertDomain(db, tenantId, userId, g);
  return g;
}

export function upsertDomain(
  db: Database.Database,
  tenantId: string,
  userId: string,
  domain: Domain,
): void {
  const blob = domain.prototype_vec ? float32ToBuffer(domain.prototype_vec) : null;
  const dim = domain.prototype_vec ? domain.prototype_vec.length : null;
  db.prepare(
    `INSERT OR REPLACE INTO domains
       (id, tenant_id, user_id, label, prototype_blob, prototype_dim, parent_id,
        level, status, origin, always_on, load_count, retrievability,
        last_routed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    domain.id,
    tenantId,
    userId,
    domain.label,
    blob,
    dim,
    domain.parent_id ?? null,
    domain.level,
    domain.status,
    domain.origin,
    domain.always_on ? 1 : 0,
    domain.load_count,
    domain.retrievability,
    domain.last_routed_at ?? null,
    domain.created_at,
    domain.updated_at,
  );
}

export function getDomain(
  db: Database.Database,
  tenantId: string,
  userId: string,
  id: string,
): Domain | null {
  const r = db
    .prepare(`SELECT * FROM domains WHERE tenant_id=? AND user_id=? AND id=?`)
    .get(tenantId, userId, id) as DomainRow | undefined;
  return r ? rowToDomain(r) : null;
}

export function listDomains(
  db: Database.Database,
  tenantId: string,
  userId: string,
  opts?: { includeCold?: boolean },
): Domain[] {
  let sql = `SELECT * FROM domains WHERE tenant_id=? AND user_id=?`;
  if (!opts?.includeCold) sql += ` AND status != 'cold'`;
  const rows = db.prepare(sql).all(tenantId, userId) as DomainRow[];
  return rows.map(rowToDomain);
}

export function setMemoryDomains(
  db: Database.Database,
  tenantId: string,
  userId: string,
  memoryId: string,
  links: MemoryDomain[],
): void {
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM memory_domain WHERE tenant_id=? AND user_id=? AND memory_id=?`,
    ).run(tenantId, userId, memoryId);
    const ins = db.prepare(
      `INSERT OR REPLACE INTO memory_domain
         (tenant_id, user_id, memory_id, domain_id, membership_weight, is_primary)
       VALUES (?,?,?,?,?,?)`,
    );
    for (const l of links) {
      ins.run(tenantId, userId, memoryId, l.domain_id, l.membership_weight, l.is_primary ? 1 : 0);
    }
  });
  tx();
}

export function getMemoryDomainsFor(
  db: Database.Database,
  tenantId: string,
  userId: string,
  memoryIds: string[],
): MemoryDomain[] {
  if (memoryIds.length === 0) return [];
  const ph = memoryIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT memory_id, domain_id, membership_weight, is_primary
       FROM memory_domain
       WHERE tenant_id=? AND user_id=? AND memory_id IN (${ph})`,
    )
    .all(tenantId, userId, ...memoryIds) as Array<{
    memory_id: string;
    domain_id: string;
    membership_weight: number;
    is_primary: number;
  }>;
  return rows.map((r) => ({
    memory_id: r.memory_id,
    domain_id: r.domain_id,
    membership_weight: r.membership_weight,
    is_primary: r.is_primary === 1,
  }));
}

export function getDomainMemberIds(
  db: Database.Database,
  tenantId: string,
  userId: string,
  domainId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT memory_id FROM memory_domain
       WHERE tenant_id=? AND user_id=? AND domain_id=?`,
    )
    .all(tenantId, userId, domainId) as Array<{ memory_id: string }>;
  return rows.map((r) => r.memory_id);
}

export function getEmbedding(
  db: Database.Database,
  tenantId: string,
  userId: string,
  recordId: string,
): Float32Array | null {
  const r = db
    .prepare(
      `SELECT vector_blob FROM mnemos_embeddings
       WHERE tenant_id=? AND user_id=? AND record_id=? LIMIT 1`,
    )
    .get(tenantId, userId, recordId) as { vector_blob: Buffer } | undefined;
  return r ? bufferToFloat32(r.vector_blob) : null;
}

export function touchDomainRouted(
  db: Database.Database,
  tenantId: string,
  userId: string,
  domainId: string,
  at: string,
): void {
  db.prepare(
    `UPDATE domains SET load_count = load_count + 1, last_routed_at = ?, updated_at = ?
     WHERE tenant_id=? AND user_id=? AND id=?`,
  ).run(at, at, tenantId, userId, domainId);
}

export function listAffinities(
  db: Database.Database,
  tenantId: string,
  userId: string,
  domainId: string,
): DomainAffinity[] {
  const rows = db
    .prepare(
      `SELECT domain_a, domain_b, affinity, updated_at FROM domain_affinity
       WHERE tenant_id=? AND user_id=? AND (domain_a=? OR domain_b=?)`,
    )
    .all(tenantId, userId, domainId, domainId) as Array<{
    domain_a: string;
    domain_b: string;
    affinity: number;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    domain_a: r.domain_a,
    domain_b: r.domain_b,
    affinity: r.affinity,
    updated_at: r.updated_at,
  }));
}

export function upsertAffinity(
  db: Database.Database,
  tenantId: string,
  userId: string,
  domainA: string,
  domainB: string,
  affinityDelta: number,
  at: string,
): void {
  // 无向归一：存 a < b
  const a = domainA < domainB ? domainA : domainB;
  const b = domainA < domainB ? domainB : domainA;
  const cur = db
    .prepare(
      `SELECT affinity FROM domain_affinity
       WHERE tenant_id=? AND user_id=? AND domain_a=? AND domain_b=?`,
    )
    .get(tenantId, userId, a, b) as { affinity: number } | undefined;
  const next = (cur?.affinity ?? 0) + affinityDelta;
  db.prepare(
    `INSERT OR REPLACE INTO domain_affinity
       (tenant_id, user_id, domain_a, domain_b, affinity, updated_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(tenantId, userId, a, b, next, at);
}
