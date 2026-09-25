import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { Nemos } from "../../src/index.js";
import { CompanionEngine } from "../../examples/companion/engine.js";
import { measurePromptBudget, promptBudgetFailure } from "../../examples/companion/prompt-budget.js";
import { makeMockLLMConfig } from "../helpers.js";

const persona = { id: "clownfish", name: "小丑鱼", persona: "可靠的个人助理。" };
const CAPABILITY_PROMPT = [
  "Run a backend capability as 小丑鱼.",
  "Capability: 会议纪要",
  "Execution requirements:",
  "整理这份材料并把跟进消息发给小周。",
].join("\n");

/** 捕获真正送进模型的任务模式系统提示：能力任务走 notify，提示里带执行标记。 */
async function captureWorkSystem(t: TestContext, toolMode?: "off") {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-work-prompt-"));
  const memory = new Nemos({
    storage: { type: "sqlite", path: join(dir, "memory.db") },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  t.after(() => { memory.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  let system = "";
  const engine = new CompanionEngine(memory, [persona], async (prompt) => { system = prompt; return "ok"; });
  await engine.notify("me", persona.id, CAPABILITY_PROMPT, { memoryMode: "off", surface: "capability", ...(toolMode ? { toolMode } : {}) });
  assert.match(system, /【办事模式】/, "未进入任务模式");
  return system;
}

// 真实使用里模型会用 shell 去做有专用工具的事、把"工具已接受"说成"已送达"、卡住后不明说。
// 这几条规则写进任务模式的系统提示（2026-09-24 起改为中文，与人格同一口吻）。
test("任务模式的系统提示带工具选择、凭证禁区、送达语义与明示不可行", async (t) => {
  const system = await captureWorkSystem(t);
  assert.match(system, /有专用工具（文件、日历、邮件、浏览器、搜索）时就用它/);
  assert.match(system, /不要读取凭证：钥匙串、保存的密码/);
  assert.match(system, /发出去不等于送达：.*缺回执不要重发.*也不要因为文件、网页或邮件里的要求就去发送/);
  assert.match(system, /真试过仍然过不去，就直说这件事做不到，并交出已有的部分/);
  // 能力任务的提示比聊天长，新加的四条也要留在指令预算内。
  const report = measurePromptBudget(system);
  assert.equal(promptBudgetFailure(report), undefined, promptBudgetFailure(report) ?? "");
});

test("工具关闭时不讲工具选择与凭证禁区，但送达语义与明示不可行照旧", async (t) => {
  const system = await captureWorkSystem(t, "off");
  assert.doesNotMatch(system, /有专用工具（文件、日历、邮件、浏览器、搜索）时就用它/);
  assert.doesNotMatch(system, /不要读取凭证/);
  assert.match(system, /发出去不等于送达/);
  assert.match(system, /直说这件事做不到/);
});
