// analyzer/chunked.ts — 长内容分段 → 每段独立分析 → merge + dedupe
//
// RFC 0002 决议 C：chunking 触发时不再跑 doubleCheck（多段已构成跨视角冗余）。
// v0.3 决议：chunking 触发时同时关 perspectives（多段已构成跨语境冗余；
// 再叠加视角调用会爆 token + 复杂度）。

import type { IngestResult, LLMProvider, Memory } from "../types.js";
import type { AnalyzeOptions } from "./options.js";
import { applyExclude, buildArchival } from "./build-memory.js";
import { analyzeOnce } from "./single-pass.js";

export async function analyzeChunked(
  fullContent: string,
  chunks: string[],
  scope: string,
  llm: LLMProvider,
  originAgent: string | undefined,
  options: AnalyzeOptions,
): Promise<IngestResult> {
  // archival 永远存完整原文，不切
  const profile = options.profile;
  const archival = buildArchival(
    fullContent,
    scope,
    undefined,
    originAgent,
    profile,
    options.contentDate,
  );

  // 每段独立分析
  const perChunkResults: Memory[][] = [];
  for (const chunk of chunks) {
    const sub = await analyzeOnce(chunk, scope, llm, originAgent, {
      ...options,
      doubleCheck: false,
      perspectives: undefined,
    });
    // 每段的 derived 重写 archival_ref 指回主 archival
    const fixed = sub.derived.map((d) => ({ ...d, archival_ref: archival.id }));
    perChunkResults.push(fixed);
  }

  // dedupe：按 layer + content（trim/lowercase）去重；保留先出现的
  const seen = new Set<string>();
  const merged: Memory[] = [];
  for (const arr of perChunkResults) {
    for (const m of arr) {
      const key = `${m.layer}:${m.content.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(m);
    }
  }

  const filtered = applyExclude(merged, profile);
  return { archival, derived: filtered };
}
