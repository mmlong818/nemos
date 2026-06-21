// v0.4 output-tiers.test.ts
// 验证：flat / tiered / narrative 三种 ContextFormat 输出结构正确；narrative 失败降级 tiered。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  memoriesToMarkdown,
  memoriesToMarkdownNarrative,
  memoriesToMarkdownTiered,
  Nemos,
  type LLMProvider,
  type Memory,
} from "../../../src/index.js";
import { makeMockLLMConfig, makeNarrativeMockLLMConfig } from "../../helpers.js";

function buildMem(layer: Memory["layer"], content: string, conf?: "high" | "medium" | "low"): Memory {
  return {
    id: `${layer}_${content.slice(0, 4)}`,
    layer,
    type: "user",
    scope: "global",
    content,
    source: {
      authoritative: false,
      kind: "derived",
      origin: "llm-extract",
      chain_depth: 1,
      confidence: conf,
    },
    arousal: { value: 0.3, signal_sources: [] },
    surprise: { value: 0.2, basis: "test" },
    ownership: { kind: "self", consent_status: "implicit" },
    created_at: "2026-06-01T00:00:00.000Z",
    last_accessed: "2026-06-01T00:00:00.000Z",
    access_count: 0,
    stability: 1.0,
    schema_version: "0.4",
  };
}

test("v0.4 flat: 默认形态保留 v0.3 行为（含 _conf:_ / _ai-inferred_）", () => {
  const mems = [
    buildMem("personal_semantic", "用户偏好早起", "high"),
    buildMem("episodic", "上周一次会议", "medium"),
  ];
  const md = memoriesToMarkdown(mems);
  assert.ok(md.includes("## Relevant memory context"));
  assert.ok(md.includes("_conf:high_"));
  assert.ok(md.includes("_ai-inferred_"));
});

test("v0.4 tiered: 按层 H2 + 中文标签 + confidence 行内", () => {
  const mems = [
    buildMem("personal_semantic", "用户偏好早起", "high"),
    buildMem("semantic", "项目 X 截止 Q4", "medium"),
    buildMem("episodic", "上周一次会议"),
  ];
  const md = memoriesToMarkdownTiered(mems);
  assert.ok(md.includes("## 关于用户（personal_semantic）"));
  assert.ok(md.includes("## 知识（semantic）"));
  assert.ok(md.includes("## 事件（episodic）"));
  assert.ok(md.includes("(high confidence)"));
  assert.ok(md.includes("(medium confidence)"));
  // 无 confidence 但 ai-inferred 的应标 ai-inferred
  assert.ok(md.includes("(ai-inferred)"));
});

test("v0.4 tiered: 空层不输出（不留空标题）", () => {
  const mems = [buildMem("personal_semantic", "偏好早起", "high")];
  const md = memoriesToMarkdownTiered(mems);
  assert.ok(md.includes("## 关于用户"));
  assert.ok(!md.includes("## 事件"));
  assert.ok(!md.includes("## 知识"));
});

test("v0.4 narrative: LLM 合成的自然段（无 bullet / 无层标题）", async () => {
  const llm: LLMProvider = {
    name: "narr-test",
    chat: async (system, user) => {
      assert.ok(system.includes("nemos 记忆叙事器"));
      assert.ok(user.includes("personal_semantic"));
      return "用户偏好早起，最近确认项目截止日期。";
    },
  };
  const mems = [
    buildMem("personal_semantic", "偏好早起", "high"),
    buildMem("episodic", "项目截止确认"),
  ];
  const out = await memoriesToMarkdownNarrative(mems, llm);
  assert.equal(out, "用户偏好早起，最近确认项目截止日期。");
});

test("v0.4 narrative: 剥 markdown 围栏", async () => {
  const llm: LLMProvider = {
    name: "narr-fence",
    chat: async () => "```\n用户偏好早起。\n```",
  };
  const mems = [buildMem("personal_semantic", "x", "high")];
  const out = await memoriesToMarkdownNarrative(mems, llm);
  assert.equal(out, "用户偏好早起。");
});

test("v0.4 getRelevantContext({ format: 'tiered' }) 走 tiered 分支", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("alice");
  await u.ingest("我喜欢早起。今天去咖啡馆。");
  const ctx = await u.getRelevantContext("早起 咖啡", { format: "tiered" });
  // tiered 用 H2 中文标签
  assert.ok(ctx.includes("##"));
  mem.close();
});

test("v0.4 getRelevantContext({ format: 'narrative' }) 走 LLM", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeNarrativeMockLLMConfig("用户偏好早起，常去咖啡馆。"),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("alice");
  await u.ingest("我喜欢早起。今天去咖啡馆。");
  const ctx = await u.getRelevantContext("早起", { format: "narrative" });
  // narrative 不应该是层标题 markdown
  assert.ok(!ctx.startsWith("##"));
  assert.ok(ctx.includes("早起") || ctx.includes("咖啡馆"));
  mem.close();
});

test("v0.4 narrative 失败时降级 tiered（不抛错）", async () => {
  const failingLlm: LLMProvider = {
    name: "fail",
    chat: async () => {
      throw new Error("simulated LLM error");
    },
  };
  // 直接通过 Nemos 用 custom llm（覆盖 narrative 路径）
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: {
      provider: "custom",
      name: "fail",
      chat: async (system, user) => {
        // ingest 用的 mock：返回最小 JSON
        if (system.includes("nemos 记忆叙事器")) throw new Error("simulated LLM error");
        if (system.includes("记忆审查官")) return JSON.stringify({ derived: [], stats: {} });
        return JSON.stringify({
          archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "r" } },
          derived: [
            {
              layer: "personal_semantic",
              content: "偏好早起",
              type: "user",
              scope: "global",
              source: { authoritative: false, origin: "llm-extract", chain_depth: 1 },
              arousal: { value: 0.3, signal_sources: [] },
              surprise: { value: 0.2, basis: "x" },
            },
          ],
        });
      },
    },
    features: { doubleCheck: false },
  });
  const u = mem.forUser("alice");
  await u.ingest("我喜欢早起");
  const ctx = await u.getRelevantContext("早起", { format: "narrative" });
  // 降级到 tiered → 必有 H2
  assert.ok(ctx.includes("##"), "降级 tiered 后应有 H2 标签");
  void failingLlm; // 不直接用，但保留示例
  mem.close();
});
