// v0.4 sensitivity-detection.test.ts
// 验证：默认 prompt 含 SENSITIVITY_GUIDANCE，且 LLM 输出 sensitive=true 被 SDK 落库；
// 默认 search 隐藏 sensitive；includeSensitive:true 可见；sensitiveOnly:true 仅 sensitive。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos, SENSITIVITY_GUIDANCE } from "../../../src/index.js";
import { makeSensitivityAwareMockLLMConfig, resetMockCount } from "../../helpers.js";

test("v0.4: 非 diary profile 的 system prompt 含 sensitivity 检测引导", async () => {
  resetMockCount();
  let capturedSystem = "";
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: {
      provider: "custom",
      name: "capture-mock",
      chat: async (system: string, user: string): Promise<string> => {
        if (!system.includes("记忆审查官")) capturedSystem = system;
        return JSON.stringify({
          archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "r" } },
          derived: [],
        });
      },
    },
    features: { doubleCheck: false },
  });
  await mem.forUser("alice").ingest("普通内容");
  assert.ok(capturedSystem.length > 0);
  assert.ok(
    capturedSystem.includes("隐私敏感检测"),
    "默认场景 prompt 必须含 SENSITIVITY_GUIDANCE",
  );
  mem.close();
});

test("v0.4: diary profile 不重复拼 sensitivity guidance（避免冗余）", async () => {
  let capturedSystem = "";
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: {
      provider: "custom",
      name: "capture-mock",
      chat: async (system: string, user: string): Promise<string> => {
        if (!system.includes("记忆审查官")) capturedSystem = system;
        return JSON.stringify({
          archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "r" } },
          derived: [],
        });
      },
    },
    features: { doubleCheck: false },
  });
  await mem.forUser("alice").ingest("今天的反思", { scenario: "diary" });
  assert.ok(capturedSystem.length > 0);
  // diary 不应该再追加非 diary 路径的 guidance（diary 已声明 sensitive=true）
  assert.ok(!capturedSystem.includes("隐私敏感检测"), "diary 场景不重复 SENSITIVITY_GUIDANCE");
  mem.close();
});

test("v0.4: 含敏感关键词的内容 → memory.sensitive=true 写库", async () => {
  resetMockCount();
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeSensitivityAwareMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("alice");
  await u.ingest("用户提到健康话题。他在工作上很专注。");

  // 跨层找
  const ep = await u.listByLayer("episodic");
  const sem = await u.listByLayer("semantic");
  const psem = await u.listByLayer("personal_semantic");
  const all = [...ep, ...sem, ...psem];
  const hasSensitive = all.some((m) => m.sensitive === true);
  assert.ok(hasSensitive, "包含「健康话题」的 derived 必须被 mock 标 sensitive=true");
  mem.close();
});

test("v0.4: search 默认不返 sensitive；includeSensitive:true 可见", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeSensitivityAwareMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("alice");
  await u.ingest("用户提到健康话题");

  const def = await u.search("健康");
  for (const m of def) {
    assert.notEqual(m.sensitive, true, "默认 search 不应返回 sensitive");
  }

  const withSens = await u.search("健康", { includeSensitive: true });
  assert.ok(withSens.length >= 1, "includeSensitive:true 应能查到 sensitive 记录");
  assert.ok(
    withSens.some((m) => m.sensitive === true),
    "includeSensitive:true 必有至少一条 sensitive 命中",
  );
  mem.close();
});

test("v0.4: sensitiveOnly:true 只返 sensitive 集合", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeSensitivityAwareMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("alice");
  await u.ingest("用户提到健康话题");
  await u.ingest("用户喜欢喝咖啡");

  const only = await u.search("用户", { sensitiveOnly: true });
  assert.ok(only.length >= 1);
  for (const m of only) {
    assert.equal(m.sensitive, true, "sensitiveOnly 必须全部为 sensitive");
  }
  mem.close();
});

test("v0.4: SENSITIVITY_GUIDANCE 常量公开导出（供朋友自定义 prompt 复用）", () => {
  assert.ok(typeof SENSITIVITY_GUIDANCE === "string");
  assert.ok(SENSITIVITY_GUIDANCE.includes("健康"));
  assert.ok(SENSITIVITY_GUIDANCE.includes("亲密关系"));
});
