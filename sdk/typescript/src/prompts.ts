// prompts.ts — SYSTEM_PROMPT / CHECK_SYSTEM_PROMPT 常量化 + v0.2 scenario profiles
//
// 抽取 / 审查 prompt 与 nemos schema 约束语义集中于此。

import type { ScenarioProfile } from "./types.js";

/**
 * v0.4 sensitivity 检测引导：内容触及健康话题 / 财务状况 / 亲密关系（配偶/伴侣/家人）/
 * 情绪危机（自杀自残、严重抑郁）/ 身份认同等高私密领域时，请把对应 derived 的
 * `sensitive` 字段置为 true。职场关系、一般人际不算。diary 场景已强制全标 sensitive。
 */
export const SENSITIVITY_GUIDANCE = `\n隐私敏感检测：当 derived 内容涉及以下任一类别时，请将该条 sensitive 字段置为 true：
- 健康（疾病、用药、就诊、身体不适、心理状况）
- 财务（收入、债务、资产、消费困难）
- 亲密关系（配偶 / 伴侣 / 家人 / 同住者之间的互动；不含同事 / 朋友 / 一般人际）
- 情绪危机（强烈负面情绪、自伤自残、生存压力）
- 其它高私密话题（身份认同、性向、宗教取向）
默认行为：默认 search 不返回 sensitive 记录；archival 不受影响（原文用户主权）。如用户原文明显不涉以上类别，sensitive 保持 false。`;

export const SYSTEM_PROMPT = `你是 nemos 记忆分析器，遵循 nemos schema（个人记忆基础设施）。

任务：把用户上传内容分析成结构化 memory。

规则：
1. 用户原文创建 1 条 archival memory（authoritative=true, layer=archival），content 是完整原文。
2. 从原文中提取 derived facts，分配到 episodic / semantic / personal_semantic / procedural 之一：
   - episodic: 一次性事件、瞬间观察、特定时刻发生的事
   - semantic: 一般事实、跨场景适用的知识
   - personal_semantic: 关于用户自己的事实（偏好/技能/关系/目标）
   - procedural: 行为模式、how-to、流程
3. 所有 derived 必须 authoritative=false, chain_depth=1（你是 LLM，是 AI 推断不是用户陈述）
4. 每条 derived 估算 arousal (0-1, 情绪强度) 和 surprise (0-1, 信息新颖度)
5. personal_semantic 应尽量输出结构化事实候选：
   - subject: 当前用户固定写 "user:self"；无法确定主体时写原始称呼，不要猜身份
   - predicate 优先从 identity.name / identity.preferred_address / residence.current / employment.organization / employment.role / workplace.location / relationship.family / contact.emergency / document.passport_expiry / preference.food / preference.communication_style / constraint.health / constraint.safety / device.camera.primary / achievement.personal_best 中选择；不匹配时只省略 predicate，不能因此省略整条记忆
   - object 保存事实值，不要把事实值写进 predicate
   - utterance_mode 判断 literal / roleplay / hypothetical / quoted / joke / uncertain；只有现实中的明确陈述使用 literal
   - specificity 判断 global / contextual / temporary
6. 不要生成 claim_key、哈希或规范化版本号；这些由确定性客户端生成
7. 完整性优先：逐句扫描整段输入，每个独立主题分别抽取；专有名词、人物关系、日期、期限、数字、型号、地点、约束和固定流程不得因不在 predicate 词表中而遗漏
8. 价值排序：优先保留未来可行动或长期有用的信息（证件期限、紧急联系人、偏好、约束、计划、设备和流程）；一次性环境噪声只有在用户明确要求或具有持续影响时才抽取
9. 时间锚点：用户消息中的 event_time 是原文发生时间，也是“今天/明天/昨天/上周”等相对时间的唯一解析基准；不得使用模型调用当天代替
10. 输出前检查原文每个包含人名、专有名词、日期、数字或明确关系的片段，确保已有对应 derived，或确实属于无长期价值的填充内容
11. 表格、排班、清单和键值结构必须保留精确对应关系：不能只概括表名、列名或名单；每个可能被查询的行列交叉关系分别形成事实，并保留姓名、日期、时段、数量与单位
12. derived.content 必须使用对应原文片段的语言，不得翻译；英文事实保持英文，中文事实保持中文，专有名词保留原写法
13. type 表示事实归属：用户经历、状态、计划、偏好和待办必须标为 user；助手提供的通用知识或建议标为 reference；不要因为事实来自助手回复就把其中复述的用户事实标成 reference
14. 同一消息内出现计划、执行、取消或替代时，必须按语义顺序保存最终状态：已经完成、交换或取消的旧动作不得继续写成独立的待办；只剩下的新动作要明确写出。复合句可保留过程，但必须标清哪些已完成、哪些仍待处理

输出严格 JSON（不要 markdown 围栏）：
{
  "archival": {
    "arousal": {"value": 0.0, "signal_sources": []},
    "surprise": {"value": 0.0, "basis": "raw input baseline"}
  },
  "derived": [
    {
      "layer": "episodic" | "semantic" | "personal_semantic" | "procedural",
      "content": "<提取的事实>",
      "type": "project" | "reference" | "user",
      "source": {"authoritative": false, "origin": "llm-extract", "chain_depth": 1},
      "arousal": {"value": 0.0-1.0, "signal_sources": ["punctuation"|"strong_words"|"...其他"]},
      "surprise": {"value": 0.0-1.0, "basis": "<为什么算 surprise>"},
      "event_at": "<可选 ISO 8601 日期或 month 精度；原文有明确时间标识时填，否则省略>",
      "subject": "user:self",
      "predicate": "<可选受控 predicate id>",
      "object": "<可选结构化事实值；数组或对象也可以>",
      "context_dimensions": {"<仅 predicate 允许的维度>": "<值>"},
      "utterance_mode": "literal" | "roleplay" | "hypothetical" | "quoted" | "joke" | "uncertain",
      "specificity": "global" | "contextual" | "temporary",
      "sensitive": false
    }
  ]
}

注意：archival.content 字段不要包含，客户端会强制用原文覆盖。
如果原文极短或没有可提取的事实，derived 可以是空数组 []，但 archival 必须存在。
不要输出 JSON 以外的任何内容。`;

export const CHECK_SYSTEM_PROMPT = `你是 nemos 记忆审查官。

你将收到对**同一份原文**做的两次独立 derived 抽取（A 集合、B 集合）。任务：
1. **去重**：A、B 中表达相同事实的条目合并为一条；保留最清晰、信息密度最高的版本
2. **confidence 评分**：
   - 在 A、B 都出现的事实 → confidence: "high"
   - 仅出现在 A 或 B 之一 → confidence: "medium"
   - 一处明显错抽或粒度过细 → 直接丢弃，不要保留
3. **矛盾检测**：A、B 对同一事实给出冲突描述 → 保留为 1 条，标 confidence: "conflict"，content 用括号注明两种说法
4. **层级一致性**：同一事实在 A 是 episodic、B 是 semantic → 选更准确的那一层，记录 confidence: "medium"
5. **不要新增 A、B 都没有的 derived**——你的任务是审查不是再分析
6. event_at / sensitive / subject / predicate / object / context_dimensions / utterance_mode / specificity 字段：A、B 任一非空都保留；结构冲突时只在已有候选中选择，不新增事实

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
        "chain_depth": 2,
        "pass_count": 1 | 2,
        "confidence": "high" | "medium" | "conflict"
      },
      "arousal": {"value": 0.0-1.0, "signal_sources": [...]},
      "surprise": {"value": 0.0-1.0, "basis": "..."},
      "event_at": "<可选>",
      "subject": "<可选>",
      "predicate": "<可选受控 predicate id>",
      "object": "<可选结构化事实值>",
      "context_dimensions": {},
      "utterance_mode": "literal" | "roleplay" | "hypothetical" | "quoted" | "joke" | "uncertain",
      "specificity": "global" | "contextual" | "temporary",
      "sensitive": false
    }
  ],
  "stats": {
    "pass_a_count": <int>,
    "pass_b_count": <int>,
    "merged_count": <int>,
    "high_confidence": <int>,
    "medium_confidence": <int>,
    "conflicts": <int>
  }
}

不要输出 JSON 以外的任何内容。`;

// ============================================================================
// v0.2 内置 scenario profiles
// ============================================================================

/** 默认 profile：等价 v0.1 行为，无加权无排除。 */
export const PROFILE_DEFAULT: ScenarioProfile = {
  name: "default",
};

/** 聊天对话片段。偏向 episodic + personal_semantic，捕捉情绪与决定。 */
export const PROFILE_CHAT: ScenarioProfile = {
  name: "chat",
  emphasis: {
    layers: { episodic: 1.5, personal_semantic: 1.3 },
    signals: ["emotion", "decision", "relationship"],
  },
  promptAddendum:
    "场景：聊天对话片段。\n" +
    "倾向：把当下感受/决定/关系互动归 episodic；把用户表达过的偏好/身份/目标归 personal_semantic。\n" +
    "重点信号：情绪强度（开心/沮丧/兴奋）、决定（我决定 / 我要 / 我以后）、关系（提到的人/角色）。\n" +
    "对话片段里通用的、跨场景的事实归 semantic；可复用的行为模式归 procedural。",
  temporal: { extractEventDate: true },
};

/** 研报/技术文档。强调 semantic + procedural；排除 personal_semantic（第三方"我"不是用户）。 */
export const PROFILE_DOC_RESEARCH: ScenarioProfile = {
  name: "doc-research",
  emphasis: {
    layers: { semantic: 1.5, procedural: 1.4 },
  },
  exclude: {
    layers: ["personal_semantic"],
  },
  promptAddendum:
    "场景：第三方文档 / 研究报告 / 技术文章。\n" +
    "关键：文档作者不是当前用户。文中出现的'我'/'我们'/作者署名/团队 → 一律不算用户偏好。\n" +
    "倾向：客观事实 / 概念定义 / 数据 / 论点 → semantic；方法 / 流程 / 步骤 / API 用法 → procedural；具体事件 / 发布 / 公告 → episodic。\n" +
    "禁止：不要往 personal_semantic 输出任何 derived；这层是用户偏好层，与文档无关。\n" +
    "如果文中有明确发布日期 / 事件日期，请输出 event_at（ISO 8601）。",
  temporal: { extractEventDate: true },
};

/** 代码 review / 项目笔记。强调 procedural + semantic，捕捉模式与配置。 */
export const PROFILE_CODING: ScenarioProfile = {
  name: "coding",
  emphasis: {
    layers: { procedural: 1.5, semantic: 1.3 },
    signals: ["pattern", "antipattern", "config", "decision"],
  },
  promptAddendum:
    "场景：代码 / 项目笔记 / 工程决策。\n" +
    "倾向：编码规范 / 重构步骤 / 部署流程 → procedural；技术概念 / 库 API / 数据结构 → semantic；具体一次 bug / 一次发版 / 一次会议决定 → episodic；用户的技术偏好 / 擅长栈 / 不喜欢的模式 → personal_semantic。\n" +
    "重点信号：pattern（推荐做法）、antipattern（避免做法）、config（配置/魔法数）、decision（决定使用 X 不用 Y）。",
};

/** 个人日记/情感记录。深度 episodic + personal_semantic；默认 sensitive + hide。 */
export const PROFILE_DIARY: ScenarioProfile = {
  name: "diary",
  emphasis: {
    layers: { episodic: 2.0, personal_semantic: 1.5 },
    signals: ["emotion", "reflection", "growth"],
  },
  promptAddendum:
    "场景：个人日记 / 情感记录 / 内省笔记。\n" +
    "倾向：当天发生的事 / 感受 / 对话 → episodic；从经历中提炼出的关于自己的认识（如「我容易在 X 情境下焦虑」/「我珍视 Y」）→ personal_semantic；总结出的人生观 / 价值观 / 通用智慧 → semantic。\n" +
    "请抽取 event_at（ISO 8601，day 精度）当日记里有明确日期或可推断（如「昨天」/「上周三」以 ingest 时刻为 anchor）。\n" +
    "所有 derived 都包含敏感个人信息 → 输出 sensitive: true。",
  temporal: { extractEventDate: true },
  privacy: { sensitive: true, hideFromSearch: true },
};

/** 会议纪要/语音转写。强调 episodic + procedural，捕捉决定与行动项。 */
export const PROFILE_MEETING: ScenarioProfile = {
  name: "meeting",
  emphasis: {
    layers: { episodic: 1.5, procedural: 1.3 },
    signals: ["decision", "action-item", "commitment", "deadline"],
  },
  promptAddendum:
    "场景：会议纪要 / 多人讨论 / 语音转写。\n" +
    "倾向：会议中的具体讨论 / 谁说了什么 → episodic；达成的流程 / 谁负责什么 / how-to → procedural；通用事实 / 数据 → semantic。\n" +
    "重点信号：decision（决定/拍板）、action-item（待办/谁做）、commitment（承诺/到 X 日期）、deadline（截止日）。\n" +
    "如果会议中提到具体时间点（X 月 Y 日交付），请输出 event_at。\n" +
    "注意：会议中其他人说的话不是当前用户的偏好；只有明确「我（当前用户）」的发言才进 personal_semantic。",
  temporal: { extractEventDate: true },
};

/** 语音转文字。叙事弧线 + episodic。 */
export const PROFILE_VOICE_TRANSCRIPT: ScenarioProfile = {
  name: "voice-transcript",
  emphasis: {
    layers: { episodic: 1.4 },
    signals: ["narrative-arc", "emotion", "context-switch"],
  },
  promptAddendum:
    "场景：语音转文字（可能有口语化、停顿、重复）。\n" +
    "倾向：叙事中的具体事件 / 时间线 → episodic；穿插的偏好表达 → personal_semantic；总结性陈述 → semantic。\n" +
    "重点信号：narrative-arc（开始-中间-结尾）、emotion（叙述时的情绪）、context-switch（话题切换点）。\n" +
    "处理转写错别字时按上下文推断正确意思；不要把停顿词（嗯/啊/然后）当事实。",
  temporal: { extractEventDate: true },
};

/** 所有内置 profile 注册表。 */
export const BUILTIN_PROFILES: Record<string, ScenarioProfile> = {
  default: PROFILE_DEFAULT,
  chat: PROFILE_CHAT,
  "doc-research": PROFILE_DOC_RESEARCH,
  coding: PROFILE_CODING,
  diary: PROFILE_DIARY,
  meeting: PROFILE_MEETING,
  "voice-transcript": PROFILE_VOICE_TRANSCRIPT,
};

/**
 * 把 base SYSTEM_PROMPT 拼上 scenario 引导（emphasis / promptAddendum / temporal 提示）。
 *
 * 顺序：base → 场景声明 → emphasis/exclude 引导 → temporal 引导 → 自定义 promptAddendum。
 */
export function composeSystemPrompt(
  baseSystem: string,
  profile: ScenarioProfile,
): string {
  const parts: string[] = [baseSystem];

  if (profile.name && profile.name !== "default") {
    parts.push(`\n\n=== 场景上下文（scenario: ${profile.name}）===`);
  } else if (!profile.name) {
    parts.push(`\n\n=== 场景上下文（自定义 scenario）===`);
  }

  // Emphasis 引导
  const emphLines: string[] = [];
  if (profile.emphasis?.layers) {
    const entries = Object.entries(profile.emphasis.layers).filter(
      ([, w]) => typeof w === "number" && w !== 1.0,
    );
    if (entries.length > 0) {
      const desc = entries
        .map(([layer, w]) => `${layer}(权重 ${w})`)
        .join("、");
      emphLines.push(`分层偏好：本场景倾向 ${desc}。模糊归属时优先选权重高的层。`);
    }
  }
  if (profile.emphasis?.signals && profile.emphasis.signals.length > 0) {
    emphLines.push(
      `重点信号：请优先捕捉与以下信号相关的 derived：${profile.emphasis.signals.join(" / ")}。`,
    );
  }
  if (profile.exclude?.layers && profile.exclude.layers.length > 0) {
    emphLines.push(
      `排除层：本场景不应产出以下层的 derived：${profile.exclude.layers.join(" / ")}。如果不确定，可丢弃该 derived。`,
    );
  }
  if (emphLines.length > 0) {
    parts.push(emphLines.join("\n"));
  }

  // Temporal 引导
  if (profile.temporal?.extractEventDate) {
    parts.push(
      `时间感知：请抽取 event_at 字段。原文有明确日期（"2026-05-30"）→ ISO 8601 day；只有月份（"去年春天"）→ ISO 8601 month；相对时间（"昨天"/"上周"）→ 以当前 ingest 时刻为 anchor 计算具体日期；无法判断 → 省略 event_at 字段。`,
    );
  }

  if (profile.utteranceMode) {
    parts.push(`表达语境：本段内容按 ${profile.utteranceMode} 处理；不得改写成 literal。`);
  }

  // Privacy 引导
  if (profile.privacy?.sensitive) {
    parts.push(
      `隐私：本场景内容默认包含敏感信息，所有 derived 应标 sensitive: true。`,
    );
  } else if (profile.name !== "diary") {
    // v0.4：非 diary 场景默认拼上 sensitivity 检测引导（diary 已经全标，避免冗余）
    parts.push(SENSITIVITY_GUIDANCE);
  }

  // 自定义 promptAddendum
  if (profile.promptAddendum && profile.promptAddendum.trim().length > 0) {
    parts.push(`\n=== 场景指令 ===\n${profile.promptAddendum.trim()}`);
  }

  return parts.join("\n");
}

/**
 * 解析 IngestOptions.scenario 字段为 ScenarioProfile：
 * - undefined → default profile
 * - string → 查内置；不存在则 throw
 * - object → 与 default 合并（用户字段优先）
 */
export function resolveScenario(
  raw: string | ScenarioProfile | undefined,
): ScenarioProfile {
  if (raw === undefined) return PROFILE_DEFAULT;
  if (typeof raw === "string") {
    const found = BUILTIN_PROFILES[raw];
    if (!found) {
      throw new Error(
        `[nemos] 未知内置 scenario: '${raw}'。可选: ${Object.keys(BUILTIN_PROFILES).join(", ")}。或传 ScenarioProfile object 自定义。`,
      );
    }
    return found;
  }
  // object：浅合并默认字段
  return {
    ...PROFILE_DEFAULT,
    ...raw,
    emphasis: { ...PROFILE_DEFAULT.emphasis, ...raw.emphasis },
    exclude: { ...PROFILE_DEFAULT.exclude, ...raw.exclude },
    temporal: { ...PROFILE_DEFAULT.temporal, ...raw.temporal },
    privacy: { ...PROFILE_DEFAULT.privacy, ...raw.privacy },
    chunking: { ...PROFILE_DEFAULT.chunking, ...raw.chunking },
  };
}
