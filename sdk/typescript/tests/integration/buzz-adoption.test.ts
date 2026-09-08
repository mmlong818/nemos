import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { startBuzzHarness } from "../fixtures/buzz-adoption-harness.js";

test("real server: memory failure is explicit, attention resolves after a decision and survives restart", { timeout: 90_000 }, async () => {
  const app = await startBuzzHarness();
  const get = async (path: string) => (await fetch(app.base + path)).json() as Promise<any>;
  const post = (path: string, body: unknown) => fetch(app.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const file = join(app.dir, "counterparts.json");
    for (const response of [await fetch(app.base + "/api/relationships"), await post("/api/relationships", { id: "new", boundaries: [] }), await post("/api/relationships/delete", { id: "new" })]) {
      assert.equal(response.status, 503);
      const data = await response.json() as any;
      assert.equal(data.code, "RELATIONSHIP_MEMORY_UNAVAILABLE");
      assert.match(data.error, /不会自动清空或覆盖/);
    }
    assert.equal(readFileSync(file, "utf8"), "{QA-corrupted-memory");
    // 只断言本夹具植入的三条，不断言队列总数：默认每日计划任务到点后会被调度器
    // 入队并产生一条待送达记录，总数因此随运行时刻变化（09:10 之前 3 条、之后 4 条）。
    // 用总数断言等于让这个测试被无关的后台活动挟持。
    const planted = [`job:${app.uncertainId}`, `job:${app.failedId}`, `approval:${app.approvalId}`];
    const idsOf = (queue: any): string[] => queue.items.map((item: any) => item.id);
    const first = await get("/api/review-queue");
    for (const id of planted) assert.ok(idsOf(first).includes(id), `待处理队列缺少 ${id}`);
    assert.equal(first.items[0].id, `job:${app.uncertainId}`, "uncertain 排在最前");
    assert.equal(first.relationshipMemory.state, "unavailable");
    assert.deepEqual((await get("/api/review-queue")).items, first.items);
    assert.equal((await post("/api/agent/approval/decision", { id: app.approvalId, allowed: false })).status, 200);
    const afterDecision = idsOf(await get("/api/review-queue"));
    assert.equal(afterDecision.includes(`approval:${app.approvalId}`), false, "已决定的审批离开队列");
    for (const id of [`job:${app.uncertainId}`, `job:${app.failedId}`]) {
      assert.ok(afterDecision.includes(id), `${id} 不应受审批决定影响`);
    }
    const before = await get("/api/agent/job?id=" + app.uncertainId);
    await app.restart();
    const after = await get("/api/agent/job?id=" + app.uncertainId);
    assert.equal(after.job.status, "uncertain");
    assert.equal(after.job.attempts, before.job.attempts, "restart never replays uncertain work");
    const afterRestart = idsOf(await get("/api/review-queue"));
    assert.ok(afterRestart.includes(`job:${app.uncertainId}`), "重启后 uncertain 仍在队列里");
    assert.equal(afterRestart.includes(`approval:${app.approvalId}`), false, "重启不会让已决定的审批回到队列");
    writeFileSync(file, "[]");
    await app.restart();
    assert.deepEqual((await get("/api/relationships")).profiles, []);
    assert.equal((await post("/api/relationships", { id: "client", boundaries: ["不得分享成本"] })).status, 200);
    await app.restart();
    assert.deepEqual((await get("/api/relationships?id=client")).profile.boundaries, ["不得分享成本"]);
    assert.equal(app.requests.length, 0, "no paid/real model requests");
    for (const path of ["/automations", "/runs", "/memory", "/assets/agent-events.js"]) assert.equal((await fetch(app.base + path)).status, 200);
  } finally { await app.stop(); }
});
