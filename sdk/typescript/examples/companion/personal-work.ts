import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Memory, Nemos } from "../../src/index.js";
import { APP_PERSONA_ID } from "./identity.js";
import { convScope } from "./engine.js";

export class PersonalWorkError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export interface PersonalMatter {
  id: string; revision: number; title: string; goal: string; nextAction: string;
  status: "active" | "waiting" | "paused" | "completed";
  dueAt: string; remindAt: string; waitingFor: string; result: string;
  taskId: string; artifactId: string; authority: "remind-only";
  createdAt: string; updatedAt: string;
}
export interface LearningProposal {
  id: string; revision: number; kind: "preference" | "decision" | "constraint";
  content: string; source: { matterId: string; taskId: string; artifactId: string; excerpt: string };
  state: "pending" | "accepting" | "confirmed" | "rejected" | "revoking" | "revoked";
  memoryId?: string; confirmedAt?: string; updatedAt: string; createdAt: string;
}
function text(value: unknown, field: string, max: number, required = false): string {
  if (value !== undefined && typeof value !== "string") throw new PersonalWorkError(`${field}必须是文字`);
  const result = String(value ?? "").trim();
  if (required && !result) throw new PersonalWorkError(`请填写${field}`);
  if ((required && !result) || result.length > max) throw new PersonalWorkError(`${field}需为${required ? " 1 至" : "不超过"} ${max} 个字符`);
  return result;
}
function instant(value: unknown, field: string): string {
  const result = text(value, field, 40);
  if (!result) return "";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) throw new PersonalWorkError(`${field}需要有效时间和时区`);
  const localDate = result.slice(0, 10);
  if (new Date(`${localDate}T00:00:00Z`).toISOString().slice(0, 10) !== localDate) throw new PersonalWorkError(`${field}需要真实存在的日期`);
  return new Date(result).toISOString();
}

/** Separate, local SQLite state. Every lookup is bound to the server-owned user id. */
export class PersonalWorkStore {
  private readonly db: Database.Database;
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(path: string) {
    this.db = new Database(path);
    try {
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS personal_records (
      user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY(user_id,kind,id));
      CREATE TABLE IF NOT EXISTS personal_reminders (
      user_id TEXT NOT NULL, id TEXT NOT NULL, matter_id TEXT NOT NULL,
      fire_at TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT,
      PRIMARY KEY(user_id,id));`);
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private records<T>(user: string, kind: string): T[] {
    return (this.db.prepare("SELECT payload FROM personal_records WHERE user_id=? AND kind=?").all(user, kind) as Array<{ payload: string }>).map((row) => JSON.parse(row.payload));
  }
  private get<T>(user: string, kind: string, id: string): T {
    const row = this.db.prepare("SELECT payload FROM personal_records WHERE user_id=? AND kind=? AND id=?").get(user, kind, id) as { payload: string } | undefined;
    if (!row) throw new PersonalWorkError("记录不存在或不属于当前用户", 404);
    return JSON.parse(row.payload);
  }
  private put(user: string, kind: string, record: { id: string }) {
    this.db.prepare("INSERT INTO personal_records VALUES (?,?,?,?) ON CONFLICT(user_id,kind,id) DO UPDATE SET payload=excluded.payload").run(user, kind, record.id, JSON.stringify(record));
  }
  listMatters(user: string) { return this.records<PersonalMatter>(user, "matter").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  getMatter(user: string, id: string) { return this.get<PersonalMatter>(user, "matter", id); }
  saveMatter(user: string, input: Partial<PersonalMatter>): PersonalMatter {
    return this.db.transaction(() => {
      const id = text(input.id, "事项编号", 100) || randomUUID();
      const old = input.id ? this.getMatter(user, id) : undefined;
      if (old && input.revision !== old.revision) throw new PersonalWorkError("事项已被更新，请重新读取后再保存", 409);
      if (!old && this.listMatters(user).length >= 2000) throw new PersonalWorkError("本地事项数量已达上限", 409);
      const status = input.status ?? old?.status ?? "active";
      if (!["active", "waiting", "paused", "completed"].includes(status)) throw new PersonalWorkError("无效的事项状态");
      const now = new Date().toISOString();
      const merged = { ...old, ...input };
      const matter: PersonalMatter = {
        id, revision: (old?.revision ?? 0) + 1, status,
        title: text(merged.title, "事项名称", 100, true), goal: text(merged.goal, "目标", 1000, true),
        nextAction: text(merged.nextAction, "下一步", 500, status === "active"),
        waitingFor: text(merged.waitingFor, "等待条件", 500, status === "waiting"),
        result: text(merged.result, "完成结果", 2000, status === "completed"),
        dueAt: instant(merged.dueAt, "截止时间"), remindAt: instant(merged.remindAt, "跟进时间"),
        taskId: text(merged.taskId, "关联任务", 150), artifactId: text(merged.artifactId, "关联结果", 150),
        authority: "remind-only", createdAt: old?.createdAt ?? now, updatedAt: now,
      };
      this.put(user, "matter", matter);
      this.db.prepare("UPDATE personal_reminders SET acknowledged_at=? WHERE user_id=? AND matter_id=? AND acknowledged_at IS NULL AND (fire_at<>? OR ?)")
        .run(now, user, id, matter.remindAt || matter.dueAt, status === "completed" || status === "paused" ? 1 : 0);
      return matter;
    })();
  }
  tick(user: string, now = new Date().toISOString()): number {
    const stamp = instant(now, "当前时间");
    return this.db.transaction(() => {
      let count = 0;
      for (const matter of this.listMatters(user)) {
        const fireAt = matter.remindAt || matter.dueAt;
        if (!["active", "waiting"].includes(matter.status) || !fireAt || fireAt > stamp) continue;
        count += this.db.prepare("INSERT OR IGNORE INTO personal_reminders(user_id,id,matter_id,fire_at,created_at) VALUES(?,?,?,?,?)")
          .run(user, `${matter.id}:${fireAt}`, matter.id, fireAt, stamp).changes;
      }
      return count;
    })();
  }
  reminders(user: string) {
    const rows = this.db.prepare("SELECT id,matter_id AS matterId,fire_at AS fireAt,created_at AS createdAt FROM personal_reminders WHERE user_id=? AND acknowledged_at IS NULL ORDER BY fire_at LIMIT 200").all(user) as Array<{ id: string; matterId: string; fireAt: string; createdAt: string }>;
    return rows.map((row) => ({ ...row, matter: this.getMatter(user, row.matterId) }));
  }
  acknowledge(user: string, id: string) {
    const changed = this.db.prepare("UPDATE personal_reminders SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE user_id=? AND id=?").run(new Date().toISOString(), user, id);
    if (!changed.changes) throw new PersonalWorkError("提醒不存在", 404);
  }
  proposals(user: string) { return this.records<LearningProposal>(user, "learning").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  propose(user: string, input: { kind?: unknown; content?: unknown; source?: Partial<LearningProposal["source"]> }): LearningProposal {
    if (!["preference", "decision", "constraint"].includes(String(input.kind))) throw new PersonalWorkError("请选择偏好、决定或约束");
    const content = text(input.content, "待确认内容", 1000, true);
    const source = { matterId: text(input.source?.matterId, "事项来源", 100), taskId: text(input.source?.taskId, "任务来源", 150), artifactId: text(input.source?.artifactId, "结果来源", 150), excerpt: text(input.source?.excerpt, "来源摘录", 1500) };
    if (source.matterId) this.getMatter(user, source.matterId);
    const prior = this.proposals(user);
    const duplicate = prior.find((p) => p.state === "pending" && p.content === content && p.kind === input.kind && JSON.stringify(p.source) === JSON.stringify(source));
    if (duplicate) return duplicate;
    if (prior.length >= 4000) throw new PersonalWorkError("待确认记录数量已达上限", 409);
    const now = new Date().toISOString();
    const proposal: LearningProposal = { id: randomUUID(), revision: 1, content, kind: input.kind as LearningProposal["kind"], source, state: "pending", createdAt: now, updatedAt: now };
    this.put(user, "learning", proposal);
    return proposal;
  }
  private change(user: string, proposal: LearningProposal, state: LearningProposal["state"]) {
    const updated = { ...proposal, state, revision: proposal.revision + 1, updatedAt: new Date().toISOString() };
    this.put(user, "learning", updated);
    return updated;
  }
  async decide(user: string, id: string, action: "confirm" | "reject" | "revoke", revision: number, memory: Nemos): Promise<LearningProposal> {
    const key = `${user}:${id}`;
    const prior = this.locks.get(key) ?? Promise.resolve();
    const operation = prior.catch(() => {}).then(async () => {
      let proposal = this.get<LearningProposal>(user, "learning", id);
      if ((action === "confirm" && proposal.state === "confirmed") || (action === "revoke" && proposal.state === "revoked") || (action === "reject" && proposal.state === "rejected")) return proposal;
      if (proposal.revision !== revision && !["accepting", "revoking"].includes(proposal.state)) throw new PersonalWorkError("记录已更新，请重新读取后再操作", 409);
      if (action === "reject") {
        if (proposal.state !== "pending") throw new PersonalWorkError("这条记录已处理", 409);
        return this.change(user, proposal, "rejected");
      }
      const store = memory.forUser(user);
      if (action === "revoke") {
        if (!["confirmed", "revoking"].includes(proposal.state) || !proposal.memoryId) throw new PersonalWorkError("只能撤回已确认的学习", 409);
        proposal = this.change(user, proposal, "revoking");
        const saved = memory.raw().storage.findById("default", user, proposal.memoryId!);
        if (saved && (saved.belief_state ?? "active") === "active") await store.invalidate(saved.id, "用户撤回已确认的学习");
        return this.change(user, proposal, "revoked");
      }
      if (!["pending", "accepting"].includes(proposal.state)) throw new PersonalWorkError("这条记录不能再次确认", 409);
      proposal = this.change(user, proposal, "accepting");
      // A stable origin repairs interruption between the SDK write and our receipt.
      // Only explicit UI confirmation can enter this path; models can only propose.
      // The core explicitly admits reviewed UI entries under this canonical
      // origin. Keep the proposal id in source_message_id, not a fabricated
      // confidence or extra independent-evidence count.
      const origin = "clownfish-memory-ui";
      const layer = proposal.kind === "preference" ? "procedural" : "semantic";
      let existing: Memory | undefined;
      for (let offset = 0; ; offset += 100) {
        const page = await store.listByLayer(layer, { scope: convScope(user, APP_PERSONA_ID), limit: 100, offset });
        existing = page.find((item) => item.source.origin === origin && item.source.source_message_id === proposal.id);
        if (existing || page.length < 100) break;
      }
      const saved = existing ?? await store.write({
        layer, content: proposal.content, type: "user", scope: convScope(user, APP_PERSONA_ID),
        source: { authoritative: true, origin, extractor: "user_typed", chain_depth: 0,
          speaker_id: `user:${user}`, subject_id: `user:${user}`, conversation_id: `learning:${proposal.id}`, source_message_id: proposal.id },
        utteranceMode: "literal",
      });
      proposal.memoryId = saved.id;
      proposal.confirmedAt = new Date().toISOString();
      return this.change(user, proposal, "confirmed");
    });
    this.locks.set(key, operation);
    try { return await operation; } finally { if (this.locks.get(key) === operation) this.locks.delete(key); }
  }
}
