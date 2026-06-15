// embedding.ts — embedding provider 抽象
//
// v0.1 默认 OpenAI text-embedding-3-small；用户未提供 → search 退化为 SQLite FTS5。

import type { EmbeddingConfig, EmbeddingProvider } from "./types.js";

const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";
const OPENAI_DEFAULT_DIM = 1536;
const ZHIPU_DEFAULT_MODEL = "embedding-3";
const ZHIPU_DEFAULT_DIM = 2048;
const ZHIPU_EMBEDDING_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/embeddings";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dim: number;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) throw new Error("[nemos] OpenAI embedding 缺少 apiKey");
    this.apiKey = apiKey;
    this.model = model || OPENAI_DEFAULT_MODEL;
    this.modelId = `openai-${this.model}-v1`;
    this.dim = OPENAI_DEFAULT_DIM;
  }

  async embed(text: string): Promise<Float32Array> {
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `[nemos] OpenAI embedding HTTP ${resp.status}: ${body.slice(0, 240)}`,
      );
    }
    const data = (await resp.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    if (!vec) throw new Error("[nemos] OpenAI embedding 响应无 data[0].embedding");
    return Float32Array.from(vec);
  }
}

export class ZhipuEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dim: number;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) throw new Error("[nemos] Zhipu embedding 缺少 apiKey");
    this.apiKey = apiKey;
    this.model = model || ZHIPU_DEFAULT_MODEL;
    this.modelId = `zhipu-${this.model}-v1`;
    this.dim = ZHIPU_DEFAULT_DIM;
  }

  async embed(text: string): Promise<Float32Array> {
    const resp = await fetch(ZHIPU_EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `[nemos] Zhipu embedding HTTP ${resp.status}: ${body.slice(0, 240)}`,
      );
    }
    const data = (await resp.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    if (!vec) throw new Error("[nemos] Zhipu embedding 响应无 data[0].embedding");
    return Float32Array.from(vec);
  }
}

export class CustomEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dim: number;
  private readonly fn: (text: string) => Promise<Float32Array>;

  constructor(
    fn: (text: string) => Promise<Float32Array>,
    modelId: string,
    dim: number,
  ) {
    this.fn = fn;
    this.modelId = modelId;
    this.dim = dim;
  }

  embed(text: string): Promise<Float32Array> {
    return this.fn(text);
  }
}

export function makeEmbeddingProvider(
  config: EmbeddingConfig | undefined,
): EmbeddingProvider | null {
  if (!config || config.provider === "none") return null;
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddingProvider(config.apiKey, config.model);
    case "zhipu":
      return new ZhipuEmbeddingProvider(config.apiKey, config.model);
    case "custom":
      return new CustomEmbeddingProvider(config.embed, config.modelId, config.dim);
    default: {
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error("[nemos] 未知 embedding provider");
    }
  }
}

/**
 * Cosine 相似度（embedding search 用，纯 JS，避免引入 sqlite-vec 的强依赖）。
 * 注意：search.ts 在没有 sqlite-vec 时会调这个；有 sqlite-vec 时走 SQL 内置。
 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) continue;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
