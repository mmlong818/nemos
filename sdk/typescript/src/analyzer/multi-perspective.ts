// analyzer/multi-perspective.ts — v0.3 多视角并行抽取 + merge pass

import { composeSystemPrompt } from "../prompts.js";
import {
  MULTI_PERSPECTIVE_MERGE_PROMPT,
  getPerspectivePrompt,
} from "../perspectives.js";
import type { IngestResult, LLMProvider, Memory, Perspective, VerificationStats } from "../types.js";
import type { AnalyzeOptions } from "./options.js";
import {
  applyExclude,
  buildArchival,
  buildDerivedMultiPerspective,
} from "./build-memory.js";
import {
  parseAnalyzeJson,
  parseCheckJson,
  type ParsedAnalyze,
  type RawDerivedWithSource,
} from "./json-parse.js";

/**
 * v0.3：多视角并行抽取 + merge pass。
 *
 * 流程：
 *   1. 对每个 perspective 用其特化 sub-prompt 并行调 LLM；
 *   2. 把所有视角的 derived 喂给 MERGE_PROMPT 做合并；
 *   3. 把 perspectives 数组写入每条 derived.source 推 confidence；
 *   4. 保留与 v0.2 相同的 archival 构造规则（archival.content 强制 = trimmed）。
 *
 * 与 chunking 互斥：分析器入口已先选 chunking 路径；这里不再考虑分段。
 * 与 doubleCheck 互斥：入口确保两者不同时启用。
 */
export async function analyzeMultiPerspective(
  content: string,
  scope: string,
  llm: LLMProvider,
  originAgent: string | undefined,
  options: AnalyzeOptions = {},
): Promise<IngestResult> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("[nemos] content is empty");
  const perspectives = options.perspectives ?? [];
  if (perspectives.length === 0) {
    throw new Error("[nemos] analyzeMultiPerspective 需要 perspectives 非空");
  }

  const profile = options.profile;

  // 1) 并行各视角抽取
  const userMessage = `scope: ${scope}\n\n用户内容：\n${trimmed}`;
  const perViewRaw = await Promise.all(
    perspectives.map(async (p) => {
      const base = getPerspectivePrompt(p);
      const system = profile ? composeSystemPrompt(base, profile) : base;
      const raw = await llm.chat(system, userMessage);
      const parsed = parseAnalyzeJson(raw);
      return { perspective: p, parsed };
    }),
  );

  // 用第一视角的 archival 字段作 archival meta source（content 总会被覆盖）
  const firstArch = perViewRaw[0]?.parsed.archival;
  const archival = buildArchival(
    trimmed,
    scope,
    firstArch,
    originAgent,
    profile,
    options.contentDate,
  );

  // 2) 准备 merge 输入：把每条 derived 标上 from_perspective
  const allWithSource: RawDerivedWithSource[] = [];
  for (const v of perViewRaw) {
    for (const d of v.parsed.derived) {
      allWithSource.push({ ...d, from_perspective: v.perspective });
    }
  }

  // 若所有视角都没产 derived，直接返回空
  if (allWithSource.length === 0) {
    return { archival, derived: [] };
  }

  // 3) Merge pass
  const mergeSystem = profile
    ? composeSystemPrompt(MULTI_PERSPECTIVE_MERGE_PROMPT, profile)
    : MULTI_PERSPECTIVE_MERGE_PROMPT;
  const mergeInput = JSON.stringify(
    { perspectives_input: allWithSource, scope },
    null,
    2,
  );
  const mergeUserMsg = `请合并以下多视角 derived 抽取：\n\n${mergeInput}`;
  const mergeRaw = await llm.chat(mergeSystem, mergeUserMsg);
  const merged = parseCheckJson(mergeRaw);

  // 4) 构造 derived；perspectives + confidence 由客户端推导（不信 LLM 自填）
  let derived = (merged.derived || []).map((d) =>
    buildDerivedMultiPerspective(
      d,
      scope,
      originAgent,
      archival.id,
      profile,
    ),
  );
  derived = applyExclude(derived, profile);

  const stats = synthesizeStats(perViewRaw, derived);
  return { archival, derived, verification_stats: stats };
}

function synthesizeStats(
  perView: Array<{ perspective: Perspective; parsed: ParsedAnalyze }>,
  merged: Memory[],
): VerificationStats {
  const totalIn = perView.reduce((sum, v) => sum + v.parsed.derived.length, 0);
  let high = 0;
  let medium = 0;
  let conflicts = 0;
  for (const m of merged) {
    const c = m.source.confidence;
    if (c === "high") high++;
    else if (c === "medium") medium++;
    else if (c === "conflict") conflicts++;
  }
  return {
    pass_a_count: totalIn,
    pass_b_count: 0,
    merged_count: merged.length,
    high_confidence: high,
    medium_confidence: medium,
    conflicts,
  };
}
