/**
 * 技能契约：每项面向用户的执行能力都要说清三件事——吃什么输入、交什么输出、守什么约束。
 *
 * 只有一段自然语言规则时，模型容易把任务跑成"先规划、再检索、再复核"却交不出正文
 * （真实使用里"每日资料简报"就是这样以 max_rounds 收场的）。把输入格式、输出结构和
 * 长度/禁忌显式写出来，产物才可核验，例行任务才有边界。
 *
 * 契约是能力定义的一部分，随能力进运行提示；这里不做任何模型调用。
 */
export interface SkillContract {
  /** 期望的输入形态：需要哪些材料、每条记录什么格式、缺失时怎么办。 */
  input: string;
  /** 交付物的结构：章节顺序、表格列、结尾的判断句式。 */
  output: string;
  /** 硬约束：长度上限、禁用说法、不得编造的字段、必须标注的状态。 */
  constraints: string;
}

export function renderSkillContract(contract: SkillContract): string {
  return [
    "Skill contract:",
    `- 输入契约：${contract.input.trim()}`,
    `- 输出契约：${contract.output.trim()}`,
    `- 约束：${contract.constraints.trim()}`,
  ].join("\n");
}

export function isCompleteSkillContract(value: unknown): value is SkillContract {
  if (!value || typeof value !== "object") return false;
  const contract = value as Record<string, unknown>;
  return (["input", "output", "constraints"] as const).every((key) => typeof contract[key] === "string" && contract[key].trim().length >= 12);
}

const SHARED_CONSTRAINTS = "不编造数字、人名、日期与来源；无法核实的写「待核验」并说明缺什么。比较一律用表格。开头不复述任务，结尾不承诺稍后补做。";

/** 与 web/assets/workflow-catalog.js 中面向用户的 backendId 一一对应；tests/unit/skill-contract.test.ts 钉住覆盖率。 */
export const BUILTIN_SKILL_CONTRACTS: Readonly<Record<string, SkillContract>> = {
  "research-brief": {
    input: "研究问题一句话；已有材料或链接（可选）；时间窗与地域（缺省为最近 30 天、不限地域）；读者是谁。",
    output: "① 问题拆解（3–6 个子问题）② 来源表：来源、类型、权威等级、核验时间、结论摘录 ③ 主要发现，每条回指来源编号 ④ 三句结论：确定的、有争议的、待核验的 ⑤ 下一步可做的一次验证。",
    constraints: `正文不超过 1500 字；检索不超过 5 次；找不到可靠来源就写明缺口而不是补一段泛泛的背景。${SHARED_CONSTRAINTS}`,
  },
  "decision-brief": {
    input: "要做的决定一句话；可选方案（没有就由能力先列出）；已知事实与限制；决定的截止时间。",
    output: "背景 → 方案表（方案、收益、成本、风险、可逆性）→ 证据状态 → 建议与触发条件（什么情况下改选）→ 需要用户拍板的 1–3 个问题。",
    constraints: `方案不超过 4 个；每个风险标高/中/低；不替用户做出最终决定。${SHARED_CONSTRAINTS}`,
  },
  "html-report": {
    input: "报告主题与读者；数据表或要点（每行一条，字段用竖线分隔）；希望的版式（editorial / dashboard / brief，缺省 brief）。",
    output: "单页可打印 HTML：标题、摘要、分节正文、结构化表格；图表用 table data-chart 结构化数据；结尾一段「本报告依据与局限」。",
    constraints: `不引用外部 CDN；表格列名与输入字段一致；没有数据的图表不画。${SHARED_CONSTRAINTS}`,
  },
  "document-draft": {
    input: "文档用途与读者；正文要点或原始材料；格式要求（字数、章节、是否需要附录）。",
    output: "标题、摘要（≤150 字）、按章节编号的正文、必要表格、结论、附录；结构可直接写入 Word。",
    constraints: `保留材料中的原始数字与措辞，改动处在「修改说明」里列出；不加入材料之外的事实。${SHARED_CONSTRAINTS}`,
  },
  "meeting-minutes": {
    input: "会议转写、聊天记录或草稿原文；会议主题、时间、参会人（能从原文推出就不必另给）；是否需要跟进消息草稿。",
    output: "会议信息 → 三句摘要 → 决议清单 → 行动项表（负责人、事项、截止、依赖、状态）→ 待决问题与风险 → 可选跟进草稿。",
    constraints: `未点名的负责人写「未指定」，未说明的日期写「待定」；区分事实与推断；行动项每条不超过 30 字。${SHARED_CONSTRAINTS}`,
  },
  "presentation-builder": {
    input: "演讲目的、听众与场合；核心材料；页数上限与时长（缺省 10 页、10 分钟）。",
    output: "叙事主线一句话 → 逐页计划：标题、关键信息、支撑证据、版式建议、讲者备注 → 开场、转折、结论、下一步各有独立页。",
    constraints: `每页只讲一个观点；版式至少 3 种交替；页数不超过上限；不把长文分页当演示。${SHARED_CONSTRAINTS}`,
  },
  "thinking-workbench": {
    input: "模糊的问题原话；已知事实与已排除的选项；用户最在意的一个约束。",
    output: "问题重述 → 关键问题 → 假设图（事实 / 假设 / 解释 / 矛盾 / 未知）→ 备选框架 → 反方论点 → 低成本验证 → 决策信号与下一步。",
    constraints: `至少两种解释框架；证据不足时明确写「暂不下结论」；总长不超过 1200 字。${SHARED_CONSTRAINTS}`,
  },
  "product-design": {
    input: "用户是谁、要完成的真实任务；现有流程或界面（可选）；硬性限制（平台、合规、技术栈）。",
    output: "用户与情境 → 主任务与成功标准 → 端到端流程 → 信息架构 → 关键界面（含状态与错误）→ 文案语言 → 响应式行为 → 验收清单。",
    constraints: `每个界面给出空态、加载、错误三种状态；验收项可被人工逐条勾选；不用组件堆砌替代流程。${SHARED_CONSTRAINTS}`,
  },
  "business-deal": {
    input: "对方公司与角色；合作目标；已有往来记录；我方底线与不可谈项。",
    output: "客户背景 → 关键人地图 → 双方价值 → 证据 → 未决问题 → 预计异议与应对 → 谈判边界 → 会议议程 → 跟进消息草稿 → 下一步。",
    constraints: `不编造对方承诺、预算与权限；跟进草稿每封不超过 150 字；异议至少 3 条且各配一条应对。${SHARED_CONSTRAINTS}`,
  },
  "market-opportunity": {
    input: "目标用户与要解决的问题；现有替代方案；已知需求信号或数据；商业限制。",
    output: "目标用户与问题 → 现有替代 → 需求信号（标数据日期）→ 竞争结构 → 差异化 → 风险 → 机会论点一句话 → 使论点失效的条件 → 低成本验证计划。",
    constraints: `市场规模类数字必须带来源与日期，否则标「估算」；至少写出 2 个失效条件；验证计划一周内可执行。${SHARED_CONSTRAINTS}`,
  },
  "ability-builder": {
    input: "反复出现的工作是什么；过去 3 次的真实例子；输入从哪来、输出给谁。",
    output: "是否值得沉淀的判断 → 正/负触发示例各 3 条 → 必需输入 → 有序步骤 → 决策规则 → 输出契约 → 异常路径 → 验收检查 → 触发测试用例。",
    constraints: `一次性、模糊或不安全的自动化直接拒绝并说明原因；步骤不超过 9 步；触发测试必须含近似但不该触发的反例。${SHARED_CONSTRAINTS}`,
  },
  "topic-evaluation": {
    input: "候选选题列表（每行一条）；目标受众与平台；已做过的选题及表现（可选）。",
    output: "按优先级排序的选题表：选题、受众、切入角度、难点、预计表现（高/中/低）、理由 → 不做的选题及原因 → 建议先做的 3 条。",
    constraints: `每条理由不超过 40 字；按结构而不是按主题归类相似选题；不把没有依据的「爆款预测」写成事实。${SHARED_CONSTRAINTS}`,
  },
  "video-script": {
    input: "一个选题；目标时长与平台；创作者风格描述或过往表现好的开头（可选）；产品或信息点。",
    output: "3 个备选开头（前 1 秒文字与画面）→ 按秒段分镜表：时间、口播、画面、屏幕文字 → 中段防流失的一个变化点 → 结尾动作。",
    constraints: `口播总字数按时长折算（每秒约 4 字）不得超出；开头必须在 3 秒内兑现承诺；不出现广告腔与空泛形容词。${SHARED_CONSTRAINTS}`,
  },
  "market-briefing": {
    input: "关注标的或板块；时段（盘前 / 盘中 / 盘后 / 周度）；用户持仓或关注清单（可选）。",
    output: "范围 → 来源地图 → 关注表：标的、催化剂、来源状态、行情时效、风险、下一步核验 → 风险边界 → 一句可在聊天里说的口语摘要。",
    constraints: `不给买卖建议；行情、成交、持仓类数字必须带时间与提供方；公告优先于新闻；拿不到实时数据时改为核验清单。${SHARED_CONSTRAINTS}`,
  },
};
