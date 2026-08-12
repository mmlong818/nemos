import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CompanionEngine, isDeliveryPreferenceMemory, type ChatAgentContext, type ChatFn } from "../../examples/companion/engine.js";
import { Nemos } from "../../src/index.js";
import { makeMockLLMConfig } from "../helpers.js";

test("任务偏好白名单只接受明确属于用户的交付习惯", () => {
  assert.equal(isDeliveryPreferenceMemory("用户偏好简洁标题和三列表格"), true);
  assert.equal(isDeliveryPreferenceMemory("排版：正文 15px，标题使用黑体"), true);
  assert.equal(isDeliveryPreferenceMemory("测试故事里要求使用表格，且不代表用户本人"), false);
  assert.equal(isDeliveryPreferenceMemory("第三方报告的格式包含五个章节"), false);
  assert.equal(isDeliveryPreferenceMemory("用户今天在加班"), false);
});

test("English capability prompts use task mode and its long-output budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-work-mode-"));
  let observed: {
    system?: string;
    maxTokens?: number;
    context?: ChatAgentContext;
  } = {};
  const chat: ChatFn = async (system, _user, _model, maxTokens, context) => {
    observed = { system, maxTokens, context };
    return "done";
  };
  const memory = new Nemos({
    storage: { type: "sqlite", path: join(dir, "memory.db") },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const engine = new CompanionEngine(memory, [{
    id: "clownfish",
    name: "小丑鱼",
    persona: "可靠的个人助理。",
    maxReplyTokens: 800,
  }], chat);

  try {
    await engine.seedSelfState("clownfish", ["这条角色近况不能进入能力任务"]);
    await engine.notify("me", "clownfish", [
      "Run a backend capability as 小丑鱼.",
      "Capability: 思考工作台",
      "Target artifact format: HTML",
      "Execution requirements:",
      "Return the completed structured result.",
    ].join("\n"), { memoryMode: "off" });

    assert.match(observed.system ?? "", /Task delivery mode/);
    assert.doesNotMatch(observed.system ?? "", /角色近况不能进入能力任务/);
    assert.equal(observed.maxTokens, 6000);
    assert.equal(observed.context?.mode, "task");
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("ordinary chat omits the full capability catalog until the user asks for it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-capability-context-"));
  const systems: string[] = [];
  let capabilityReads = 0;
  const chat: ChatFn = async (system) => {
    systems.push(system);
    return "done";
  };
  const memory = new Nemos({
    storage: { type: "sqlite", path: join(dir, "memory.db") },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const engine = new CompanionEngine(memory, [{
    id: "clownfish",
    name: "小丑鱼",
    persona: "可靠的个人助理。",
  }], chat, {
    capabilityContext: () => {
      capabilityReads++;
      return "- 写正式文档：生成可编辑文档";
    },
  });

  try {
    await engine.notify("me", "clownfish", "今天有点累", { memoryMode: "off" });
    assert.equal(capabilityReads, 0);
    assert.doesNotMatch(systems[0] ?? "", /写正式文档/);

    await engine.notify("me", "clownfish", "你有哪些能力？", { memoryMode: "off" });
    assert.equal(capabilityReads, 1);
    assert.match(systems[1] ?? "", /写正式文档/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
