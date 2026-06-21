// chunking.test.ts —— chunkContent 边界测试

import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkContent } from "../../../src/utils/chunking.js";
import { Nemos } from "../../../src/index.js";
import { makeMockLLMConfig, resetMockCount, getMockCallCount } from "../../helpers.js";

test("短内容不切（≤ maxChars 单元素数组）", () => {
  const chunks = chunkContent("hello world", { maxChars: 1000 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], "hello world");
});

test("长内容按 markdown 章节切", () => {
  const text = [
    "## 第一节",
    "a".repeat(500),
    "## 第二节",
    "b".repeat(500),
    "## 第三节",
    "c".repeat(500),
  ].join("\n");
  const chunks = chunkContent(text, { maxChars: 700, overlap: 50 });
  assert.ok(chunks.length >= 2, "应切出多段");
  for (const c of chunks) {
    assert.ok(c.length <= 700 + 50, `每段不超过 maxChars+overlap：实际 ${c.length}`);
  }
});

test("无 markdown 章节时按段落切", () => {
  const para = "p".repeat(2000);
  const text = `${para}\n\n${para}\n\n${para}\n\n${para}`;
  const chunks = chunkContent(text, { maxChars: 2500, overlap: 100 });
  assert.ok(chunks.length >= 2);
});

test("极长单段（硬切）", () => {
  const text = "a".repeat(20000);
  const chunks = chunkContent(text, { maxChars: 5000, overlap: 100 });
  assert.ok(chunks.length >= 4);
});

test("chunking 触发时自动关 doubleCheck（RFC 0002 决议 C）", async () => {
  resetMockCount();
  // 制造长内容触发 chunking
  const longText = ("## 章节\n" + "a".repeat(3000) + "\n\n").repeat(4);
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: true }, // 配置开了；但 chunking 路径应该跳过
  });
  const u = mem.forUser("u1");
  // 用 chunking.maxChars 配小一点强制切多段
  await u.ingest(longText, {
    scenario: { name: "test", chunking: { maxChars: 4000, overlap: 100 } },
  });
  // 期望：N 段 × 1 次 LLM（无 check pass）；如果是 doubleCheck=true 路径应 3N+1
  const calls = getMockCallCount();
  // 多段，N >= 2，singel-pass mode 调用应 < 3N+1
  assert.ok(calls >= 2, `应该至少调 2 次 LLM（每段 1 次），实际 ${calls}`);
  assert.ok(calls <= 6, `chunking 路径不应触发双 pass + check，调用次数应远小于 3N+1，实际 ${calls}`);
  mem.close();
});
