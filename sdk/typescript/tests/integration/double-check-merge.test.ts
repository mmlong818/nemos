// double-check-merge.test.ts —— 双 pass + 校验产出 confidence 字段

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mnemos } from "../../src/index.js";
import { getMockCallCount, makeMockLLMConfig, resetMockCount } from "../helpers.js";

test("doubleCheck: true 触发 3 次 LLM 调用（pass A + pass B + check）", async () => {
  resetMockCount();
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: true },
  });
  const u = mem.forUser("u1");
  await u.ingest("我每天写代码。我喜欢 TypeScript。");
  assert.equal(getMockCallCount(), 3, "应调 3 次 LLM (双 pass + check)");
  mem.close();
});

test("doubleCheck 后 derived 带 confidence 字段", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: true },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("我每天写代码。我喜欢 TypeScript。");
  assert.ok(r.verification_stats, "应有 verification_stats");
  for (const d of r.derived) {
    assert.ok(d.source.confidence, `derived 必须带 confidence: ${d.id}`);
    assert.equal(d.source.chain_depth, 2, "经过 check pass 后 chain_depth=2");
  }
  mem.close();
});

test("confidenceMin='high' 过滤 search 结果", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: true },
  });
  const u = mem.forUser("u1");
  await u.ingest("我每天写代码。我喜欢 TypeScript。");
  const results = await u.search("代码", { confidenceMin: "high", topK: 10 });
  // mock 是确定性的 → 所有 confidence 都是 high → 不应被过滤掉
  assert.ok(results.length > 0);
  for (const r of results) {
    if (r.source.confidence) {
      assert.equal(r.source.confidence, "high");
    }
  }
  mem.close();
});

test("doubleCheck: false 只调 1 次 LLM", async () => {
  resetMockCount();
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await u.ingest("一段不需要校验的内容");
  assert.equal(getMockCallCount(), 1);
  mem.close();
});
