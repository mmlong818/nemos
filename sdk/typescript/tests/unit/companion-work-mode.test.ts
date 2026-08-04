import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CompanionEngine, type ChatAgentContext, type ChatFn } from "../../examples/companion/engine.js";
import { Nemos } from "../../src/index.js";
import { makeMockLLMConfig } from "../helpers.js";

test("English capability prompts use task mode and its long-output budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-companion-work-mode-"));
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
    id: "zhiwei",
    name: "知微",
    persona: "可靠的个人助理。",
    maxReplyTokens: 800,
  }], chat);

  try {
    await engine.seedSelfState("zhiwei", ["这条角色近况不能进入能力任务"]);
    await engine.notify("me", "zhiwei", [
      "Run a backend capability as 知微.",
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
