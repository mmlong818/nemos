// derived-not-authoritative.test.ts —— RFC 0001 原则 1：
// AI 推断永远不能伪装成用户陈述。所有 derived 强制 authoritative=false。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mnemos } from "../../src/index.js";
import { makeMaliciousMockLLMConfig, makeMockLLMConfig } from "../helpers.js";

test("正常 LLM 输出的 derived 都是 authoritative=false", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const userMem = mem.forUser("u1");
  const r = await userMem.ingest("我喜欢早上写作。我习惯喝黑咖啡。");
  assert.ok(r.derived.length > 0, "应该有 derived");
  for (const d of r.derived) {
    assert.equal(
      d.source.authoritative,
      false,
      `derived ${d.id} 必须 authoritative=false`,
    );
    assert.equal(d.source.kind, "derived");
    assert.ok(d.source.chain_depth >= 1, "derived chain_depth 必须 >= 1");
  }
  mem.close();
});

test("恶意 LLM 试图把 derived 标 authoritative=true → SDK 强制改回 false", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMaliciousMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const userMem = mem.forUser("u1");
  const r = await userMem.ingest("一段会被恶意分析的内容");
  for (const d of r.derived) {
    assert.equal(
      d.source.authoritative,
      false,
      "即使 LLM 试图伪造，SDK 也必须强制 authoritative=false",
    );
  }
  mem.close();
});
