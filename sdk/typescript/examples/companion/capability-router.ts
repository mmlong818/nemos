export interface CapabilityRouteInput {
  goal: string;
  materialNames?: string[];
  workspacePath?: string;
}

export interface CapabilityRouteResult {
  capabilityId: string;
  catalogId: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface RouteRule {
  capabilityId: string;
  catalogId: string;
  patterns: RegExp[];
  reason: string;
}

const ROUTES: RouteRule[] = [
  { capabilityId: "ability-builder", catalogId: "ability", patterns: [/(生成|创建|新增|沉淀|锻造).{0,8}(能力|技能)/i, /做成.{0,6}(能力|技能)/i], reason: "目标是沉淀可重复使用的能力" },
  { capabilityId: "meeting-minutes", catalogId: "meeting", patterns: [/(整理|生成|输出|写成|做成).{0,10}(会议纪要|会议记录|行动项)|(?:会议纪要|会议记录).{0,10}(整理|生成|输出)|把.{0,24}(记录|讨论|访谈).{0,12}(整理|提炼).{0,8}(纪要|行动项)/i], reason: "用户明确要求把记录整理成会议纪要" },
  { capabilityId: "thinking-workbench", catalogId: "thinking", patterns: [/(?:按|依照).{0,8}(?:紧急程度|优先级).{0,8}(?:整理|安排|排序)|(?:紧急程度|优先级).{0,8}(?:整理|安排|排序)/i], reason: "目标是先安排优先级和行动顺序" },
  { capabilityId: "project-development", catalogId: "developer", patterns: [/开发|写代码|改代码|修复.{0,8}(问题|bug)|项目检查|代码库|仓库|(?:构建|测试).{0,12}(代码|项目|仓库|软件|程序|接口)|(?:代码|项目|仓库|软件|程序|接口).{0,12}(构建|测试)/i], reason: "目标需要读取和修改项目文件" },
  { capabilityId: "presentation-builder", catalogId: "presentation", patterns: [/PPT|演示文稿|路演|幻灯|课件|(?:生成|制作|做成|输出).{0,8}(汇报|提案)|(?:汇报|提案).{0,8}(PPT|演示|大纲|材料)/i], reason: "目标交付物是演示文稿" },
  { capabilityId: "quick-speech", catalogId: "speech", patterns: [/语音转写|音频转写|录音转写|视频转写|识别音频|听写/i], reason: "目标是把音频内容快速转成文字" },
  { capabilityId: "quick-translate", catalogId: "translate", patterns: [/翻译|中译英|英译中|译成|译文/i], reason: "目标是快速翻译文字" },
  { capabilityId: "quick-polish", catalogId: "polish", patterns: [/轻量润色|文字润色|校对错别字|清理标点/i], reason: "目标是轻量清理文字表达" },
  { capabilityId: "meeting-minutes", catalogId: "meeting", patterns: [/会议|纪要|访谈|录音|讨论记录/i], reason: "材料属于会议或访谈记录" },
  { capabilityId: "market-briefing", catalogId: "marketBrief", patterns: [/港股|股票|行情|公告|财报|盘前|盘后|自选|持仓|HKEX/i], reason: "目标需要整理市场与证券资料" },
  { capabilityId: "product-design", catalogId: "product", patterns: [/产品|界面|交互|原型|用户体验|功能设计|用户路径|操作流程|能力页|文件工作流|工作台设计/i], reason: "目标是设计产品流程或界面" },
  { capabilityId: "business-deal", catalogId: "business", patterns: [/商务|合作|销售|客户|谈判|成交|跟进/i], reason: "目标是推进商务合作" },
  { capabilityId: "decision-brief", catalogId: "decision", patterns: [/决策|比较|选择|取舍|评估|该不该/i], reason: "目标是比较方案并作出判断" },
  { capabilityId: "market-opportunity", catalogId: "market", patterns: [/市场|赛道|机会|定位|竞品|增长/i], reason: "目标是评估市场机会" },
  { capabilityId: "research-brief", catalogId: "research", patterns: [/研究|调研|资料|调查|行业|搜集|分析报告|核验|威胁建模|提示注入|安全审计|隐私风险/i], reason: "目标需要检索和核验资料" },
  { capabilityId: "html-report", catalogId: "web", patterns: [/网页|HTML|页面|网站|可视化/i], reason: "目标交付物是独立网页" },
  { capabilityId: "document-draft", catalogId: "document", patterns: [/文档|文章|总结|说明|方案|写作|润色|周报|月报|日报|材料整理|项目复盘/i], reason: "目标交付物是正式文稿" },
  { capabilityId: "thinking-workbench", catalogId: "thinking", patterns: [/思考|梳理|头脑风暴|复盘|想法|困惑|优先级|紧急程度|时间安排/i], reason: "目标需要先拆解问题" },
];

const EXTENSION_ROUTES: Record<string, Omit<CapabilityRouteResult, "confidence">> = {
  ".ppt": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".pps": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".pot": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".pptx": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".pptm": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".ppsx": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".ppsm": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".odp": { capabilityId: "presentation-builder", catalogId: "presentation", reason: "已附带演示文稿材料" },
  ".doc": { capabilityId: "document-draft", catalogId: "document", reason: "已附带文档材料" },
  ".docx": { capabilityId: "document-draft", catalogId: "document", reason: "已附带文档材料" },
  ".docm": { capabilityId: "document-draft", catalogId: "document", reason: "已附带文档材料" },
  ".odt": { capabilityId: "document-draft", catalogId: "document", reason: "已附带文档材料" },
  ".rtf": { capabilityId: "document-draft", catalogId: "document", reason: "已附带文档材料" },
  ".epub": { capabilityId: "document-draft", catalogId: "document", reason: "已附带电子书材料" },
  ".xls": { capabilityId: "document-draft", catalogId: "document", reason: "已附带表格材料" },
  ".xlsx": { capabilityId: "document-draft", catalogId: "document", reason: "已附带表格材料" },
  ".xlsm": { capabilityId: "document-draft", catalogId: "document", reason: "已附带表格材料" },
  ".xlsb": { capabilityId: "document-draft", catalogId: "document", reason: "已附带表格材料" },
  ".ods": { capabilityId: "document-draft", catalogId: "document", reason: "已附带表格材料" },
  ".csv": { capabilityId: "document-draft", catalogId: "document", reason: "已附带表格材料" },
  ".pdf": { capabilityId: "document-draft", catalogId: "document", reason: "已附带 PDF 材料" },
  ".txt": { capabilityId: "document-draft", catalogId: "document", reason: "已附带文本材料" },
  ".md": { capabilityId: "document-draft", catalogId: "document", reason: "已附带 Markdown 材料" },
};

export function routeCapability(input: CapabilityRouteInput): CapabilityRouteResult {
  const goal = String(input.goal || "").trim().slice(0, 4000);
  const workspacePath = String(input.workspacePath || "").trim();
  if (workspacePath) {
    return { capabilityId: "project-development", catalogId: "developer", confidence: "high", reason: "已指定项目工作区" };
  }

  const materialNames = (input.materialNames || []).map((name) => String(name || "").toLowerCase());
  const hasReadableDocument = materialNames.some((name) => /\.(?:docx?|docm|odt|rtf|epub|ppt|pps|pot|pptx|pptm|ppsx|ppsm|odp|xls|xlsx|xlsm|xlsb|ods|pdf|txt|md|csv|json)$/.test(name));
  if (hasReadableDocument && /(提取|摘要|总结|整理|归纳|改写|润色|校对|转换|阅读|分析)(?:.{0,12})(?:附件|文件|材料|内容|要点|原文)?/i.test(goal)) {
    return {
      capabilityId: "document-draft",
      catalogId: "document",
      confidence: "high",
      reason: "目标是处理已附带的文档内容",
    };
  }

  for (const rule of ROUTES) {
    if (rule.patterns.some((pattern) => pattern.test(goal))) {
      return { capabilityId: rule.capabilityId, catalogId: rule.catalogId, confidence: "high", reason: rule.reason };
    }
  }

  for (const name of materialNames) {
    const normalized = String(name || "").toLowerCase();
    const extension = Object.keys(EXTENSION_ROUTES).find((item) => normalized.endsWith(item));
    if (extension) return { ...EXTENSION_ROUTES[extension], confidence: "medium" };
  }

  return {
    capabilityId: "thinking-workbench",
    catalogId: "thinking",
    confidence: "low",
    reason: "目标还不够明确，先整理问题和成功标准",
  };
}
