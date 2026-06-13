// perspectives-merge.test.ts — 多视角 merge：confidence 计算 + perspectives 字段写入

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveConfidence } from "../../../src/perspectives.js";
import { Mnemos } from "../../../src/index.js";
import {
  makePerspectiveMockLLMConfig,
  makeConflictPerspectiveMockLLMConfig,
} from "../../helpers.js";

test("deriveConfidence: >=2 视角 → high", () => {
  assert.equal(deriveConfidence(["fact", "decision"], false), "high");
  assert.equal(deriveConfidence(["fact", "method", "decision"], false), "high");
});

test("deriveConfidence: 1 视角 → medium", () => {
  assert.equal(deriveConfidence(["fact"], false), "medium");
});

test("deriveConfidence: 0 视角 → low（兜底）", () => {
  assert.equal(deriveConfidence([], false), "low");
  assert.equal(deriveConfidence(undefined, false), "low");
});

test("deriveConfidence: conflict 优先", () => {
  assert.equal(deriveConfidence(["fact", "emotion"], true), "conflict");
  assert.equal(deriveConfidence([], true), "conflict");
});

test("multi-perspective ingest → derived 带 perspectives + 推断 confidence", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makePerspectiveMockLLMConfig(),
    features: { perspectives: ["fact", "method", "decision"] },
  });
  try {
    const r = await mem.forUser("alice").ingest("X 项目准备发布，我决定用 A 而非 B");
    assert.ok(r.derived.length >= 1, "应有至少 1 条 derived");
    // 每条 derived 至少标了 1 个 perspective
    for (const d of r.derived) {
      assert.ok(
        Array.isArray(d.source.perspectives) && d.source.perspectives.length >= 1,
        `derived 应有 perspectives 数组: ${d.id}`,
      );
      // confidence 由 perspectives 推算
      const expected =
        d.source.perspectives.length >= 2 ? "high" : "medium";
      assert.equal(d.source.confidence, expected, `confidence 推算: ${d.id}`);
    }
  } finally {
    mem.close();
  }
});

test("multi-perspective conflict → confidence='conflict' + perspectives_conflict=true", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeConflictPerspectiveMockLLMConfig(),
    features: { perspectives: ["fact", "emotion"] },
  });
  try {
    const r = await mem.forUser("alice").ingest("X 与 反 X 同时被表达");
    assert.equal(r.derived.length, 1);
    const d = r.derived[0]!;
    assert.equal(d.source.confidence, "conflict");
    assert.equal(d.source.perspectives_conflict, true);
    assert.ok(d.source.perspectives?.includes("fact"));
    assert.ok(d.source.perspectives?.includes("emotion"));
  } finally {
    mem.close();
  }
});

test("features.doubleCheck=true 与 features.perspectives 互斥 → throw", () => {
  assert.throws(
    () =>
      new Mnemos({
        storage: { type: "memory" },
        llm: { provider: "custom", chat: async () => "{}" },
        features: { doubleCheck: true, perspectives: ["fact"] },
      }),
    /互斥/,
  );
});

test("不传 perspectives = v0.2 doubleCheck 行为（向后兼容）", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makePerspectiveMockLLMConfig(),
  });
  try {
    const r = await mem.forUser("alice").ingest("X 项目发布");
    // v0.2 路径：confidence 由 LLM check pass 给（mock 返回 'high'）
    for (const d of r.derived) {
      // 不应有 perspectives 数组（v0.2 路径）
      assert.equal(d.source.perspectives, undefined);
    }
  } finally {
    mem.close();
  }
});
