import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_REASONING_LIMITS, chatRuntimeLimits } from "../../examples/companion/chat-budgets.js";

// 真实运行：助理页单次输入约 7800 token，"快速"档 2 轮共 8000，第一轮想调工具就 token_budget_exhausted。
// 守卫：每一档都要容得下「该档轮数 × 每轮 1 万 token 输入」，外加一段回复。
test("每档预算都容得下它允许的轮数，按每轮 1 万 token 输入计", () => {
  for (const [name, limits] of Object.entries(CHAT_REASONING_LIMITS)) {
    assert.ok(limits.maxTotalTokens >= limits.maxRounds * 10_000 + 1_000, `${name}: ${limits.maxTotalTokens} < ${limits.maxRounds} × 10000`);
    assert.ok(limits.maxToolRounds < limits.maxRounds, `${name}: 至少留一轮交付`);
  }
});

test("未识别的档位按均衡处理，返回副本不共享引用", () => {
  assert.deepEqual(chatRuntimeLimits("whatever"), CHAT_REASONING_LIMITS.balanced);
  const copy = chatRuntimeLimits("fast");
  copy.maxTotalTokens = 1;
  assert.notEqual(CHAT_REASONING_LIMITS.fast.maxTotalTokens, 1);
});
