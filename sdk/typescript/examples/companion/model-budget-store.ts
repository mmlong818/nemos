import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

/** A durable identity must be saved by the owner before admitting any model call. */
export interface BudgetIdentity {
  scope: string;
  taskInstanceId: string;
  budgetKey: string;
}

export interface BudgetTask extends BudgetIdentity {
  limitTokens: number;
  reservedTokens: number;
  state: "open" | "closed";
}

export type AttemptState = "reserved" | "started" | "cancelled_before_start" | "finished" | "ambiguous";
export interface BudgetAttempt {
  attemptId: string;
  taskInstanceId: string;
  tokens: number;
  state: AttemptState;
  actualOutputTokens: number | null;
}

export interface BudgetStoreOptions {
  maxTasks?: number;
  maxAttempts?: number;
}

const SCHEMA_VERSION = 3;
const DEFAULT_MAX_TASKS = 100_000;
const DEFAULT_MAX_ATTEMPTS = 1_000_000;
const MAX_TOKENS = 1_000_000_000;

function positiveInteger(value: number, label: string, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} 必须是有效正整数。`);
}

function identityText(value: string, label: string): void {
  if (!value || value.length > 256 || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} 无效。`);
}

/** Synchronous transactions serialize admission across connections to the same local SQLite file. */
export class ModelBudgetStore {
  private readonly db: Database.Database;
  private readonly maxTasks: number;
  private readonly maxAttempts: number;

  constructor(path: string, options: BudgetStoreOptions = {}) {
    this.maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    positiveInteger(this.maxTasks, "任务容量");
    positiveInteger(this.maxAttempts, "尝试容量");
    this.db = new Database(path);
    this.db.pragma("busy_timeout = 5000");
    for (let attempt = 0; ; attempt++) {
      try {
        this.db.pragma("journal_mode = WAL");
        break;
      } catch (error) {
        if (!/database is locked|database is busy/i.test(String(error)) || attempt >= 50) {
          this.db.close();
          throw error;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    let version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > SCHEMA_VERSION) {
      this.db.close();
      throw new Error(`不支持较新的模型预算数据库版本 ${version}。`);
    }
    if (version < SCHEMA_VERSION) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        // Another process may have completed this migration while this
        // connection waited for the write lock. Make the migration decision
        // from the version protected by the lock, not the earlier snapshot.
        version = this.db.pragma("user_version", { simple: true }) as number;
        if (version > SCHEMA_VERSION) throw new Error(`不支持较新的模型预算数据库版本 ${version}。`);
        if (version >= SCHEMA_VERSION) {
          this.db.exec("COMMIT");
        } else {
        if (version === 0) this.db.exec(`
          CREATE TABLE policy_tasks (
            task_instance_id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            budget_key TEXT NOT NULL UNIQUE,
            limit_tokens INTEGER NOT NULL CHECK(limit_tokens > 0),
            reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens >= 0),
            state TEXT NOT NULL CHECK(state IN ('open','closed')),
            created_at INTEGER NOT NULL,
            closed_at INTEGER,
            UNIQUE(scope, budget_key)
          );
          CREATE TABLE policy_attempts (
            attempt_id TEXT PRIMARY KEY,
            task_instance_id TEXT NOT NULL REFERENCES policy_tasks(task_instance_id),
            tokens INTEGER NOT NULL CHECK(tokens > 0),
            state TEXT NOT NULL CHECK(state IN ('reserved','started','cancelled_before_start','finished','ambiguous')),
            created_at INTEGER,
            started_at INTEGER,
            finished_at INTEGER,
            actual_output_tokens INTEGER
          );
          CREATE INDEX policy_attempt_task ON policy_attempts(task_instance_id, state);
        `);
        if (version < 2) {
        this.db.exec(`CREATE TABLE policy_issuer (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          task_epoch TEXT NOT NULL,
          key_epoch TEXT NOT NULL,
          next_serial INTEGER NOT NULL CHECK(next_serial > 0)
        )`);
        this.db.prepare("INSERT INTO policy_issuer(singleton, task_epoch, key_epoch, next_serial) VALUES (1, ?, ?, 1)")
          .run(randomUUID(), randomUUID());
        }
        this.db.exec(`CREATE TABLE policy_owners (
          scope TEXT NOT NULL, owner_key TEXT NOT NULL, declared_identity TEXT NOT NULL,
          task_instance_id TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(scope, owner_key), UNIQUE(scope, declared_identity)
        )`);
        this.db.pragma("user_version = 3");
        this.db.exec("COMMIT");
        }
      } catch (error) { this.db.exec("ROLLBACK"); this.db.close(); throw error; }
    }
  }

  close(): void { this.db.close(); }

  /** Bind a durable owner to exactly one issued task. Owner rows are retained as tombstones after GC. */
  bindOwner(scope: string, ownerKey: string, declaredIdentity: string, limitTokens: number): BudgetTask {
    identityText(scope, "预算作用域");
    identityText(ownerKey, "任务所属身份");
    identityText(declaredIdentity, "任务预算身份");
    positiveInteger(limitTokens, "任务预算", MAX_TOKENS);
    return this.immediate(() => {
      const existing = this.db.prepare("SELECT declared_identity AS declaredIdentity, task_instance_id AS taskInstanceId FROM policy_owners WHERE scope = ? AND owner_key = ?")
        .get(scope, ownerKey) as { declaredIdentity: string; taskInstanceId: string } | undefined;
      if (existing) {
        if (existing.declaredIdentity !== declaredIdentity) throw new Error("任务所属身份已有不同预算身份，拒绝重新发行额度。");
        const task = this.db.prepare("SELECT scope, task_instance_id AS taskInstanceId, budget_key AS budgetKey, limit_tokens AS limitTokens, reserved_tokens AS reservedTokens, state FROM policy_tasks WHERE task_instance_id = ?")
          .get(existing.taskInstanceId) as BudgetTask | undefined;
        if (!task) throw new Error("旧任务预算已回收，拒绝重新发行额度。");
        return task;
      }
      const ownerCount = this.db.prepare("SELECT COUNT(*) AS n FROM policy_owners").get() as { n: number };
      if (ownerCount.n >= this.maxTasks) throw new Error("模型任务所属身份记录已满，暂不能开启新任务。");
      const task = this.issueTaskInTransaction(scope, limitTokens);
      this.db.prepare("INSERT INTO policy_owners(scope, owner_key, declared_identity, task_instance_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(scope, ownerKey, declaredIdentity, task.taskInstanceId, Date.now());
      return task;
    });
  }

  private immediate<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = body(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private task(identity: BudgetIdentity): BudgetTask {
    const row = this.db.prepare("SELECT scope, task_instance_id AS taskInstanceId, budget_key AS budgetKey, limit_tokens AS limitTokens, reserved_tokens AS reservedTokens, state FROM policy_tasks WHERE task_instance_id = ? AND scope = ? AND budget_key = ?")
      .get(identity.taskInstanceId, identity.scope, identity.budgetKey) as BudgetTask | undefined;
    if (!row) throw new Error("模型预算身份不存在或不匹配。");
    return row;
  }

  private attempt(attemptId: string): BudgetAttempt | undefined {
    return this.db.prepare("SELECT attempt_id AS attemptId, task_instance_id AS taskInstanceId, tokens, state, actual_output_tokens AS actualOutputTokens FROM policy_attempts WHERE attempt_id = ?")
      .get(attemptId) as BudgetAttempt | undefined;
  }

  /** Issues an unguessable new incarnation; callers must persist both IDs with the owning task. */
  issueTask(scope: string, limitTokens: number): BudgetTask {
    identityText(scope, "预算作用域");
    positiveInteger(limitTokens, "任务预算", MAX_TOKENS);
    return this.immediate(() => this.issueTaskInTransaction(scope, limitTokens));
  }

  private issueTaskInTransaction(scope: string, limitTokens: number): BudgetTask {
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM policy_tasks").get() as { n: number };
      if (count.n >= this.maxTasks) throw new Error("模型任务预算记录已满，暂不能开启新任务。");
      const issuer = this.db.prepare("SELECT task_epoch AS taskEpoch, key_epoch AS keyEpoch, next_serial AS nextSerial FROM policy_issuer WHERE singleton = 1")
        .get() as { taskEpoch: string; keyEpoch: string; nextSerial: number };
      if (!Number.isSafeInteger(issuer.nextSerial) || issuer.nextSerial < 1 || issuer.nextSerial >= Number.MAX_SAFE_INTEGER)
        throw new Error("模型任务身份发行序号已耗尽。");
      const task: BudgetTask = {
        scope, taskInstanceId: `${issuer.taskEpoch}:${issuer.nextSerial}`,
        budgetKey: `${issuer.keyEpoch}:${issuer.nextSerial}`,
        limitTokens, reservedTokens: 0, state: "open",
      };
      this.db.prepare("UPDATE policy_issuer SET next_serial = ? WHERE singleton = 1").run(issuer.nextSerial + 1);
      this.db.prepare("INSERT INTO policy_tasks(task_instance_id, scope, budget_key, limit_tokens, reserved_tokens, state, created_at) VALUES (?, ?, ?, ?, 0, 'open', ?)")
        .run(task.taskInstanceId, scope, task.budgetKey, limitTokens, Date.now());
      return task;
  }

  getTask(identity: BudgetIdentity): BudgetTask { return this.task(identity); }
  getAttempt(identity: BudgetIdentity, attemptId: string): BudgetAttempt | undefined {
    this.task(identity);
    const attempt = this.attempt(attemptId);
    if (attempt && attempt.taskInstanceId !== identity.taskInstanceId) throw new Error("模型尝试身份已属于其他任务。");
    return attempt;
  }

  /** Duplicate attempt IDs are idempotent only for the exact same task and token request. */
  reserve(identity: BudgetIdentity, attemptId: string, tokens: number, currentLimitTokens: number): BudgetAttempt {
    identityText(attemptId, "尝试身份");
    positiveInteger(tokens, "预留 Token", MAX_TOKENS);
    positiveInteger(currentLimitTokens, "当前任务预算", MAX_TOKENS);
    return this.immediate(() => {
      const task = this.task(identity);
      const existing = this.attempt(attemptId);
      if (existing) {
        if (existing.taskInstanceId !== task.taskInstanceId || existing.tokens !== tokens) throw new Error("重复的模型尝试身份与原预留不符。");
        return existing;
      }
      if (task.state !== "open") throw new Error("已关闭的模型任务预算不可重新开启。");
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM policy_attempts").get() as { n: number };
      if (count.n >= this.maxAttempts) throw new Error("模型尝试预算记录已满，暂不能预留。");
      const limit = Math.min(task.limitTokens, currentLimitTokens);
      if (task.reservedTokens + tokens > limit) throw new Error("本次任务的模型输出 Token 预留预算已用完。");
      this.db.prepare("INSERT INTO policy_attempts(attempt_id, task_instance_id, tokens, state, created_at) VALUES (?, ?, ?, 'reserved', ?)")
        .run(attemptId, task.taskInstanceId, tokens, Date.now());
      this.db.prepare("UPDATE policy_tasks SET reserved_tokens = reserved_tokens + ? WHERE task_instance_id = ?")
        .run(tokens, task.taskInstanceId);
      return this.attempt(attemptId)!;
    });
  }

  private transition(identity: BudgetIdentity, attemptId: string, action: "start" | "refund" | "finish" | "ambiguous", actualOutputTokens?: number | null): BudgetAttempt {
    identityText(attemptId, "尝试身份");
    if (actualOutputTokens != null && (!Number.isSafeInteger(actualOutputTokens) || actualOutputTokens < 0 || actualOutputTokens > MAX_TOKENS))
      throw new Error("实际输出 Token 必须是有效非负整数。");
    return this.immediate(() => {
      const task = this.task(identity);
      const attempt = this.getAttempt(identity, attemptId);
      if (!attempt) throw new Error("模型尝试身份不存在。");
      const target: AttemptState = action === "start" ? "started" : action === "refund" ? "cancelled_before_start" : action === "finish" ? "finished" : "ambiguous";
      if (attempt.state === target) return attempt;
      if (action === "start" && attempt.state === "reserved" && task.state === "open") {
        this.db.prepare("UPDATE policy_attempts SET state = 'started', started_at = ? WHERE attempt_id = ?").run(Date.now(), attemptId);
      } else if (action === "refund" && attempt.state === "reserved") {
        this.db.prepare("UPDATE policy_attempts SET state = 'cancelled_before_start', finished_at = ? WHERE attempt_id = ?").run(Date.now(), attemptId);
        this.db.prepare("UPDATE policy_tasks SET reserved_tokens = reserved_tokens - ? WHERE task_instance_id = ?").run(attempt.tokens, identity.taskInstanceId);
      } else if (action === "finish" && attempt.state === "started") {
        this.db.prepare("UPDATE policy_attempts SET state = 'finished', finished_at = ?, actual_output_tokens = ? WHERE attempt_id = ?")
          .run(Date.now(), actualOutputTokens ?? null, attemptId);
      } else if (action === "ambiguous" && attempt.state === "started") {
        this.db.prepare("UPDATE policy_attempts SET state = 'ambiguous', finished_at = ? WHERE attempt_id = ?").run(Date.now(), attemptId);
      } else {
        throw new Error(`模型尝试状态 ${attempt.state} 不允许 ${action}。`);
      }
      return this.attempt(attemptId)!;
    });
  }

  /** Commit this state immediately before provider transport; every later outcome remains charged. */
  start(identity: BudgetIdentity, attemptId: string): BudgetAttempt { return this.transition(identity, attemptId, "start"); }
  refundBeforeStart(identity: BudgetIdentity, attemptId: string): BudgetAttempt { return this.transition(identity, attemptId, "refund"); }
  finish(identity: BudgetIdentity, attemptId: string, actualOutputTokens?: number | null): BudgetAttempt {
    return this.transition(identity, attemptId, "finish", actualOutputTokens);
  }
  markAmbiguous(identity: BudgetIdentity, attemptId: string): BudgetAttempt { return this.transition(identity, attemptId, "ambiguous"); }

  /** Terminal close rejects new reservations; existing charged attempts are never refunded. */
  closeTask(identity: BudgetIdentity): BudgetTask {
    return this.immediate(() => {
      const task = this.task(identity);
      if (task.state === "open") {
        const pending = this.db.prepare("SELECT COUNT(*) AS n FROM policy_attempts WHERE task_instance_id = ? AND state IN ('reserved','started','ambiguous')")
          .get(task.taskInstanceId) as { n: number };
        if (pending.n) throw new Error("模型尝试尚未明确结算，不能关闭任务预算。");
        this.db.prepare("UPDATE policy_tasks SET state = 'closed', closed_at = ? WHERE task_instance_id = ?")
          .run(Date.now(), task.taskInstanceId);
      }
      return this.task(identity);
    });
  }

  /** Close only an already issued owner; missing or legacy identity never creates a task. */
  closeOwner(scope: string, ownerKey: string, declaredIdentity: string): BudgetTask | undefined {
    identityText(scope, "预算作用域");
    identityText(ownerKey, "任务所属身份");
    identityText(declaredIdentity, "任务预算身份");
    return this.immediate(() => {
      const owner = this.db.prepare("SELECT declared_identity AS declaredIdentity, task_instance_id AS taskInstanceId FROM policy_owners WHERE scope = ? AND owner_key = ?")
        .get(scope, ownerKey) as { declaredIdentity: string; taskInstanceId: string } | undefined;
      if (!owner) return undefined;
      if (owner.declaredIdentity !== declaredIdentity) throw new Error("任务所属身份已有不同预算身份，拒绝关闭。");
      const task = this.db.prepare("SELECT scope, task_instance_id AS taskInstanceId, budget_key AS budgetKey, limit_tokens AS limitTokens, reserved_tokens AS reservedTokens, state FROM policy_tasks WHERE task_instance_id = ?")
        .get(owner.taskInstanceId) as BudgetTask | undefined;
      if (!task) return undefined; // Collected owner tombstone.
      if (task.state === "open") {
        const pending = this.db.prepare("SELECT COUNT(*) AS n FROM policy_attempts WHERE task_instance_id = ? AND state IN ('reserved','started','ambiguous')")
          .get(task.taskInstanceId) as { n: number };
        if (pending.n) return undefined;
        this.db.prepare("UPDATE policy_tasks SET state = 'closed', closed_at = ? WHERE task_instance_id = ?")
          .run(Date.now(), task.taskInstanceId);
      }
      return this.task(task);
    });
  }

  /** Reclaim closed tasks; the durable issuer sequence makes their identities impossible to reissue. */
  collectClosed(olderThan: number, maxTasks = 1000): number {
    positiveInteger(maxTasks, "回收批量");
    if (!Number.isSafeInteger(olderThan) || olderThan < 0) throw new Error("回收时间无效。");
    return this.immediate(() => {
      const rows = this.db.prepare("SELECT task_instance_id AS taskInstanceId FROM policy_tasks WHERE state = 'closed' AND closed_at <= ? ORDER BY closed_at, task_instance_id LIMIT ?")
        .all(olderThan, maxTasks) as { taskInstanceId: string }[];
      const deleteAttempts = this.db.prepare("DELETE FROM policy_attempts WHERE task_instance_id = ?");
      const deleteTask = this.db.prepare("DELETE FROM policy_tasks WHERE task_instance_id = ? AND state = 'closed'");
      for (const row of rows) { deleteAttempts.run(row.taskInstanceId); deleteTask.run(row.taskInstanceId); }
      return rows.length;
    });
  }

  stats(): { tasks: number; attempts: number; maxTasks: number; maxAttempts: number } {
    const tasks = (this.db.prepare("SELECT COUNT(*) AS n FROM policy_tasks").get() as { n: number }).n;
    const attempts = (this.db.prepare("SELECT COUNT(*) AS n FROM policy_attempts").get() as { n: number }).n;
    return { tasks, attempts, maxTasks: this.maxTasks, maxAttempts: this.maxAttempts };
  }
}
