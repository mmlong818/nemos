// storage/decay-ops-sqlite.ts — v0.4 decay / reflect 相关 SQLite 操作
//
// 把 sqlite-impl.ts 的 v0.4 方法抽出来，让单文件 ≤ 600 行。

import type Database from "better-sqlite3";
import { LAYERS, type Layer, type Memory } from "../types.js";
import { rowToMemory, type RowMemory } from "./row-mapper.js";
import type { DecayCandidate } from "./types.js";

export function touchAccess(
  db: Database.Database,
  tenantId: string,
  userId: string,
  layer: Layer,
  id: string,
  nextStability: number,
): void {
  if (layer === "archival") return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ${layer}
        SET last_accessed = ?,
            access_count = access_count + 1,
            stability = ?
      WHERE id = ? AND tenant_id = ? AND user_id = ? AND archival_protected = 0`,
  ).run(now, nextStability, id, tenantId, userId);
}

export function listDecayCandidates(db: Database.Database, limit = 500): DecayCandidate[] {
  const out: DecayCandidate[] = [];
  for (const layer of LAYERS) {
    if (layer === "archival") continue;
    // 游标：按 last_decay_at 升序（SQLite 中 NULL 排最前 = 从未检查的优先）。
    // runDecayScan 对每个候选都会 updateDecayMeta 回写 last_decay_at，
    // 因此每轮取「最久未检查」的一批，多轮自然轮转整表——
    // 此前按 last_accessed 排序会每轮反复选中同一批最旧行，其余永不被扫到。
    const rows = db
      .prepare(
        `SELECT id, layer, tenant_id, user_id, last_accessed, access_count,
                stability, sensitive, cold, cold_at, archival_protected, last_decay_at
           FROM ${layer}
          WHERE archival_protected = 0
          ORDER BY last_decay_at ASC, last_accessed ASC
          LIMIT ?`,
      )
      .all(limit) as DecayCandidate[];
    for (const r of rows) out.push(r);
  }
  return out;
}

export function markCold(
  db: Database.Database,
  tenantId: string,
  userId: string,
  layer: Layer,
  id: string,
  coldAt: string,
): void {
  if (layer === "archival") return;
  db.prepare(
    `UPDATE ${layer}
        SET cold = 1, cold_at = ?
      WHERE id = ? AND tenant_id = ? AND user_id = ? AND archival_protected = 0`,
  ).run(coldAt, id, tenantId, userId);
}

export function clearCold(
  db: Database.Database,
  tenantId: string,
  userId: string,
  layer: Layer,
  id: string,
): void {
  if (layer === "archival") return;
  db.prepare(
    `UPDATE ${layer}
        SET cold = 0, cold_at = NULL
      WHERE id = ? AND tenant_id = ? AND user_id = ?`,
  ).run(id, tenantId, userId);
}

export function updateDecayMeta(
  db: Database.Database,
  tenantId: string,
  userId: string,
  layer: Layer,
  id: string,
  retrievability: number,
  lastDecayAt: string,
): void {
  if (layer === "archival") return;
  db.prepare(
    `UPDATE ${layer}
        SET retrievability = ?, last_decay_at = ?
      WHERE id = ? AND tenant_id = ? AND user_id = ?`,
  ).run(retrievability, lastDecayAt, id, tenantId, userId);
}

export function listColdByUser(
  db: Database.Database,
  tenantId: string,
  userId: string,
): Memory[] {
  const out: Memory[] = [];
  for (const layer of LAYERS) {
    if (layer === "archival") continue;
    const rows = db
      .prepare(
        `SELECT * FROM ${layer}
          WHERE tenant_id = ? AND user_id = ? AND cold = 1
          ORDER BY cold_at DESC`,
      )
      .all(tenantId, userId) as RowMemory[];
    for (const r of rows) out.push(rowToMemory(r));
  }
  return out;
}

export function countEpisodicSinceLastReflect(
  db: Database.Database,
  tenantId: string,
  userId: string,
  sinceIso: string | null,
): number {
  if (sinceIso) {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS c FROM episodic
          WHERE tenant_id = ? AND user_id = ? AND created_at > ?`,
      )
      .get(tenantId, userId, sinceIso) as { c: number };
    return r.c;
  }
  const r = db
    .prepare(
      `SELECT COUNT(*) AS c FROM episodic
        WHERE tenant_id = ? AND user_id = ?`,
    )
    .get(tenantId, userId) as { c: number };
  return r.c;
}

export function listRecentEpisodic(
  db: Database.Database,
  tenantId: string,
  userId: string,
  limit: number,
): Memory[] {
  const rows = db
    .prepare(
      `SELECT * FROM episodic
        WHERE tenant_id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(tenantId, userId, limit) as RowMemory[];
  return rows.map(rowToMemory);
}

export function listEpisodicByEventSeq(
  db: Database.Database,
  tenantId: string,
  userId: string,
  spaceId: string,
  afterSeq: number,
  upToSeq: number,
): Memory[] {
  const rows = db.prepare(
    `SELECT e.* FROM episodic e
     JOIN nemos_event_metadata event ON event.event_id = COALESCE(e.archival_ref, e.id)
     WHERE e.tenant_id=? AND e.user_id=?
       AND event.space_id=? AND event.event_seq>? AND event.event_seq<=?
     ORDER BY event.event_seq DESC, e.created_at DESC`,
  ).all(tenantId, userId, spaceId, afterSeq, upToSeq) as RowMemory[];
  return rows.map(rowToMemory);
}
export function listPersonalSemantic(
  db: Database.Database,
  tenantId: string,
  userId: string,
): Memory[] {
  const rows = db
    .prepare(
      `SELECT * FROM personal_semantic
        WHERE tenant_id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT 200`,
    )
    .all(tenantId, userId) as RowMemory[];
  return rows.map(rowToMemory);
}
