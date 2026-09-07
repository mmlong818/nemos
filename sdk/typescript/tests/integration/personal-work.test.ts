import assert from "node:assert/strict";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("个人事项 HTTP：保存、后端提醒、确认学习、撤回、重启和错误边界", { timeout: 60000 }, async () => {
  const app = await startModelHarness();
  const post = async (path: string, body: unknown) => { const res = await fetch(app.base + "/api/personal-work" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() as any }; };
  const snapshot = async () => await (await fetch(app.base + "/api/personal-work")).json() as any;
  try {
    assert.equal((await fetch(app.base + "/matters")).status, 200);
    const created = await post("/matters", { title: "测试发布", goal: "交付可验证客户端", nextAction: "核对安装包", dueAt: "2020-01-01T00:00:00Z", userId: "forged-user", authority: "all" });
    assert.equal(created.status, 200); const matter = created.body.record;
    assert.equal(matter.authority, "remind-only");
    assert.equal((await post("/matters", { ...matter, revision: 0 })).status, 409);
    assert.equal((await post("/matters", { ...matter, taskId: "missing-task" })).status, 400);
    const incomplete = await post("/matters", { ...matter, status: "completed", result: "" });
    assert.equal(incomplete.status, 400);
    assert.equal(incomplete.body.error, "请填写完成结果");
    assert.equal((await snapshot()).matters[0].status, "active");
    assert.equal((await post("/matters", { ...matter, dueAt: "2026-02-30T00:00:00Z" })).status, 400);
    await app.restart();
    const after = await snapshot(); assert.equal(after.matters.length, 1); assert.equal(after.reminders.length, 1);
    await post("/acknowledge", { id: after.reminders[0].id }); await app.restart(); assert.equal((await snapshot()).reminders.length, 0);
    const proposed = await post("/learning", { kind: "preference", content: "用户偏好简洁标题和三列表格", source: { matterId: matter.id, excerpt: "发布复盘中的确认" } });
    const p = proposed.body.record; assert.equal(p.state, "pending");
    assert.equal((await post("/decision", { id: p.id, revision: 1, action: "confirm" })).status, 400);
    const confirmed = await post("/decision", { id: p.id, revision: 1, action: "confirm", confirmed: true });
    assert.equal(confirmed.status, 200); assert.ok(confirmed.body.record.memoryId);
    const memories = await (await fetch(app.base + "/api/memory?who=me")).json() as any;
    const fact = memories.facts.find((m: any) => m.id === confirmed.body.record.memoryId);
    assert.ok(fact);
    assert.equal(fact.source.kind, "confirmed-learning");
    assert.equal(fact.source.excerpt, "发布复盘中的确认");
    assert.equal(fact.source.proposalId, p.id);
    assert.equal(fact.source.sourceMessageId, undefined);
    assert.equal((await post("/decision", { id: p.id, revision: confirmed.body.record.revision, action: "revoke", confirmed: true })).status, 200);
    await app.restart(); assert.equal((await snapshot()).proposals[0].state, "revoked");
  } finally { await app.stop(); }
});
