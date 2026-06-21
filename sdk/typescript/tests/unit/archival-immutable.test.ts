// archival-immutable.test.ts —— 守住 spec I3：archival.content 始终是用户原文，
// LLM 无权改写。即使恶意 LLM 试图改也无效。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../src/index.js";
import { makeMockLLMConfig } from "../helpers.js";

test("archival.content 永远等于用户原始输入，LLM 改不了", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false }, // 简化路径
  });
  const userMem = mem.forUser("u1");
  const original = "今天我决定每天早上 6 点起床写作！这是个重要决定。";
  const result = await userMem.ingest(original);
  assert.equal(result.archival.content, original, "archival.content 必须 = 原文");
  assert.equal(result.archival.source.authoritative, true, "archival 必须 authoritative=true");
  assert.equal(result.archival.source.kind, "authoritative");
  assert.equal(result.archival.source.chain_depth, 0);
  mem.close();
});

test("archival 经过 trim 后是字节级副本（前后空白被裁掉）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const userMem = mem.forUser("u1");
  const original = "  这是带空白的输入  \n";
  const result = await userMem.ingest(original);
  assert.equal(result.archival.content, original.trim());
  mem.close();
});

test("skipAnalysis 模式只产 archival 不产 derived", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
  });
  const userMem = mem.forUser("u1");
  const r = await userMem.ingest("我喜欢咖啡", { skipAnalysis: true });
  assert.equal(r.derived.length, 0);
  assert.equal(r.archival.content, "我喜欢咖啡");
  mem.close();
});
