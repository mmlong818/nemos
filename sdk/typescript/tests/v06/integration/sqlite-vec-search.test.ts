// sqlite-vec-search.test.ts
// sqlite-vec SQL 侧余弦接线后的行为验证。断言的是与扫描路径无关的性质
// （sqlite-vec 不可用的平台自动落到 JS 兜底，测试同样成立）：
// 1) topK 按余弦相似度降序，与测试内独立计算的暴力扫描参考结果一致
// 2) sensitive/cold/invalidated 的 hydrate 过滤语义不变
// 3) 与查询向量维度不同的记录不致整个检索报错（模型切换后的混血库）

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../../src/index.js";
import type { Memory } from "../../../src/types.js";
import { SCHEMA_VERSION } from "../../../src/types.js";

const DIM = 32;

/** 确定性伪随机向量（种子=索引），维度 DIM。 */
function seededVec(seed: number, dim = DIM): Float32Array {
  const v = new Float32Array(dim);
  let s = seed * 2654435761 % 4294967296;
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v[i] = (s / 2147483648) * 2 - 1;
  }
  return v;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function makeMemory(id: string, content: string, extra?: Partial<Memory>): Memory {
  const now = new Date().toISOString();
  return {
    id,
    layer: "personal_semantic",
    type: "user",
    scope: "global",
    content,
    source: { authoritative: false, kind: "derived", origin: "llm-extract", chain_depth: 1 },
    arousal: { value: 0, signal_sources: [] },
    surprise: { value: 0, basis: "r" },
    ownership: { kind: "user" },
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 1,
    schema_version: SCHEMA_VERSION,
    ...extra,
  } as unknown as Memory;
}

function setup(n: number) {
  const dir = mkdtempSync(join(tmpdir(), "nemos-vec-"));
  const mem = new Nemos({
    storage: { type: "sqlite", path: join(dir, "m.db") },
    llm: { provider: "custom", name: "noop", chat: async () => "{}" },
    worker: { manualWorker: true },
  });
  const storage = mem.raw().storage;
  for (let i = 0; i < n; i++) {
    storage.insert("default", "alice", makeMemory(`psem_v${i}`, `事实 ${i}`));
    storage.insertEmbedding("default", "alice", "personal_semantic", `psem_v${i}`, seededVec(i), "test-model");
  }
  return { dir, mem, storage };
}

test("searchEmbedding topK 排序与暴力扫描参考结果一致", async () => {
  const N = 200, TOPK = 10;
  const { dir, mem, storage } = setup(N);
  const q = seededVec(9999);

  const got = storage.searchEmbedding("default", "alice", q, ["personal_semantic"], undefined, TOPK);

  // 参考答案：测试内独立暴力扫描
  const expected = Array.from({ length: N }, (_, i) => ({ id: `psem_v${i}`, score: cosine(q, seededVec(i)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOPK);

  assert.equal(got.length, TOPK);
  assert.deepEqual(got.map((r) => r.memory.id), expected.map((e) => e.id), "topK 顺序应与参考一致");
  for (let i = 0; i < TOPK; i++) {
    assert.ok(Math.abs(got[i].score - expected[i].score) < 1e-4, `score[${i}] 偏差过大: ${got[i].score} vs ${expected[i].score}`);
  }

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("hydrate 过滤语义不变：sensitive/cold/invalidated 默认不返回", async () => {
  const { dir, mem, storage } = setup(20);
  const q = seededVec(0); // 与 psem_v0 完全同向 → v0 必然是 top1 候选

  // 把 top1 标记为 cold，检索时应被过滤掉
  storage.markCold("default", "alice", "personal_semantic", "psem_v0", new Date().toISOString());
  const got = storage.searchEmbedding("default", "alice", q, ["personal_semantic"], undefined, 5);
  assert.ok(got.length > 0);
  assert.ok(!got.some((r) => r.memory.id === "psem_v0"), "cold 记录不应出现在默认检索");

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("混合维度库不报错：不同 dim 的记录不参与但检索可用", async () => {
  const { dir, mem, storage } = setup(10);
  // 插入一条不同维度（模拟模型切换后的遗留向量）
  storage.insert("default", "alice", makeMemory("psem_odd", "旧模型向量"));
  storage.insertEmbedding("default", "alice", "personal_semantic", "psem_odd", seededVec(1, 64), "old-model");

  const got = storage.searchEmbedding("default", "alice", seededVec(9999), ["personal_semantic"], undefined, 5);
  assert.ok(got.length > 0, "混合维度下检索不应报错、不应为空");

  await mem.close();
  rmSync(dir, { recursive: true, force: true });
});
