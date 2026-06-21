// v0.5 l3-spreading.test.ts（集成）—— RFC 0005 §4 L3 跨域扩散接入检索
// 验证：路由命中 L1 领域的种子，沿 cross-memory 边扩散一跳，把"跨域、且不被 query 直接命中"
// 的关联记忆纳入结果（领域隔离只在路由层，不挡记忆间连接）；l3SpreadLimit 控制开关与限额。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos, type RouteResult } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

const TENANT = "default";
const now = "2026-01-01T00:00:00.000Z";
const routeToEcon = async (): Promise<RouteResult> => ({ l1: "d_econ", l2: [], confidence: 0.9, fallback: false });

function domain(id: string, label: string, user: string) {
  return { id, tenant_id: TENANT, user_id: user, label, prototype_vec: null, level: 0, status: "warm" as const, origin: "emergent" as const, always_on: false, load_count: 0, retrievability: 1, created_at: now, updated_at: now };
}

// 造场景：A 命中 query 且属 econ 领域；C 不含 query 词、属另一个领域，但 A--related-->C。
async function seed(mem: Nemos, l3SpreadLimit: number) {
  const u = mem.forUser("alice");
  const a = (await u.write({ layer: "semantic", content: "deadline 经济衰退失业", source: { authoritative: false, origin: "test" } })).id;
  const c = (await u.write({ layer: "semantic", content: "周末去看了一场音乐会，很治愈", source: { authoritative: false, origin: "test" } })).id;
  const s = mem.raw().storage;
  s.updateRelated(TENANT, "alice", "semantic", a, [c]); // A → C 跨域关联边
  s.ensureGlobalDomain(TENANT, "alice");
  s.upsertDomain(TENANT, "alice", domain("d_econ", "经济", "alice"));
  s.upsertDomain(TENANT, "alice", domain("d_other", "生活", "alice"));
  s.setMemoryDomains(TENANT, "alice", a, [{ memory_id: a, domain_id: "d_econ", membership_weight: 1, is_primary: true }]);
  s.setMemoryDomains(TENANT, "alice", c, [{ memory_id: c, domain_id: "d_other", membership_weight: 1, is_primary: true }]);
  void l3SpreadLimit;
  return { a, c, u };
}

test("L3：路由命中领域的种子沿 related 把跨域记忆纳入（C 不含 query 词，纯靠 L3 进来）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, domains: { enabled: true, router: { provider: "custom", route: routeToEcon }, l3SpreadLimit: 5 } },
  });
  try {
    const { a, c, u } = await seed(mem, 5);
    const r = await u.search("deadline", { topK: 50 });
    const ids = new Set(r.map((m) => m.id));
    assert.ok(ids.has(a), "种子 A（命中 query + 属路由领域）在结果里");
    assert.ok(ids.has(c), "L3 沿 related 把跨域的 C 纳入——C 不含 deadline，只能由 L3 进来");
  } finally {
    mem.close();
  }
});

test("L3 开关：l3SpreadLimit=0 时不扩散（C 不出现）——回归对照", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, domains: { enabled: true, router: { provider: "custom", route: routeToEcon }, l3SpreadLimit: 0 } },
  });
  try {
    const { a, c, u } = await seed(mem, 0);
    const r = await u.search("deadline", { topK: 50 });
    const ids = new Set(r.map((m) => m.id));
    assert.ok(ids.has(a), "种子 A 仍在");
    assert.ok(!ids.has(c), "l3SpreadLimit=0：不扩散，C 不出现");
  } finally {
    mem.close();
  }
});

test("L3 限额：每种子最多 l3SpreadLimit 条", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false, domains: { enabled: true, router: { provider: "custom", route: routeToEcon }, l3SpreadLimit: 1 } },
  });
  try {
    const u = mem.forUser("bob");
    const a = (await u.write({ layer: "semantic", content: "deadline 经济衰退", source: { authoritative: false, origin: "test" } })).id;
    const c1 = (await u.write({ layer: "semantic", content: "关联记忆甲", source: { authoritative: false, origin: "test" } })).id;
    const c2 = (await u.write({ layer: "semantic", content: "关联记忆乙", source: { authoritative: false, origin: "test" } })).id;
    const s = mem.raw().storage;
    s.updateRelated(TENANT, "bob", "semantic", a, [c1, c2]); // A 有两条关联
    s.ensureGlobalDomain(TENANT, "bob");
    s.upsertDomain(TENANT, "bob", domain("d_econ", "经济", "bob"));
    s.setMemoryDomains(TENANT, "bob", a, [{ memory_id: a, domain_id: "d_econ", membership_weight: 1, is_primary: true }]);
    const r = await u.search("deadline", { topK: 50 });
    const spread = r.filter((m) => m.id === c1 || m.id === c2);
    assert.equal(spread.length, 1, "限额 1：两条关联里只纳入 1 条");
  } finally {
    mem.close();
  }
});
