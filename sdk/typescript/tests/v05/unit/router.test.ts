// v0.5 router.test.ts
// 验证：LLMRouter 无领域→fallback、合法 JSON 解析、编造 id 过滤、LLM 错误→fallback；
// CentroidRouter queryVec=null→fallback、cosine 路由到最近领域。

import { test } from "node:test";
import assert from "node:assert/strict";
import { LLMRouter, CentroidRouter, createRouter } from "../../../src/router.js";
import { GLOBAL_DOMAIN_ID, type Domain, type LLMProvider } from "../../../src/types.js";

function dom(id: string, vec?: number[]): Domain {
  return {
    id,
    tenant_id: "t",
    user_id: "u",
    label: id,
    prototype_vec: vec ? new Float32Array(vec) : null,
    parent_id: undefined,
    level: 0,
    status: "warm",
    origin: "emergent",
    always_on: false,
    load_count: 0,
    retrievability: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const globalDom: Domain = { ...dom(GLOBAL_DOMAIN_ID), always_on: true, status: "hot", origin: "seed" };

function mockLLM(reply: string | (() => Promise<string>)): LLMProvider {
  return {
    name: "mock",
    chat: typeof reply === "string" ? async () => reply : reply,
  };
}

test("LLMRouter：无候选领域（只有 GLOBAL）→ fallback", async () => {
  const r = new LLMRouter(mockLLM('{"l1":"x","l2":[],"confidence":0.9}'));
  const out = await r.route("q", null, [globalDom]);
  assert.equal(out.fallback, true);
  assert.equal(out.l1, null);
});

test("LLMRouter：合法 JSON 正确解析 L1/L2/confidence", async () => {
  const domains = [globalDom, dom("d_med"), dom("d_econ"), dom("d_geo")];
  const r = new LLMRouter(
    mockLLM('{"l1":"d_med","l2":["d_econ"],"confidence":0.8}'),
  );
  const out = await r.route("抑郁失眠", null, domains);
  assert.equal(out.fallback, false);
  assert.equal(out.l1, "d_med");
  assert.deepEqual(out.l2, ["d_econ"]);
  assert.equal(out.confidence, 0.8);
});

test("LLMRouter：编造的 id 被过滤（L1 编造→fallback）", async () => {
  const domains = [globalDom, dom("d_med")];
  const r = new LLMRouter(mockLLM('{"l1":"d_FAKE","l2":["d_ALSO_FAKE"],"confidence":0.9}'));
  const out = await r.route("q", null, domains);
  assert.equal(out.fallback, true, "L1 不在候选中 → fallback");
});

test("LLMRouter：L2 编造 id 被过滤但 L1 合法仍生效", async () => {
  const domains = [globalDom, dom("d_med"), dom("d_econ")];
  const r = new LLMRouter(mockLLM('{"l1":"d_med","l2":["d_FAKE","d_econ"],"confidence":0.7}'));
  const out = await r.route("q", null, domains);
  assert.equal(out.l1, "d_med");
  assert.deepEqual(out.l2, ["d_econ"], "编造的 L2 id 被过滤");
});

test("LLMRouter：LLM 抛错 → fallback", async () => {
  const domains = [globalDom, dom("d_med")];
  const r = new LLMRouter(
    mockLLM(async () => {
      throw new Error("llm down");
    }),
  );
  const out = await r.route("q", null, domains);
  assert.equal(out.fallback, true);
});

test("LLMRouter：解析失败（非 JSON）→ fallback", async () => {
  const domains = [globalDom, dom("d_med")];
  const r = new LLMRouter(mockLLM("not json at all"));
  const out = await r.route("q", null, domains);
  assert.equal(out.fallback, true);
});

test("CentroidRouter：queryVec=null → fallback", async () => {
  const r = new CentroidRouter();
  const out = await r.route("q", null, [dom("d", [1, 0, 0])]);
  assert.equal(out.fallback, true);
});

test("CentroidRouter：cosine 路由到最近质心的领域", async () => {
  const domains = [
    globalDom, // 无质心，应被忽略
    dom("d_med", [1, 0, 0]),
    dom("d_econ", [0, 1, 0]),
    dom("d_geo", [0, 0, 1]),
  ];
  const r = new CentroidRouter();
  const out = await r.route("q", new Float32Array([0.9, 0.1, 0]), domains);
  assert.equal(out.fallback, false);
  assert.equal(out.l1, "d_med", "应路由到最近的 d_med");
  assert.ok(out.confidence > 0.5);
});

test("CentroidRouter：无质心领域 → fallback", async () => {
  const r = new CentroidRouter();
  const out = await r.route("q", new Float32Array([1, 0, 0]), [globalDom, dom("d_no_vec")]);
  assert.equal(out.fallback, true);
});

test("createRouter：按 provider 分发", () => {
  const llm = mockLLM("{}");
  assert.equal(createRouter({ provider: "llm" }, llm).name, "llm-router");
  assert.equal(createRouter({ provider: "centroid" }, llm).name, "centroid-router");
  const custom = createRouter(
    { provider: "custom", route: async () => ({ l1: null, l2: [], confidence: 0, fallback: true }), name: "my" },
    llm,
  );
  assert.equal(custom.name, "my");
});
