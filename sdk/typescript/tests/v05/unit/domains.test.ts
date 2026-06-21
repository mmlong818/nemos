// v0.5 domains.test.ts
// 验证：resolveDomainsConfig/resolveProspectiveConfig 默认值；rerankByActivation
// 四级权重 + 逃生阀 + soft 降权不剔除；buildProspectiveContext minConfidence 过滤 + 标注。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDomainsConfig,
  resolveProspectiveConfig,
  rerankByActivation,
  buildProspectiveContext,
  DOMAINS_DEFAULTS,
  PROSPECTIVE_DEFAULTS,
} from "../../../src/domains.js";
import { GLOBAL_DOMAIN_ID, type Memory, type NemosConfig, type Prospective, type RouteResult } from "../../../src/types.js";

function mem(id: string): Memory {
  return {
    id,
    layer: "semantic",
    type: "user",
    scope: "global",
    content: id,
    source: { authoritative: false, kind: "derived", origin: "x", chain_depth: 1 },
    arousal: { value: 0, signal_sources: [] },
    surprise: { value: 0, basis: "" },
    ownership: { kind: "self" },
    created_at: "2026-01-01T00:00:00.000Z",
    last_accessed: "2026-01-01T00:00:00.000Z",
    access_count: 0,
    stability: 1,
    schema_version: "0.5",
  };
}

const baseConfig: NemosConfig = {
  storage: { type: "memory" },
  llm: { provider: "custom", chat: async () => "{}" },
};

test("resolveDomainsConfig 默认全部保守值", () => {
  const c = resolveDomainsConfig(baseConfig);
  assert.equal(c.enabled, false);
  assert.equal(c.routeConfidenceThreshold, DOMAINS_DEFAULTS.routeConfidenceThreshold);
  assert.equal(c.l2Max, 3);
  assert.equal(c.l3SpreadLimit, 5);
});

test("resolveProspectiveConfig 默认全部保守值", () => {
  const c = resolveProspectiveConfig(baseConfig);
  assert.equal(c.enabled, false);
  assert.equal(c.minConfidence, PROSPECTIVE_DEFAULTS.minConfidence);
  assert.equal(c.onDemand, false);
});

test("resolveDomainsConfig 读取用户覆盖值", () => {
  const c = resolveDomainsConfig({
    ...baseConfig,
    features: { domains: { enabled: true, routeConfidenceThreshold: 0.5, l2Max: 2 } },
  });
  assert.equal(c.enabled, true);
  assert.equal(c.routeConfidenceThreshold, 0.5);
  assert.equal(c.l2Max, 2);
});

test("rerankByActivation 逃生阀：fallback 时原样返回", () => {
  const mems = [mem("a"), mem("b"), mem("c")];
  const route: RouteResult = { l1: "d1", l2: [], confidence: 0.9, fallback: true };
  const out = rerankByActivation(mems, route, () => ["d1"], 0.35);
  assert.deepEqual(out.map((m) => m.id), ["a", "b", "c"]);
});

test("rerankByActivation 逃生阀：低置信原样返回", () => {
  const mems = [mem("a"), mem("b")];
  const route: RouteResult = { l1: "d1", l2: [], confidence: 0.2, fallback: false };
  const out = rerankByActivation(mems, route, () => ["d1"], 0.35);
  assert.deepEqual(out.map((m) => m.id), ["a", "b"]);
});

test("rerankByActivation：L1 领域记忆升顶，非激活领域降权但不剔除（soft）", () => {
  // 原始顺序：econ 在前，med 在后；路由到 med 后 med 应升顶，econ 仍在结果里
  const mems = [mem("econ1"), mem("econ2"), mem("med1")];
  const membership: Record<string, string[]> = {
    econ1: ["dom_econ"],
    econ2: ["dom_econ"],
    med1: ["dom_med"],
  };
  const route: RouteResult = { l1: "dom_med", l2: [], confidence: 0.9, fallback: false };
  const out = rerankByActivation(mems, route, (id) => membership[id] ?? [], 0.35);
  assert.equal(out[0].id, "med1", "L1 领域记忆应升到第一");
  assert.equal(out.length, 3, "非激活领域记忆不被剔除（soft）");
  assert.ok(out.some((m) => m.id === "econ1"));
});

test("rerankByActivation：L2 权重高于无关领域", () => {
  const mems = [mem("other"), mem("adj"), mem("main")];
  const membership: Record<string, string[]> = {
    other: ["dom_x"],
    adj: ["dom_adj"],
    main: ["dom_main"],
  };
  const route: RouteResult = { l1: "dom_main", l2: ["dom_adj"], confidence: 0.9, fallback: false };
  const out = rerankByActivation(mems, route, (id) => membership[id] ?? [], 0.35);
  // main(L1=0.9) > adj(L2=0.6) > other(0.3)
  assert.deepEqual(out.map((m) => m.id), ["main", "adj", "other"]);
});

test("rerankByActivation：GLOBAL 共享层恒高权重", () => {
  const mems = [mem("g"), mem("m")];
  const membership: Record<string, string[]> = {
    g: [GLOBAL_DOMAIN_ID],
    m: ["dom_med"],
  };
  const route: RouteResult = { l1: "dom_med", l2: [], confidence: 0.9, fallback: false };
  const out = rerankByActivation(mems, route, (id) => membership[id] ?? [], 0.35);
  // GLOBAL=1.0 > L1=0.9 → g 在前
  assert.equal(out[0].id, "g");
});

function prosp(id: string, confidence: number): { prospective: Prospective; score: number } {
  return {
    score: 1,
    prospective: {
      id,
      tenant_id: "t",
      user_id: "u",
      scope: "global",
      domain_ids: [],
      cue: `cue-${id}`,
      projection: `proj-${id}`,
      confidence,
      evidence_refs: [],
      prediction_log: [],
      retrievability: 1,
      status: "crystallized",
      created_at: "2026-01-01T00:00:00.000Z",
      last_accessed: "2026-01-01T00:00:00.000Z",
    },
  };
}

test("buildProspectiveContext：过滤低置信 + 带 kind=prospective 标注", () => {
  const items = [prosp("hi", 0.7), prosp("lo", 0.2)];
  const lines = buildProspectiveContext(items, 0.4);
  assert.equal(lines.length, 1, "低于 minConfidence 的被过滤");
  assert.match(lines[0], /\[prospective \| AI预测·置信0\.70\]/);
  assert.match(lines[0], /cue-hi/);
  assert.match(lines[0], /proj-hi/);
});
