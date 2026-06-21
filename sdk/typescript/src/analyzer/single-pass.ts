// analyzer/single-pass.ts — 单 pass + 双 pass + 校验 pass（v0.2 路径）

import { CHECK_SYSTEM_PROMPT, SYSTEM_PROMPT, composeSystemPrompt } from "../prompts.js";
import type { IngestResult, LLMProvider } from "../types.js";
import type { AnalyzeOptions } from "./options.js";
import { applyExclude, buildArchival, buildDerived } from "./build-memory.js";
import { parseAnalyzeJson, parseCheckJson, stripForCheck } from "./json-parse.js";

/**
 * 单 pass 分析。
 */
export async function analyzeOnce(
  content: string,
  scope: string,
  llm: LLMProvider,
  originAgent: string | undefined,
  options: AnalyzeOptions = {},
): Promise<IngestResult> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("[nemos] content is empty");

  const profile = options.profile;
  const systemPrompt = profile
    ? composeSystemPrompt(SYSTEM_PROMPT, profile)
    : SYSTEM_PROMPT;

  const userMessage = `scope: ${scope}\n\n用户内容：\n${trimmed}`;
  const raw = await llm.chat(systemPrompt, userMessage);
  const parsed = parseAnalyzeJson(raw);

  const archival = buildArchival(
    trimmed,
    scope,
    parsed.archival,
    originAgent,
    profile,
    options.contentDate,
  );
  let derived = (parsed.derived || []).map((d) =>
    buildDerived(d, scope, originAgent, archival.id, /*chain_depth=*/ 1, profile),
  );
  derived = applyExclude(derived, profile);
  return { archival, derived };
}

/**
 * 双 pass + 第三 pass 校验。
 */
export async function analyzeWithVerification(
  content: string,
  scope: string,
  llm: LLMProvider,
  originAgent: string | undefined,
  options: AnalyzeOptions = {},
): Promise<IngestResult> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("[nemos] content is empty");

  const profile = options.profile;
  const [a, b] = await Promise.all([
    analyzeOnce(trimmed, scope, llm, originAgent, options),
    analyzeOnce(trimmed, scope, llm, originAgent, options),
  ]);

  const checkSystem = profile
    ? composeSystemPrompt(CHECK_SYSTEM_PROMPT, profile)
    : CHECK_SYSTEM_PROMPT;

  const checkInput = JSON.stringify(
    {
      pass_a_derived: a.derived.map(stripForCheck),
      pass_b_derived: b.derived.map(stripForCheck),
      scope,
    },
    null,
    2,
  );
  const userMsg = `请审查以下两次独立 derived 抽取的结果：\n\n${checkInput}`;
  const raw = await llm.chat(checkSystem, userMsg);
  const check = parseCheckJson(raw);

  const archival = a.archival;
  let derived = (check.derived || []).map((d) =>
    buildDerived(d, scope, originAgent, archival.id, /*chain_depth=*/ 2, profile),
  );
  derived = applyExclude(derived, profile);

  return {
    archival,
    derived,
    verification_stats: check.stats || undefined,
  };
}
