export type ExpertRiskLevel = "low" | "medium" | "high";
export type ExpertMemoryMode = "off" | "preferences";

export interface ExpertExecutionContract {
  personaId: string;
  capabilityIds: string[];
  scenario: RegExp;
  tools: string[];
  workflow: string[];
  deliverable: string;
  reviewChecks: string[];
  riskLevel: ExpertRiskLevel;
}

export interface ExpertAssignmentPlan {
  personaId: string;
  responsibility: string;
  capabilityId: string;
  format: "md" | "html";
  memoryMode: ExpertMemoryMode;
  contract: ExpertExecutionContract;
}

export interface ExpertTeamPlan {
  id: string;
  capabilityId: string;
  reason: string;
  assignments: ExpertAssignmentPlan[];
  finalMemoryMode: ExpertMemoryMode;
  finalReviewChecks: string[];
}

export interface DependencyArtifact {
  title: string;
  summary: string;
  text: string;
}

const CONTRACTS: ExpertExecutionContract[] = [
  {
    personaId: "system_architecture",
    capabilityIds: ["project-development", "product-design"],
    scenario: /架构|系统|数据流|接口|API|数据库|权限|安全|性能|扩展|迁移/i,
    tools: ["项目文件读取", "代码搜索", "依赖与配置检查"],
    workflow: ["确认系统边界和状态来源", "检查关键数据流、权限与失败路径", "给出最小可靠结构和验证点"],
    deliverable: "系统边界、关键数据流、主要风险和可验证的架构建议",
    reviewChecks: ["每项判断能对应到任务或项目证据", "覆盖失败与恢复路径", "没有引入无必要的复杂度"],
    riskLevel: "high",
  },
  {
    personaId: "lean_engineering",
    capabilityIds: ["project-development"],
    scenario: /开发|实现|代码|重构|修复|性能|依赖|工程|最小方案/i,
    tools: ["项目文件读写", "代码搜索", "构建与测试"],
    workflow: ["明确当前成功标准", "定位最小可行修改面", "检查实现复杂度并提出可执行方案"],
    deliverable: "精确修改建议、影响范围和验证方式",
    reviewChecks: ["建议能直接落实到当前项目", "没有推测性抽象", "保留未要求改变的既有行为"],
    riskLevel: "high",
  },
  {
    personaId: "quality_testing",
    capabilityIds: ["project-development", "product-design", "presentation-builder", "document-draft", "document-conversion"],
    scenario: /测试|质量|验收|错误|故障|边界|稳定|恢复|真实检查|下载|上传/i,
    tools: ["测试运行", "产物读取", "真实用户路径检查"],
    workflow: ["确认最重要的用户承诺", "覆盖核心、边界和失败恢复场景", "记录可复现证据和剩余风险"],
    deliverable: "按影响排序的问题、复现证据和验收结果",
    reviewChecks: ["核心路径有真实验证", "失败结论附带证据", "未验证内容没有写成已通过"],
    riskLevel: "medium",
  },
  {
    personaId: "release_operations",
    capabilityIds: ["project-development"],
    scenario: /发布|部署|上线|构建|打包|安装|升级|回滚|备份|远端|Git/i,
    tools: ["构建与测试", "版本状态检查", "发布前安全检查"],
    workflow: ["检查构建、配置和依赖", "定义发布验证与回滚路径", "核对敏感信息和最终版本状态"],
    deliverable: "发布检查结果、风险、回滚办法和可核验版本信息",
    reviewChecks: ["构建和发布状态来自真实命令", "敏感信息已检查", "回滚路径明确且可执行"],
    riskLevel: "high",
  },
  {
    personaId: "industry_analysis",
    capabilityIds: ["research-brief", "market-opportunity", "market-briefing"],
    scenario: /研究|行业|市场|竞品|趋势|产业|公司|产品比较|资料/i,
    tools: ["来源搜索", "网页读取", "证据分级"],
    workflow: ["界定研究问题和证据标准", "整理玩家、结构和替代方案", "区分事实、推断与未知"],
    deliverable: "可追溯的事实、结构判断、反证和待核验项",
    reviewChecks: ["关键结论可回指来源", "时效信息标明核验时间", "简介和宣传没有替代代码或一手证据"],
    riskLevel: "medium",
  },
  {
    personaId: "first_principles",
    capabilityIds: ["research-brief", "thinking-workbench", "market-opportunity"],
    scenario: /可行性|验证|假设|约束|原理|为什么|根因|最小实验/i,
    tools: ["任务材料读取", "来源核验", "假设检查"],
    workflow: ["拆分目标、约束和假设", "找出最可能推翻方案的条件", "设计最低成本验证"],
    deliverable: "底层约束、关键假设、反例和最小验证计划",
    reviewChecks: ["事实与假设明确分开", "存在可证伪条件", "建议包含停止或转向信号"],
    riskLevel: "medium",
  },
  {
    personaId: "decision_analysis",
    capabilityIds: ["research-brief", "decision-brief", "thinking-workbench", "market-opportunity", "business-deal"],
    scenario: /决策|选择|取舍|风险|优先级|方案|机会成本|谈判/i,
    tools: ["任务材料读取", "产物比较", "风险检查"],
    workflow: ["定义决策范围和期限", "比较选项、收益、成本与风险", "逆向检查失败路径"],
    deliverable: "方案比较、关键分歧、风险边界和建议条件",
    reviewChecks: ["没有替用户隐藏重要取舍", "结论对应明确前提", "证据不足时保留不确定性"],
    riskLevel: "medium",
  },
  {
    personaId: "product_lead",
    capabilityIds: ["product-design", "presentation-builder", "document-draft", "html-report"],
    scenario: /产品|用户|需求|定位|功能|取舍|叙事|演示|汇报|文档/i,
    tools: ["需求材料读取", "产物预览", "用户路径检查"],
    workflow: ["确认目标用户和核心任务", "压缩信息并做功能取舍", "形成可验收的产品或内容标准"],
    deliverable: "核心用户价值、取舍结论、内容主线和验收标准",
    reviewChecks: ["核心体验可以一句话说明", "每项内容服务于真实用户任务", "默认状态降低理解成本"],
    riskLevel: "low",
  },
  {
    personaId: "user_experience",
    capabilityIds: ["product-design"],
    scenario: /体验|流程|路径|新手|易用|操作|上传|下载|恢复|误解/i,
    tools: ["真实页面检查", "交互状态检查", "小屏路径检查"],
    workflow: ["还原用户从进入到完成的路径", "标记理解、操作和恢复阻力", "按用户影响排序修正建议"],
    deliverable: "真实用户路径、主要阻力、恢复方案和优先级",
    reviewChecks: ["主任务能连续完成", "重要动作有及时反馈", "错误可理解且可恢复"],
    riskLevel: "low",
  },
  {
    personaId: "interface_design",
    capabilityIds: ["product-design", "presentation-builder", "document-draft", "document-conversion", "html-report"],
    scenario: /界面|页面|视觉|图标|配色|排版|布局|PPT|幻灯片|Word|报告/i,
    tools: ["页面或产物预览", "视觉层级检查", "响应式检查"],
    workflow: ["确认主信息和阅读顺序", "检查排版、颜色、图标与组件状态", "核对小屏、打印或放映效果"],
    deliverable: "版式结构、视觉问题、修正标准和最终检查结果",
    reviewChecks: ["信息层级清楚", "视觉语义一致", "目标载体上的可读性已经检查"],
    riskLevel: "low",
  },
  {
    personaId: "interaction_design",
    capabilityIds: ["product-design"],
    scenario: /交互|流程|状态|切换|点击|中断|继续|撤销|恢复/i,
    tools: ["流程检查", "页面状态检查", "异常路径检查"],
    workflow: ["画出主路径和必要分支", "检查默认值、反馈与中断恢复", "删除无价值的选择和中间步骤"],
    deliverable: "主流程、状态转换、异常路径和简化建议",
    reviewChecks: ["操作结果符合用户预期", "没有无意义的准备步骤", "中断后可以继续或恢复"],
    riskLevel: "low",
  },
  {
    personaId: "brand_strategy",
    capabilityIds: ["presentation-builder", "document-draft", "article-polish", "business-deal"],
    scenario: /品牌|命名|文案|传播|营销|受众|表达|包装|标题/i,
    tools: ["材料读取", "内容结构检查", "受众语言检查"],
    workflow: ["确认受众和沟通场景", "压缩核心承诺并补足证据", "检查标题、语气与传播边界"],
    deliverable: "受众判断、核心表达、文案问题和可直接使用的修正版",
    reviewChecks: ["表达具体且可信", "没有空泛或夸张承诺", "关键术语对新手可理解"],
    riskLevel: "low",
  },
  {
    personaId: "critical_thinking",
    capabilityIds: ["thinking-workbench", "decision-brief", "research-brief"],
    scenario: /思考|定义|前提|逻辑|反例|论证|观点|矛盾|偏见/i,
    tools: ["任务材料读取", "论证结构检查", "反例与前提检查"],
    workflow: ["澄清关键概念和命题", "检查隐藏前提、反例和逻辑跳跃", "形成更准确的表述和继续验证问题"],
    deliverable: "命题、前提、反例、逻辑缺口和更可靠的改写",
    reviewChecks: ["概念定义明确", "结论没有超出前提", "反例和不同解释得到处理"],
    riskLevel: "low",
  },
  {
    personaId: "long_term_strategy",
    capabilityIds: ["market-opportunity", "decision-brief", "business-deal", "operator-workflow"],
    scenario: /战略|长期|路线图|复利|护城河|平台|生态|三年|五年|不可逆/i,
    tools: ["任务材料读取", "路径与情景比较", "长期风险检查"],
    workflow: ["确认长期不变需求和目标", "比较路径的可逆性、积累与依赖", "明确阶段重点、放弃事项和转向信号"],
    deliverable: "长期路径、阶段重点、复利结构、风险和停止条件",
    reviewChecks: ["长期判断不依赖短期热点", "不可逆决定有充分证据", "路线包含阶段性验证"],
    riskLevel: "medium",
  },
  {
    personaId: "pricing_finance",
    capabilityIds: ["market-briefing", "market-opportunity", "business-deal", "decision-brief"],
    scenario: /定价|成本|收入|预算|利润|现金流|回本|单价|套餐|财务/i,
    tools: ["数据与表格读取", "财务计算", "敏感性分析"],
    workflow: ["明确收入、成本和关键假设", "计算单位经济与敏感区间", "检查定价、现金流和最坏情景"],
    deliverable: "财务假设、计算、敏感性、定价与风险边界",
    reviewChecks: ["数字标明来源和单位", "计算可以复核", "不确定预测没有写成确定收益"],
    riskLevel: "high",
  },
  {
    personaId: "sales_growth",
    capabilityIds: ["business-deal", "market-opportunity", "operator-workflow"],
    scenario: /销售|增长|获客|线索|客户|转化|渠道|跟进|成交|漏斗/i,
    tools: ["客户与材料读取", "漏斗与触达分析", "跟进计划整理"],
    workflow: ["定义目标客户和排除条件", "检查触达、价值表达和转化阻力", "形成跟进节奏、停止规则和复盘指标"],
    deliverable: "客户判断、价值表达、触达流程、异议和转化实验",
    reviewChecks: ["没有虚构客户承诺", "触达尊重边界和停止规则", "增长建议可以用指标验证"],
    riskLevel: "medium",
  },
  {
    personaId: "startup_validation",
    capabilityIds: ["market-opportunity", "product-design", "operator-workflow", "decision-brief"],
    scenario: /创业|MVP|早期|想法|痛点|需求验证|首批用户|付费验证/i,
    tools: ["用户与市场材料读取", "假设优先级检查", "验证实验设计"],
    workflow: ["压缩用户、痛点和替代方案", "找出最危险假设和首批强需求用户", "设计手动验证、判断信号和停止条件"],
    deliverable: "核心假设、首批用户、最低成本验证和继续或停止信号",
    reviewChecks: ["验证衡量真实使用或付费", "没有用关注度代替需求", "实验可以在短周期内执行"],
    riskLevel: "medium",
  },
  {
    personaId: "research_verification",
    capabilityIds: ["research-brief", "source-finder", "market-opportunity", "market-briefing"],
    scenario: /研究|检索|来源|证据|核验|论文|报告|代码仓库|实现|真假|时效/i,
    tools: ["来源搜索", "网页与仓库读取", "证据分级与交叉核验"],
    workflow: ["建立待核验声明和证据标准", "优先读取一手材料与实际实现", "记录冲突、缺口、时间和可信度"],
    deliverable: "声明与证据对应表、核验结论、来源等级和仍待确认项",
    reviewChecks: ["关键结论均有一手或交叉证据", "宣传简介没有替代真实实现", "时效信息标明核验时间"],
    riskLevel: "medium",
  },
  {
    personaId: "document_editor",
    capabilityIds: ["document-draft", "document-conversion", "meeting-minutes", "article-polish", "html-report"],
    scenario: /文档|Word|报告|方案|文章|长文|润色|改写|纪要|校对|格式/i,
    tools: ["材料与附件读取", "结构化文档生成", "导出与可编辑性检查"],
    workflow: ["确认读者、用途和不可改变信息", "建立结构并统一术语与语气", "检查事实、版式、附件和导出结果"],
    deliverable: "可直接编辑使用的文档结构、正文和校对说明",
    reviewChecks: ["事实、数字和名称未被擅自改写", "结构服务于真实阅读场景", "目标格式可以继续编辑或发送"],
    riskLevel: "low",
  },
  {
    personaId: "presentation_design",
    capabilityIds: ["presentation-builder"],
    scenario: /PPT|演示|幻灯片|汇报|路演|讲稿|放映|页面节奏|版式/i,
    tools: ["材料读取", "演示文稿生成", "放映与版式预览"],
    workflow: ["确认受众、场景和核心主线", "建立页级叙事、视觉和演讲备注", "检查节奏、可读性、图表与放映效果"],
    deliverable: "可放映且可编辑的页级演示方案与版式检查结果",
    reviewChecks: ["一页一个主要信息", "每页视觉形式帮助理解", "开场、转场、结论和行动完整"],
    riskLevel: "low",
  },
  {
    personaId: "data_analysis",
    capabilityIds: ["market-briefing", "market-opportunity", "html-report", "research-brief", "document-conversion"],
    scenario: /数据|表格|Excel|XLSX|CSV|指标|统计|计算|图表|趋势|同比|环比/i,
    tools: ["表格读取", "结构化计算", "图表与复算检查"],
    workflow: ["核对字段、单位、口径和缺失值", "完成可复现计算和异常检查", "呈现结论、限制和复算入口"],
    deliverable: "数据质量说明、计算结果、关键图表和可复算结论",
    reviewChecks: ["计算口径和单位明确", "异常与缺失值已处理", "没有把相关性写成因果"],
    riskLevel: "medium",
  },
  {
    personaId: "project_coordination",
    capabilityIds: ["meeting-minutes", "group-progress-tracker", "operator-workflow", "workflow-builder"],
    scenario: /进度|会议|纪要|群聊|行动项|负责人|截止|依赖|阻塞|跟进/i,
    tools: ["会议与群聊材料读取", "任务状态整理", "行动项与决定记录"],
    workflow: ["提取目标、决定、行动项和未知项", "标明负责人、期限、依赖和状态", "形成下一步、跟进节奏和完成标准"],
    deliverable: "可持续更新的推进表、决定记录、行动项和风险",
    reviewChecks: ["每个行动项有负责人或明确待确认", "决定和建议没有混淆", "进度对应可验证结果"],
    riskLevel: "low",
  },
  {
    personaId: "workflow_automation",
    capabilityIds: ["workflow-builder", "operator-workflow", "group-progress-tracker"],
    scenario: /自动化|流程|触发|定时|重复|批量|审批|重试|通知|连接器|工作流/i,
    tools: ["流程状态检查", "任务与自动化配置", "失败与审计检查"],
    workflow: ["还原人工流程和输入输出", "区分自动、辅助和必须人工的节点", "定义触发、权限、重试、告警和验收"],
    deliverable: "自动化流程、状态、审批、异常和人工接管规则",
    reviewChecks: ["高风险动作保留确认", "重复执行不会产生重复副作用", "失败后有恢复和人工接管路径"],
    riskLevel: "high",
  },
  {
    personaId: "security_compliance",
    capabilityIds: ["project-development", "document-conversion", "workflow-builder", "operator-workflow"],
    scenario: /安全|隐私|权限|密钥|令牌|凭证|泄露|合规|删除|发布|上传|外发|审计/i,
    tools: ["项目与配置检查", "敏感信息扫描", "权限和审计记录检查"],
    workflow: ["列出资产、信任边界和高风险动作", "检查输入、权限、密钥、日志和外发路径", "按严重性给出修复与验证"],
    deliverable: "安全风险、影响、证据、修复和剩余风险",
    reviewChecks: ["敏感信息未进入日志或产物", "权限符合最小授权", "高风险操作有确认、审计和恢复"],
    riskLevel: "high",
  },
  {
    personaId: "contract_risk",
    capabilityIds: ["business-deal", "document-draft", "document-conversion", "decision-brief"],
    scenario: /合同|协议|条款|合作|付款|交付|验收|违约|责任|知识产权|数据归属|谈判/i,
    tools: ["合同与材料读取", "条款结构检查", "风险和待核验项整理"],
    workflow: ["提取主体、权利义务和时间点", "检查付款、验收、责任、数据、知识产权与退出", "标明谈判问题和需律师核验内容"],
    deliverable: "合同风险清单、谈判问题和专业律师核验入口",
    reviewChecks: ["不冒充执业律师或给确定性法律结论", "模糊承诺转为可验收条件", "高风险条款说明最坏后果"],
    riskLevel: "high",
  },
  {
    personaId: "visual_analysis",
    capabilityIds: ["image-prompt-reconstruction", "presentation-builder", "product-design"],
    scenario: /图片|图像|截图|构图|光线|色彩|材质|风格|提示词|复刻|视觉/i,
    tools: ["图像读取", "可见证据分析", "视觉提示词结构化"],
    workflow: ["识别主体、空间和信息层级", "拆解构图、光色、材质和表现技法", "形成可复用描述并标注不确定性"],
    deliverable: "基于可见证据的视觉拆解、完整提示词、精简提示词和负面约束",
    reviewChecks: ["没有虚构画面外信息", "参数足以支持复现", "不确定身份、品牌和来源未被写成事实"],
    riskLevel: "low",
  },
];

const DEFAULT_TEAMS: Record<string, string[]> = {
  "project-development": ["system_architecture", "lean_engineering", "quality_testing"],
  "research-brief": ["research_verification", "industry_analysis", "first_principles", "decision_analysis"],
  "source-finder": ["research_verification", "industry_analysis", "first_principles"],
  "market-opportunity": ["startup_validation", "industry_analysis", "long_term_strategy", "decision_analysis"],
  "market-briefing": ["industry_analysis", "data_analysis", "research_verification", "decision_analysis"],
  "product-design": ["product_lead", "user_experience", "interface_design", "interaction_design"],
  "presentation-builder": ["product_lead", "presentation_design", "brand_strategy", "visual_analysis"],
  "document-draft": ["document_editor", "product_lead", "interface_design"],
  "document-conversion": ["document_editor", "quality_testing", "interface_design"],
  "ocr-extraction": ["document_editor", "quality_testing", "data_analysis"],
  "meeting-minutes": ["project_coordination", "document_editor", "decision_analysis"],
  "group-progress-tracker": ["project_coordination", "workflow_automation", "decision_analysis"],
  "operator-workflow": ["workflow_automation", "project_coordination", "interaction_design", "quality_testing"],
  "workflow-builder": ["workflow_automation", "interaction_design", "quality_testing", "security_compliance"],
  "article-polish": ["document_editor", "brand_strategy", "product_lead"],
  "business-deal": ["sales_growth", "contract_risk", "decision_analysis", "pricing_finance"],
  "decision-brief": ["decision_analysis", "first_principles", "contract_risk"],
  "thinking-workbench": ["critical_thinking", "first_principles", "decision_analysis"],
  "image-prompt-reconstruction": ["visual_analysis", "interface_design"],
  "html-report": ["product_lead", "interface_design", "quality_testing"],
};

const RESPONSIBILITIES: Record<string, string> = {
  system_architecture: "检查系统边界、数据流、权限和失败恢复",
  lean_engineering: "确认最小可靠实现、影响范围和工程复杂度",
  quality_testing: "按真实用户路径和交付标准验证完整性",
  release_operations: "核对构建、发布、安全检查和回滚路径",
  industry_analysis: "核验来源、实际实现和行业结构判断",
  first_principles: "拆解约束、关键假设和可证伪条件",
  decision_analysis: "比较方案、机会成本、风险和关键分歧",
  product_lead: "确认目标用户、核心价值和内容取舍",
  user_experience: "检查端到端用户路径、理解成本和恢复能力",
  interface_design: "检查信息层级、版式、视觉一致性和载体适配",
  interaction_design: "检查流程、状态反馈、中断恢复和多余步骤",
  brand_strategy: "检查受众理解、核心表达和传播可信度",
  research_verification: "核验关键声明、来源等级、实际实现和时效",
  document_editor: "整理正式文档结构、语言、事实和可编辑格式",
  presentation_design: "建立演示主线、页级叙事、版式和放映节奏",
  data_analysis: "检查数据口径、质量、计算、图表和结论边界",
  project_coordination: "整理决定、负责人、依赖、阻塞和下一步",
  workflow_automation: "设计触发、状态、审批、重试和人工接管",
  security_compliance: "检查权限、敏感信息、不可信输入和高风险操作",
  contract_risk: "检查合作条款、交付验收、责任和知识产权风险",
  visual_analysis: "按可见证据拆解图像并形成可复用视觉说明",
  critical_thinking: "检查定义、前提、反例和逻辑跳跃",
  long_term_strategy: "比较长期路径、复利结构、不可逆风险和阶段重点",
  pricing_finance: "核对财务假设、计算、敏感性和定价边界",
  sales_growth: "检查目标客户、触达、异议、漏斗和转化实验",
  startup_validation: "设计首批用户、危险假设和最低成本需求验证",
};

export function expertContract(personaId: string): ExpertExecutionContract | undefined {
  return CONTRACTS.find((item) => item.personaId === personaId);
}

export function planExpertTeam(input: { capabilityId: string; instruction: string }): ExpertTeamPlan {
  const defaults = DEFAULT_TEAMS[input.capabilityId] ?? ["first_principles", "decision_analysis", "quality_testing"];
  const scores = new Map<string, number>();
  for (const contract of CONTRACTS) {
    let score = defaults.includes(contract.personaId) ? 10 - defaults.indexOf(contract.personaId) : 0;
    if (contract.capabilityIds.includes(input.capabilityId)) score += 4;
    if (contract.scenario.test(input.instruction)) score += 9;
    if (score > 0) scores.set(contract.personaId, score);
  }
  const selected = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([personaId]) => expertContract(personaId)!)
    .filter(Boolean);
  const assignments = selected.map<ExpertAssignmentPlan>((contract) => ({
    personaId: contract.personaId,
    responsibility: RESPONSIBILITIES[contract.personaId] ?? contract.deliverable,
    capabilityId: input.capabilityId === "project-development" && contract.capabilityIds.includes("project-development")
      ? "project-development"
      : contract.capabilityIds.includes("research-brief") && /研究|核验|来源|市场|行业|竞品/i.test(input.instruction)
        ? "research-brief"
        : "decision-brief",
    format: contract.capabilityIds.includes("research-brief") ? "html" : "md",
    memoryMode: "off",
    contract,
  }));
  return {
    id: `team-${input.capabilityId}`,
    capabilityId: input.capabilityId,
    reason: teamReason(input.capabilityId, assignments.length),
    assignments,
    finalMemoryMode: "preferences",
    finalReviewChecks: [
      "完整满足原任务，而不是只汇总专家意见",
      "关键结论能回指任务材料、专家证据或真实验证",
      "交付形式与所选能力一致并可直接使用",
      "明确标出未验证内容、限制和剩余风险",
    ],
  };
}

export function expertAssignmentPrompt(assignment: ExpertAssignmentPlan, objective: string): string {
  const contract = assignment.contract;
  return [
    "你是小丑鱼本次任务中临时调用的内部专业执行单元。不要向用户介绍专家体系或内部配置。",
    `主任务：${objective}`,
    `本次职责：${assignment.responsibility}`,
    `风险等级：${contract.riskLevel}`,
    `可用工具方向：${contract.tools.join("、")}。工具不可用时明确记录缺口，不得假装执行。`,
    "执行流程：",
    ...contract.workflow.map((item, index) => `${index + 1}. ${item}`),
    `必须交付：${contract.deliverable}`,
    "复核标准：",
    ...contract.reviewChecks.map((item) => `- ${item}`),
    "只处理本次职责；给出具体发现、证据和可执行建议，不代替小丑鱼做最终交付。",
  ].join("\n");
}

export function finalDeliveryPrompt(input: {
  objective: string;
  reviewChecks: string[];
}): string {
  return [
    "结合下面完整的专家交付完成原任务。专家内容是内部材料，不要逐人复述，也不要向用户暴露内部专家配置。",
    `原任务：${input.objective}`,
    "必须直接交付最终结果，不能只总结意见或只给执行计划。",
    "最终复核：",
    ...input.reviewChecks.map((item) => `- ${item}`),
  ].join("\n");
}

export function dependencyArtifactBlock(
  refs: readonly string[],
  resolveArtifact: (id: string) => DependencyArtifact | null,
  maximumChars = 120_000,
): string {
  const sections: string[] = [];
  let used = 0;
  for (const ref of refs) {
    const id = ref.startsWith("artifact:") ? ref.slice("artifact:".length) : "";
    if (!id) continue;
    const artifact = resolveArtifact(id);
    if (!artifact) continue;
    const section = [
      `【专家交付：${artifact.title}】`,
      `提炼摘要：${artifact.summary || "未提供摘要"}`,
      "完整原文：",
      artifact.text,
    ].join("\n");
    const remaining = maximumChars - used;
    if (remaining <= 0) break;
    sections.push(section.slice(0, remaining));
    used += Math.min(section.length, remaining);
  }
  if (sections.length === 0) return "";
  return `\n\n以下是依赖任务的提炼摘要和完整原文，必须实际阅读后再完成最终交付：\n\n${sections.join("\n\n")}`;
}

function teamReason(capabilityId: string, count: number): string {
  const labels: Record<string, string> = {
    "project-development": "开发任务需要工程、质量与必要的发布检查",
    "research-brief": "研究任务需要来源核验、假设检查和决策复核",
    "product-design": "产品设计需要同时检查价值、路径、界面和状态",
    "presentation-builder": "演示交付需要同时检查叙事、版式和受众表达",
  };
  return `${labels[capabilityId] ?? "任务需要多角度独立检查"}，本次调用 ${count} 项专业检查。`;
}
