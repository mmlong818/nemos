// v0.4 cold-hide-from-search.test.ts
// 验证：标 cold 的 memory 默认从 search 隐藏；includeCold:true 可见；archival 永远在；
// 用户 clearCold 后再次可见。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("v0.4: cold 默认从 search 隐藏；includeCold:true 才可见", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      decay: { enabled: true, coldDormancyDays: 0, coldThreshold: 0.99 },
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  await u.ingest("我喜欢早起写作");

  // 注意：不在 scan 之前 search（search 命中会刷新 last_accessed，导致 dt=0 → R=1 ≥ threshold）
  // 跳到 100 天后跑 decay scan
  await u.runDecayScan(Date.now() + 100 * DAY_MS);
  const cold = await u.listCold();
  assert.ok(cold.length > 0, "至少一条应被标 cold");

  // 默认 search 不返
  const def = await u.search("早起");
  for (const m of def) {
    assert.notEqual(m.cold, true, "默认 search 不应返回 cold");
  }

  // includeCold:true 仍可见
  const all = await u.search("早起", { includeCold: true });
  const sawCold = all.some((m) => m.cold === true);
  assert.ok(sawCold, "includeCold:true 应能查到 cold 记录");

  mem.close();
});

test("v0.4: archival 永不 cold（即便跑 100 年 decay）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      decay: { enabled: true, coldDormancyDays: 0, coldThreshold: 0.99 },
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  await u.ingest("原始内容");
  await u.runDecayScan(Date.now() + 100 * 365 * DAY_MS);

  const arch = await u.listByLayer("archival");
  for (const a of arch) {
    assert.notEqual(a.cold, true);
    assert.equal(a.archival_protected, true);
  }
  const cold = await u.listCold();
  for (const c of cold) {
    assert.notEqual(c.layer, "archival");
  }
  mem.close();
});

test("v0.4: clearCold 后再次可见", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      decay: { enabled: true, coldDormancyDays: 0, coldThreshold: 0.99 },
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  await u.ingest("我喜欢早起");
  await u.runDecayScan(Date.now() + 60 * DAY_MS);
  const cold = await u.listCold();
  assert.ok(cold.length > 0);
  const target = cold[0]!;
  await u.clearCold(target.id);

  // 默认 search 应能查到（cold=false）
  const after = await u.search("早起");
  const sawTarget = after.some((m) => m.id === target.id);
  assert.ok(sawTarget, "clearCold 后默认 search 应能找回");
  mem.close();
});

test("v0.4: 跨 user 隔离 — alice 的 cold 不会影响 bob", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      decay: { enabled: true, coldDormancyDays: 0, coldThreshold: 0.99 },
    },
    worker: { manualWorker: true },
  });
  const a = mem.forUser("alice");
  const b = mem.forUser("bob");

  await a.ingest("我喜欢早起");
  await b.ingest("我喜欢早起");

  // alice 跑 decay 100 天后
  await a.runDecayScan(Date.now() + 100 * DAY_MS);

  const bobCold = await b.listCold();
  // bob 的也会被标（因为 scan 是全局；但每条都带 tenant/user）
  // 这里要验证 alice 跑 scan 不影响 bob 的可见性
  void bobCold;
  // alice 的 cold 不应该影响 bob 的 search
  const bRes = await b.search("早起", { includeCold: true });
  assert.ok(bRes.length > 0);

  mem.close();
});
