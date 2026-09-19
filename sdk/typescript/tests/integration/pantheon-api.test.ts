import assert from "node:assert/strict";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

async function json(base: string, path: string, body?: unknown) {
  const response = await fetch(base + path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { response, body: await response.json() as any };
}

test("万神殿页面、离线保护和私有思维库走真实同源路由且不触发真实模型", { timeout: 60_000 }, async () => {
  const harness = await startModelHarness();
  try {
    const before = harness.requests.length;
    const page = await fetch(harness.base + "/pantheon");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /万神殿/);
    assert.equal((await fetch(harness.base + "/assets/pantheon.js")).status, 200);
    assert.equal((await fetch(harness.base + "/assets/pantheon.css")).status, 200);

    const created = await json(harness.base, "/api/pantheon/session", { issue: "探索本地社区共享空间的可行性" });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.session.plan.intent, "explore");
    assert.ok(created.body.session.plan.seats.length >= 1 && created.body.session.plan.seats.length <= 3);
    const interjected = await json(harness.base, "/api/pantheon/session/interject", { sessionId: created.body.session.id, text: "请考虑夜间噪音。" });
    assert.equal(interjected.body.session.transcript.at(-1).kind, "user");
    const advanced = await json(harness.base, "/api/pantheon/session/advance", { sessionId: created.body.session.id });
    assert.equal(advanced.response.status, 400);
    assert.equal(advanced.body.ok, false);
    assert.match(advanced.body.userMessage || advanced.body.error, /模型|离线|连接/);

    const draft = await json(harness.base, "/api/pantheon/distill", { displayName: "我的审慎法", kind: "framework" });
    assert.equal(draft.response.status, 201);
    assert.equal(draft.body.unit.status, "draft");
    let status = await json(harness.base, "/api/pantheon/thought/status", { id: draft.body.unit.id, action: "submit_review" });
    assert.equal(status.body.unit.status, "review");
    status = await json(harness.base, "/api/pantheon/thought/status", { id: draft.body.unit.id, action: "approve" });
    assert.equal(status.body.unit.status, "approved");
    const catalog = await json(harness.base, "/api/pantheon/catalog");
    assert.ok(catalog.body.models.some((model: any) => model.id === draft.body.unit.id));
    const removed = await json(harness.base, "/api/pantheon/thought/delete", { id: draft.body.unit.id });
    assert.equal(removed.body.deleted, true);
    assert.equal(harness.requests.length, before, "离线隔离流程不得请求合成provider之外的任何模型调用");
    await harness.restart();
    const expired = await fetch(harness.base + `/api/pantheon/session?id=${encodeURIComponent(created.body.session.id)}`);
    assert.equal(expired.status, 404, "服务重启后不得把旧sessionId误绑定到新进程");
  } finally {
    await harness.stop();
  }
});
