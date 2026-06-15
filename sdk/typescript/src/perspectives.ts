// perspectives.ts — v0.3 多视角抽取
//
// 取代 v0.2 "同 prompt 双 pass + check pass" 的单一审查思路，转向
// "多个特化视角并行抽 → merge pass 合并"：
//
//   [content]
//     ├─ Fact      → semantic / reference 倾向
//     ├─ Emotion   → episodic / personal_semantic 倾向（情绪、关系、态度）
//     ├─ Method    → procedural 倾向（how-to / 流程 / 模式）
//     ├─ Decision  → episodic / personal_semantic（决定、承诺、行动项）
//     ├─ Temporal  → episodic（事件序列 + event_at）
//     └─ ...merge → confidence 由出现视角数决定
//
// 每个 perspective 是 SYSTEM_PROMPT 的特化版本。merge 不复用 v0.2
// CHECK_SYSTEM_PROMPT，因为输入语义不同（多视角同份原文 vs 双 pass 同视角）。

import type { Perspective } from "./types.js";

// ============================================================================
// 默认启用的视角组合
// ============================================================================

/** v0.3 默认开启的三视角；朋友可在 features.perspectives 覆盖。 */
export const DEFAULT_PERSPECTIVES: Perspective[] = [
  "fact",
  "method",
  "decision",
];

/** 5 个内置视角（合法集合）。 */
export const ALL_PERSPECTIVES: readonly Perspective[] = [
  "fact",
  "emotion",
  "method",
  "decision",
  "temporal",
] as const;

// ============================================================================
// 视角 sub-prompt
//
// 每个 sub-prompt 是 SYSTEM_PROMPT 的窄化版：相同 JSON 输出契约 + 强约束，
// 仅改变 "关注什么" 这一段。避免在 prompt 里塞太多场景知识，让单视角更聚焦。
// ============================================================================

const COMMON_RULES = `
规则：
1. 用户原文创建 1 条 archival memory（authoritative=true, layer=archival），content 是完整原文。
2. 从原文中提取 derived facts，分配到 episodic / semantic / personal_semantic / procedural 之一：
   - episodic: 一次性事件、瞬间观察、特定时刻发生的事
   - semantic: 一般事实、跨场景适用的知识
   - personal_semantic: 关于用户自己的事实（偏好/技能/关系/目标）
   - procedural: 行为模式、how-to、流程
3. 所有 derived 必须 authoritative=false, chain_depth=1（AI 推断不是用户陈述）
4. 每条 derived 估算 arousal (0-1) 和 surprise (0-1)
5. 不要输出 JSON 以外的任何内容；不要 markdown 围栏。

输出契约（archival.content 字段省略，客户端会用原文覆盖）：
{
  "archival": { "arousal": {...}, "surprise": {...} },
  "derived": [
    {
      "layer": "...", "content": "...", "type": "...",
      "source": { "authoritative": false, "origin": "llm-extract", "chain_depth": 1 },
      "arousal": {...}, "surprise": {...},
      "event_at": "<可选 ISO 8601>",
      "sensitive": false
    }
  ]
}`;

export const PERSPECTIVE_FACT = `你是 nemos 记忆分析器（fact 视角）。

视角焦点：**客观事实、数据、对比、引用、概念定义**。
- 仅抽取可独立验证的客观陈述、数字、引文、术语定义、对比结论。
- 忽略情绪强度、内心活动、动机推测——那些由 emotion 视角处理。
- 倾向归类到 semantic（一般事实）/ episodic（事件中提到的事实）。
- 对"我喜欢 X"这种自陈情感不要抽（personal_semantic 由其他视角处理）。

${COMMON_RULES}`;

export const PERSPECTIVE_EMOTION = `你是 nemos 记忆分析器（emotion 视角）。

视角焦点：**情绪信号、关系互动、态度、感受倾向**。
- 抽取用户对人/事/物表现出的情感反应、关系描述、态度立场。
- 用中性、抽象的方式描述情绪强度，避免复述敏感细节。
- 高 arousal 优先归 episodic（具体情境）或 personal_semantic（稳定倾向）。
- 忽略与情绪无关的纯客观数据——fact 视角负责。

${COMMON_RULES}`;

export const PERSPECTIVE_METHOD = `你是 nemos 记忆分析器（method 视角）。

视角焦点：**方法论、流程、模式、how-to、配置**。
- 抽取可复用的步骤、规范、推荐做法、反模式、配置约定。
- 倾向归类到 procedural。
- 忽略一次性事件细节——decision/temporal 视角负责。
- 忽略事实型定义——fact 视角负责。

${COMMON_RULES}`;

export const PERSPECTIVE_DECISION = `你是 nemos 记忆分析器（decision 视角）。

视角焦点：**决定、承诺、行动项、转折点**。
- 抽取"决定做 X / 选了 A 而非 B / 答应了 / 要在 Y 之前完成"这类信号。
- 高 surprise（决策点常意味着方向调整）。
- 归类：具体一次决定 → episodic；稳定决策模式 → personal_semantic。
- 忽略客观事实陈述——fact 视角负责。

${COMMON_RULES}`;

export const PERSPECTIVE_TEMPORAL = `你是 nemos 记忆分析器（temporal 视角）。

视角焦点：**时间线、事件序列、时序关系**。
- 抽取带明确或可推断时间的事件，输出 event_at（ISO 8601）。
- 相对时间（昨天/上周/三月前）→ 以当前 ingest 时刻为 anchor 计算。
- 倾向归类到 episodic。
- 没有时间锚点的纯事实由 fact 视角负责。

${COMMON_RULES}`;

const PROMPT_BY_PERSPECTIVE: Record<Perspective, string> = {
  fact: PERSPECTIVE_FACT,
  emotion: PERSPECTIVE_EMOTION,
  method: PERSPECTIVE_METHOD,
  decision: PERSPECTIVE_DECISION,
  temporal: PERSPECTIVE_TEMPORAL,
};

export function getPerspectivePrompt(p: Perspective): string {
  return PROMPT_BY_PERSPECTIVE[p];
}

// ============================================================================
// Merge pass prompt
// ============================================================================

/**
 * 合并多视角输出。
 *
 * 输入：每个视角各自产生的 derived 数组（标了 perspective 来源）。
 * 输出：合并后的 derived 列表，每条带 perspectives 数组字段。
 *
 * 与 v0.2 CHECK_SYSTEM_PROMPT 的差异：
 * - 这里输入是 N 个视角（语义异质），不是双 pass（语义同源）。
 * - confidence 规则由"多少视角都看到"决定，不再依赖 LLM 主观判定。
 * - 矛盾标 perspectives_conflict=true，content 用括号注明两种说法。
 */
export const MULTI_PERSPECTIVE_MERGE_PROMPT = `你是 nemos 多视角合并器。

你将收到对**同一份原文**做的多视角独立抽取（每条 derived 标了 from_perspective）。任务：

1. **跨视角合并**：内容表达同一事实的条目合并为 1 条。
   - 合并时填 perspectives 数组（如 ["fact","decision"]），记录所有看到该事实的视角。
   - content 选最清晰、信息密度最高的版本。
   - 取信息密度更高的 event_at / sensitive。
2. **冲突检测**：不同视角对同一事实给出冲突描述：
   - 仍保留为 1 条；perspectives_conflict=true。
   - content 用括号注明两种说法。例：「X（fact 视角）/ 反 X（emotion 视角暗示）」。
3. **不要新增视角都没看到的 derived**——你的任务是合并不是再抽取。
4. **层级一致性**：同事实在多视角分到不同层 → 选最准确的；如难判断，保留出现次数最多的层。
5. **忽略噪声**：仅出现在 1 视角且明显粒度过细 / 噪声 → 可丢弃。

输出严格 JSON（不要 markdown 围栏）：
{
  "derived": [
    {
      "layer": "episodic" | "semantic" | "personal_semantic" | "procedural",
      "content": "<合并后最清晰的表述>",
      "type": "user" | "feedback" | "project" | "reference",
      "source": {
        "authoritative": false,
        "origin": "llm-merged",
        "chain_depth": 2
      },
      "arousal": {"value": 0.0-1.0, "signal_sources": [...]},
      "surprise": {"value": 0.0-1.0, "basis": "..."},
      "event_at": "<可选 ISO 8601>",
      "sensitive": false,
      "perspectives": ["fact", "decision"],
      "perspectives_conflict": false
    }
  ],
  "stats": {
    "input_count": <int>,
    "merged_count": <int>,
    "high_confidence": <int>,
    "medium_confidence": <int>,
    "conflicts": <int>
  }
}

不要输出 JSON 以外的任何内容。`;

// ============================================================================
// Confidence 推导（不依赖 LLM，client-side 规则）
// ============================================================================

/**
 * 由 perspectives 数组 + conflict 标记推导 confidence。
 * - conflict=true → 'conflict'
 * - perspectives.length >= 2 → 'high'
 * - perspectives.length == 1 → 'medium'
 * - 否则（兜底）→ 'low'
 */
export function deriveConfidence(
  perspectives: Perspective[] | undefined,
  conflict: boolean | undefined,
): "high" | "medium" | "low" | "conflict" {
  if (conflict === true) return "conflict";
  const n = perspectives?.length ?? 0;
  if (n >= 2) return "high";
  if (n === 1) return "medium";
  return "low";
}
