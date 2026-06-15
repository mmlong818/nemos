// v0.5 reflect-evolution.test.ts
// 验证 reflect 离线层：领域 birth/split/merge/sleep（RFC 0005 §6）+ 前瞻预测-验证闭环（RFC 0006 §5）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStorage } from "../../../src/index.js";
import {
  runDomainEvolution,
  runProspectiveVerification,
  splitDomains,
  mergeDomains,
  sleepDomains,
  recomputeCentroids,
} from "../../../src/reflect-domain.js";
import type { LLMProvider, Memory, Prospective, Domain } from "../../../src/index.js";

const T = "t1";
const U = "u1";
const noop = (): void => {};

function ep(id: string, content: string): Memory {
  return {
    id,
    layer: "episodic",
    type: "user",
    scope: "global",
    content,
    source: { authoritative: true, kind: "authoritative", origin: "user", chain_depth: 0 },
    arousal: { value: 0.5, signal_sources: [] },
    surprise: { value: 0.5, basis: "" },
    ownership: { kind: "self" },
    created_at: "2026-01-01T00:00:00.000Z",
    last_accessed: "2026-01-01T00:00:00.000Z",
    access_count: 0,
    stability: 1,
    schema_version: "0.5",
  };
}

function dom(id: string, vec: number[] | null, created: string, lastRouted?: string): Domain {
  return {
    id,
    tenant_id: T,
    user_id: U,
    label: id,
    prototype_vec: vec ? new Float32Array(vec) : null,
    parent_id: undefined,
    level: 0,
    status: "warm",
    origin: "emergent",
    always_on: false,
    load_count: 0,
    retrievability: 1,
    last_routed_at: lastRouted,
    created_at: created,
    updated_at: created,
  };
}

function mockLLM(handler: (system: string, user: string) => string): LLMProvider {
  return { name: "mock", chat: async (s, u) => handler(s, u) };
}

// ── birth ──────────────────────────────────────────────────────────────────
test("runDomainEvolution birth：同标签 ≥ 成团数 → 建领域 + 归属记忆", async () => {
  const s = new InMemoryStorage();
  for (let i = 0; i < 3; i++) {
    const m = ep(`ep_${i}`, `医疗记忆 ${i}`);
    s.insert(T, U, m);
    s.insertEmbedding(T, U, "episodic", m.id, new Float32Array([1, 0, 0]), "mock");
  }
  const llm = mockLLM((sys) => {
    if (sys.includes("领域分类器")) {
      return JSON.stringify([
        { index: 0, label: "医疗" },
        { index: 1, label: "医疗" },
        { index: 2, label: "医疗" },
      ]);
    }
    return "{}";
  });
  const r = await runDomainEvolution(s, llm, null, noop, { tenantId: T, userId: U, defaultScope: "global" }, { enabled: true, minClusterSize: 3 });
  assert.equal(r.born, 1, "应诞生 1 个领域");
  const doms = s.listDomains(T, U).filter((d) => d.label === "医疗");
  assert.equal(doms.length, 1);
  const members = s.getDomainMemberIds(T, U, doms[0].id);
  assert.equal(members.length, 3, "3 条记忆归属新领域");
});

test("runDomainEvolution birth 防抖：不足成团数 → 不建领域", async () => {
  const s = new InMemoryStorage();
  for (let i = 0; i < 2; i++) {
    const m = ep(`ep_${i}`, `孤记忆 ${i}`);
    s.insert(T, U, m);
    s.insertEmbedding(T, U, "episodic", m.id, new Float32Array([1, 0, 0]), "mock");
  }
  const llm = mockLLM((sys) =>
    sys.includes("领域分类器")
      ? JSON.stringify([{ index: 0, label: "杂" }, { index: 1, label: "杂" }])
      : "{}",
  );
  const r = await runDomainEvolution(s, llm, null, noop, { tenantId: T, userId: U, defaultScope: "global" }, { enabled: true, minClusterSize: 3 });
  assert.equal(r.born, 0, "2 < 3 不建领域（防抖）");
});

// ── recomputeCentroids ───────────────────────────────────────────────────────
test("recomputeCentroids：质心 = 成员 embedding 均值", () => {
  const s = new InMemoryStorage();
  s.upsertDomain(T, U, dom("d1", [0, 0, 0], "2026-01-01T00:00:00.000Z"));
  const m1 = ep("m1", "a");
  const m2 = ep("m2", "b");
  s.insert(T, U, m1);
  s.insert(T, U, m2);
  s.insertEmbedding(T, U, "episodic", "m1", new Float32Array([1, 0, 0]), "mock");
  s.insertEmbedding(T, U, "episodic", "m2", new Float32Array([0, 1, 0]), "mock");
  s.setMemoryDomains(T, U, "m1", [{ memory_id: "m1", domain_id: "d1", membership_weight: 1, is_primary: true }]);
  s.setMemoryDomains(T, U, "m2", [{ memory_id: "m2", domain_id: "d1", membership_weight: 1, is_primary: true }]);
  const n = recomputeCentroids(s, noop, T, U);
  assert.equal(n, 1);
  const d = s.getDomain(T, U, "d1");
  assert.ok(d?.prototype_vec);
  assert.ok(Math.abs(d.prototype_vec[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(d.prototype_vec[1] - 0.5) < 1e-6);
});

// ── split ────────────────────────────────────────────────────────────────────
test("splitDomains：过载且双峰 → 裂子领域，parent_id 回指", () => {
  const s = new InMemoryStorage();
  const created = "2026-01-01T00:00:00.000Z";
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z"); // > 最小存活期
  s.upsertDomain(T, U, dom("d_big", [1, 0, 0], created));
  // 4 条近 [1,0,0]，4 条近 [0,1,0] → 明显双峰
  for (let i = 0; i < 8; i++) {
    const id = `m_${i}`;
    s.insert(T, U, ep(id, `mem ${i}`));
    const vec = i < 4 ? [1, 0, 0] : [0, 1, 0];
    s.insertEmbedding(T, U, "episodic", id, new Float32Array(vec), "mock");
    s.setMemoryDomains(T, U, id, [{ memory_id: id, domain_id: "d_big", membership_weight: 1, is_primary: true }]);
  }
  const n = splitDomains(s, noop, T, U, nowMs);
  assert.equal(n, 1, "应裂 1 次");
  const all = s.listDomains(T, U, { includeCold: true });
  const child = all.find((d) => d.parent_id === "d_big");
  assert.ok(child, "应有子领域回指 d_big");
  assert.equal(child.level, 1);
});

test("splitDomains 防抖：新领域（未过最小存活期）不裂", () => {
  const s = new InMemoryStorage();
  const created = "2026-02-28T00:00:00.000Z";
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z"); // 仅 1 天 < 7 天
  s.upsertDomain(T, U, dom("d_new", [1, 0, 0], created));
  for (let i = 0; i < 8; i++) {
    const id = `m_${i}`;
    s.insert(T, U, ep(id, `mem ${i}`));
    s.insertEmbedding(T, U, "episodic", id, new Float32Array(i < 4 ? [1, 0, 0] : [0, 1, 0]), "mock");
    s.setMemoryDomains(T, U, id, [{ memory_id: id, domain_id: "d_new", membership_weight: 1, is_primary: true }]);
  }
  assert.equal(splitDomains(s, noop, T, U, nowMs), 0, "未过存活期不裂（防抖）");
});

// ── merge ────────────────────────────────────────────────────────────────────
test("mergeDomains：高 affinity + 成员交叠大 → 合并，被并方沉 cold", () => {
  const s = new InMemoryStorage();
  const created = "2026-01-01T00:00:00.000Z";
  s.upsertDomain(T, U, dom("d_a", [1, 0, 0], created));
  s.upsertDomain(T, U, dom("d_b", [1, 0, 0], created));
  // 3 条记忆同时属 a、b（交叠 100%）
  for (let i = 0; i < 3; i++) {
    const id = `m_${i}`;
    s.insert(T, U, ep(id, `mem ${i}`));
    s.insertEmbedding(T, U, "episodic", id, new Float32Array([1, 0, 0]), "mock");
    s.setMemoryDomains(T, U, id, [
      { memory_id: id, domain_id: "d_a", membership_weight: 1, is_primary: true },
      { memory_id: id, domain_id: "d_b", membership_weight: 1, is_primary: false },
    ]);
  }
  s.upsertAffinity(T, U, "d_a", "d_b", 0.9, created);
  const n = mergeDomains(s, noop, T, U);
  assert.equal(n, 1, "应合并 1 次");
  const b = s.getDomain(T, U, "d_b");
  assert.equal(b?.status, "cold", "被并方沉 cold（反固化，不删除）");
  assert.ok(b !== null, "被并方仍存在（未物理删除）");
});

// ── sleep ────────────────────────────────────────────────────────────────────
test("sleepDomains：长期未命中 → 沉 cold 降权", () => {
  const s = new InMemoryStorage();
  const created = "2026-01-01T00:00:00.000Z";
  const nowMs = Date.parse("2026-06-01T00:00:00.000Z"); // 距今 > 30 天空闲
  s.upsertDomain(T, U, dom("d_idle", [1, 0, 0], created, "2026-01-05T00:00:00.000Z"));
  const n = sleepDomains(s, noop, T, U, nowMs);
  assert.equal(n, 1);
  const d = s.getDomain(T, U, "d_idle");
  assert.equal(d?.status, "cold");
  assert.ok((d?.retrievability ?? 1) <= 0.2, "retrievability 被敲低");
});

test("sleepDomains 防抖：近期命中的领域不沉睡", () => {
  const s = new InMemoryStorage();
  const created = "2026-01-01T00:00:00.000Z";
  const nowMs = Date.parse("2026-06-01T00:00:00.000Z");
  s.upsertDomain(T, U, dom("d_active", [1, 0, 0], created, "2026-05-30T00:00:00.000Z")); // 2 天前命中
  assert.equal(sleepDomains(s, noop, T, U, nowMs), 0);
});

// ── 前瞻预测-验证闭环 ─────────────────────────────────────────────────────────
test("runProspectiveVerification：pending 预测被现实验证 → resolve + 算 surprise + 下调 confidence", async () => {
  const s = new InMemoryStorage();
  const p: Prospective = {
    id: "p1",
    tenant_id: T,
    user_id: U,
    scope: "global",
    domain_ids: [],
    cue: "截稿临近时会怎样",
    projection: "熬夜赶工、焦虑上升",
    confidence: 0.6,
    evidence_refs: [],
    prediction_log: [{ predicted_at: "2026-01-01T00:00:00.000Z", predicted: "熬夜赶工", resolved: false }],
    retrievability: 1,
    status: "crystallized",
    created_at: "2026-01-01T00:00:00.000Z",
    last_accessed: "2026-01-01T00:00:00.000Z",
  };
  s.insertProspective(T, U, p);
  const recent = [ep("ep_real", "这次提前两天就交稿了，全程很从容，没怎么熬夜")];
  const llm = mockLLM((sys) =>
    sys.includes("前瞻预测验证器")
      ? JSON.stringify({ occurred: true, actual: "提前从容完成", surprise: 0.8 })
      : "{}",
  );
  const r = await runProspectiveVerification(s, llm, noop, { tenantId: T, userId: U }, recent);
  assert.equal(r.verified, 1);
  const upd = s.getProspective(T, U, "p1");
  assert.equal(upd?.prediction_log[0].resolved, true, "pending → resolved");
  assert.equal(upd?.prediction_log[0].surprise, 0.8);
  assert.equal(upd?.prediction_log[0].actual, "提前从容完成");
  assert.ok((upd?.confidence ?? 1) < 0.6, "confidence 因高 surprise 下调");
  assert.ok(upd?.last_verified_at, "记录验证时间");
});

test("runProspectiveVerification：现实未匹配 → 不动 pending", async () => {
  const s = new InMemoryStorage();
  const p: Prospective = {
    id: "p1",
    tenant_id: T,
    user_id: U,
    scope: "global",
    domain_ids: [],
    cue: "截稿",
    projection: "熬夜",
    confidence: 0.6,
    evidence_refs: [],
    prediction_log: [{ predicted_at: "x", predicted: "熬夜", resolved: false }],
    retrievability: 1,
    status: "crystallized",
    created_at: "2026-01-01T00:00:00.000Z",
    last_accessed: "2026-01-01T00:00:00.000Z",
  };
  s.insertProspective(T, U, p);
  const llm = mockLLM((sys) =>
    sys.includes("前瞻预测验证器")
      ? JSON.stringify({ occurred: false, actual: "", surprise: 0 })
      : "{}",
  );
  const r = await runProspectiveVerification(s, llm, noop, { tenantId: T, userId: U }, [ep("e", "无关事件")]);
  assert.equal(r.verified, 0);
  const upd = s.getProspective(T, U, "p1");
  assert.equal(upd?.prediction_log[0].resolved, false, "未匹配 → pending 不变");
});
