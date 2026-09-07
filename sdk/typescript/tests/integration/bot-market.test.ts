import assert from "node:assert/strict";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("Bot 市场 HTTP：无需模型浏览/添加、并发幂等、拒绝错误版本、保护个人版本并重启持久化", { timeout: 60000 }, async () => {
  const h = await startModelHarness();
  const req = async (path = "", body?: unknown, expected = 200) => {
    const r = await fetch(h.base + "/api/assistant-team" + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json() as any; assert.equal(r.status, expected, JSON.stringify(data)); return data;
  };
  try {
    const page = await (await fetch(h.base + "/bots?view=market")).text(); assert.match(page, /id="marketPane"/);
    assert.equal((await req()).ready, false);
    const official = await req("/market"); assert.deepEqual(official.templates, []); assert.equal(official.status, "not-launched");
    const { templates } = await req("/templates"); assert.equal(templates.length, 8);
    const t = templates[0], body = { id: t.id, version: t.version };
    const before = h.requests.length;
    const results = await Promise.all(Array.from({ length: 5 }, () => req("/import", body)));
    const bot = results[0].record; assert.ok(results.every((r) => r.record.id === bot.id));
    assert.equal((await req()).bots.length, 3); assert.equal((await req()).jobs.length, 0);
    assert.equal(h.requests.length, before); // adding is not a model invocation
    await req("/import", { id: t.id, version: 99 }, 409);
    await req("/import", { id: "unknown", version: 1 }, 404);
    await req("/import", [], 400);
    await req("/bot", { ...bot, instructions: "用户明确修改的规则", enabled: false, template: { id: "forged" } });
    const again = (await req("/import", body)).record;
    assert.equal(again.instructions, "用户明确修改的规则"); assert.equal(again.enabled, false); assert.equal(again.template.id, t.id);
    await h.restart();
    assert.deepEqual((await req("/import", body)).record, again);
    assert.equal((await req()).jobs.length, 0);
    const importCalls = h.requests.length;
    for (const template of templates.slice(1)) {
      const created = (await req("/import", { id: template.id, version: template.version })).record;
      assert.equal(created.instructions, template.instructions);
      assert.equal(created.template.id, template.id);
      assert.equal((await req("/import", { id: template.id, version: template.version })).record.id, created.id);
    }
    assert.equal((await req()).bots.length, 10);
    assert.equal((await req()).jobs.length, 0); assert.equal(h.requests.length, importCalls);
    await h.restart();
    assert.equal((await req()).bots.length, 10);
    assert.equal((await req("/import", body)).record.instructions, "用户明确修改的规则");
    const plant = (await req()).bots.find((b: any) => b.template?.id === "plant-journal");
    const moved = (await req("/bot", { id: plant.id, revision: plant.revision, placement: "market" })).record;
    assert.equal(moved.instructions, plant.instructions);
    assert.equal(moved.placement, "market");
    assert.equal(moved.marketListed, true);
    await h.restart();
    assert.deepEqual((await req()).bots.find((b: any) => b.id === plant.id), moved);
    const restored = (await req("/bot", { id: moved.id, revision: moved.revision, placement: "team" })).record;
    assert.equal(restored.id, plant.id);
    assert.equal(restored.instructions, plant.instructions);
    assert.equal(restored.marketListed, true);
    assert.equal(restored.placement, "team");
    assert.equal((await req()).bots.length, 10);
    assert.equal((await req()).jobs.length, 0);
    assert.equal(h.requests.length, importCalls);
  } finally { await h.stop(); }
});
