// zhipu-embedding.test.ts — ZhipuEmbeddingProvider（embedding-3，OpenAI 兼容端点）

import { test } from "node:test";
import assert from "node:assert/strict";
import { ZhipuEmbeddingProvider, makeEmbeddingProvider } from "../../src/embedding.js";

interface CapturedReq {
  url: string;
  headers: Record<string, string>;
  body: { model: string; input: string };
}

function mockFetch(vec: number[]): { restore: () => void; captured: () => CapturedReq | null } {
  const orig = globalThis.fetch;
  let cap: CapturedReq | null = null;
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    cap = { url, headers: init.headers, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: vec }] }),
      text: async () => "",
    };
  }) as unknown as typeof fetch;
  return { restore: () => { globalThis.fetch = orig; }, captured: () => cap };
}

test("ZhipuEmbeddingProvider：打智谱 embeddings 端点 + Bearer + 默认 embedding-3", async () => {
  const m = mockFetch([0.1, 0.2, 0.3]);
  try {
    const p = new ZhipuEmbeddingProvider("test-key");
    const out = await p.embed("hello");
    assert.ok(out instanceof Float32Array);
    assert.equal(out.length, 3);
    assert.ok(Math.abs(out[0] - 0.1) < 1e-6);
    const req = m.captured()!;
    assert.match(req.url, /open\.bigmodel\.cn\/api\/paas\/v4\/embeddings/);
    assert.equal(req.headers.Authorization, "Bearer test-key");
    assert.equal(req.body.model, "embedding-3");
    assert.equal(req.body.input, "hello");
  } finally {
    m.restore();
  }
});

test("ZhipuEmbeddingProvider：默认 modelId + dim=2048", () => {
  const p = new ZhipuEmbeddingProvider("k");
  assert.equal(p.modelId, "zhipu-embedding-3-v1");
  assert.equal(p.dim, 2048);
});

test("ZhipuEmbeddingProvider：可覆盖 model", async () => {
  const m = mockFetch([1]);
  try {
    const p = new ZhipuEmbeddingProvider("k", "embedding-2");
    await p.embed("x");
    assert.equal(m.captured()!.body.model, "embedding-2");
    assert.equal(p.modelId, "zhipu-embedding-2-v1");
  } finally {
    m.restore();
  }
});

test("ZhipuEmbeddingProvider：缺 apiKey 抛错", () => {
  assert.throws(() => new ZhipuEmbeddingProvider(""), /缺少 apiKey/);
});

test("makeEmbeddingProvider：provider=zhipu → ZhipuEmbeddingProvider", () => {
  const p = makeEmbeddingProvider({ provider: "zhipu", apiKey: "k" });
  assert.ok(p);
  assert.equal(p.modelId, "zhipu-embedding-3-v1");
  assert.equal(p.dim, 2048);
});

test("ZhipuEmbeddingProvider：响应缺 embedding 抛错", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
    text: async () => "",
  })) as unknown as typeof fetch;
  try {
    const p = new ZhipuEmbeddingProvider("k");
    await assert.rejects(() => p.embed("x"), /无 data\[0\]\.embedding/);
  } finally {
    globalThis.fetch = orig;
  }
});
