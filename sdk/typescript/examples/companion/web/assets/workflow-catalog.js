/* Single catalog for the tool launcher and built-in workflow Bots. No user data or permissions are changed here. */
(() => {
  const CATALOG = [
  { id: "presentation", backendId: "presentation-builder", name: "做 PPT", icon: "presentation", summary: "生成可放映、可继续编辑的演示文稿", description: "先梳理受众和叙事主线，再生成有版式变化、演讲备注和网页预览的 PowerPoint。", use: "汇报、提案、课程分享、路演", deliverable: "可编辑 PPTX 与网页预览", format: "pptx", featured: true, detail: "生成页面结构、版式、备注和可编辑文件" },
  { id: "document", backendId: "document-draft", name: "写正式文档", icon: "document", summary: "起草、改写和整理正式内容", description: "根据目标和材料生成结构完整的文稿，也能沿用你的常用文笔与排版习惯。", use: "方案、总结、说明、长文", deliverable: "可编辑文稿", format: "doc", featured: true, detail: "形成结构清楚、可以继续编辑的文稿" },
  { id: "research", backendId: "research-brief", name: "深度研究", icon: "search", summary: "搜索来源、核验声明并形成可追溯结论", description: "围绕一个问题规划研究路径，搜索并分级来源，对关键声明做独立复核，清楚标出证据和限制。", use: "行业研究、竞品、专题调研", deliverable: "带来源台账的研究报告", format: "html", featured: true, detail: "规划、搜索、来源分级、事实核验和结论复审" },
  { id: "marketBrief", backendId: "market-briefing", name: "查港股资料", icon: "trend", summary: "读取公告、行情快照并整理盘前盘后简报", description: "按股票代码读取港交所官方公告和带查询时间的第三方行情快照；明确延迟、来源和待核验项，不提供交易指令。", use: "自选股、公告核验、盘前盘后复盘", deliverable: "带来源与时间戳的市场资料简报", format: "html", detail: "读取关注代码、官方公告、行情快照和风险边界" },
  { id: "thinking", backendId: "thinking-workbench", name: "梳理复杂问题", icon: "lightbulb", summary: "把模糊问题变成可操作的思考工作台", description: "分开事实、假设、矛盾和未知，保留多个选项，形成可以勾选和补充的验证计划。", use: "问题拆解、创意探索、复盘", deliverable: "可交互思考工作台", format: "html", featured: true, detail: "梳理问题、假设、选择和验证办法" },
  { id: "product", backendId: "product-design", name: "设计产品界面", icon: "layout", summary: "从用户任务形成页面和交互方案", description: "先理清真实用户路径，再产出信息结构、关键界面、交互说明和验收要点。", use: "新功能、界面改版、产品方案", deliverable: "产品设计说明", format: "html", featured: true, detail: "形成用户流程、页面结构与设计说明" },
  { id: "meeting", backendId: "meeting-minutes", name: "整理会议纪要", icon: "checklist", summary: "从记录中提炼结论和行动项", description: "把会议文字整理成摘要、决定、责任人、截止时间、风险和未决问题。", use: "会议记录、访谈、讨论复盘", deliverable: "纪要与行动表", format: "doc", featured: true, detail: "提炼决定、行动项与未决问题" },
  { id: "translate", backendId: "quick-translate", name: "翻译文字", icon: "translate", summary: "中英文自动识别并直接翻译", description: "用于快速处理中英文互译，结果可以复制或保存为文本。", use: "短文、邮件、即时内容", deliverable: "可复制译文", format: "txt", quickTool: true, detail: "自动识别语言并输出译文" },
  { id: "speech", backendId: "quick-speech", name: "语音转写", icon: "mic", summary: "把音频、视频或现场录音转成文字", description: "支持选择文件或直接录音，长音频会自动分段识别并合并。", use: "录音、访谈、视频、口述", deliverable: "可保存转写文本", format: "txt", quickTool: true, detail: "上传或录音后生成完整文字" },
  { id: "polish", backendId: "quick-polish", name: "文字润色", icon: "polish", summary: "清理错别字、标点和断句", description: "轻量改善文字表达，不扩写新信息，也不改变原意。", use: "消息、邮件、短文、初稿", deliverable: "可复制润色文本", format: "txt", quickTool: true, detail: "保持原意并改善文字表达" },
  { id: "web", backendId: "html-report", name: "做网页报告", icon: "globe", summary: "把内容制作成独立网页", description: "生成不依赖外部服务、可直接在浏览器打开的单页内容。", use: "报告、说明页、互动展示", deliverable: "独立 HTML 网页", format: "html", detail: "制作可直接打开的独立网页" },
  { id: "decision", backendId: "decision-brief", name: "比较方案", icon: "scale", summary: "比较证据、风险与行动条件", description: "把零散信息整理成可判断的选择，说明收益、代价、风险和什么时候应该改变决定。", use: "选型、取舍、优先级判断", deliverable: "决策简报", format: "md", detail: "比较方案、风险和行动条件" },
  { id: "business", backendId: "business-deal", name: "推进商务合作", icon: "handshake", summary: "建立关键人、异议和跟进工作台", description: "梳理双方价值、关键人、异议、谈判边界和跟进动作，话术可以直接复制使用。", use: "合作、销售、谈判、跟进", deliverable: "可执行商务推进台", format: "html", detail: "准备合作策略、异议处理与跟进动作" },
  { id: "market", backendId: "market-opportunity", name: "模拟市场机会", icon: "trend", summary: "用多种情景检验机会是否成立", description: "从用户、竞争、执行和不确定性出发，调整权重比较不同情景，形成机会判断和低成本验证计划。", use: "市场洞察、机会评估、定位", deliverable: "可调节情景模拟台", format: "html", detail: "比较需求、竞争和执行情景，明确失效条件" },
  { id: "topic", backendId: "topic-evaluation", name: "评估选题", icon: "lightbulb", summary: "把一批候选选题排出优先级并说明取舍", description: "对你或「深度研究」给出的候选逐条判断做还是不做，写清理由、受众、难点和放弃的原因。不抓平台热搜，也不声称掌握实时热度。", use: "内容排期、选题取舍、二创判断", deliverable: "带排序依据的选题判断", format: "md", detail: "逐条判断、理由、受众、难点与排序依据" },
  { id: "videoScript", backendId: "video-script", name: "写短视频脚本", icon: "mic", summary: "把一个选题写成可直接开拍的脚本", description: "输出 3 个开头备选、带时间轴的分段口播与画面提示、一个结尾动作，并列出用到的平台、时长、受众、目标假设。", use: "口播视频、短视频、图文转视频", deliverable: "可照读的分段脚本", format: "md", detail: "开头备选、分段口播、画面提示与参数假设" },
  { id: "ability", backendId: "ability-builder", name: "扩展构建（高级）", icon: "branch", summary: "构建并验证本机技能扩展，不是创建文字", description: "高级工具：先判断是否值得沉淀，再生成触发边界、输入、步骤、异常路径和测试；通过检查后加入本机技能库。只需编辑文字工作规则时，请到技能库。", use: "本机技能扩展与触发测试", deliverable: "已验证并安装的本机技能", format: "html", detail: "资格判断、触发测试、技能生成和本机安装" },
];
  const identities = {
    presentation: ["演示制作", "写作表达"],
    document: ["文档写作", "写作表达"],
    research: ["资料研究", "决策验证"],
    marketBrief: ["港股资料", "决策验证"],
    thinking: ["问题梳理", "工作推进"],
    product: ["产品设计", "工作推进"],
    meeting: ["会议纪要", "日程沟通"],
    web: ["网页报告", "写作表达"],
    decision: ["方案比较", "决策验证"],
    business: ["商务推进", "工作推进"],
    market: ["市场机会", "决策验证"],
    topic: ["选题评估", "自媒体"],
    videoScript: ["短视频脚本", "自媒体"]
  };
  const workflows = CATALOG.filter(item => identities[item.id]).map(item => Object.freeze({
    ...item, name: identities[item.id][0], category: identities[item.id][1],
    execution: "capability-workflow", editable: false,
    href: "/capabilities?bot=" + encodeURIComponent(item.id)
  }));
  window.ClownfishWorkflowCatalog = Object.freeze({
    capabilities: Object.freeze(CATALOG.map(Object.freeze)),
    workflows: Object.freeze(workflows),
    resolve: id => workflows.find(item => item.id === id),
    tools: Object.freeze(CATALOG.filter(item => !identities[item.id]))
  });
})();
