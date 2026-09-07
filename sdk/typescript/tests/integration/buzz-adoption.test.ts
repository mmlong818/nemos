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
    const first = await get("/api/review-queue");
    assert.equal(first.items.length, 3);
    assert.equal(first.items[0].id, `job:${app.uncertainId}`);
    assert.equal(first.relationshipMemory.state, "unavailable");
    assert.deepEqual((await get("/api/review-queue")).items, first.items);
    assert.equal((await post("/api/agent/approval/decision", { id: app.approvalId, allowed: false })).status, 200);
    assert.equal((await get("/api/review-queue")).items.length, 2);
    const before = await get("/api/agent/job?id=" + app.uncertainId);
    await app.restart();
    const after = await get("/api/agent/job?id=" + app.uncertainId);
    assert.equal(after.job.status, "uncertain");
    assert.equal(after.job.attempts, before.job.attempts, "restart never replays uncertain work");
    assert.equal((await get("/api/review-queue")).items.length, 2);
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
