// v0.4 fsrs-decay.test.ts
// 验证：reinforceStability cap / computeRetrievability 公式 / decideDecay 各分支 /
// archival 永远跳过 / runDecayScan 端到端。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRetrievability,
  decideDecay,
  DECAY_DEFAULTS,
  InMemoryStorage,
  Nemos,
  reinforceStability,
  resolveDecayConfig,
  runDecayScan,
} from "../../../src/index.js";
import type { DecayCandidate } from "../../../src/storage/types.js";
import { makeMockLLMConfig } from "../../helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOOP_LOG = (): void => {};

test("v0.4 reinforceStability: S *= 1.3 capped 365", () => {
  assert.equal(Math.round(reinforceStability(1, 365)), Math.round(1.3));
  assert.equal(Math.round(reinforceStability(100, 365)), 130);
  // 超 cap
  assert.equal(reinforceStability(300, 365), 365);
  // S <= 0 fallback
  assert.equal(reinforceStability(0, 365), 1.3);
});

test("v0.4 computeRetrievability: R = exp(-Δt/S)", () => {
  const now = 1_000_000_000_000;
  // Δt = 1 day, S = 1 → R ≈ exp(-1) ≈ 0.3679
  const r1 = computeRetrievability(now, now - DAY_MS, 1);
  assert.ok(Math.abs(r1 - Math.exp(-1)) < 1e-6);
  // Δt = 0 → R = 1
  const r2 = computeRetrievability(now, now, 5);
  assert.equal(r2, 1.0);
  // Δt 巨大 / S 小 → R 接近 0
  const r3 = computeRetrievability(now, now - 100 * DAY_MS, 1);
  assert.ok(r3 < 0.001);
  // S = 0 → R = 0
  assert.equal(computeRetrievability(now, now - DAY_MS, 0), 0);
});

function candidate(opts: Partial<DecayCandidate> & { last_accessed: string; stability: number }): DecayCandidate {
  return {
    id: "ep_test",
    layer: "episodic",
    tenant_id: "default",
    user_id: "alice",
    last_accessed: opts.last_accessed,
    access_count: opts.access_count ?? 0,
    stability: opts.stability,
    sensitive: opts.sensitive ?? 0,
    cold: opts.cold ?? 0,
    cold_at: opts.cold_at ?? null,
    archival_protected: opts.archival_protected ?? 0,
  };
}

test("v0.4 decideDecay: archival_protected → 永不 cold", () => {
  const now = Date.now();
  const old = new Date(now - 1000 * DAY_MS).toISOString();
  const c = candidate({ last_accessed: old, stability: 1, archival_protected: 1 });
  const d = decideDecay(c, DECAY_DEFAULTS, now);
  assert.equal(d.shouldMarkCold, false);
});

test("v0.4 decideDecay: access_count > 0 → 不标 cold", () => {
  const now = Date.now();
  const old = new Date(now - 100 * DAY_MS).toISOString();
  const c = candidate({ last_accessed: old, stability: 1, access_count: 1 });
  const d = decideDecay(c, DECAY_DEFAULTS, now);
  assert.equal(d.shouldMarkCold, false);
});

test("v0.4 decideDecay: 已 cold → 不重复标", () => {
  const now = Date.now();
  const old = new Date(now - 100 * DAY_MS).toISOString();
  const c = candidate({ last_accessed: old, stability: 1, cold: 1 });
  const d = decideDecay(c, DECAY_DEFAULTS, now);
  assert.equal(d.shouldMarkCold, false);
});

test("v0.4 decideDecay: dormancy 未满 → 不标 cold", () => {
  const now = Date.now();
  // 5 天前，dormancy=7 → 还没满
  const recent = new Date(now - 5 * DAY_MS).toISOString();
  const c = candidate({ last_accessed: recent, stability: 0.5 });
  const d = decideDecay(c, DECAY_DEFAULTS, now);
  assert.equal(d.shouldMarkCold, false);
});

test("v0.4 decideDecay: R<threshold + dormancy 满 + access=0 → 标 cold", () => {
  const now = Date.now();
  const old = new Date(now - 30 * DAY_MS).toISOString();
  const c = candidate({ last_accessed: old, stability: 1 });
  const d = decideDecay(c, DECAY_DEFAULTS, now);
  // R = exp(-30) → ~ 1e-13, 远小于 0.1
  assert.equal(d.shouldMarkCold, true);
  assert.ok(d.retrievability < 0.1);
});

test("v0.4 resolveDecayConfig: 默认 disabled + 用户配置覆盖", () => {
  const def = resolveDecayConfig({ storage: { type: "memory" }, llm: { provider: "anthropic", apiKey: "x" } });
  assert.equal(def.enabled, false);
  assert.equal(def.coldThreshold, 0.1);

  const overridden = resolveDecayConfig({
    storage: { type: "memory" },
    llm: { provider: "anthropic", apiKey: "x" },
    features: { decay: { enabled: true, coldThreshold: 0.05, coldDormancyDays: 3 } },
  });
  assert.equal(overridden.enabled, true);
  assert.equal(overridden.coldThreshold, 0.05);
  assert.equal(overridden.coldDormancyDays, 3);
});

test("v0.4 runDecayScan: disabled → 立即返回零结果", () => {
  const storage = new InMemoryStorage();
  const r = runDecayScan(storage, { ...DECAY_DEFAULTS, enabled: false }, NOOP_LOG);
  assert.equal(r.scanned, 0);
  assert.equal(r.cooled, 0);
});

test("v0.4 runDecayScan: archival 永远不会出现在 candidates", async () => {
  // 用真 Nemos ingest 一条；archival_protected=true
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, decay: { enabled: true, coldDormancyDays: 0, coldThreshold: 0.99 } },
  });
  const u = mem.forUser("alice");
  await u.ingest("我喜欢早起");
  // 取底层 storage 候选
  const storage = mem.raw().storage;
  const cands = storage.listDecayCandidates(100);
  for (const c of cands) {
    assert.notEqual(c.layer, "archival", "archival 不应出现在 decay candidates");
    assert.equal(c.archival_protected, 0);
  }
  mem.close();
});

test("v0.4 runDecayScan: 端到端 → cold 标记落库 + archival 永久豁免", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      decay: { enabled: true, coldDormancyDays: 0, coldThreshold: 0.99, scanIntervalMs: 1 },
    },
    worker: { manualWorker: true },
  });
  const u = mem.forUser("alice");
  await u.ingest("我喜欢早起 11:00 写作");

  // 模拟时间已过 100 天
  const future = Date.now() + 100 * DAY_MS;
  const result = await u.runDecayScan(future);
  assert.ok(result.scanned > 0, "应有候选");
  assert.ok(result.cooled > 0, "应至少一条 cold");

  // archival 永远不会 cold
  const arch = await u.listByLayer("archival");
  for (const a of arch) {
    assert.notEqual(a.cold, true, "archival 永不 cold");
  }

  // 列 cold 应包含至少一条
  const cold = await u.listCold();
  assert.ok(cold.length > 0);
  for (const c of cold) {
    assert.notEqual(c.layer, "archival");
    assert.equal(c.cold, true);
  }
  mem.close();
});
