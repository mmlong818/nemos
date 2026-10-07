import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import test, { type TestContext } from "node:test";
import Database from "better-sqlite3";
import { ModelBudgetStore } from "../../examples/companion/model-budget-store.js";

function fixture(t: TestContext, options: { maxTasks?: number; maxAttempts?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nemos-budget-"));
  const path = join(dir, "model-call-policy.db");
  const stores: ModelBudgetStore[] = [];
  const open = () => { const store = new ModelBudgetStore(path, options); stores.push(store); return store; };
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { open, path };
}

test("task identity and charged attempts survive reopen; started crash remains charged", (t) => {
  const f = fixture(t); const a = f.open();
  const task = a.issueTask("fixture", 100);
  a.reserve(task, "first", 60, 100); a.start(task, "first");
  a.close();
  const b = f.open();
  assert.equal(b.getTask(task).reservedTokens, 60);
  assert.equal(b.getAttempt(task, "first")?.state, "started");
  assert.throws(() => b.reserve(task, "too-much", 41, 100), /预算已用完/);
  b.markAmbiguous(task, "first");
  assert.equal(b.getTask(task).reservedTokens, 60);
  assert.equal(b.getAttempt(task, "first")?.state, "ambiguous");
  assert.throws(() => b.refundBeforeStart(task, "first"), /不允许 refund/);
});

test("two connections serialize shared-task reservations and retries each charge", (t) => {
  const f = fixture(t); const a = f.open(); const b = f.open();
  const task = a.issueTask("fixture", 100);
  assert.equal(a.reserve(task, "team-plan", 50, 100).state, "reserved");
  assert.equal(b.reserve(task, "team-worker", 50, 100).state, "reserved");
  assert.throws(() => a.reserve(task, "retry", 1, 100), /预算已用完/);
  a.start(task, "team-plan"); b.start(task, "team-worker");
  assert.equal(a.getTask(task).reservedTokens, 100);
  assert.equal(b.getTask(task).reservedTokens, 100);
});

test("duplicate attempt is idempotent but mismatched task, tokens, or reused cancelled ID fail", (t) => {
  const s = fixture(t).open(); const first = s.issueTask("fixture", 100); const second = s.issueTask("fixture", 100);
  s.reserve(first, "same", 20, 100);
  assert.equal(s.reserve(first, "same", 20, 100).state, "reserved");
  assert.equal(s.getTask(first).reservedTokens, 20);
  assert.throws(() => s.reserve(first, "same", 21, 100), /原预留不符/);
  assert.throws(() => s.reserve(second, "same", 20, 100), /原预留不符/);
  s.refundBeforeStart(first, "same");
  assert.equal(s.getTask(first).reservedTokens, 0);
  assert.equal(s.reserve(first, "same", 20, 100).state, "cancelled_before_start");
  assert.throws(() => s.start(first, "same"), /不允许 start/);
  assert.throws(() => s.getTask({ ...first, budgetKey: randomUUID() }), /身份不存在/);
});

test("pre-start refund survives reopen; lowered limit and reserved crash stay conservative", (t) => {
  const f = fixture(t); const a = f.open(); const task = a.issueTask("fixture", 100);
  a.reserve(task, "queued", 50, 100); a.reserve(task, "uncertain-queue", 30, 100);
  a.close(); const b = f.open();
  assert.equal(b.getAttempt(task, "queued")?.state, "reserved");
  assert.throws(() => b.reserve(task, "new", 1, 70), /预算已用完/);
  b.refundBeforeStart(task, "queued");
  assert.equal(b.getTask(task).reservedTokens, 30);
  b.reserve(task, "new", 40, 70); b.start(task, "new"); b.finish(task, "new", 0);
  assert.equal(b.getTask(task).reservedTokens, 70);
  assert.equal(b.getAttempt(task, "new")?.actualOutputTokens, 0);
});

test("closed incarnation cannot reopen; reused display task receives a fresh budget identity", (t) => {
  const s = fixture(t).open(); const old = s.issueTask("fixture", 11);
  s.reserve(old, "a", 10, 11); s.start(old, "a");
  s.reserve(old, "pending", 1, 11);
  assert.throws(() => s.closeTask(old), /尚未明确结算/);
  s.finish(old, "a", 4); s.refundBeforeStart(old, "pending");
  s.closeTask(old);
  assert.equal(s.closeTask(old).state, "closed");
  assert.throws(() => s.reserve(old, "b", 1, 10), /不可重新开启/);
  assert.throws(() => s.start(old, "pending"), /不允许 start/);
  const replacement = s.issueTask("fixture", 10);
  assert.notEqual(replacement.taskInstanceId, old.taskInstanceId);
  assert.notEqual(replacement.budgetKey, old.budgetKey);
  assert.throws(() => s.reserve({ ...replacement, budgetKey: old.budgetKey }, "c", 1, 10), /身份不存在/);
  s.reserve(replacement, "c", 10, 10);
  assert.equal(s.getTask(old).reservedTokens, 10);
});

test("capacity fails closed, then closed GC reclaims rows without reviving identities", (t) => {
  const f = fixture(t, { maxTasks: 2, maxAttempts: 2 }); const s = f.open();
  const one = s.issueTask("fixture", 20);
  s.reserve(one, "finished", 10, 20); s.start(one, "finished"); s.finish(one, "finished", 3);
  s.reserve(one, "refunded", 10, 20); s.refundBeforeStart(one, "refunded"); s.closeTask(one);
  assert.equal(s.getTask(one).reservedTokens, 10);
  assert.equal(s.getAttempt(one, "finished")?.state, "finished");
  assert.equal(s.getAttempt(one, "refunded")?.state, "cancelled_before_start");
  const two = s.issueTask("fixture", 20);
  assert.throws(() => s.reserve(two, "third", 1, 20), /记录已满/);
  assert.throws(() => s.issueTask("fixture", 20), /记录已满/);
  assert.deepEqual(s.stats(), { tasks: 2, attempts: 2, maxTasks: 2, maxAttempts: 2 });
  assert.equal(s.collectClosed(0), 0);
  assert.equal(s.collectClosed(Date.now() + 1, 1), 1);
  assert.equal(s.collectClosed(Date.now() + 1), 0);
  assert.deepEqual(s.stats(), { tasks: 1, attempts: 0, maxTasks: 2, maxAttempts: 2 });
  assert.throws(() => s.getTask(one), /身份不存在/);
  assert.throws(() => s.reserve(one, "revive", 1, 20), /身份不存在/);
  const replacement = s.issueTask("fixture", 20);
  assert.notEqual(replacement.taskInstanceId, one.taskInstanceId);
  assert.notEqual(replacement.budgetKey, one.budgetKey);
  s.reserve(replacement, "third", 1, 20);
  s.close(); const reopened = f.open();
  assert.throws(() => reopened.reserve(one, "revive", 1, 20), /身份不存在/);
  assert.throws(() => reopened.issueTask("fixture", 20), /记录已满/);
});

test("schema rejects unsupported future version without touching it", (t) => {
  const f = fixture(t); const s = f.open(); s.close();
  const migrated = new Database(f.path, { readonly: true });
  assert.equal(migrated.pragma("user_version", { simple: true }), 3); migrated.close();
  const db = new Database(f.path); db.pragma("user_version = 99"); db.close();
  assert.throws(() => f.open(), /较新的模型预算数据库版本/);
  const check = new Database(f.path, { readonly: true });
  assert.equal(check.pragma("user_version", { simple: true }), 99); check.close();
});

test("owner alias survives restart and GC as a fail-closed tombstone", (t) => {
  const f = fixture(t, { maxTasks: 2 }); const first = f.open();
  const task = first.bindOwner("companion", "run-1", "uuid-1", 100);
  first.reserve(task, "attempt-1", 60, 100); first.start(task, "attempt-1");
  first.close(); const second = f.open();
  assert.equal(second.bindOwner("companion", "run-1", "uuid-1", 100).taskInstanceId, task.taskInstanceId);
  assert.throws(() => second.bindOwner("companion", "run-1", "uuid-2", 100), /不同预算身份/);
  assert.throws(() => second.reserve(task, "retry", 41, 100), /预算已用完/);
  second.finish(task, "attempt-1", 4);
  second.closeTask(task); second.collectClosed(Date.now() + 1);
  assert.throws(() => second.bindOwner("companion", "run-1", "uuid-1", 100), /已回收/);
  second.bindOwner("companion", "run-2", "uuid-2", 100);
  assert.throws(() => second.bindOwner("companion", "run-3", "uuid-3", 100), /记录已满/);
});

test("owner closes only after every concurrent attempt settles; ambiguous crash remains charged and open", (t) => {
  const f = fixture(t); const first = f.open(); const second = f.open();
  const task = first.bindOwner("companion", "team-key", "uuid-team", 100);
  first.reserve(task, "worker-a", 30, 100); first.start(task, "worker-a");
  second.reserve(task, "worker-b", 20, 100); second.start(task, "worker-b");
  assert.equal(first.closeOwner("companion", "team-key", "uuid-team"), undefined);
  first.finish(task, "worker-a", 10);
  assert.equal(first.closeOwner("companion", "team-key", "uuid-team"), undefined);
  second.markAmbiguous(task, "worker-b");
  assert.equal(first.closeOwner("companion", "team-key", "uuid-team"), undefined);
  assert.equal(first.collectClosed(Date.now() + 1), 0);
  assert.equal(first.getTask(task).reservedTokens, 50);
  assert.equal(first.getTask(task).state, "open");
});

test("settled owner detail is collected without recreating old or missing identities", (t) => {
  const f = fixture(t, { maxTasks: 2, maxAttempts: 2 }); const first = f.open();
  const task = first.bindOwner("companion", "team-key", "uuid-team", 100);
  assert.equal(first.closeOwner("companion", "missing", "old-uuid"), undefined);
  assert.equal(first.stats().tasks, 1);
  first.reserve(task, "plan", 20, 100); first.start(task, "plan"); first.finish(task, "plan", 5);
  first.reserve(task, "worker", 20, 100); first.start(task, "worker"); first.finish(task, "worker", 8);
  assert.equal(first.closeOwner("companion", "team-key", "uuid-team")?.state, "closed");
  assert.equal(first.collectClosed(Date.now() + 1), 1);
  assert.equal(first.closeOwner("companion", "team-key", "uuid-team"), undefined);
  assert.throws(() => first.bindOwner("companion", "team-key", "uuid-team", 100), /已回收/);
  assert.throws(() => first.bindOwner("companion", "team-key", "other-uuid", 100), /不同预算身份/);
  assert.deepEqual(first.stats(), { tasks: 0, attempts: 0, maxTasks: 2, maxAttempts: 2 });
  const next = first.bindOwner("companion", "next-key", "next-uuid", 100);
  assert.notEqual(next.taskInstanceId, task.taskInstanceId);
});

test("version 2 migration keeps issued tasks and adds owner binding", (t) => {
  const f = fixture(t); const initial = f.open();
  const legacy = initial.issueTask("legacy", 20); initial.close();
  const db = new Database(f.path); db.exec("DROP TABLE policy_owners; PRAGMA user_version = 2"); db.close();
  const upgraded = f.open();
  assert.equal(upgraded.getTask(legacy).limitTokens, 20);
  assert.equal(upgraded.bindOwner("companion", "owner", "uuid", 20).state, "open");
});

test("concurrent first connections serialize fresh database migration", async (t) => {
  const f = fixture(t);
  const modulePath = join(process.cwd(), "examples/companion/model-budget-store.ts");
  const source = `
    require("tsx/cjs");
    const { parentPort, workerData } = require("node:worker_threads");
    const { ModelBudgetStore } = require(workerData.modulePath);
    parentPort.on("message", (message) => {
      if (message !== "open") return;
      try {
        const store = new ModelBudgetStore(workerData.path);
        const task = store.bindOwner("companion", "shared-owner", "shared-uuid", 20);
        parentPort.postMessage({ ok: true, taskInstanceId: task.taskInstanceId });
        store.close();
        parentPort.close();
      } catch (error) { parentPort.postMessage({ ok: false, error: String(error) }); parentPort.close(); }
    });
    parentPort.postMessage({ ready: true });
  `;
  const workers = [0, 1].map(() => new Worker(source, {
    eval: true,
    execArgv: ["--import", "tsx"],
    workerData: { modulePath, path: f.path },
  }));
  t.after(async () => { await Promise.all(workers.map((worker) => worker.terminate())); });
  await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
    worker.once("message", (message) => message?.ready ? resolve() : reject(new Error("Worker 未就绪")));
    worker.once("error", reject);
  })));
  const results = await Promise.all(workers.map((worker) => new Promise<{ ok: boolean; taskInstanceId?: string; error?: string }>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.postMessage("open");
  })));
  assert.equal(results.every((result) => result.ok), true, JSON.stringify(results));
  assert.equal(results[0]?.taskInstanceId, results[1]?.taskInstanceId);
});

test("version 1 migration preserves prior identities and starts monotonic issuance", (t) => {
  const f = fixture(t); const db = new Database(f.path);
  const legacyTaskId = randomUUID(); const legacyKey = randomUUID();
  db.exec(`CREATE TABLE policy_tasks (
    task_instance_id TEXT PRIMARY KEY, scope TEXT NOT NULL, budget_key TEXT NOT NULL UNIQUE,
    limit_tokens INTEGER NOT NULL, reserved_tokens INTEGER NOT NULL,
    state TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER
  );
  CREATE TABLE policy_attempts (
    attempt_id TEXT PRIMARY KEY, task_instance_id TEXT NOT NULL REFERENCES policy_tasks(task_instance_id),
    tokens INTEGER NOT NULL, state TEXT NOT NULL, created_at INTEGER,
    started_at INTEGER, finished_at INTEGER, actual_output_tokens INTEGER
  );
  CREATE INDEX policy_attempt_task ON policy_attempts(task_instance_id, state);
  PRAGMA user_version = 1;`);
  db.prepare("INSERT INTO policy_tasks VALUES (?, 'fixture', ?, 10, 10, 'open', 1, NULL)").run(legacyTaskId, legacyKey);
  db.prepare("INSERT INTO policy_attempts VALUES ('legacy-attempt', ?, 10, 'started', 1, 1, NULL, NULL)").run(legacyTaskId);
  db.close();
  const store = f.open(); const legacy = { scope: "fixture", taskInstanceId: legacyTaskId, budgetKey: legacyKey };
  assert.equal(store.getTask(legacy).reservedTokens, 10);
  assert.equal(store.getAttempt(legacy, "legacy-attempt")?.state, "started");
  const newer = store.issueTask("fixture", 10);
  assert.notEqual(newer.taskInstanceId, legacyTaskId);
  assert.match(newer.taskInstanceId, /^[0-9a-f-]{36}:1$/);
  store.close();
  const reopened = f.open();
  assert.match(reopened.issueTask("fixture", 10).taskInstanceId, /:2$/);
});
