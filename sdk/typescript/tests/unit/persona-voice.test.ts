import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { Nemos } from "../../src/index.js";
import { CompanionEngine } from "../../examples/companion/engine.js";
import { PERSONAS, personaOverrides } from "../../examples/companion/personas.js";
import { APP_PERSONA_ID } from "../../examples/companion/identity.js";
import { measurePromptBudget, promptBudgetFailure } from "../../examples/companion/prompt-budget.js";
import { extractQuickReplies } from "../../examples/companion/quick-replies.js";
import { makeMockLLMConfig } from "../helpers.js";

const browserQuickReplies = require("../../examples/companion/web/assets/quick-replies.js");

function engineWith(t: TestContext, reply = "好的") {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-persona-voice-"));
  const memory = new Nemos({ storage: { type: "sqlite", path: join(dir, "memory.db") }, llm: makeMockLLMConfig(), features: { doubleCheck: false }, worker: { manualWorker: true } });
  t.after(() => { memory.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const calls: Array<{ system: string; user: string }> = [];
  const personas = PERSONAS.filter((p) => p.id === APP_PERSONA_ID).map((p) => ({ ...p }));
  const engine = new CompanionEngine(memory, personas, async (system, user) => { calls.push({ system, user }); return reply; });
  return { engine, calls };
}

const WORK = ["Run a backend capability as 小丑鱼.", "Capability: 会议纪要", "Execution requirements:", "整理这份材料。"].join("\n");

test("小丑鱼的默认人设是一个有性格的伙伴，不再是'应用本身'", () => {
  const core = PERSONAS.find((p) => p.id === APP_PERSONA_ID)!.persona;
  assert.doesNotMatch(core, /应用本身|不假装真人|不使用性别化助理人设/);
  assert.match(core, /真心帮忙，不表演帮忙/);
  assert.match(core, /你可以有看法/);
  assert.match(core, /你是 ta 生活里的客人/);
  // 仍然不冒充真人，危机时优先安全。
  assert.match(core, /被问到是不是 AI 时坦诚说明/);
  assert.match(core, /自伤、自杀/);
});

test("聊天和办事用同一段说话方式；办事模式改为中文，不再有英文交付规则", async (t) => {
  const { engine, calls } = engineWith(t);
  await engine.send("me", APP_PERSONA_ID, "今天好累");
  await engine.notify("me", APP_PERSONA_ID, WORK, { memoryMode: "off", surface: "capability" });
  const [chat, work] = calls.map((c) => c.system);
  for (const system of [chat, work]) {
    assert.match(system, /【小丑鱼怎么说话 —— 聊天和办事都是同一个你】/);
    assert.match(system, /真心帮忙，不表演帮忙/, "两种模式都带同一份人设");
    assert.match(system, /【选项】/, "快捷回复的写法两边一致");
    const report = measurePromptBudget(system);
    assert.equal(promptBudgetFailure(report), undefined, promptBudgetFailure(report) ?? "");
  }
  assert.match(work, /【办事模式】/);
  assert.match(work, /发出去不等于送达/);
  assert.doesNotMatch(work, /Task delivery mode|Do not only say you will do it|Never promise future delivery/);
});

test("用户给助手起了别的名字：自称用新名字，并说明小丑鱼是应用名", async (t) => {
  const { engine, calls } = engineWith(t);
  engine.updatePersona(APP_PERSONA_ID, { name: "阿鱼" });
  await engine.send("me", APP_PERSONA_ID, "你叫什么");
  assert.match(calls[0].system, /ta 给你起的名字是「阿鱼」/);
  assert.match(calls[0].system, /小丑鱼是这款应用的名字/);
});

test("快捷回复：只识别结尾单独一行的【选项】，2 到 4 个；剥掉后再存进对话记录", async (t) => {
  const cases: Array<[string, { text: string; options: string[] }]> = [
    ["目标建好了。每月底要我跟你对一次进度吗？\n【选项】好，每月底对一次｜不用，我自己记", { text: "目标建好了。每月底要我跟你对一次进度吗？", options: ["好，每月底对一次", "不用，我自己记"] }],
    ["选哪个？\n\n【选项】A | B | C", { text: "选哪个？", options: ["A", "B", "C"] }],
    ["只有一个不算\n【选项】好", { text: "只有一个不算\n【选项】好", options: [] }],
    ["中间的不算\n【选项】甲｜乙\n后面还有话", { text: "中间的不算\n【选项】甲｜乙\n后面还有话", options: [] }],
    ["太长的选项不算\n【选项】这是一个非常非常非常非常非常长的选项超过了二十四个字的限制吧｜短", { text: "太长的选项不算\n【选项】这是一个非常非常非常非常非常长的选项超过了二十四个字的限制吧｜短", options: [] }],
    ["没有选项的普通回复", { text: "没有选项的普通回复", options: [] }],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(extractQuickReplies(input), expected, input);
    assert.deepEqual(browserQuickReplies.extractQuickReplies(input), expected, "前端解析与服务端一致：" + input);
  }
  // 引擎存进近期对话的是剥掉选项后的正文：下一轮提示里看不到【选项】那一行。
  const { engine, calls } = engineWith(t, "要现在开始吗？\n【选项】现在开始｜晚点再说");
  await engine.send("me", APP_PERSONA_ID, "帮我整理下周计划");
  await engine.send("me", APP_PERSONA_ID, "现在开始");
  assert.match(calls[1].user, /要现在开始吗？/);
  assert.doesNotMatch(calls[1].user, /【选项】/);
});

test("人格覆盖只保存和默认不同的项：默认人设更新后，没改过的用户能收到", () => {
  const defaults = PERSONAS.map((p) => ({ ...p }));
  const current = defaults.map((p) => ({ ...p }));
  current.find((p) => p.id === APP_PERSONA_ID)!.name = "阿鱼";
  const overrides = personaOverrides(current, defaults);
  assert.deepEqual(overrides, [{ id: APP_PERSONA_ID, name: "阿鱼" }]);
  assert.deepEqual(personaOverrides(defaults, defaults), []);
  // 服务端把 PERSONAS 的同一批对象交给引擎；直接在共享对象上改名，默认参数也必须认出这是改动。
  const shared = PERSONAS.find((p) => p.id === APP_PERSONA_ID)!;
  const before = shared.name;
  try {
    shared.name = "阿鱼";
    assert.deepEqual(personaOverrides(PERSONAS), [{ id: APP_PERSONA_ID, name: "阿鱼" }]);
  } finally { shared.name = before; }
});
