import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { Nemos } from "../../src/index.js";
import { PersonalWorkStore } from "../../examples/companion/personal-work.js";
import { makeMockLLMConfig } from "../helpers.js";
import { CompanionEngine } from "../../examples/companion/engine.js";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "personal-work-"));
  const path = join(dir, "personal.db");
  const openMemory = () => new Nemos({ storage: { type: "sqlite", path: join(dir, "memory.db") }, llm: makeMockLLMConfig(), worker: { manualWorker: true } });
  const state = { store: new PersonalWorkStore(path), memory: openMemory(), path,
    restart() { this.store.close(); this.memory.close(); this.store = new PersonalWorkStore(path); this.memory = openMemory(); } };
  t.after(() => { state.store.close(); state.memory.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return state;
}
const matter = { title: "十月旅行", goal: "确认出行方案", nextAction: "确认可休假的日期", dueAt: "2026-10-01T09:00:00+08:00" };

test("事项跨数据库重启保留，更新需要正确版本，不能修改其他用户事项", (t) => {
  const f = fixture(t); const saved = f.store.saveMatter("me", matter);
  assert.equal(saved.authority, "remind-only"); f.restart();
  assert.equal(f.store.getMatter("me", saved.id).goal, matter.goal);
  assert.deepEqual(f.store.listMatters("another"), []);
  assert.throws(() => f.store.getMatter("another", saved.id), /不存在/);
  assert.throws(() => f.store.saveMatter("me", { ...saved, revision: 0 }), /已被更新/);
  const updated = f.store.saveMatter("me", { id: saved.id, revision: saved.revision, status: "waiting", waitingFor: "家人回复" });
  assert.equal(updated.revision, 2); assert.equal(updated.title, matter.title);
});
test("等待、完成、时间和长度校验阻止虚假完成，不改变原记录", (t) => {
  const f = fixture(t); const saved = f.store.saveMatter("me", matter);
  for (const patch of [{ status: "waiting" }, { status: "completed" }, { title: "" }, { goal: "a".repeat(1001) }, { dueAt: "2026-10-01T09:00" }]) {
    assert.throws(() => f.store.saveMatter("me", { ...saved, ...patch } as typeof saved));
  }
  assert.deepEqual(f.store.getMatter("me", saved.id), saved);
  assert.equal(f.store.saveMatter("me", { ...saved, status: "completed", result: "已确定日程" }).status, "completed");
});
test("到期提醒无需浏览器并跨重启去重，已确认提醒不会再次弹出", (t) => {
  const f = fixture(t); const saved = f.store.saveMatter("me", matter);
  assert.equal(f.store.tick("me", "2026-09-30T00:00:00Z"), 0);
  assert.equal(f.store.tick("me", "2026-10-01T01:00:00Z"), 1);
  f.restart(); assert.equal(f.store.tick("me", "2026-10-02T01:00:00Z"), 0);
  const reminder = f.store.reminders("me")[0]; assert.equal(reminder.matterId, saved.id);
  assert.throws(() => f.store.acknowledge("another", reminder.id), /不存在/);
  f.store.acknowledge("me", reminder.id); f.restart();
  assert.equal(f.store.tick("me", "2026-10-03T01:00:00Z"), 0); assert.deepEqual(f.store.reminders("me"), []);
});
test("暂停/完成取消旧提醒，改跟进时间仅创建新时间的提醒", (t) => {
  const f = fixture(t); let saved = f.store.saveMatter("me", matter);
  f.store.tick("me", "2026-10-02T01:00:00Z");
  saved = f.store.saveMatter("me", { ...saved, remindAt: "2026-10-03T01:00:00Z" });
  assert.deepEqual(f.store.reminders("me"), []);
  assert.equal(f.store.tick("me", "2026-10-03T01:00:00Z"), 1);
  saved = f.store.saveMatter("me", { ...saved, status: "paused" });
  assert.deepEqual(f.store.reminders("me"), []); assert.equal(f.store.tick("me", "2026-10-04T01:00:00Z"), 0);
});
test("学习提议不进入记忆；拒绝不写入，确认后才可召回", async (t) => {
  const f = fixture(t);
  const input = { kind: "preference", content: "用户偏好简洁标题和三列表格", source: { excerpt: "用户在复盘中明确表示" } };
  const proposal = f.store.propose("me", input);
  assert.equal(f.store.propose("me", input).id, proposal.id);
  assert.equal((await f.memory.forUser("me").listByLayer("procedural")).length, 0);
  const confirmed = await f.store.decide("me", proposal.id, "confirm", proposal.revision, f.memory);
  assert.equal(confirmed.state, "confirmed"); assert.ok(confirmed.memoryId);
  const engine = new CompanionEngine(f.memory, [{ id: "clownfish", name: "小丑鱼", persona: "个人助理" }], async () => "完成");
  assert.match((await engine.recall("me", "clownfish", "按要求交付", "preferences")).userFacts, /三列表格/);
  const rejected = f.store.propose("me", { kind: "decision", content: "第三方的例子不是用户决定" });
  await f.store.decide("me", rejected.id, "reject", rejected.revision, f.memory);
  assert.equal((await f.memory.forUser("me").listByLayer("semantic")).length, 0);
});
test("确认并发/重试不会重复写入，撤回后重启不再召回", async (t) => {
  const f = fixture(t); const p = f.store.propose("me", { kind: "preference", content: "用户偏好简洁标题和三列表格" });
  const results = await Promise.all([f.store.decide("me", p.id, "confirm", 1, f.memory), f.store.decide("me", p.id, "confirm", 1, f.memory)]);
  assert.equal(results[0].memoryId, results[1].memoryId);
  assert.equal((await f.memory.forUser("me").listByLayer("procedural")).length, 1);
  await f.store.decide("me", p.id, "revoke", results[0].revision, f.memory); f.restart();
  assert.equal(f.store.proposals("me")[0].state, "revoked");
  const engine = new CompanionEngine(f.memory, [{ id: "clownfish", name: "小丑鱼", persona: "个人助理" }], async () => "完成");
  assert.equal((await engine.recall("me", "clownfish", "用户偏好简洁标题和三列表格", "preferences")).userFacts, "");
});
test("确认写入与本地回执之间中断时，重新确认修复回执而非复制记忆", async (t) => {
  const f = fixture(t); const p = f.store.propose("me", { kind: "constraint", content: "用户要求所有外发操作再次确认" });
  const confirmed = await f.store.decide("me", p.id, "confirm", 1, f.memory);
  const db = new Database(f.path);
  db.prepare("UPDATE personal_records SET payload=? WHERE user_id=? AND kind='learning' AND id=?").run(JSON.stringify({ ...p, state: "accepting", revision: 2 }), "me", p.id); db.close();
  f.restart(); const repaired = await f.store.decide("me", p.id, "confirm", 2, f.memory);
  assert.equal(repaired.memoryId, confirmed.memoryId); assert.equal((await f.memory.forUser("me").listByLayer("semantic")).length, 1);
});
test("学习操作拒绝跨用户、过期版本和已拒绝记录重新确认", async (t) => {
  const f = fixture(t); const p = f.store.propose("me", { kind: "decision", content: "已确认的测试决定" });
  await assert.rejects(f.store.decide("another", p.id, "confirm", 1, f.memory), /不存在/);
  await assert.rejects(f.store.decide("me", p.id, "confirm", 99, f.memory), /已更新/);
  const rejected = await f.store.decide("me", p.id, "reject", 1, f.memory);
  await assert.rejects(f.store.decide("me", p.id, "confirm", rejected.revision, f.memory), /不能再次确认/);
});
test("损坏数据库不会被当成空白数据库覆盖", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "personal-corrupt-")); const file = join(dir, "bad.db");
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  writeFileSync(file, "not-a-database"); assert.throws(() => new PersonalWorkStore(file)); assert.equal(readFileSync(file, "utf8"), "not-a-database");
});
