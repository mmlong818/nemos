// prefilter.ts — 矛盾失效粗筛（RFC 0007 §2.3）
//
// 目的：在把"新事实 × 现有候选事实"丢给 LLM 判矛盾之前，先用一个便宜的文本相似度
// 把"根本不相干"的候选筛掉，只让"像在说同一件事"的少数候选进 LLM——省调用、可扩展。
//
// 算法：字符 bigram 集合的 Jaccard 相似度。对中文鲁棒（无需分词），对中英混排也够用。
// 这是 v1 的轻量实现；上规模 / 要更准时可换成 MinHash 或语义 cosine（接口不变）。
// 注意：纯词法粗筛会漏掉"语义相关但用词不同"的矛盾对（罕见，因抽取出的事实通常点名主体），
// 阈值宜偏低（宁可多放进 LLM，也别误筛）。

/** 文本 → 字符 bigram 集合（小写、去空白）。单字符文本回退为它本身。 */
export function shingles(text: string): Set<string> {
  const s = (text || "").toLowerCase().replace(/\s+/g, "");
  const out = new Set<string>();
  if (s.length <= 1) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 两个集合的 Jaccard 相似度 = |交| / |并|。任一为空 → 0。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * 从候选里挑出与 queryText 词法相似度 ≥ threshold 的（"可能在说同一件事"）。
 * 保留原对象，附上算得的 score，按相似度降序，便于上层取 topK。
 */
export function prefilterCandidates<T extends { content: string }>(
  queryText: string,
  candidates: T[],
  threshold = 0.08,
): Array<T & { score: number }> {
  const q = shingles(queryText);
  if (q.size === 0) return [];
  const scored: Array<T & { score: number }> = [];
  for (const c of candidates) {
    const score = jaccard(q, shingles(c.content));
    if (score >= threshold) scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
