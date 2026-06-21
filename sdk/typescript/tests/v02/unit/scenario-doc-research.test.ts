// scenario-doc-research.test.ts —— doc-research profile 排除 personal_semantic

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

test("scenario='doc-research' 时不产出 personal_semantic（exclude.layers 生效）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  // 内容中带「我喜欢」会让 mock 默认输出 personal_semantic；scenario 应 hard filter 掉
  const r = await u.ingest("我喜欢这篇研报里的方法。研究表明 X 与 Y 相关。", {
    scenario: "doc-research",
  });
  const psCount = r.derived.filter((d) => d.layer === "personal_semantic").length;
  assert.equal(psCount, 0, "doc-research 必须排除 personal_semantic");
  // 每条 derived 都带 scenario 标签
  for (const d of r.derived) {
    assert.equal(d.scenario, "doc-research");
  }
  mem.close();
});

test("scenario object 自定义可覆盖内置字段", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("我喜欢早上写作", {
    scenario: {
      name: "custom-research",
      exclude: { layers: ["personal_semantic"] },
    },
  });
  const psCount = r.derived.filter((d) => d.layer === "personal_semantic").length;
  assert.equal(psCount, 0);
  for (const d of r.derived) {
    assert.equal(d.scenario, "custom-research");
  }
  mem.close();
});

test("未知 string scenario throw", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await assert.rejects(
    async () => u.ingest("内容", { scenario: "unknown-profile" }),
    /未知内置 scenario/,
  );
  mem.close();
});
