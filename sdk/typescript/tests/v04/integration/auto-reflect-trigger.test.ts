// v0.4 auto-reflect-trigger.test.ts
// 验证：累积 ≥ autoTriggerThreshold 条 episodic 后，下一次 ingest 自动触发 reflect。
// disabled 时不触发；显式 runReflect 永远可用。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeReflectMockLLMConfig } from "../../helpers.js";

test("v0.4: 累积 N 条 episodic 后自动触发 reflect（threshold=5）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeReflectMockLLMConfig({ fixedContent: "用户倾向早晨高产" }),
    features: {
      doubleCheck: false,
      reflect: { enabled: true, autoTriggerThreshold: 5 },
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");

  // 写 5 条 episodic 触发阈值
  for (let i = 0; i < 5; i++) {
    await u.ingest(`今天我又做了高产的事 ${i}`);
  }

  // auto-reflect 在第 5 条 ingest 时已触发；检查是否有 personal_semantic 产出
  const psem = await u.listByLayer("personal_semantic");
  const consolidated = psem.find((m) => Array.isArray(m.consolidated_from) && m.consolidated_from.length > 0);
  assert.ok(consolidated, "auto-reflect 应产至少 1 条带 consolidated_from 的 personal_semantic");
  assert.equal(consolidated!.source.origin, "reflect-consolidation");
  mem.close();
});

test("v0.4: reflect.enabled=false 时不触发 auto-reflect", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeReflectMockLLMConfig(),
    features: {
      doubleCheck: false,
      reflect: { enabled: false, autoTriggerThreshold: 3 },
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");

  for (let i = 0; i < 5; i++) {
    await u.ingest(`今天我做事 ${i}`);
  }

  const psem = await u.listByLayer("personal_semantic");
  const consolidated = psem.find((m) => Array.isArray(m.consolidated_from) && m.consolidated_from.length > 0);
  assert.equal(consolidated, undefined, "disabled 时不应有 reflect 产物");
  mem.close();
});

test("v0.4: enabled 时手动 runReflect 仍可调用", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeReflectMockLLMConfig(),
    features: {
      doubleCheck: false,
      reflect: { enabled: false }, // 关 auto 也允许手动
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");

  for (let i = 0; i < 3; i++) {
    await u.ingest(`今天我做事 ${i}`);
  }
  const r = await u.runReflect();
  assert.ok(r.episodicConsumed >= 3);
  assert.ok(r.derived.length >= 1);
  mem.close();
});

test("v0.4: auto-reflect 触发后 baseline 推进，再次触发需累积新一批", async () => {
  let reflectCallCount = 0;
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: {
      provider: "custom",
      name: "reflect-counter",
      chat: async (system, user) => {
        if (system.includes("nemos 反思整合器")) {
          reflectCallCount++;
          const ids: string[] = [];
          const re = /"id":\s*"(ep_[a-zA-Z0-9]+)"/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(user)) !== null) {
            if (m[1]) ids.push(m[1]);
          }
          if (ids.length === 0) return JSON.stringify({ derived: [] });
          return JSON.stringify({
            derived: [
              {
                layer: "personal_semantic",
                content: `第 ${reflectCallCount} 次 reflect`,
                type: "user",
                scope: "global",
                source: { authoritative: false, origin: "reflect-consolidation", chain_depth: 1, confidence: "high" },
                consolidated_from: ids.slice(0, 3),
                arousal: { value: 0.3, signal_sources: [] },
                surprise: { value: 0.2, basis: "x" },
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
              content: "今天某事",
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
    features: {
      doubleCheck: false,
      reflect: { enabled: true, autoTriggerThreshold: 3 },
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");

  // 第一批 3 条 → 触发 1 次 reflect
  for (let i = 0; i < 3; i++) await u.ingest("今天事");
  assert.equal(reflectCallCount, 1, "第一批 3 条应触发 1 次 reflect");

  // 再 2 条 → 还差 1 条到下一个阈值（3 + 3 = 6，当前累积 5）
  await u.ingest("今天事 A");
  await u.ingest("今天事 B");
  assert.equal(reflectCallCount, 1, "尚未到下一阈值，不应再次触发");

  // 第 6 条 → baseline=3 + threshold=3 → 触发
  await u.ingest("今天事 C");
  assert.equal(reflectCallCount, 2, "累积达到下一阈值时再次触发");

  mem.close();
});
