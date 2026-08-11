// storage/storyline-ops-sqlite.ts — v0.8 故事线 SQLite 操作
//
// 一条线的生命周期比其中任何一条记忆都长，所以单独建表；
// 线内记忆靠 visibility.owner = {kind:"storyline", id} 归集，不在这里冗余存 id 列表。

import type Database from "better-sqlite3";
import type { Storyline, StorylinePatch, StorylineStatus } from "../types.js";
import type { StorylineQuery } from "./types.js";

interface StorylineRow {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  status: string;
  participant_ids_json: string;
  scope: string;
  digest: string | null;
  open_threads_json: string;
  created_at: string;
  updated_at: string;
  last_event_at: string;
}

function rowToStoryline(r: StorylineRow): Storyline {
  const storyline: Storyline = {
    id: r.id,
    tenant_id: r.tenant_id,
    user_id: r.user_id,
    title: r.title,
    status: r.status as StorylineStatus,
    participant_ids: JSON.parse(r.participant_ids_json) as string[],
    scope: r.scope,
    open_threads: JSON.parse(r.open_threads_json) as string[],
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_event_at: r.last_event_at,
  };
  if (r.digest) storyline.digest = r.digest;
  return storyline;
}

export function upsertStoryline(
  db: Database.Database,
  tenantId: string,
  userId: string,
  s: Storyline,
): Storyline {
  db.prepare(
    `INSERT INTO storylines (
       id, tenant_id, user_id, title, status, participant_ids_json, scope,
       digest, open_threads_json, created_at, updated_at, last_event_at
     ) VALUES (@id, @tenant_id, @user_id, @title, @status, @participant_ids_json, @scope,
       @digest, @open_threads_json, @created_at, @updated_at, @last_event_at)
     ON CONFLICT(tenant_id, user_id, id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       participant_ids_json = excluded.participant_ids_json,
       scope = excluded.scope,
       digest = excluded.digest,
       open_threads_json = excluded.open_threads_json,
       updated_at = excluded.updated_at,
       last_event_at = excluded.last_event_at`,
  ).run({
    id: s.id,
    tenant_id: tenantId,
    user_id: userId,
    title: s.title,
    status: s.status,
    participant_ids_json: JSON.stringify(s.participant_ids),
    scope: s.scope,
    digest: s.digest ?? null,
    open_threads_json: JSON.stringify(s.open_threads),
    created_at: s.created_at,
    updated_at: s.updated_at,
    last_event_at: s.last_event_at,
  });
  return { ...s, tenant_id: tenantId, user_id: userId };
}

export function getStoryline(
  db: Database.Database,
  tenantId: string,
  userId: string,
  id: string,
): Storyline | null {
  const row = db
    .prepare(`SELECT * FROM storylines WHERE tenant_id = ? AND user_id = ? AND id = ?`)
    .get(tenantId, userId, id) as StorylineRow | undefined;
  return row ? rowToStoryline(row) : null;
}

export function listStorylines(
  db: Database.Database,
  tenantId: string,
  userId: string,
  query: StorylineQuery = {},
): Storyline[] {
  let sql = `SELECT * FROM storylines WHERE tenant_id = ? AND user_id = ?`;
  const params: unknown[] = [tenantId, userId];
  if (query.status && query.status.length > 0) {
    sql += ` AND status IN (${query.status.map(() => "?").join(",")})`;
    params.push(...query.status);
  }
  if (query.scope) {
    sql += ` AND scope = ?`;
    params.push(query.scope);
  }
  // 最近活跃的线排前面——续期时几乎总是要最近那条。
  // created_at / id 只作 tiebreak：同毫秒创建的两条线也要给出稳定顺序。
  sql += ` ORDER BY last_event_at DESC, created_at DESC, id DESC LIMIT ?`;
  params.push(query.limit ?? 50);
  const rows = db.prepare(sql).all(...params) as StorylineRow[];
  const all = rows.map(rowToStoryline);
  if (!query.participantId) return all;
  return all.filter((s) => s.participant_ids.includes(query.participantId as string));
}

export function patchStoryline(
  db: Database.Database,
  tenantId: string,
  userId: string,
  id: string,
  patch: StorylinePatch,
  now: string,
): Storyline | null {
  const current = getStoryline(db, tenantId, userId, id);
  if (!current) return null;
  const participants = [...current.participant_ids];
  for (const participant of patch.add_participants ?? []) {
    if (participant && !participants.includes(participant)) participants.push(participant);
  }
  const next: Storyline = {
    ...current,
    title: patch.title ?? current.title,
    status: patch.status ?? current.status,
    participant_ids: participants,
    open_threads: patch.open_threads ?? current.open_threads,
    updated_at: now,
    // touch 才刷新活跃时间：只改个标题不该把这条线顶到最前面。
    last_event_at: patch.touch ? now : current.last_event_at,
  };
  if (patch.digest !== undefined) next.digest = patch.digest;
  return upsertStoryline(db, tenantId, userId, next);
}

export function deleteStoryline(
  db: Database.Database,
  tenantId: string,
  userId: string,
  id: string,
): boolean {
  const result = db
    .prepare(`DELETE FROM storylines WHERE tenant_id = ? AND user_id = ? AND id = ?`)
    .run(tenantId, userId, id);
  return result.changes > 0;
}
