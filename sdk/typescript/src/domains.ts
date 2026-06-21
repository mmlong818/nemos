// domains.ts — v0.5 领域路由的纯函数层：config 解析 + 四级激活 rerank + 前瞻上下文
//
// 这些是确定性纯函数，便于单测；副作用（storage 读写）留在 user-memory.ts。

import type { Memory, NemosConfig, Prospective, RouteResult } from "./types.js";
import { GLOBAL_DOMAIN_ID } from "./types.js";

export interface DomainsRuntimeConfig {
  enabled: boolean;
  router: NonNullable<NonNullable<NemosConfig["features"]>["domains"]>["router"];
  routeConfidenceThreshold: number;
  l2Max: number;
  l3SpreadLimit: number;
}

export interface ProspectiveRuntimeConfig {
  enabled: boolean;
  minConfidence: number;
  onDemand: boolean;
}

export const DOMAINS_DEFAULTS: DomainsRuntimeConfig = {
  enabled: false,
  router: { provider: "llm" },
  routeConfidenceThreshold: 0.35,
  l2Max: 3,
  l3SpreadLimit: 5,
};

export const PROSPECTIVE_DEFAULTS: ProspectiveRuntimeConfig = {
  enabled: false,
  minConfidence: 0.4,
  onDemand: false,
};

export function resolveDomainsConfig(config: NemosConfig): DomainsRuntimeConfig {
  const raw = config.features?.domains;
  if (!raw) return { ...DOMAINS_DEFAULTS };
  return {
    enabled: raw.enabled === true,
    router: raw.router ?? DOMAINS_DEFAULTS.router,
    routeConfidenceThreshold:
      typeof raw.routeConfidenceThreshold === "number"
        ? raw.routeConfidenceThreshold
        : DOMAINS_DEFAULTS.routeConfidenceThreshold,
    l2Max: typeof raw.l2Max === "number" ? raw.l2Max : DOMAINS_DEFAULTS.l2Max,
    l3SpreadLimit:
      typeof raw.l3SpreadLimit === "number" ? raw.l3SpreadLimit : DOMAINS_DEFAULTS.l3SpreadLimit,
  };
}

export function resolveProspectiveConfig(config: NemosConfig): ProspectiveRuntimeConfig {
  const raw = config.features?.prospective;
  if (!raw) return { ...PROSPECTIVE_DEFAULTS };
  return {
    enabled: raw.enabled === true,
    minConfidence:
      typeof raw.minConfidence === "number"
        ? raw.minConfidence
        : PROSPECTIVE_DEFAULTS.minConfidence,
    onDemand: raw.onDemand === true,
  };
}

// 四级激活权重（RFC 0005 §4）：L0 共享 / L1 主 / L2 邻接 / 其余。
const W_L0 = 1.0;
const W_L1 = 0.9;
const W_L2 = 0.6;
const W_OTHER = 0.3;

/**
 * 四级激活 rerank：对已按相关度排序的 memories，按其领域归属乘以激活权重重排。
 * soft 多归属：取所属领域的最大权重；降权不剔除（隔离而非牢笼）。
 * 逃生阀：route.fallback 或 confidence < threshold → 原样返回（全局检索）。
 */
export function rerankByActivation(
  memories: Memory[],
  route: RouteResult,
  membershipFor: (memoryId: string) => string[],
  threshold: number,
): Memory[] {
  if (route.fallback || route.confidence < threshold || !route.l1) {
    return memories;
  }
  const l2 = new Set(route.l2);
  // 按激活权重分层排序；同层内保留原相关度顺序（idx 升序）。
  // 这样 L1 领域记忆整体升顶、无关领域整体降权但不剔除（soft 隔离）。
  const scored = memories.map((m, i) => {
    const doms = membershipFor(m.id);
    let w = W_OTHER;
    for (const d of doms) {
      let dw = W_OTHER;
      if (d === GLOBAL_DOMAIN_ID) dw = W_L0;
      else if (d === route.l1) dw = W_L1;
      else if (l2.has(d)) dw = W_L2;
      if (dw > w) w = dw;
    }
    return { m, weight: w, idx: i };
  });
  scored.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.idx - b.idx));
  return scored.map((s) => s.m);
}

/**
 * 构建前瞻上下文项（RFC 0006）：带 kind=prospective 标注，明确这是 AI 建构预测。
 * 仅纳入 confidence >= minConfidence 的固化前瞻。
 */
export function buildProspectiveContext(
  prospectives: Array<{ prospective: Prospective; score: number }>,
  minConfidence: number,
): string[] {
  const out: string[] = [];
  for (const item of prospectives) {
    const p = item.prospective;
    if (p.confidence < minConfidence) continue;
    out.push(
      `[prospective | AI预测·置信${p.confidence.toFixed(2)}] ${p.cue} → ${p.projection}`,
    );
  }
  return out;
}
