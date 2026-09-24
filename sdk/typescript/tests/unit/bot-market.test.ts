import assert from "node:assert/strict";
import test from "node:test";
import { listBotMarket } from "../../examples/companion/bot-market.js";
import { AssistantBotStore, runAssistantTeam } from "../../examples/companion/assistant-team.js";
import type { AgentJobRecord, AgentJobHandlerContext } from "../../src/agent/job-queue.js";

const TEMPLATE_IDS = ["blind-reviewer", "bot-designer", "co-creation-panel", "contract-clause-check", "copy-humanizer", "copy-strategist", "dual-draft-synthesis", "evidence-grading", "idea-stress-test", "meeting-decisions", "meeting-prep", "memory-snapshot-export", "project-guide", "requirement-discovery", "source-ledger", "spreadsheet-audit", "tech-article-editor", "work-report-writer"];

test("精选市场：十八种有来源的原生适配，声明实际边界，目录返回副本", () => {
  const templates = listBotMarket(); assert.equal(templates.length, 18);
  assert.equal(new Set(templates.map((t) => t.id)).size, 18);
  assert.deepEqual(templates.map((t) => t.id).sort(), TEMPLATE_IDS);
  for (const t of templates) {
    assert.equal(t.adaptation, "independent-native"); assert.equal(t.permissions.tools, "off");
    assert.equal(t.permissions.memory, "task-only"); assert.equal(t.permissions.automaticRoutines, false);
    assert.match(t.source.url, /^https:\/\/github\.com\/mmlong818\//); assert.match(t.source.previewSha256, /^[0-9A-F]{64}$/);
    // GitHub 来源必须钉到具体文件与 commit，否则日后无法复核当时看到的是哪一版。
    if (t.source.url.startsWith("https://github.com/mmlong818/") && t.source.url !== "https://github.com/mmlong818/nemos") assert.match(t.source.name, /^mmlong818\/[\w.-]+ \S+ @[0-9a-f]{7}/);
    for (const extra of t.enrichedFrom ?? []) {
      assert.match(extra.url, /^https:\/\/github\.com\/mmlong818\//); assert.match(extra.previewSha256, /^[0-9A-F]{64}$/);
    }
    // 升过版的模板必须说明补充来源；没升版的不该带。
    assert.equal((t.enrichedFrom?.length ?? 0) > 0, t.version > 1, `${t.id} 的 enrichedFrom 与版本不一致`);
    assert.ok(t.instructions.length < 4000 && t.instructions.length > 100);
    assert.ok(t.notIncluded.length > 0); assert.match(t.example.materials, /示例/);
    assert.ok(t.inputTemplate.length > 20 && t.inputTemplate.length < 24000);
    assert.equal(new Set(t.requiredFields).size, t.requiredFields.length);
    assert.doesNotMatch(t.instructions, /andrew-|FILL.IN|\/workspace\/|PST|Pillow/);
  }
  templates[0].instructions = "forged"; templates[0].permissions.tools = "on" as "off";
  assert.notEqual(listBotMarket()[0].instructions, "forged"); assert.equal(listBotMarket()[0].permissions.tools, "off");
});

test("默认材料梳理只处理当前材料，与深度研究的外部检索和核验边界分开", () => {
  const store = new AssistantBotStore(":memory:");
  try {
    store.seed("one");
    const organizer = store.get("one", "bot-organizer");
    assert.equal(organizer.name, "材料梳理");
    assert.match(organizer.instructions, /仅基于本次已提供的材料/);
    assert.match(organizer.instructions, /不检索或核验外部资料/);
  } finally { store.close(); }
});

test("添加幂等、用户隔离、版本校验、不覆盖个人派生规则、不接受伪造来源或权限", () => {
  const store = new AssistantBotStore(":memory:");
  try {
    const t = listBotMarket()[0]; const bot = store.importTemplate("one", { id: t.id, version: t.version, instructions: "evil", enabled: false, tools: "on" });
    assert.equal(bot.instructions, t.instructions); assert.equal(bot.enabled, true);
    assert.equal(bot.visibility, "private");
    assert.deepEqual(bot.ruleVersion, { kind: "user-derived", version: 1, baseTemplateVersion: t.version });
    assert.deepEqual(bot.template, { id: t.id, version: t.version, source: t.source, adaptation: t.adaptation });
    assert.equal(store.importTemplate("one", t as any).id, bot.id); assert.equal(store.list("one").length, 1);
    assert.throws(() => store.importTemplate("one", { id: t.id, version: 0 }), /版本/);
    assert.throws(() => store.importTemplate("one", { id: "https://example.com/evil", version: 1 }), /不存在/);
    assert.throws(() => store.importTemplate("one", { id: t.id, version: "1" }), /版本/);
    const updated = store.save("one", { ...bot, name: "我的项目助理", enabled: false, instructions: "我的规则",
      template: { id: "forged", version: 999, source: { name: "forged" } }, ruleVersion: { kind: "local", version: 999 } });
    assert.deepEqual(updated.template, bot.template);
    assert.deepEqual(updated.ruleVersion, { kind: "user-derived", version: 2, baseTemplateVersion: t.version });
    assert.equal(updated.visibility, "private");
    const toggled = store.save("one", { id: updated.id, revision: updated.revision, enabled: true });
    assert.deepEqual(toggled.ruleVersion, updated.ruleVersion, "表单的启用状态默认值不属于规则修改");
    const whitespace = store.save("one", { id: toggled.id, revision: toggled.revision, name: ` ${toggled.name} `, instructions: ` ${toggled.instructions} ` });
    assert.deepEqual(whitespace.ruleVersion, toggled.ruleVersion, "输入框首尾空白归一化后不虚增规则版本");
    assert.throws(() => store.save("one", { ...whitespace, visibility: "public" }), /本机私有/);
    assert.deepEqual(store.importTemplate("one", { id: t.id, version: 1 }), whitespace);
    const other = store.importTemplate("two", { id: t.id, version: 1 }); assert.notEqual(other.id, bot.id);
    assert.equal(other.instructions, t.instructions);
    const plain = store.save("one", { name: "custom", role: "worker", instructions: "rules", template: bot.template });
    assert.equal(plain.template, undefined);
    assert.deepEqual(plain.ruleVersion, { kind: "local", version: 1 }); assert.equal(plain.visibility, "private");
  } finally { store.close(); }
});

test("旧模板记录在读取时保留来源，按用户派生规则版本解释且不写回用户数据", () => {
  const store = new AssistantBotStore(":memory:");
  try {
    const t = listBotMarket()[0]; const imported = store.importTemplate("one", { id: t.id, version: t.version });
    const legacy = { ...imported } as any; delete legacy.ruleVersion; delete legacy.visibility;
    (store as any).db.prepare("UPDATE assistant_bots SET payload=? WHERE user_id=? AND id=?").run(JSON.stringify(legacy), "one", imported.id);
    const read = store.get("one", imported.id);
    assert.equal(read.visibility, "private");
    assert.deepEqual(read.ruleVersion, { kind: "user-derived", version: 1, baseTemplateVersion: t.version });
    const stored = JSON.parse((store as any).db.prepare("SELECT payload FROM assistant_bots WHERE user_id=? AND id=?").get("one", imported.id).payload);
    assert.equal(stored.ruleVersion, undefined); assert.equal(stored.visibility, undefined);
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

test("启动时把无配方的模板补进技能库：幂等、不动已停用或已改名的、跳过带配方的、升版只刷新未改动的、库满即停", () => {
  const store = new AssistantBotStore(":memory:");
  try {
    store.seed("one");
    const imported = store.seedMarketTemplates("one");
    const withRecipe = listBotMarket().filter((t) => t.recipe && ((t.recipe.skills?.length ?? 0) + (t.recipe.routines?.length ?? 0)) > 0).map((t) => t.id);
    assert.ok(withRecipe.includes("project-guide"));
    assert.deepEqual(imported.sort(), listBotMarket().map((t) => t.id).filter((id) => !withRecipe.includes(id)).sort());
    const bots = store.list("one");
    assert.equal(bots.filter((b) => b.template).length, imported.length);
    assert.equal(bots.some((b) => b.template?.id === "project-guide"), false, "带配方的模板不自动导入");
    const reviewer = bots.find((b) => b.template?.id === "blind-reviewer")!;
    const edited = store.save("one", { ...reviewer, name: "我的盲审", enabled: false });
    assert.deepEqual(store.seedMarketTemplates("one"), [], "第二次补齐什么都不导");
    const after = store.get("one", edited.id);
    assert.equal(after.name, "我的盲审"); assert.equal(after.enabled, false);
    assert.equal(store.list("one").length, bots.length);
    // 模板升版：没被用户碰过的派生 Bot 换成新规则并记下新基线版本；用户改过的（revision > 1）原样保留。
    const bumped = listBotMarket().find((t) => t.version > 1 && t.id !== "blind-reviewer")!;
    const stale = bots.find((b) => b.template?.id === bumped.id)!;
    const db = (store as any).db;
    const age = (bot: any) => db.prepare("UPDATE assistant_bots SET payload=? WHERE user_id=? AND id=?").run(JSON.stringify({ ...bot, instructions: "旧版规则", template: { ...bot.template, version: bumped.version - 1 }, ruleVersion: { ...bot.ruleVersion, baseTemplateVersion: bumped.version - 1 } }), "one", bot.id);
    age(stale); age(edited);
    assert.deepEqual(store.seedMarketTemplates("one"), [bumped.id]);
    const fresh = store.get("one", stale.id);
    assert.equal(fresh.instructions, bumped.instructions); assert.equal(fresh.revision, 1);
    assert.deepEqual(fresh.ruleVersion, { kind: "user-derived", version: 1, baseTemplateVersion: bumped.version });
    assert.equal(fresh.template?.version, bumped.version);
    assert.equal(store.get("one", edited.id).instructions, "旧版规则", "用户动过的派生 Bot 不随模板升版被覆盖");
    assert.deepEqual(store.seedMarketTemplates("one"), [], "刷新一次后再跑不再动");
    // 来源改了但模板没升版：未改动的派生 Bot 只换来源说明，规则与版本不动；改过的仍不碰。
    const relabel = listBotMarket().find((t) => t.version === 1 && !t.recipe)!;
    const labeled = bots.find((b) => b.template?.id === relabel.id)!;
    db.prepare("UPDATE assistant_bots SET payload=? WHERE user_id=? AND id=?").run(JSON.stringify({ ...labeled, template: { ...labeled.template, source: { ...labeled.template!.source, name: "某竞品内置技能（旧来源说明）" } } }), "one", labeled.id);
    assert.deepEqual(store.seedMarketTemplates("one"), [relabel.id]);
    const relabeled = store.get("one", labeled.id);
    assert.deepEqual(relabeled.template?.source, relabel.source); assert.equal(relabeled.instructions, relabel.instructions); assert.equal(relabeled.revision, 1);
    assert.deepEqual(store.seedMarketTemplates("one"), []);
    const crowded = new AssistantBotStore(":memory:");
    try {
      crowded.seed("two");
      for (let i = 0; i < 38; i++) crowded.save("two", { name: String(i), role: "worker", instructions: "rules" });
      assert.equal(crowded.list("two").length, 40);
      assert.deepEqual(crowded.seedMarketTemplates("two"), [], "库满时不报错、不导入");
    } finally { crowded.close(); }
  } finally { store.close(); }
});

test("点子卡片的标题句：每个模板都有，第一人称说清交回什么，不许承诺执行动作", () => {
  for (const t of listBotMarket()) {
    assert.ok(t.pitch, `${t.id} 缺少卡片标题句`);
    assert.match(t.pitch!, /我会/, `${t.id} 的标题句要用第一人称承诺`);
    assert.ok(t.pitch!.length <= 40, `${t.id} 的标题句太长`);
    // 模板不调用工具，只交回文字；不能出现替用户执行的承诺。
    assert.doesNotMatch(t.pitch!, /帮你(发|订|买|提交|预约|取消)|替你|自动/, `${t.id} 的标题句越过了模板边界`);
  }
});
