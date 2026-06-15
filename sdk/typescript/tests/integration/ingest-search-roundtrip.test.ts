// ingest-search-roundtrip.test.ts —— ingest → search 端到端
// 用 in-memory storage + mock LLM，无需真 API key。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../src/index.js";
import { makeMockLLMConfig } from "../helpers.js";

test("ingest 一段文本后能通过 FTS 关键词搜回", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const userMem = mem.forUser("alice");
  await userMem.ingest("我每天早上 6 点写作。我习惯喝黑咖啡。");
  const results = await userMem.search("早上 写作", { topK: 5 });
  assert.ok(results.length > 0, "应能搜到结果");
  const contents = results.map((r) => r.content).join(" ");
  assert.match(contents, /早上|写作/);
  mem.close();
});

test("两个 userId 之间数据完全隔离", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const a = mem.forUser("alice");
  const b = mem.forUser("bob");
  await a.ingest("alice 的秘密");
  await b.ingest("bob 的秘密");
  const aResults = await a.search("秘密");
  const bResults = await b.search("秘密");
  assert.ok(
    aResults.every((r) => !r.content.includes("bob")),
    "alice 不应看到 bob 的数据",
  );
  assert.ok(
    bResults.every((r) => !r.content.includes("alice")),
    "bob 不应看到 alice 的数据",
  );
  mem.close();
});

test("getRelevantContext 返回 markdown 格式", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await u.ingest("我喜欢早上写作。");
  const ctx = await u.getRelevantContext("写作", { topK: 5 });
  assert.match(ctx, /## Relevant memory context/);
  mem.close();
});

test("stats() 反映 layer 与 scope 的分布", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await u.ingest("内容 A", { scope: "project:foo" });
  await u.ingest("内容 B", { scope: "project:bar" });
  const s = await u.stats();
  assert.ok(s.total > 0);
  assert.ok(s.by_layer.archival >= 2);
  mem.close();
});
