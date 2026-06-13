// entity-extraction.test.ts — entity 抽取 + cache + 容错

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEntities, _resetEntityCache } from "../../../src/entity.js";
import { makeEntityMockLLMConfig } from "../../helpers.js";
import { makeProvider } from "../../../src/llm.js";

test("extractEntities 解析 LLM JSON 输出", async () => {
  _resetEntityCache();
  const llm = makeProvider(makeEntityMockLLMConfig(["X 项目", "团队 Alpha", "工具 K"]));
  const ents = await extractEntities("我们在 X 项目 用 工具 K 干了点活", llm);
  assert.deepEqual(ents, ["X 项目", "团队 Alpha", "工具 K"]);
});

test("extractEntities cache：相同 content 不重抽", async () => {
  _resetEntityCache();
  let n = 0;
  const llm = makeProvider({
    provider: "custom",
    chat: async () => {
      n++;
      return JSON.stringify({ entities: ["A"] });
    },
  });
  await extractEntities("same content", llm);
  await extractEntities("same content", llm);
  await extractEntities("same content", llm);
  assert.equal(n, 1, "相同 content 应只调用一次 LLM");
});

test("extractEntities 容错：LLM 返回非法 JSON → 空数组", async () => {
  _resetEntityCache();
  const llm = makeProvider({ provider: "custom", chat: async () => "not json" });
  const ents = await extractEntities("anything", llm);
  assert.deepEqual(ents, []);
});

test("extractEntities 容错：entities 不是数组 → 空数组", async () => {
  _resetEntityCache();
  const llm = makeProvider({
    provider: "custom",
    chat: async () => JSON.stringify({ entities: "not array" }),
  });
  const ents = await extractEntities("anything 2", llm);
  assert.deepEqual(ents, []);
});

test("extractEntities dedupe 大小写不敏感且截到 10", async () => {
  _resetEntityCache();
  const arr = ["A", "a", "B", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
  const llm = makeProvider({
    provider: "custom",
    chat: async () => JSON.stringify({ entities: arr }),
  });
  const ents = await extractEntities("dedup-test", llm);
  // A/a 合一；后续 B/B 也合一；总数 ≤ 10
  assert.ok(ents.length <= 10, `len=${ents.length}`);
  // 第一个 A（大写）保留
  assert.equal(ents[0], "A");
  assert.ok(!ents.includes("a"));
});
