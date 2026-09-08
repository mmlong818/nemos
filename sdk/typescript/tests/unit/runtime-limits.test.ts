import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AGENT_BUDGET, ROUTINE_LIMITS, resolveAgentBudget } from "../../examples/companion/runtime-limits.js";

const companionRoot = "examples/companion";

test("默认预算自洽：轮次不超上限，工具轮不超总轮次，token 不超字符空间", () => {
  const budget = resolveAgentBudget(undefined);
  assert.equal(budget.maxRounds, AGENT_BUDGET.maxRounds.fallback);
  assert.equal(budget.maxToolRounds, AGENT_BUDGET.maxToolRounds.fallback);
  assert.ok(budget.maxToolRounds <= budget.maxRounds);
  assert.ok(budget.maxTokens <= budget.maxOutputChars);
  assert.ok(budget.maxTotalTokens >= budget.maxTokens);
  assert.equal(budget.maxTotalTokens, budget.maxTokens * budget.maxRounds * AGENT_BUDGET.maxTotalTokens.multiplier);
});

test("越界请求被夹回边界，而不是被信任", () => {
  const huge = resolveAgentBudget({
    maxTokens: 10_000_000,
    maxRounds: 9_999,
    maxToolRounds: 9_999,
    maxTotalTokens: 10_000_000_000,
    maxOutputChars: 10_000_000,
  });
  assert.equal(huge.maxRounds, AGENT_BUDGET.maxRounds.maximum);
  assert.equal(huge.maxToolRounds, AGENT_BUDGET.maxRounds.maximum);
  assert.equal(huge.maxOutputChars, AGENT_BUDGET.maxOutputChars.maximum);
  assert.equal(huge.maxTotalTokens, AGENT_BUDGET.maxTotalTokens.maximum);

  const tiny = resolveAgentBudget({ maxTokens: -5, maxRounds: 0, maxToolRounds: -1, maxTotalTokens: 1, maxOutputChars: 1 });
  assert.equal(tiny.maxRounds, AGENT_BUDGET.maxRounds.minimum);
  assert.equal(tiny.maxToolRounds, AGENT_BUDGET.maxToolRounds.minimum);
  assert.equal(tiny.maxOutputChars, AGENT_BUDGET.maxOutputChars.minimum);
  assert.ok(tiny.maxTokens >= 1);

  for (const bad of [NaN, Infinity, undefined]) {
    const fallback = resolveAgentBudget({ maxRounds: bad as number });
    assert.equal(fallback.maxRounds, AGENT_BUDGET.maxRounds.fallback);
  }
});

test("工具轮次跟着总轮次收窄，不会出现工具轮比总轮多", () => {
  const budget = resolveAgentBudget({ maxRounds: 1, maxToolRounds: 8 });
  assert.equal(budget.maxRounds, 1);
  assert.equal(budget.maxToolRounds, 1);
});

test("回复长度不同的调用点得到成比例的字符上限", () => {
  const short = resolveAgentBudget(undefined, 800);
  const long = resolveAgentBudget(undefined, 6_000);
  assert.equal(short.maxOutputChars, 800 * AGENT_BUDGET.maxOutputChars.tokenMultiplier);
  assert.equal(long.maxOutputChars, 6_000 * AGENT_BUDGET.maxOutputChars.tokenMultiplier);
  assert.ok(long.maxTotalTokens > short.maxTotalTokens);
});

// 这些边界此前在 llm.ts 里存在两份（新发起一份、续跑一份），已经开始漂移。
// 钉住「只有一处字面量」：任何一边再写死一次，这条就红。
test("llm.ts 不再自己写预算字面量，新发起与续跑都读同一个折算函数", () => {
  const source = readFileSync(join(companionRoot, "llm.ts"), "utf8");
  assert.ok(source.includes("resolveAgentBudget"), "llm.ts 应当读 runtime-limits 的折算函数");
  assert.equal(source.includes("metadataNumber"), false, "续跑路径不该再有自己的一套边界解析");
  for (const literal of ["2_000_000", "200_000", "4_800"]) {
    assert.equal(source.includes(literal), false, `llm.ts 里仍有预算字面量 ${literal}`);
  }
});

test("计划任务的未读上限是正整数，且轮询间隔与调度器默认值一致", () => {
  assert.ok(Number.isInteger(ROUTINE_LIMITS.unreadRunsBeforePause));
  assert.ok(ROUTINE_LIMITS.unreadRunsBeforePause >= 1);
  const scheduler = readFileSync(join(companionRoot, "background-scheduler.ts"), "utf8");
  assert.ok(
    scheduler.includes(`intervalMs = ${ROUTINE_LIMITS.tickIntervalMs.toLocaleString("en-US").replace(/,/g, "_")}`),
    "调度器默认间隔与 ROUTINE_LIMITS.tickIntervalMs 不一致",
  );
});
