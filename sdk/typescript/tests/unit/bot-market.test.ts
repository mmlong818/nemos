import assert from "node:assert/strict";
import test from "node:test";
import { listBotMarket } from "../../examples/companion/bot-market.js";
import { AssistantBotStore, runAssistantTeam } from "../../examples/companion/assistant-team.js";
import type { AgentJobRecord, AgentJobHandlerContext } from "../../src/agent/job-queue.js";

test("精选市场：八种有来源的原生适配，声明实际边界，目录返回副本", () => {
  const templates = listBotMarket(); assert.equal(templates.length, 8);
  assert.equal(new Set(templates.map((t) => t.id)).size, 8);
  for (const t of templates) {
    assert.equal(t.adaptation, "independent-native"); assert.equal(t.permissions.tools, "off");
    assert.equal(t.permissions.memory, "task-only"); assert.equal(t.permissions.automaticRoutines, false);
    assert.match(t.source.url, /^https:\/\/x\.ai\/bot\//); assert.match(t.source.previewSha256, /^[0-9A-F]{64}$/);
    assert.ok(t.instructions.length < 4000 && t.instructions.length > 100);
    assert.ok(t.notIncluded.length > 0); assert.match(t.example.materials, /示例/);
    assert.ok(t.inputTemplate.length > 20 && t.inputTemplate.length < 24000);
    assert.equal(new Set(t.requiredFields).size, t.requiredFields.length);
    assert.doesNotMatch(t.instructions, /andrew-|FILL.IN|\/workspace\/|PST|Pillow/);
  }
  templates[0].instructions = "forged"; templates[0].permissions.tools = "on" as "off";
  assert.notEqual(listBotMarket()[0].instructions, "forged"); assert.equal(listBotMarket()[0].permissions.tools, "off");
});

test("添加幂等、用户隔离、版本校验、不覆盖个人编辑、不接受伪造来源或权限", () => {
  const store = new AssistantBotStore(":memory:");
  try {
    const t = listBotMarket()[0]; const bot = store.importTemplate("one", { id: t.id, version: t.version, instructions: "evil", enabled: false, tools: "on" });
    assert.equal(bot.instructions, t.instructions); assert.equal(bot.enabled, true);
    assert.equal(store.importTemplate("one", t as any).id, bot.id); assert.equal(store.list("one").length, 1);
    assert.throws(() => store.importTemplate("one", { id: t.id, version: 0 }), /版本/);
    assert.throws(() => store.importTemplate("one", { id: "https://example.com/evil", version: 1 }), /不存在/);
    assert.throws(() => store.importTemplate("one", { id: t.id, version: "1" }), /版本/);
    const updated = store.save("one", { ...bot, name: "我的项目助理", enabled: false, instructions: "我的规则", template: { id: "forged" } });
    assert.deepEqual(updated.template, bot.template);
    assert.deepEqual(store.importTemplate("one", { id: t.id, version: 1 }), updated);
    const other = store.importTemplate("two", { id: t.id, version: 1 }); assert.notEqual(other.id, bot.id);
    assert.equal(other.instructions, t.instructions);
    const plain = store.save("one", { name: "custom", role: "worker", instructions: "rules", template: bot.template }); assert.equal(plain.template, undefined);
  } finally { store.close(); }
});

test("Bot 达到上限时拒绝新导入，但重试已有导入仍成功", () => {
  const store = new AssistantBotStore(":memory:");
  try {
    const [a, b] = listBotMarket(); const bot = store.importTemplate("one", { id: a.id, version: 1 });
    for (let i = 1; i < 40; i++) store.save("one", { name: String(i), role: "worker", instructions: "rules" });
    assert.equal(store.importTemplate("one", { id: a.id, version: 1 }).id, bot.id);
    assert.throws(() => store.importTemplate("one", { id: b.id, version: 1 }), /40/);
  } finally { store.close(); }
});

for (const t of listBotMarket()) test(`原生模板可执行：${t.name}，只共享当前任务且由主助理最终交付（模拟模型）`, async () => {
  const store = new AssistantBotStore(":memory:");
  try {
    const bot = store.importTemplate("one", { id: t.id, version: t.version });
    const plan = store.plan("one", { requestId: "market-test", objective: t.example.objective, materials: t.example.materials, requiredFields: t.requiredFields, workerIds: [bot.id] });
    const job = { id: "market-job", payload: { teamPlan: plan }, checkpoints: [], metadata: { userId: "one" } } as unknown as AgentJobRecord;
    const context: AgentJobHandlerContext = { signal: new AbortController().signal, checkpoint: (status, progress, data) => { job.checkpoints.push({ at: new Date().toISOString(), status, progress, data }); } };
    let calls = 0;
    const result = await runAssistantTeam(job, context, async (system, input, _m, _n, ctx) => {
      calls++; assert.equal(ctx?.toolMode, "off"); assert.deepEqual(ctx?.memoryScopes, []);
      assert.equal(JSON.parse(input).materials, t.example.materials);
      if (calls === 1) { assert.ok(system.includes(t.instructions)); return "S1：待审阅的合成结果"; }
      return JSON.stringify({ summary: "模拟交付", fields: t.requiredFields.map((label) => ({ label, value: "待确认", sources: ["材料未提供"] })) });
    });
    assert.equal(calls, 2); assert.equal(result.data.delivery.fields.length, t.requiredFields.length);
    assert.equal(result.data.receipts[0].botId, bot.id);
  } finally { store.close(); }
});
