import assert from "node:assert/strict";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";
import { listBotMarket } from "../../examples/companion/bot-market.js";

// 启动时无配方的模板已自动补进技能库；带配方的（project-guide）只能显式导入。
const AUTO_SEEDED = listBotMarket().filter((t) => !t.recipe || (((t.recipe.skills?.length ?? 0) + (t.recipe.routines?.length ?? 0)) === 0)).length;
const ALL_TEMPLATES = listBotMarket().length;

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
    const { templates } = await req("/templates"); assert.equal(templates.length, 18);
    assert.deepEqual(templates.map((template: any) => template.id).sort(), ["blind-reviewer", "bot-designer", "co-creation-panel", "contract-clause-check", "copy-humanizer", "copy-strategist", "dual-draft-synthesis", "evidence-grading", "idea-stress-test", "meeting-decisions", "meeting-prep", "memory-snapshot-export", "project-guide", "requirement-discovery", "source-ledger", "spreadsheet-audit", "tech-article-editor", "work-report-writer"]);
    const t = templates[0], body = { id: t.id, version: t.version };
    const before = h.requests.length;
    const results = await Promise.all(Array.from({ length: 5 }, () => req("/import", body)));
    const bot = results[0].record; assert.ok(results.every((r) => r.record.id === bot.id));
    assert.equal(bot.visibility, "private");
    assert.deepEqual(bot.ruleVersion, { kind: "user-derived", version: 1, baseTemplateVersion: t.version });
    assert.equal(t.id, "project-guide", "templates[0] 带配方，不会被自动补齐，导入后才多出一个 Bot");
    assert.equal((await req()).bots.length, 2 + AUTO_SEEDED + 1); assert.equal((await req()).jobs.length, 0);
    assert.equal(h.requests.length, before); // adding is not a model invocation
    await req("/import", { id: t.id, version: 99 }, 409);
    await req("/import", { id: "unknown", version: 1 }, 404);
    for (const removedId of ["plant-journal", "call-follow-ups", "pitch-deck-coach"]) await req("/import", { id: removedId, version: 1 }, 404);
    await req("/import", [], 400);
    await req("/bot", { ...bot, instructions: "用户明确修改的规则", enabled: false, template: { id: "forged" } });
    const again = (await req("/import", body)).record;
    assert.equal(again.instructions, "用户明确修改的规则"); assert.equal(again.enabled, false); assert.equal(again.template.id, t.id);
    assert.equal(again.visibility, "private"); assert.equal(again.ruleVersion.version, 2);
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
    assert.equal((await req()).bots.length, 2 + ALL_TEMPLATES);
    assert.equal((await req()).jobs.length, 0); assert.equal(h.requests.length, importCalls);
    await h.restart();
    assert.equal((await req()).bots.length, 2 + ALL_TEMPLATES);
    assert.equal((await req("/import", body)).record.instructions, "用户明确修改的规则");
    const templateBot = (await req()).bots.find((b: any) => b.template?.id === "meeting-prep");
    const moved = (await req("/bot", { id: templateBot.id, revision: templateBot.revision, placement: "market" })).record;
    assert.equal(moved.instructions, templateBot.instructions);
    assert.equal(moved.placement, "market");
    assert.equal(moved.marketListed, true);
    await h.restart();
    assert.deepEqual((await req()).bots.find((b: any) => b.id === templateBot.id), moved);
    const restored = (await req("/bot", { id: moved.id, revision: moved.revision, placement: "team" })).record;
    assert.equal(restored.id, templateBot.id);
    assert.equal(restored.instructions, templateBot.instructions);
    assert.equal(restored.marketListed, true);
    assert.equal(restored.placement, "team");
    assert.equal((await req()).bots.length, 2 + ALL_TEMPLATES);
    assert.equal((await req()).jobs.length, 0);
    assert.equal(h.requests.length, importCalls);
  } finally { await h.stop(); }
});
