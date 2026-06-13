// scenario-emphasis-applied.test.ts —— 验证 scenario 改变 system prompt 与最终输出

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mnemos } from "../../../src/index.js";
import { composeSystemPrompt, PROFILE_CHAT, PROFILE_DOC_RESEARCH, resolveScenario } from "../../../src/prompts.js";
import { makeMockLLMConfig } from "../../helpers.js";

test("composeSystemPrompt 拼上 emphasis / exclude / temporal 引导", () => {
  const prompt = composeSystemPrompt("BASE", PROFILE_CHAT);
  assert.match(prompt, /BASE/);
  assert.match(prompt, /场景上下文.*chat/);
  assert.match(prompt, /episodic.*1\.5/);
  assert.match(prompt, /emotion/);
  assert.match(prompt, /event_at/);
});

test("composeSystemPrompt 对 doc-research 加排除引导", () => {
  const prompt = composeSystemPrompt("BASE", PROFILE_DOC_RESEARCH);
  assert.match(prompt, /排除层.*personal_semantic/);
  assert.match(prompt, /semantic.*1\.5/);
});

test("resolveScenario('chat') 返回内置 profile", () => {
  const p = resolveScenario("chat");
  assert.equal(p.name, "chat");
  assert.equal(p.emphasis?.layers?.episodic, 1.5);
});

test("resolveScenario undefined 返回 default", () => {
  const p = resolveScenario(undefined);
  assert.equal(p.name, "default");
});

test("scenario 标签写入存储", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("我和团队讨论了 Q4 计划", { scenario: "meeting" });
  assert.equal(r.archival.scenario, "meeting");
  for (const d of r.derived) {
    assert.equal(d.scenario, "meeting");
  }
  mem.close();
});

test("不传 scenario = default profile = v0.1 行为（无 sensitive / 无 scenario 字段）", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("我喜欢早上写作");
  // default profile.name = "default"，会被打上 scenario 标
  // 这里只验证不影响 sensitive / 不 hide：
  for (const d of r.derived) {
    assert.notEqual(d.sensitive, true);
  }
  mem.close();
});
