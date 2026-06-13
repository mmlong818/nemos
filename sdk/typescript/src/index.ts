// index.ts — 公开 API 入口（v0.3.1 后纯 re-export shim）
//
// 朋友 import 这里：
//   import { Mnemos } from '@mnemos/sdk';
//   const mem = new Mnemos({ storage: {...}, llm: {...} });
//   await mem.forUser('alice').ingest('...');
//
// v0.3.1 refactor：Mnemos 类拆到 mnemos.ts，UserMemory 拆到 user-memory.ts，
// persistDerivedList 拆到 persist-derived.ts；本文件仅做 re-export。

// 重新导出公共类型（朋友 IDE intellisense 友好）
export * from "./types.js";
export type { Storage } from "./storage.js";
export { SqliteStorage, InMemoryStorage } from "./storage.js";

// 公开类
export { Mnemos } from "./mnemos.js";
export { UserMemory } from "./user-memory.js";

// 共用 helper（被 worker / 其他高级用户使用）
export { persistDerivedList } from "./persist-derived.js";

// prompt 常量（朋友自定义 prompt 时可复用）
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
