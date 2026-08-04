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

  const temporalContext = buildTemporalAnchorContext(trimmed, options.contentDate);
  const userMessage = `scope: ${scope}${temporalContext}\n\n用户内容：\n${trimmed}`;
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
function buildTemporalAnchorContext(content: string, contentDate?: string): string {
  if (!contentDate) return "";
  const date = contentDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return `\nevent_time: ${contentDate}`;

  const offsets: Array<{ pattern: RegExp; label: string; days: number }> = [
    { pattern: /前天|day before yesterday/i, label: "前天", days: -2 },
    { pattern: /昨天|yesterday/i, label: "昨天", days: -1 },
    { pattern: /今天|today/i, label: "今天", days: 0 },
    { pattern: /后天|day after tomorrow/i, label: "后天", days: 2 },
    { pattern: /明天|tomorrow/i, label: "明天", days: 1 },
  ];
  const resolutions = offsets
    .filter((item) => item.pattern.test(content))
    .map((item) => `${item.label}=${shiftCalendarDate(date, item.days)}`);
  const timezone = contentDate.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "unknown";
  const resolved = resolutions.length > 0 ? `\nrelative_time_resolution: ${resolutions.join(", ")}` : "";
  return `\nevent_time: ${contentDate}\nevent_timezone: ${timezone}${resolved}`;
}

function shiftCalendarDate(match: RegExpMatchArray, days: number): string {
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return value.toISOString().slice(0, 10);
}
