// analyzer/options.ts — AnalyzeOptions 类型（共用，避免循环依赖）

import type { Perspective, ScenarioProfile } from "../types.js";

export interface AnalyzeOptions {
  /** scenario profile（已解析后的 object；上层调用 resolveScenario 转换好） */
  profile?: ScenarioProfile;
  /** 已知内容产生时间（ISO 8601），覆盖 LLM 抽取 */
  contentDate?: string;
  /** 双 pass 校验（chunk 时强制 false；与 perspectives 互斥） */
  doubleCheck?: boolean;
  /**
   * v0.3：多视角抽取。
   * 非空数组 → 走 multi-perspective 路径（与 doubleCheck 互斥）。
   * chunking 触发时自动关（chunking 自身已是跨段冗余）。
   */
  perspectives?: Perspective[];
}
