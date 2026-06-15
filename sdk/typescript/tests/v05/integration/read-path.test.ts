// v0.5 read-path.test.ts（集成）
// 验证 Nemos.search 四级激活 rerank + getRelevantContext 前瞻通道；
// 关键回归：features 默认关时行为等价 v0.4。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos, type RouteResult } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

const TENANT = "default";

// 把三条 memory（2 econ + 1 med）写入并归属领域。
async function seed(mem: Nemos, user: string): Promise<{ econ1: string; econ2: string; med1: string }> {
  const um = mem.forUser(user);
  const econ1 = (await um.write({ layer: "semantic", content: "deadline 经济衰退失业", source: { authoritative: false, origin: "test" } })).id;
  const econ2 = (await um.write({ layer: "semantic", content: "deadline 通胀萧条", source: { authoritative: false, origin: "test" } })).id;
  const med1 = (await um.write({ layer: "semantic", content: "deadline 失眠焦虑抑郁", source: { authoritative: false, origin: "test" } })).id;
  const s = mem.raw().storage;
  const now = "2026-01-01T00:00:00.000Z";
  s.ensureGlobalDomain(TENANT, user);
  s.upsertDomain(TENANT, user, { id: "d_med", tenant_id: TENANT, user_id: user, label: "医疗", prototype_vec: null, level: 0, status: "warm", origin: "emergent", always_on: false, load_count: 0, retrievability: 1, created_at: now, updated_at: now });
  s.upsertDomain(TENANT, user, { id: "d_econ", tenant_id: TENANT, user_id: user, label: "经济", prototype_vec: null, level: 0, status: "warm", origin: "emergent", always_on: false, load_count: 0, retrievability: 1, created_at: now, updated_at: now });
  s.setMemoryDomains(TENANT, user, econ1, [{ memory_id: econ1, domain_id: "d_econ", membership_weight: 1, is_primary: true }]);
  s.setMemoryDomains(TENANT, user, econ2, [{ memory_id: econ2, domain_id: "d_econ", membership_weight: 1, is_primary: true }]);
  s.setMemoryDomains(TENANT, user, med1, [{ memory_id: med1, domain_id: "d_med", membership_weight: 1, is_primary: true }]);
  return { econ1, econ2, med1 };
}

const routeToMed = async (): Promise<RouteResult> => ({ l1: "d_med", l2: [], confidence: 0.9, fallback: false });

test("domains.enabled：路由到医疗 → 医疗记忆 rerank 升顶（econ 仍在，soft）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      domains: { enabled: true, router: { provider: "custom", route: routeToMed }, routeConfidenceThreshold: 0.35 },
    },
  });
  try {
    const ids = await seed(mem, "alice");
    const r = await mem.forUser("alice").search("deadline", { topK: 50 });
    assert.equal(r[0]?.id, ids.med1, "医疗记忆升顶");
    const got = new Set(r.map((m) => m.id));
    assert.ok(got.has(ids.econ1) && got.has(ids.econ2), "经济记忆未被剔除（soft 降权）");
  } finally {
    mem.close();
  }
});

test("逃生阀：路由 fallback → 保持全局结果不变", async () => {
  const routeFallback = async (): Promise<RouteResult> => ({ l1: null, l2: [], confidence: 0, fallback: true });
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      domains: { enabled: true, router: { provider: "custom", route: routeFallback } },
    },
  });
  try {
    await seed(mem, "bob");
    const r = await mem.forUser("bob").search("deadline", { topK: 50 });
    assert.equal(r.length, 3, "fallback 时返回全部，不 rerank");
  } finally {
    mem.close();
  }
});

test("回归：domains 默认关 → 与不配 domains 行为一致（不调用 router）", async () => {
  let routerCalled = false;
  const spyRoute = async (): Promise<RouteResult> => {
    routerCalled = true;
    return { l1: "d_med", l2: [], confidence: 0.9, fallback: false };
  };
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: {
      doubleCheck: false,
      // enabled 缺省 = false；即便配了 router 也不该被调用
      domains: { router: { provider: "custom", route: spyRoute } },
    },
  });
  try {
    await seed(mem, "carol");
    const r = await mem.forUser("carol").search("deadline", { topK: 50 });
    assert.equal(routerCalled, false, "domains 未启用不应调用 router");
    assert.equal(r.length, 3);
  } finally {
    mem.close();
  }
});

test("prospective.enabled：getRelevantContext 含 kind=prospective 标注", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, prospective: { enabled: true, minConfidence: 0.4 } },
  });
  try {
    const um = mem.forUser("dave");
    await um.write({ layer: "semantic", content: "deadline 普通记忆", source: { authoritative: false, origin: "test" } });
    const now = "2026-01-01T00:00:00.000Z";
    mem.raw().storage.insertProspective(TENANT, "dave", {
      id: "p1", tenant_id: TENANT, user_id: "dave", scope: "global", domain_ids: [],
      cue: "deadline 临近", projection: "熬夜赶工焦虑上升", confidence: 0.6,
      evidence_refs: [], prediction_log: [], retrievability: 1, status: "crystallized",
      created_at: now, last_accessed: now,
    });
    const ctx = await um.getRelevantContext("deadline", { format: "flat" });
    assert.match(ctx, /\[prospective \| AI预测/, "含前瞻标注");
    assert.match(ctx, /熬夜赶工焦虑上升/);
  } finally {
    mem.close();
  }
});

test("prospective：低于 minConfidence 不返回；enabled=false 无前瞻项（回归）", async () => {
  // 低置信
  const memLow = new Nemos({
    storage: { type: "memory" }, llm: makeMockLLMConfig(),
    features: { doubleCheck: false, prospective: { enabled: true, minConfidence: 0.8 } },
  });
  try {
    const um = memLow.forUser("e1");
    await um.write({ layer: "semantic", content: "deadline x", source: { authoritative: false, origin: "test" } });
    const now = "2026-01-01T00:00:00.000Z";
    memLow.raw().storage.insertProspective(TENANT, "e1", {
      id: "p1", tenant_id: TENANT, user_id: "e1", scope: "global", domain_ids: [],
      cue: "deadline", projection: "低置信预测", confidence: 0.5,
      evidence_refs: [], prediction_log: [], retrievability: 1, status: "crystallized",
      created_at: now, last_accessed: now,
    });
    const ctx = await um.getRelevantContext("deadline", { format: "flat" });
    assert.doesNotMatch(ctx, /低置信预测/, "低于 minConfidence 不返回");
  } finally {
    memLow.close();
  }

  // 默认关
  const memOff = new Nemos({
    storage: { type: "memory" }, llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  try {
    const um = memOff.forUser("e2");
    await um.write({ layer: "semantic", content: "deadline y", source: { authoritative: false, origin: "test" } });
    const now = "2026-01-01T00:00:00.000Z";
    memOff.raw().storage.insertProspective(TENANT, "e2", {
      id: "p1", tenant_id: TENANT, user_id: "e2", scope: "global", domain_ids: [],
      cue: "deadline", projection: "应当不出现", confidence: 0.9,
      evidence_refs: [], prediction_log: [], retrievability: 1, status: "crystallized",
      created_at: now, last_accessed: now,
    });
    const ctx = await um.getRelevantContext("deadline", { format: "flat" });
    assert.doesNotMatch(ctx, /应当不出现/, "prospective 未启用无前瞻项");
  } finally {
    memOff.close();
  }
});
