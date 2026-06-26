// invalidation.ts — 矛盾失效：候选封顶 + 失效标记（RFC 0007 §2.3）
//
// 从 reflect 内联逻辑抽出，便于独立复用 / 未来 worker 化。
// 两件事：
//  1) capAnchors：当现有 personal_semantic 候选很多时，按与新内容的（词法）相似度裁到上限，
//     控制喂给 LLM 的 prompt 体积；候选不多时全保留——绝不过滤，避免漏掉用词不同的矛盾
//     （判矛盾仍由 LLM 语义完成）。语义 cosine 粗筛 + 自带判矛盾的异步 worker 为后续步骤。
//  2) applyInvalidations：把 LLM 认定被推翻的旧 anchor 标 belief_state='invalidated' + 双向回链。

import { shingles, jaccard } from "./prefilter.js";
import type { EmbeddingProvider, Memory } from "./types.js";
import type { Storage } from "./storage.js";
import { cosineSimLocal } from "./utils/vector.js";

/** 失效候选默认上限：超过才按相似度裁剪（小集合原样全送 LLM）。 */
export const DEFAULT_ANCHOR_CAP = 50;

/**
 * v2 语义候选检索（RFC 0007 §2.3 的"语义 cosine 粗筛"落地）。
 * 用 embedding 把"语义相近但用词不同"的矛盾对（如 素食↔鱼素、单身↔已婚）捞进候选，
 * 弥补纯词法 Jaccard 的漏判。对每条 anchor 取它与任一近期 episodic 的最大 cosine，
 * 保留 ≥ minCosine 的、按相似度降序裁到 topN。embedding 为空或 anchor 为空时返回 []（调用方回退词法）。
 */
export async function selectSemanticCandidates(
  embedding: EmbeddingProvider | null,
  episodicTexts: string[],
  anchors: Memory[],
  topN: number = DEFAULT_ANCHOR_CAP,
  minCosine: number = 0.3,
): Promise<Memory[]> {
  if (!embedding || anchors.length === 0 || episodicTexts.length === 0) return [];
  const epVecs = await Promise.all(episodicTexts.map((t) => embedding.embed(t)));
  const scored: Array<{ m: Memory; s: number }> = [];
  for (const a of anchors) {
    const av = await embedding.embed(a.content);
    let best = 0;
    for (const ev of epVecs) {
      const sim = cosineSimLocal(av, ev);
      if (sim > best) best = sim;
    }
    if (best >= minCosine) scored.push({ m: a, s: best });
  }
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, topN).map((x) => x.m);
}

/**
 * 候选封顶：anchors 多于 cap 时，按与 queryText 的 Jaccard 相似度降序裁到 cap 条；
 * 不多于 cap 时原样返回（不过滤）。仅为控制大集合的 prompt 成本，不改变小集合行为。
 */
export function capAnchors<T extends { content: string }>(
  anchors: T[],
  queryText: string,
  cap: number = DEFAULT_ANCHOR_CAP,
): T[] {
  if (anchors.length <= cap) return anchors;
  const q = shingles(queryText);
  return anchors
    .map((a) => ({ a, s: jaccard(q, shingles(a.content)) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, cap)
    .map((x) => x.a);
}

/**
 * 应用矛盾失效：对每条新记录，把它推翻的旧 anchor 标失效（invalid_at + expired_at +
 * belief_state='invalidated' + corrected_by 回链）。返回失效条数。
 * I4 守门（被失效 id 必须来自 anchor、anchor 恒为 personal_semantic）由调用方保证。
 */
export function applyInvalidations(
  storage: Storage,
  tenantId: string,
  userId: string,
  persisted: Memory[],
  invalidatesMap: Map<string, string[]>,
  anchorById: Map<string, Memory>,
  now: string,
): number {
  let invalidated = 0;
  for (const p of persisted) {
    const oldIds = invalidatesMap.get(p.id);
    if (!oldIds) continue;
    for (const oldId of oldIds) {
      const old = anchorById.get(oldId);
      if (!old) continue;
      storage.markInvalidated(tenantId, userId, old.layer, oldId, {
        invalidAt: p.valid_at ?? now,
        expiredAt: now,
        correctedBy: p.id,
      });
      invalidated++;
    }
  }
  return invalidated;
}
