// router.ts — v0.5 领域路由 RouterProvider（RFC 0005 §5）
//
// 随规模叠加演化：LLMRouter（保底）→ CentroidRouter（热路径）→ HybridRouter（未来）。
// 与 llm.ts / embedding.ts 的 provider 抽象同构。

import type {
  Domain,
  LLMProvider,
  RouteResult,
  RouterConfig,
  RouterProvider,
} from "./types.js";
import { GLOBAL_DOMAIN_ID } from "./types.js";
import { cosineSimLocal } from "./utils/vector.js";

const DEFAULT_L2_MAX = 3;

const FALLBACK: RouteResult = { l1: null, l2: [], confidence: 0, fallback: true };

/** 候选领域 = 非 GLOBAL、非 always_on。 */
function routableDomains(domains: Domain[]): Domain[] {
  return domains.filter((d) => d.id !== GLOBAL_DOMAIN_ID && !d.always_on);
}

/**
 * LLMRouter（保底）：领域清单 + query 交 LLM 选 top-k。
 * 冷启动 / 领域数少时直接发车。
 */
export class LLMRouter implements RouterProvider {
  readonly name = "llm-router";
  constructor(private readonly llm: LLMProvider) {}

  async route(
    query: string,
    _queryVec: Float32Array | null,
    domains: Domain[],
  ): Promise<RouteResult> {
    const candidates = routableDomains(domains);
    if (candidates.length === 0) return FALLBACK;

    const list = candidates.map((d) => ({ id: d.id, label: d.label }));
    const system = `你是记忆领域路由器。给定用户 query 和候选领域清单，选出最相关的主领域(L1)和最多 ${DEFAULT_L2_MAX} 个次相关邻接领域(L2)，并给出 0-1 的置信度。
只能从候选清单的 id 中选；若都不相关，l1 设为 null。
输出严格 JSON（不要 markdown 围栏）：{"l1": "<domain_id 或 null>", "l2": ["<id>", ...], "confidence": <0-1>}`;
    const user = `query: ${query}\n候选领域: ${JSON.stringify(list)}\n输出 JSON：`;

    let raw: string;
    try {
      raw = await this.llm.chat(system, user);
    } catch {
      return FALLBACK;
    }
    const parsed = parseRoute(raw);
    if (!parsed) return FALLBACK;

    const validIds = new Set(candidates.map((d) => d.id));
    const l1 = parsed.l1 && validIds.has(parsed.l1) ? parsed.l1 : null;
    if (!l1) return FALLBACK;
    const l2 = (parsed.l2 ?? [])
      .filter((id) => validIds.has(id) && id !== l1)
      .slice(0, DEFAULT_L2_MAX);
    const confidence =
      typeof parsed.confidence === "number" ? clamp01(parsed.confidence) : 0.5;
    return { l1, l2, confidence, fallback: false };
  }
}

/**
 * CentroidRouter（热路径）：q_vec · prototype_vec 纯数值 top-k，守 100ms。
 * 质心由 reflect 离线维护（birth 均值 + recomputeCentroids 校正）。
 */
export class CentroidRouter implements RouterProvider {
  readonly name = "centroid-router";

  async route(
    _query: string,
    queryVec: Float32Array | null,
    domains: Domain[],
  ): Promise<RouteResult> {
    if (!queryVec) return FALLBACK;
    const scored = routableDomains(domains)
      .filter((d) => d.prototype_vec)
      .map((d) => ({ id: d.id, sim: cosineSimLocal(queryVec, d.prototype_vec as Float32Array) }))
      .filter((x) => x.sim > 0)
      .sort((a, b) => b.sim - a.sim);
    if (scored.length === 0) return FALLBACK;
    const l1 = scored[0].id;
    const l2 = scored.slice(1, 1 + DEFAULT_L2_MAX).map((x) => x.id);
    // cosine ∈ [-1,1] → confidence ∈ [0,1]
    const confidence = clamp01((scored[0].sim + 1) / 2);
    return { l1, l2, confidence, fallback: false };
  }
}

export function createRouter(config: RouterConfig, llm: LLMProvider): RouterProvider {
  if (config.provider === "custom") {
    const route = config.route;
    const name = config.name ?? "custom-router";
    return { name, route };
  }
  if (config.provider === "centroid") return new CentroidRouter();
  return new LLMRouter(llm);
}

interface RawRoute {
  l1: string | null;
  l2?: string[];
  confidence?: number;
}

function parseRoute(raw: string): RawRoute | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    const obj = JSON.parse(cleaned) as RawRoute;
    if (typeof obj !== "object" || obj === null) return null;
    return obj;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
