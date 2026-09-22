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
  /**
   * 只作审计说明，不进运行提示；文字均为独立撰写。
   */
  provenance?: ReadonlyArray<{ name: string; url: string; previewSha256: string }>;
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

/**
 * 所有能力共用的反"AI 味"约束。前半段是本仓库一直有的事实纪律；后半段（占位写法、
 * 虚构示例标记、伪托引言、和稀泥式评价）来自作者演示文稿生成器里的 anti-slop 规则，
 * 见 presentation-generator lib/prompts.ts。
 */
const SHARED_CONSTRAINTS = "不编造数字、人名、日期与来源；无法核实的写「待核验」并说明缺什么。没有来源的数据用「—」占位并注「需引用：来源类型」；材料里没有的故事、案例、名人引言一律不写，必须举例时以「[虚构示例]」开头。比较一律用表格。开头不复述任务，结尾不承诺稍后补做，评价不写「总体不错但」式的和稀泥。";

const gh = (repo: string, path: string, commit: string, previewSha256: string) => ({
  url: `https://github.com/mmlong818/${repo}`,
  previewSha256,
});
const CAT = (path: string, sha: string) => gh("Cat-Research", path, "3ae393e", sha);
const PDW = (path: string, sha: string) => gh("product-design-workbench", path, "472ef91", sha);
const MAOSHU = (path: string, sha: string) => gh("maoshu-ui-design-methodology", path, "b4b742a", sha);
const CODEX = (path: string, sha: string) => gh("Codex-skills", path, "92f6d3c", sha);
const PRESGEN = (path: string, sha: string) => gh("presentation-generator", path, "3dc7b73", sha);

/** 与 web/assets/workflow-catalog.js 中面向用户的 backendId 一一对应；tests/unit/skill-contract.test.ts 钉住覆盖率。 */
export const BUILTIN_SKILL_CONTRACTS: Readonly<Record<string, SkillContract>> = {
  "research-brief": {
    input: "研究问题一句话；已有材料或链接（可选）；时间窗与地域（缺省近 6 个月、以近 3 个月为优先层，不限地域；要扩到更早须用户明确同意）；读者与用途；明确不在范围内的事项。",
    output: "① 需求澄清：目标、范围、时间窗（写具体日期）、角度、排除项、意图类型（找信息 / 解题 / 探索 / 比选 / 产出文档）② 问题拆解 3–6 个子问题与检索计划，每条注明时效层与语言 ③ 来源表：编号、来源、类型、可信等级（1 权威机构与一手数据 / 2 主流媒体与专业机构 / 3 一般网站 / 4 未知来源）、发布日期、结论摘录 ④ 声明核查表：关键声明、判定（已证实 / 有争议 / 无法核实 / 依据不足）、支持与反驳来源数 ⑤ 主要发现，每条回指来源编号 ⑥ 三句结论：确定的、有争议的、待核验的，附结论自评（证据充分性、逻辑严密性、覆盖面、局限说明）⑦ 下一步可做的一次验证。",
    constraints: `正文不超过 1500 字；检索不超过 5 次。每条信息标发布日期，超过 6 个月的标「历史参考」，日期不明标「日期未知」并降权；科技与国际话题至少含一次英文检索。重要结论须有两个以上独立来源，只有一个时标「单一来源」；4 级来源不得单独支撑结论。找不到可靠来源就写明缺口而不是补一段泛泛的背景。${SHARED_CONSTRAINTS}`,
    provenance: [
      CAT("agents/clarifier.py", "C9CC02C5032240BE77ACC78C9B6CDED36AAABDF0CCE78A1348DBD532D5524085"),
      CAT("agents/planner.py", "11A27845E0CA0DDF29C786FCBB0424AA2692ED68B8B055B12B9C6F357AF8DD43"),
      CAT("agents/researcher.py", "1FF8CE4FE14FAFC5240A7D799853D31D46F67ECD64920EA34D1EFD9FEC5D7426"),
      CAT("agents/source_verifier.py", "8F4696D9C76DA2A98B7A3C50209158512F4B5839FFACF967A011CF4B7C340700"),
      CAT("agents/conclusion_validator.py", "4F0A94981D59BD14A99D07DA07AE37A441A573384E364E15427952E95D35E568"),
    ],
  },
  "decision-brief": {
    input: "要做的决定一句话；可选方案（没有就由能力先列出）；已知事实与限制；决定的截止时间与可逆程度；谁拍板。",
    output: "背景 → 方案表（方案、收益、成本、风险、可逆性）→ 证据状态（每条关键依据标已证实 / 推断 / 待核验）→ 异议地图：从用户、竞争、成本、可交付、盲区五个立场各提最锋利的 1–2 条，列严重度、防御判定（挡得住 / 勉强 / 挡不住）与判定依据 → 建议与触发条件（什么情况下改选）→ 残余风险 → 需要用户拍板的 1–3 个问题。",
    constraints: `方案不超过 4 个；每个风险标高 / 中 / 低。异议判定不许全是「挡得住」，判定依据须引材料原文或指出其缺失；残余风险明说不粉饰。不替用户做出最终决定。${SHARED_CONSTRAINTS}`,
    provenance: [PDW("api/battle_studio.py", "03499F9B400D2AD45E33A3623424805B999E59E4E094B4E57C612B7815663F43")],
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
    input: "演讲目的、听众与场合；核心材料（用户给的素材必须优先采纳）；页数上限与时长（缺省 10 页、10 分钟，约每分钟 1 页）；是否需要讲者备注。",
    output: "叙事框架选择（学术通用 / 高管决策的结论先行 / 战略诊断的情境—冲突—问题—答案 / 感召大众的现状与愿景交替 / 产品发布 / 培训传播）与一句话叙事弧线 → 逐页计划：观点句标题（≤30 字）、这页只讲的一个观点、支撑证据与来源、版式（陈述 / 数据 / 对比 / 流程 / 引言 / 论点—支撑 / 提问 / 行动）、建议时长、讲者备注 → 开场、转折、结论、下一步各有独立页。",
    constraints: `标题必须是观点句，不是话题词；每页只讲一个观点。同一版式最多连续 2 页，连续 2–4 张信息页后安排一张低密度页；页数不超过上限，各页时长之和等于总时长的 ±10%。不为「丰富」硬套人物、案例、矩阵版式；不把长文分页当演示。${SHARED_CONSTRAINTS}`,
    provenance: [
      PRESGEN("lib/prompts.ts", "AA3A2FE377CD6D350CFFA969E616442B36D4473CF93540DC7189C54FB43F1005"),
      PRESGEN("docs/layout-spec.md", "0A8B7F74F1A53EA133691102E76EA3133CD3FCEA5D06F5FC0DDBE72489737E89"),
    ],
  },
  "thinking-workbench": {
    input: "模糊的问题原话；已知事实与已排除的选项；用户最在意的一个约束；这次要到哪一步（看清问题 / 定方向 / 定验证）。",
    output: "问题重述 → 关键问题 → 假设图（事实 / 假设 / 解释 / 矛盾 / 未知）→ 至少两种解释框架并列 → 反方论点（以全新的怀疑视角写，具体到能改什么）→ 成功标准：3–5 条可独立检验的判据及权重 → 低成本验证 → 决策信号与下一步。",
    constraints: `至少两种解释框架。反方论点必须具体可操作，「很好但可以更好」式的批评无效；判据不允许模糊表述。证据不足时明确写「暂不下结论」；总长不超过 1200 字。${SHARED_CONSTRAINTS}`,
    provenance: [CODEX("skills-zh-cn/harness-thinking/SKILL.md", "15F20F32B83A0613562E4D9FE3FC479D83DB14AE4B87B0ABC12CBE26EB085BD9")],
  },
  "product-design": {
    input: "用户是谁、要完成的真实任务；现有流程或界面（可选，注明是亲自看过还是听说）；硬性限制（平台、合规、技术栈）；必须保留的现有功能、数据与品牌约束。",
    output: "用户与情境 → 主任务与成功标准（完成结果在界面上如何被观察）→ 端到端流程（进入条件、触发、主要动作、系统处理、完成证据）→ 信息架构 → 关键界面，含状态矩阵：默认、加载、成功、空态（按原因区分）、校验错误、服务错误、禁用、权限不足、破坏性确认 → 文案：页面标题、主按钮、成功、错误、危险确认各按公式写 → 响应式行为 → 验收清单 → 证据说明：已观察、推断、未验证路径与剩余风险。",
    constraints: `空态必须区分首次未配置 / 真实零值 / 筛选无结果 / 权限不足 / 加载失败，各配与原因一致的动作。主按钮写「动词 + 对象」；成功文案写结果、范围与下一步；错误文案写原因与修法；不写「操作成功」「出错了」；没有后台进度事件不写百分比。需要比较的数据用表格不卡片化。验收项可被人工逐条勾选，只勾已观察或已验证的；不用组件堆砌替代流程；不把未访问、未运行的材料写成亲自验证。${SHARED_CONSTRAINTS}`,
    provenance: [
      MAOSHU("references/decision-patterns.md", "D03C7BCAA0C2E63268ED70C920C7073E521E35F781C600DE07511FE404490E4F"),
      MAOSHU("references/checklist.md", "3322056557534B1F8D0749472EDBEF2DB2A3AF494FF0500B7CFED7F0844F3CD3"),
      MAOSHU("references/content-standards.md", "84B3038483794FE8900E4C0F6338C86B5A0DFA2927DA52F33C1070526B34D610"),
    ],
  },
  "business-deal": {
    input: "对方公司与角色；合作目标；已有往来记录；我方底线与不可谈项。",
    output: "客户背景 → 关键人地图 → 双方价值 → 证据 → 未决问题 → 预计异议与应对 → 谈判边界 → 会议议程 → 跟进消息草稿 → 下一步。",
    constraints: `不编造对方承诺、预算与权限；跟进草稿每封不超过 150 字；异议至少 3 条且各配一条应对。${SHARED_CONSTRAINTS}`,
  },
  "market-opportunity": {
    input: "目标用户与要解决的问题；现有替代方案；已知需求信号或数据（带日期）；商业限制；可接受的验证预算与时间。",
    output: "机会卡：问题陈述（谁 / 场景 / 困难 / 代价 / 现有解法 / 缺口）→ 现有替代 → 需求信号（标数据日期）→ 竞争结构与差异化（一句话定位加 3 条支撑理由）→ 机会评分：痛点强度、市场规模、可行性各 1–5 并写依据 → 假设表：需求 / 方案 / 商业 / 可行性四类，各标重要性与不确定性，选出最优先验证的一条 → 对抗质询：从挑剔用户、竞品负责人、商业化负责人三个立场各提 1–2 条 → 机会论点一句话 → 使论点失效的条件 → 一周内可执行的低成本验证与通过 / 不通过的量化标准。",
    constraints: `市场规模类数字必须带来源与日期，否则标「估算」；评分依据只取材料，不凭感觉。至少写出 2 个失效条件；对抗质询不许全部「挡得住」。验证计划一周内可执行且有量化判据。${SHARED_CONSTRAINTS}`,
    provenance: [
      PDW("api/routes/product.py", "BD8E18E2F3FEC94C7D15DEA8510941F4370CEB6D2CD09985D767FCD9BBD96512"),
      PDW("api/battle_studio.py", "03499F9B400D2AD45E33A3623424805B999E59E4E094B4E57C612B7815663F43"),
    ],
  },
  "ability-builder": {
    input: "反复出现的工作是什么（一句话，说得宽就收窄）；过去 3 次的真实例子；输入从哪来、输出给谁；已有的脚本或参考材料（可选）。",
    output: "资格判断（重复出现、需被触发、边界清楚、有可复用输出契约四条逐一判定）→ 一句话描述（做什么 + 何时用）→ 触发测试集：应触发 5–8 条、不应触发 3–5 条、近邻易混 3–5 条 → 必需输入 → 有序步骤 → 决策规则 → 输出契约 → 异常路径 → 验收检查 → 十项自检评分（触发精确度、知识增量、示例质量、反模式对照、结构、篇幅、语气一致、边界情形、可执行性、完整性）。",
    constraints: `一次性、模糊或不安全的自动化直接拒绝并说明原因，「以后可能有用」不算理由。描述先经触发测试集检验再定稿，近邻仍误触发就收紧；步骤不超过 9 步；只写模型不知道的内容，不写营销语言和理论长篇。自检低于 8 分的项先改再交付。${SHARED_CONSTRAINTS}`,
    provenance: [
      gh("skillforge", "skill/SKILL.md", "3bd2a89", "4991FB6BC938BBAA1A16F469E13947DF5F78082E98471B8AEE1C40E791773FA8"),
      CODEX("skills-zh-cn/skillforge-generator/references/skillforge-method.md", "769B5279256AD2B02D5B290A3F0EC08E7A2DDA8CE4D15E187BD21851A67BDEF9"),
    ],
  },
  "topic-evaluation": {
    input: "候选选题列表（每行一条）；目标受众与平台；已做过的选题及表现（可选）；这批选题的时效窗口。",
    output: "按优先级排序的选题表：选题、受众、切入角度、难点、时效层（近 3 个月 / 3–6 个月 / 更早）、预计表现（高 / 中 / 低）、理由 → 每条的证据状态：材料里有依据 / 推断 / 无依据 → 不做的选题及原因 → 建议先做的 3 条与各自一条发布后可观察的验证信号。",
    constraints: `每条理由不超过 40 字；按结构而不是按主题归类相似选题。「预计表现」只能基于材料里的过往表现，否则明确写「推断」；不把没有依据的「爆款预测」写成事实；不声称掌握实时热度。${SHARED_CONSTRAINTS}`,
    provenance: [CAT("agents/planner.py", "11A27845E0CA0DDF29C786FCBB0424AA2692ED68B8B055B12B9C6F357AF8DD43")],
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
