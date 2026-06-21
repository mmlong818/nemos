// v0.6 companion-moe-guard.test.ts — 守卫：MOE 领域路由不被应用层悄悄关掉。
//
// 记忆系统(Nemos)是本体、陪伴是其上的应用。MOE（记忆按领域分桶、检索只把匹配
// 领域升顶）是核心能力，必须随应用演进一直在线。这里两层守卫：
//   A. 契约：陪伴依赖的能力配置（单一来源 memory-config.ts）确实开着 domains。
//   B. 端到端：拿陪伴的「真实」feature 配置 + 真实 centroid 路由跑一次召回，
//      证明匹配领域的记忆被升顶、无关领域软降权未剔除。
// 若谁在 memory-config.ts 把 domains 关掉 / 换走路由器，A 立刻红；若 SDK 的
// 装配回归，B 立刻红。SDK 四级激活的机制本身另由 v05 read-path.test.ts 证。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";
import { COMPANION_MEMORY_FEATURES } from "../../../examples/companion/memory-config.js";

const TENANT = "default";

// ── A. 契约守卫 ──────────────────────────────────────────────────────────────
test("v0.6 MOE 守卫：陪伴能力配置确实开着 domains 路由（单一来源）", () => {
  assert.equal(
    COMPANION_MEMORY_FEATURES.domains?.enabled,
    true,
    "陪伴 App 依赖 MOE 领域路由；不得在应用层关闭 features.domains",
  );
  assert.equal(
    COMPANION_MEMORY_FEATURES.domains?.router?.provider,
    "centroid",
    "陪伴用 centroid 路由（热路径零额外 LLM 延迟）；换走需同步更新此守卫与理由",
  );
  // 「从不踩雷」的两条同样是 App 契约，一并钉住，避免被一起改掉。
  assert.equal(COMPANION_MEMORY_FEATURES.reflect?.enabled, true, "reflect 整合不得关");
  assert.equal(COMPANION_MEMORY_FEATURES.invalidation?.enabled, true, "矛盾失效不得关");
});

// ── B. 端到端：陪伴真实配置 → centroid 路由真的重排 ──────────────────────────
// 确定性 embedding：dim=4，index0 恒为 1（让同 query 能召回全部，证明 soft 不剔除），
// index1=医疗向量、index2=经济向量。query 偏医疗 → centroid 路由到医疗领域。
const DIM = 4;
function det(text: string): Float32Array {
  const v = new Float32Array(DIM);
  v[0] = 1;
  if (/失眠|焦虑|抑郁|医疗|健康/.test(text)) v[1] = 1;
  if (/经济|通胀|萧条|失业|衰退/.test(text)) v[2] = 1;
  return v;
}
const detEmbedding = {
  provider: "custom" as const,
  embed: async (text: string): Promise<Float32Array> => det(text),
  modelId: "det-test",
  dim: DIM,
};

test("v0.6 MOE 守卫：陪伴配置端到端 → 匹配领域升顶、无关领域软降权未剔除", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    embedding: detEmbedding,
    features: COMPANION_MEMORY_FEATURES, // ← 陪伴 App 的真实能力配置
    worker: { manualWorker: true }, // 不让 reflect 后台自动跑，保持确定性
  });
  try {
    const user = "alice";
    const um = mem.forUser(user);
    const med = (await um.write({ layer: "semantic", content: "deadline 失眠焦虑抑郁", source: { authoritative: false, origin: "test" } })).id;
    const econ1 = (await um.write({ layer: "semantic", content: "deadline 经济衰退失业", source: { authoritative: false, origin: "test" } })).id;
    const econ2 = (await um.write({ layer: "semantic", content: "deadline 通胀萧条", source: { authoritative: false, origin: "test" } })).id;

    const s = mem.raw().storage;
    const now = "2026-01-01T00:00:00.000Z";
    s.ensureGlobalDomain(TENANT, user);
    // prototype_vec 用 index1/index2 单位向量 → centroid 路由按 query 偏向选 L1。
    s.upsertDomain(TENANT, user, { id: "d_med", tenant_id: TENANT, user_id: user, label: "医疗", prototype_vec: Float32Array.from([0, 1, 0, 0]), level: 0, status: "warm", origin: "emergent", always_on: false, load_count: 0, retrievability: 1, created_at: now, updated_at: now });
    s.upsertDomain(TENANT, user, { id: "d_econ", tenant_id: TENANT, user_id: user, label: "经济", prototype_vec: Float32Array.from([0, 0, 1, 0]), level: 0, status: "warm", origin: "emergent", always_on: false, load_count: 0, retrievability: 1, created_at: now, updated_at: now });
    s.setMemoryDomains(TENANT, user, med, [{ memory_id: med, domain_id: "d_med", membership_weight: 1, is_primary: true }]);
    s.setMemoryDomains(TENANT, user, econ1, [{ memory_id: econ1, domain_id: "d_econ", membership_weight: 1, is_primary: true }]);
    s.setMemoryDomains(TENANT, user, econ2, [{ memory_id: econ2, domain_id: "d_econ", membership_weight: 1, is_primary: true }]);

    // query 偏医疗 → centroid 路由 L1=医疗 → 医疗记忆升顶。
    const r = await um.search("deadline 失眠焦虑", { topK: 50 });
    assert.equal(r[0]?.id, med, "匹配领域（医疗）记忆被 centroid 路由升顶");
    const got = new Set(r.map((m) => m.id));
    assert.ok(got.has(econ1) && got.has(econ2), "无关领域（经济）软降权但未被剔除——隔离非牢笼");
  } finally {
    mem.close();
  }
});
