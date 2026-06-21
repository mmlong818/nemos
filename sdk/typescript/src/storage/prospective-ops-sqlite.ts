// storage/prospective-ops-sqlite.ts — v0.5 前瞻记忆 SQLite 操作（RFC 0006）

import type Database from "better-sqlite3";
import type { Prospective } from "../types.js";
import type { ProspectivePatch } from "./types.js";
import { bufferToFloat32, cosineSimLocal, float32ToBuffer } from "../utils/vector.js";

interface ProspectiveRow {
  id: string;
  tenant_id: string;
  user_id: string;
  scope: string;
  domain_ids_json: string;
  cue: string;
  cue_blob: Buffer | null;
  cue_dim: number | null;
  projection: string;
  confidence: number;
  evidence_refs_json: string;
  prediction_log_json: string;
  retrievability: number;
  status: string;
  created_at: string;
  last_accessed: string;
  last_verified_at: string | null;
}

function rowToProspective(r: ProspectiveRow): Prospective {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    user_id: r.user_id,
    scope: r.scope,
    domain_ids: JSON.parse(r.domain_ids_json) as string[],
    cue: r.cue,
    cue_vec: r.cue_blob ? bufferToFloat32(r.cue_blob) : undefined,
    projection: r.projection,
    confidence: r.confidence,
    evidence_refs: JSON.parse(r.evidence_refs_json) as string[],
    prediction_log: JSON.parse(r.prediction_log_json) as Prospective["prediction_log"],
    retrievability: r.retrievability,
    status: r.status as Prospective["status"],
    created_at: r.created_at,
    last_accessed: r.last_accessed,
    last_verified_at: r.last_verified_at ?? undefined,
  };
}

export function insertProspective(
  db: Database.Database,
  tenantId: string,
  userId: string,
  p: Prospective,
): Prospective {
  const blob = p.cue_vec ? float32ToBuffer(p.cue_vec) : null;
  const dim = p.cue_vec ? p.cue_vec.length : null;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO prospective
         (id, tenant_id, user_id, scope, domain_ids_json, cue, cue_blob, cue_dim,
          projection, confidence, evidence_refs_json, prediction_log_json,
          retrievability, status, created_at, last_accessed, last_verified_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      p.id,
      tenantId,
      userId,
      p.scope,
      JSON.stringify(p.domain_ids),
      p.cue,
      blob,
      dim,
      p.projection,
      p.confidence,
      JSON.stringify(p.evidence_refs),
      JSON.stringify(p.prediction_log),
      p.retrievability,
      p.status,
      p.created_at,
      p.last_accessed,
      p.last_verified_at ?? null,
    );
    // 同步 cue FTS（先删后插，幂等）
    db.prepare(`DELETE FROM prospective_cue_fts WHERE id=?`).run(p.id);
    db.prepare(
      `INSERT INTO prospective_cue_fts (id, tenant_id, user_id, cue) VALUES (?,?,?,?)`,
    ).run(p.id, tenantId, userId, p.cue);
  });
  tx();
  return p;
}

export function getProspective(
  db: Database.Database,
  tenantId: string,
  userId: string,
  id: string,
): Prospective | null {
  const r = db
    .prepare(`SELECT * FROM prospective WHERE tenant_id=? AND user_id=? AND id=?`)
    .get(tenantId, userId, id) as ProspectiveRow | undefined;
  return r ? rowToProspective(r) : null;
}

export function listProspective(
  db: Database.Database,
  tenantId: string,
  userId: string,
  opts?: { limit?: number; scope?: string },
): Prospective[] {
  let sql = `SELECT * FROM prospective WHERE tenant_id=? AND user_id=?`;
  const params: unknown[] = [tenantId, userId];
  if (opts?.scope) {
    sql += ` AND scope=?`;
    params.push(opts.scope);
  }
  sql += ` ORDER BY created_at DESC`;
  if (opts?.limit) {
    sql += ` LIMIT ?`;
    params.push(opts.limit);
  }
  const rows = db.prepare(sql).all(...params) as ProspectiveRow[];
  return rows.map(rowToProspective);
}

export function searchProspectiveByCue(
  db: Database.Database,
  tenantId: string,
  userId: string,
  query: string,
  queryVec: Float32Array | null,
  topK: number,
): Array<{ prospective: Prospective; score: number }> {
  // 全局匹配，不按领域过滤（RFC 0006）
  if (queryVec) {
    const rows = db
      .prepare(`SELECT * FROM prospective WHERE tenant_id=? AND user_id=?`)
      .all(tenantId, userId) as ProspectiveRow[];
    const scored = rows
      .map((r) => {
        const p = rowToProspective(r);
        const score = p.cue_vec ? cosineSimLocal(queryVec, p.cue_vec) : 0;
        return { prospective: p, score };
      })
      .filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
  // 降级 FTS
  const ftsRows = db
    .prepare(
      `SELECT id, rank FROM prospective_cue_fts
       WHERE tenant_id=? AND user_id=? AND prospective_cue_fts MATCH ?
       ORDER BY rank LIMIT ?`,
    )
    .all(tenantId, userId, query, topK) as Array<{ id: string; rank: number }>;
  const out: Array<{ prospective: Prospective; score: number }> = [];
  for (const fr of ftsRows) {
    const p = getProspective(db, tenantId, userId, fr.id);
    if (p) out.push({ prospective: p, score: 1 / (1 + Math.abs(fr.rank)) });
  }
  return out;
}

export function updateProspective(
  db: Database.Database,
  tenantId: string,
  userId: string,
  id: string,
  patch: ProspectivePatch,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.projection !== undefined) {
    sets.push("projection=?");
    params.push(patch.projection);
  }
  if (patch.confidence !== undefined) {
    sets.push("confidence=?");
    params.push(patch.confidence);
  }
  if (patch.prediction_log !== undefined) {
    sets.push("prediction_log_json=?");
    params.push(JSON.stringify(patch.prediction_log));
  }
  if (patch.retrievability !== undefined) {
    sets.push("retrievability=?");
    params.push(patch.retrievability);
  }
  if (patch.last_verified_at !== undefined) {
    sets.push("last_verified_at=?");
    params.push(patch.last_verified_at);
  }
  if (patch.last_accessed !== undefined) {
    sets.push("last_accessed=?");
    params.push(patch.last_accessed);
  }
  if (sets.length === 0) return;
  params.push(tenantId, userId, id);
  db.prepare(
    `UPDATE prospective SET ${sets.join(", ")} WHERE tenant_id=? AND user_id=? AND id=?`,
  ).run(...params);
}
