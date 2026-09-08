import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { Nemos } from "../../src/index.js";
import { CompanionEngine } from "../../examples/companion/engine.js";
import { PROMPT_BUDGET, measurePromptBudget, promptBudgetFailure } from "../../examples/companion/prompt-budget.js";
import { makeMockLLMConfig } from "../helpers.js";

const persona = { id: "clownfish", name: "小丑鱼", persona: "可靠的个人助理。" };

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-prompt-budget-"));
  const memory = new Nemos({
    storage: { type: "sqlite", path: join(dir, "memory.db") },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  t.after(() => { memory.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return memory;
}

/** 捕获真正送进模型的那份系统提示，而不是按源码统计。 */
async function capture(t: TestContext, text: string, opts: { work?: boolean } = {}) {
  const memory = fixture(t);
  let system = "";
  const engine = new CompanionEngine(memory, [persona], async (prompt) => { system = prompt; return "ok"; }, {
    inFlightWork: () => [{ title: "每日简报", state: "running", startedAt: "2026-09-08T01:00:00.000Z" }],
    capabilityContext: () => "decision-brief：比较方案并给出行动条件。",
  });
  // 工作模式由文本里的执行标记触发（WORK_PROMPT_MARKER），不是另一个方法。
  await engine.send("me", persona.id, opts.work ? `执行要求：${text}` : text);
  assert.ok(system.length > 0, "未捕获到系统提示");
  return system;
}

test("统计的是祈使指令条数，并按小节归类", () => {
  const report = measurePromptBudget([
    "【角色】",
    "你是一个助理。",
    "不要编造事实。",
    "## Tool policy",
    "Never claim success before a tool result.",
    "You must keep the original file.",
    "这行只是描述，不含祈使标记。",
  ].join("\n"));
  assert.equal(report.instructions, 3);
  assert.equal(report.lines, 7);
  assert.deepEqual(report.byBlock, [
    { block: "Tool policy", instructions: 2 },
    { block: "角色", instructions: 1 },
  ]);
  assert.equal(report.overBy, 0);
  assert.equal(promptBudgetFailure(report), undefined);
});

test("越预算时给出超出多少与该先看哪一块", () => {
  const lines = ["【很多规则】", ...Array.from({ length: PROMPT_BUDGET.maxInstructions + 4 }, (_, i) => `不要做第 ${i} 件事。`)];
  const report = measurePromptBudget(lines.join("\n"));
  assert.equal(report.overBy, 4);
  const message = promptBudgetFailure(report)!;
  assert.match(message, /超出预算 4 条/);
  assert.match(message, /很多规则/);
  // 提示里必须写清"调高上限是唯一的失效方式"，否则下一个人越线时最省事的做法就是调数字。
  assert.match(message, /调高上限/);
});

// 这条是真正的守卫：量真实装配出来的提示，而不是源码里所有分支的总和。
test("日常对话的系统提示在指令预算内", async (t) => {
  const report = measurePromptBudget(await capture(t, "帮我想想周末做点什么"));
  assert.ok(report.instructions > 10, "捕获到的提示看起来不完整");
  assert.equal(promptBudgetFailure(report), undefined, promptBudgetFailure(report) ?? "");
});

test("任务模式的系统提示在指令预算内", async (t) => {
  const system = await capture(t, "整理这份材料并给我一份简报", { work: true });
  const report = measurePromptBudget(system);
  assert.equal(promptBudgetFailure(report), undefined, promptBudgetFailure(report) ?? "");
});

// 在场契约只在有活在飞时注入，所以它是最容易把某一轮推过线的一块——单独钉住。
test("有后台任务在跑时，在场规则计入同一份预算", async (t) => {
  const system = await capture(t, "帮我想想周末做点什么");
  assert.match(system, /正在后台进行的活/, "本轮应当注入了在场契约");
  const report = measurePromptBudget(system);
  assert.ok(report.byBlock.some((item) => item.block.includes("正在后台进行的活")), "在场规则应当被归到自己的小节");
  assert.equal(promptBudgetFailure(report), undefined, promptBudgetFailure(report) ?? "");
});
