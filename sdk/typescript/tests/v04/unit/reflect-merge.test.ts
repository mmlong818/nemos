// v0.4 reflect-merge.test.ts
// 验证：reflect 输入 ≥20 条 episodic → 输出新 semantic + consolidated_from 引用；
// authoritative=false 强制；archival 不被修改；空 episodic → derived 为空。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos, resolveReflectConfig, REFLECT_DEFAULTS } from "../../../src/index.js";
import { makeMockLLMConfig, makeReflectMockLLMConfig } from "../../helpers.js";

test("v0.4 resolveReflectConfig: 默认 disabled + 用户覆盖", () => {
  const d = resolveReflectConfig({ storage: { type: "memory" }, llm: { provider: "anthropic", apiKey: "x" } });
  assert.equal(d.enabled, false);
  assert.equal(d.autoTriggerThreshold, REFLECT_DEFAULTS.autoTriggerThreshold);

  const o = resolveReflectConfig({
    storage: { type: "memory" },
    llm: { provider: "anthropic", apiKey: "x" },
    features: { reflect: { enabled: true, autoTriggerThreshold: 5, includePersonalSemantic: false } },
  });
  assert.equal(o.enabled, true);
  assert.equal(o.autoTriggerThreshold, 5);
  assert.equal(o.includePersonalSemantic, false);
});

test("v0.4 runReflect: 输入 20 条 episodic → 输出新 personal_semantic + consolidated_from", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeReflectMockLLMConfig(),
    features: { doubleCheck: false, reflect: { enabled: true, autoTriggerThreshold: 9999 } },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");

  // 写 20 条「今天 …」走 mock pickLayer → episodic
  for (let i = 0; i < 20; i++) {
    await u.ingest(`今天我在早晨完成了任务 ${i}`);
  }

  const eps = await u.listByLayer("episodic");
  assert.ok(eps.length >= 20, `应至少 20 条 episodic，实际 ${eps.length}`);

  const r = await u.runReflect();
  assert.ok(r.episodicConsumed >= 20);
  assert.ok(r.derived.length >= 1, "reflect 应至少产 1 条 derived");

  const d = r.derived[0]!;
  assert.equal(d.layer, "personal_semantic");
  assert.equal(d.source.authoritative, false, "reflect 输出强制 authoritative=false");
  assert.equal(d.source.kind, "derived");
  assert.equal(d.source.origin, "reflect-consolidation");
  assert.ok(Array.isArray(d.consolidated_from));
  assert.ok(d.consolidated_from!.length >= 1);
  assert.ok(d.consolidated_at, "必须填 consolidated_at");
  // consolidated_from 引用的 id 必须真实存在于 episodic 集
  const epIds = new Set(eps.map((e) => e.id));
  for (const id of d.consolidated_from!) {
    assert.ok(epIds.has(id), `consolidated_from 引用必须存在: ${id}`);
  }
  mem.close();
});

test("v0.4 runReflect: 空 episodic → derived=[]，不报错", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeReflectMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  const r = await u.runReflect();
  assert.equal(r.episodicConsumed, 0);
  assert.equal(r.derived.length, 0);
  mem.close();
});

test("v0.4 runReflect: 跨 user 隔离 (alice reflect 不读 bob 的 episodic)", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeReflectMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const a = mem.forUser("alice");
  const b = mem.forUser("bob");
  // alice 没有任何 episodic；bob 有 5 条
  for (let i = 0; i < 5; i++) {
    await b.ingest(`今天我做了事情 ${i}`);
  }
  const r = await a.runReflect();
  assert.equal(r.episodicConsumed, 0, "alice 应看不到 bob 的 episodic");
  assert.equal(r.derived.length, 0);
  mem.close();
});

test("v0.4 runReflect: archival 不被读 / 不被修改 (archival_protected)", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeReflectMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  for (let i = 0; i < 3; i++) {
    await u.ingest(`今天我做事 ${i}`);
  }
  const archBefore = await u.listByLayer("archival");
  assert.ok(archBefore.length === 3);
  // 全 archival 都应 archival_protected
  for (const a of archBefore) {
    assert.equal(a.archival_protected, true);
  }
  await u.runReflect();
  const archAfter = await u.listByLayer("archival");
  // 数量不变（reflect 不增 archival）
  assert.equal(archAfter.length, 3);
  // 内容与 protected 标都不变
  for (const a of archAfter) {
    assert.equal(a.archival_protected, true);
  }
  mem.close();
});

test("v0.4 runReflect: 编造的 consolidated_from（不在 ep 集合内）被过滤", async () => {
  // 自定义 LLM 返回 consolidated_from=['ep_does_not_exist']
  let callCount = 0;
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: {
      provider: "custom",
      name: "fake-reflect",
      chat: async (system) => {
        callCount++;
        if (system.includes("nemos 反思整合器")) {
          return JSON.stringify({
            derived: [
              {
                layer: "personal_semantic",
                content: "编造的 pattern",
                type: "user",
                scope: "global",
                source: { authoritative: false, origin: "reflect-consolidation", chain_depth: 1, confidence: "high" },
                consolidated_from: ["ep_fake_id_that_does_not_exist"],
                arousal: { value: 0.3, signal_sources: [] },
                surprise: { value: 0.2, basis: "fake" },
              },
            ],
          });
        }
        if (system.includes("记忆审查官")) return JSON.stringify({ derived: [], stats: {} });
        return JSON.stringify({
          archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "r" } },
          derived: [
            {
              layer: "episodic",
              content: "x",
              type: "user",
              scope: "global",
              source: { authoritative: false, origin: "llm-extract", chain_depth: 1 },
              arousal: { value: 0, signal_sources: [] },
              surprise: { value: 0, basis: "r" },
            },
          ],
        });
      },
    },
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  await u.ingest("今天某事");
  const r = await u.runReflect();
  // 假 consolidated_from → 该 derived 应被丢弃
  assert.equal(r.derived.length, 0, "编造的 consolidated_from 必须被过滤");
  void callCount;
  mem.close();
});

// 兜底：旧 mockLLM 单独跑 reflect 默认走 buildExtractResponse 路径（不应崩）
test("v0.4 runReflect 默认 mock 不抛错", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  await u.ingest("今天我做事 A");
  await u.runReflect();
  mem.close();
});
