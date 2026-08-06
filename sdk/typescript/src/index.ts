// index.ts — 公开 API 入口（v0.3.1 后纯 re-export shim）
//
// 调用方 import 这里：
//   import { Nemos } from '@nemos/sdk';
//   const mem = new Nemos({ storage: {...}, llm: {...} });
//   await mem.forUser('alice').ingest('...');
//
// v0.3.1 refactor：Nemos 类拆到 nemos.ts，UserMemory 拆到 user-memory.ts，
// persistDerivedList 拆到 persist-derived.ts；本文件仅做 re-export。

// 重新导出公共类型（调用方 IDE intellisense 友好）
export * from "./types.js";
export type { Storage } from "./storage.js";
export { SqliteStorage, InMemoryStorage } from "./storage.js";

// 公开类
export { Nemos } from "./nemos.js";
export { UserMemory } from "./user-memory.js";

// 共用 helper（被 worker / 其他高级用户使用）
export { persistDerivedList } from "./persist-derived.js";

// v0.7：可审计 Agent 运行时（模型循环、工具调度、取消与上下文接力）
export * from "./agent/index.js";

// v0.7.2: deterministic query planning for multi-channel recall.
export { planRecallQuery } from "./recall.js";

// v0.7.4: persisted salience and evidence coverage.
export {
  SALIENCE_ALGORITHM_VERSION,
  LONG_TERM_SALIENCE_THRESHOLD,
  deriveEvidenceCoverage,
  computeMemorySalience,
  ensureMemoryQualityMetadata,
  determinePromotion,
  hasDurableSalience,
} from "./salience.js";

// v0.7.1：受控事实身份与确定性规范化。
export {
  CLAIM_KEY_VERSION,
  NORMALIZER_VERSION,
  canonicalJson,
  getPredicate,
  listPredicates,
  makeClaimKey,
  normalizeAssertion,
} from "./claims.js";

// prompt 常量（调用方自定义 prompt 时可复用）

export {
  SYSTEM_PROMPT,
  CHECK_SYSTEM_PROMPT,
  SENSITIVITY_GUIDANCE,
  composeSystemPrompt,
  resolveScenario,
  BUILTIN_PROFILES,
} from "./prompts.js";

// v0.4：decay / reflect 模块（power-user 接口）
export {
  resolveDecayConfig,
  reinforceStability,
  computeRetrievability,
  decideDecay,
  runDecayScan,
  DECAY_DEFAULTS,
  type DecayConfig,
  type DecayDecision,
  type DecayScanResult,
} from "./decay.js";
export {
  resolveReflectConfig,
  runReflect,
  REFLECT_DEFAULTS,
  REFLECT_SYSTEM_PROMPT,
  type ReflectConfig,
  type ReflectInput,
  type ReflectResult,
} from "./reflect.js";
export {
  memoriesToMarkdown,
  memoriesToMarkdownTiered,
  memoriesToMarkdownNarrative,
} from "./utils/markdown.js";
