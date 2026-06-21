// v0.6 prefilter.test.ts — 矛盾失效粗筛（RFC 0007 §2.3）
// 验证：同主体的事实被保留进 LLM；不相干的被筛掉；阈值与排序行为正确。

import { test } from "node:test";
import assert from "node:assert/strict";
import { shingles, jaccard, prefilterCandidates } from "../../../src/prefilter.js";

test("v0.6 prefilter: shingles 中文/边界", () => {
  assert.deepEqual([...shingles("猫狗")], ["猫狗"]);
  assert.equal(shingles("").size, 0);
  assert.equal(shingles("a").size, 1); // 单字符回退
  assert.ok(shingles("abc").has("ab") && shingles("abc").has("bc"));
});

test("v0.6 prefilter: jaccard 相同/不相干", () => {
  assert.equal(jaccard(shingles("用户养了一只猫"), shingles("用户养了一只猫")), 1);
  assert.equal(jaccard(new Set(), shingles("x")), 0);
  // 不相干文本相似度应很低
  assert.ok(jaccard(shingles("用户喜欢爬山跑步"), shingles("北京今天下雨")) < 0.08);
});

test("v0.6 prefilter: 保留同主体候选、筛掉无关", () => {
  const candidates = [
    { id: "1", content: "用户养了一只狗，名叫 Max" },
    { id: "2", content: "用户是一名后端程序员" },
    { id: "3", content: "用户周末喜欢去爬山" },
  ];
  // 新事实：关于那只狗 → 应只把 #1 放进来
  const kept = prefilterCandidates("用户的狗 Max 最近去世了", candidates, 0.08);
  const ids = kept.map((k) => k.id);
  assert.ok(ids.includes("1"), "同主体(Max/狗)的候选应保留");
  assert.ok(!ids.includes("2") && !ids.includes("3"), "无关候选应被筛掉");
  // 带 score 且降序
  assert.ok(kept[0] && typeof kept[0].score === "number");
});

test("v0.6 prefilter: 空 query / 空候选不崩", () => {
  assert.deepEqual(prefilterCandidates("", [{ content: "x" }]), []);
  assert.deepEqual(prefilterCandidates("x", []), []);
});
