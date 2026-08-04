// analyzer/index.ts — 顶层 analyze 入口 + 再导出
//
// 守住的硬约束（详见各子模块）：
// 1. archival.content 客户端强制 = 用户原始输入字节级副本（build-memory.ts）
// 2. archival.source.authoritative = true 强制
// 3. 所有 derived.source.authoritative = false 强制
// 4. personal_semantic 拒绝 authoritative=true → 降级为 episodic
// 5. JSON 容错：剥 markdown 围栏 / 缺字段补默认（json-parse.ts）
// 6. v0.2: scenario.exclude.layers 在分析后 hard filter（build-memory.ts applyExclude）
// 7. v0.2/v0.3: chunking 触发时自动关 doubleCheck + perspectives（chunked.ts）

import type { IngestResult, LLMProvider } from "../types.js";
import { chunkContent } from "../utils/chunking.js";
import type { AnalyzeOptions } from "./options.js";
import { analyzeChunked } from "./chunked.js";
import { AnalyzeJsonParseError } from "./json-parse.js";
import { analyzeMultiPerspective } from "./multi-perspective.js";
import { analyzeOnce, analyzeWithVerification } from "./single-pass.js";
import { appendStructuredFacts } from "./structured-facts.js";

const ADAPTIVE_CHUNK_MIN_CHARS = 256;
const ADAPTIVE_CHUNK_MAX_ATTEMPTS = 4;

export type { AnalyzeOptions } from "./options.js";
export { analyzeOnce, analyzeWithVerification } from "./single-pass.js";
export { analyzeMultiPerspective } from "./multi-perspective.js";
export { analyzeChunked } from "./chunked.js";
export { appendStructuredFacts, extractMarkdownTableFacts } from "./structured-facts.js";
export { buildArchival, buildDerived, buildDerivedMultiPerspective, applyExclude } from "./build-memory.js";
export {
  parseAnalyzeJson,
  parseCheckJson,
  stripForCheck,
  isValidIsoLike,
} from "./json-parse.js";
export type {
  RawArchival,
  RawDerived,
  RawDerivedWithSource,
  ParsedAnalyze,
  ParsedCheck,
} from "./json-parse.js";

/**
 * 顶层分析入口。根据内容长度自动选 chunked / 单段路径。
 *
 * - 单段（≤ maxChars）：按 options.perspectives / doubleCheck 选 multi-perspective / verified / once
 * - 多段：每段单 pass → merge derived → dedupe；doubleCheck 与 perspectives 强制关
 */
export async function analyze(
  content: string,
  scope: string,
  llm: LLMProvider,
  originAgent: string | undefined,
  options: AnalyzeOptions = {},
): Promise<IngestResult> {
  const trimmed = (content || "").trim();
  if (!trimmed) throw new Error("[nemos] content is empty");

  const profile = options.profile;
  const maxChars = profile?.chunking?.maxChars ?? 8000;
  const overlap = profile?.chunking?.overlap ?? 200;

  // 决策：是否 chunking
  const chunks = chunkContent(trimmed, { maxChars, overlap });
  const useChunking = chunks.length > 1;

  let result: IngestResult;
  try {
    if (useChunking) {
      result = await analyzeChunked(trimmed, chunks, scope, llm, originAgent, options);
    } else if (options.perspectives && options.perspectives.length > 0) {
      result = await analyzeMultiPerspective(trimmed, scope, llm, originAgent, options);
    } else if (options.doubleCheck) {
      result = await analyzeWithVerification(trimmed, scope, llm, originAgent, options);
    } else {
      result = await analyzeOnce(trimmed, scope, llm, originAgent, options);
    }
  } catch (error) {
    if (!(error instanceof AnalyzeJsonParseError)) throw error;
    result = await analyzeWithAdaptiveChunks(
      trimmed,
      scope,
      llm,
      originAgent,
      options,
      maxChars,
      overlap,
      error,
    );
  }
  return appendStructuredFacts(result, trimmed, scope, originAgent, profile);
}

async function analyzeWithAdaptiveChunks(
  content: string,
  scope: string,
  llm: LLMProvider,
  originAgent: string | undefined,
  options: AnalyzeOptions,
  configuredMaxChars: number,
  overlap: number,
  initialError: AnalyzeJsonParseError,
): Promise<IngestResult> {
  let lastError = initialError;
  let maxChars = Math.max(
    ADAPTIVE_CHUNK_MIN_CHARS,
    Math.min(Math.floor(configuredMaxChars / 2), Math.floor(content.length / 2)),
  );

  for (let attempt = 0; attempt < ADAPTIVE_CHUNK_MAX_ATTEMPTS; attempt += 1) {
    const chunks = chunkContent(content, {
      maxChars,
      overlap: Math.min(overlap, Math.floor(maxChars / 4)),
    });
    if (chunks.length <= 1) break;

    try {
      return await analyzeChunked(content, chunks, scope, llm, originAgent, options);
    } catch (error) {
      if (!(error instanceof AnalyzeJsonParseError)) throw error;
      lastError = error;
    }

    if (maxChars === ADAPTIVE_CHUNK_MIN_CHARS) break;
    maxChars = Math.max(ADAPTIVE_CHUNK_MIN_CHARS, Math.floor(maxChars / 2));
  }

  throw lastError;
}
