// v0.6 invalidation.test.ts — 候选封顶（RFC 0007 §2.3）
// capAnchors 仅在候选超上限时按相似度裁剪；小集合原样保留（不过滤，防漏矛盾）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { capAnchors, DEFAULT_ANCHOR_CAP } from "../../../src/invalidation.js";

test("v0.6 capAnchors: 小集合原样返回（不过滤）", () => {
  const anchors = [
    { content: "用户养了一只狗叫 Max" },
    { content: "用户完全不相干的另一件事：喜欢喝美式咖啡" },
  ];
  // 即便其中一条与 query 词法不像，也不能被丢——小集合全保留交给 LLM 语义判断
  const out = capAnchors(anchors, "今天 Max 去世了", DEFAULT_ANCHOR_CAP);
  assert.equal(out.length, 2, "<=cap 时不过滤");
});

test("v0.6 capAnchors: 超上限时裁到 cap 并按相似度优先", () => {
  const anchors = [];
  for (let i = 0; i < 60; i++) anchors.push({ content: "无关事实编号 " + i + " 关于天气和股票" });
  anchors.push({ content: "用户养了一只狗叫 Max，很黏人" }); // 与 query 相关
  const out = capAnchors(anchors, "Max 这只狗最近怎么样", 50);
  assert.equal(out.length, 50, "裁到 cap");
  assert.ok(out.some((a) => a.content.includes("Max")), "相关候选应被相似度排序保留");
});
