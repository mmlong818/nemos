// v0.5 storage-domain.test.ts
// 验证领域 + 前瞻 storage 方法在 InMemoryStorage 与 SqliteStorage(:memory:) 双实现下行为一致。

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStorage, SqliteStorage } from "../../../src/index.js";
import {
  GLOBAL_DOMAIN_ID,
  type Domain,
  type Prospective,
  type Storage,
} from "../../../src/index.js";

const T = "t1";
const U = "u1";

function makeDomain(id: string, label: string, status: Domain["status"] = "warm"): Domain {
  return {
    id,
    tenant_id: T,
    user_id: U,
    label,
    prototype_vec: new Float32Array([1, 0, 0]),
    parent_id: undefined,
    level: 0,
    status,
    origin: "emergent",
    always_on: false,
    load_count: 0,
    retrievability: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function makeProspective(id: string, cue: string, confidence: number): Prospective {
  return {
    id,
    tenant_id: T,
    user_id: U,
    scope: "global",
    domain_ids: ["d_med"],
    cue,
    cue_vec: new Float32Array([1, 0, 0]),
    projection: `proj-${id}`,
    confidence,
    evidence_refs: ["ep_1"],
    prediction_log: [],
    retrievability: 1,
    status: "crystallized",
    created_at: "2026-01-01T00:00:00.000Z",
    last_accessed: "2026-01-01T00:00:00.000Z",
  };
}

function runSuite(name: string, make: () => Storage): void {
  test(`[${name}] ensureGlobalDomain 幂等 + always_on`, () => {
    const s = make();
    const g1 = s.ensureGlobalDomain(T, U);
    const g2 = s.ensureGlobalDomain(T, U);
    assert.equal(g1.id, GLOBAL_DOMAIN_ID);
    assert.equal(g1.always_on, true);
    assert.equal(g2.id, GLOBAL_DOMAIN_ID);
    // 只应有一条 GLOBAL
    const all = s.listDomains(T, U, { includeCold: true });
    assert.equal(all.filter((d) => d.id === GLOBAL_DOMAIN_ID).length, 1);
    s.close();
  });

  test(`[${name}] upsert/get domain + 质心往返`, () => {
    const s = make();
    s.upsertDomain(T, U, makeDomain("d_med", "医疗"));
    const got = s.getDomain(T, U, "d_med");
    assert.ok(got);
    assert.equal(got.label, "医疗");
    assert.ok(got.prototype_vec);
    assert.equal(got.prototype_vec.length, 3);
    assert.equal(got.prototype_vec[0], 1);
    s.close();
  });

  test(`[${name}] listDomains 默认排除 cold，includeCold 取全集`, () => {
    const s = make();
    s.upsertDomain(T, U, makeDomain("d_hot", "热", "warm"));
    s.upsertDomain(T, U, makeDomain("d_cold", "冷", "cold"));
    const active = s.listDomains(T, U);
    assert.ok(active.some((d) => d.id === "d_hot"));
    assert.ok(!active.some((d) => d.id === "d_cold"), "默认应排除 cold");
    const all = s.listDomains(T, U, { includeCold: true });
    assert.ok(all.some((d) => d.id === "d_cold"));
    s.close();
  });

  test(`[${name}] setMemoryDomains / getMemoryDomainsFor / getDomainMemberIds`, () => {
    const s = make();
    s.setMemoryDomains(T, U, "m1", [
      { memory_id: "m1", domain_id: "d_med", membership_weight: 1, is_primary: true },
      { memory_id: "m1", domain_id: "d_econ", membership_weight: 0.5, is_primary: false },
    ]);
    s.setMemoryDomains(T, U, "m2", [
      { memory_id: "m2", domain_id: "d_med", membership_weight: 1, is_primary: true },
    ]);
    const links = s.getMemoryDomainsFor(T, U, ["m1"]);
    assert.equal(links.length, 2);
    const members = s.getDomainMemberIds(T, U, "d_med").sort();
    assert.deepEqual(members, ["m1", "m2"]);
    // 覆盖式：重写 m1 只留 d_econ
    s.setMemoryDomains(T, U, "m1", [
      { memory_id: "m1", domain_id: "d_econ", membership_weight: 1, is_primary: true },
    ]);
    assert.deepEqual(s.getDomainMemberIds(T, U, "d_med").sort(), ["m2"]);
    s.close();
  });

  test(`[${name}] upsertAffinity 累加 + 无向归一`, () => {
    const s = make();
    s.upsertAffinity(T, U, "b", "a", 0.3, "2026-01-01T00:00:00.000Z"); // 传入顺序反的
    s.upsertAffinity(T, U, "a", "b", 0.4, "2026-01-02T00:00:00.000Z");
    const affs = s.listAffinities(T, U, "a");
    assert.equal(affs.length, 1, "无向归一应只有一条边");
    assert.ok(Math.abs(affs[0].affinity - 0.7) < 1e-6, "累加 0.3+0.4=0.7");
    s.close();
  });

  test(`[${name}] touchDomainRouted 增计数 + 记时间`, () => {
    const s = make();
    s.upsertDomain(T, U, makeDomain("d_med", "医疗"));
    s.touchDomainRouted(T, U, "d_med", "2026-02-02T00:00:00.000Z");
    const d = s.getDomain(T, U, "d_med");
    assert.equal(d?.load_count, 1);
    assert.equal(d?.last_routed_at, "2026-02-02T00:00:00.000Z");
    s.close();
  });

  test(`[${name}] prospective CRUD + updateProspective`, () => {
    const s = make();
    s.insertProspective(T, U, makeProspective("p1", "截稿临近", 0.6));
    const got = s.getProspective(T, U, "p1");
    assert.ok(got);
    assert.equal(got.confidence, 0.6);
    assert.deepEqual(got.evidence_refs, ["ep_1"]);
    s.updateProspective(T, U, "p1", {
      confidence: 0.42,
      prediction_log: [{ predicted_at: "x", predicted: "p", actual: "a", surprise: 0.8, resolved: true }],
    });
    const upd = s.getProspective(T, U, "p1");
    assert.equal(upd?.confidence, 0.42);
    assert.equal(upd?.prediction_log.length, 1);
    assert.equal(upd?.prediction_log[0].resolved, true);
    assert.equal(upd?.prediction_log[0].surprise, 0.8);
    s.close();
  });

  test(`[${name}] searchProspectiveByCue 向量匹配（全局，不按领域）`, () => {
    const s = make();
    s.insertProspective(T, U, makeProspective("p_near", "近", 0.6));
    const far = makeProspective("p_far", "远", 0.6);
    far.cue_vec = new Float32Array([0, 0, 1]);
    s.insertProspective(T, U, far);
    const hits = s.searchProspectiveByCue(T, U, "q", new Float32Array([1, 0, 0]), 5);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].prospective.id, "p_near", "最近 cue 向量排第一");
    s.close();
  });

  test(`[${name}] 跨 user 隔离`, () => {
    const s = make();
    s.upsertDomain(T, U, makeDomain("d_med", "医疗"));
    const other = s.listDomains(T, "OTHER_USER", { includeCold: true });
    assert.equal(other.length, 0, "其它 user 看不到");
    s.close();
  });
}

runSuite("memory", () => new InMemoryStorage());
runSuite("sqlite", () => new SqliteStorage(":memory:"));
