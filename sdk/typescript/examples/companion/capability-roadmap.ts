export type RoadmapStatus = "done" | "doing" | "next" | "later" | "excluded";

export interface RoadmapItem {
  id: string;
  title: string;
  outcome: string;
  status: RoadmapStatus;
}

export interface RoadmapPhase {
  id: string;
  title: string;
  goal: string;
  items: RoadmapItem[];
}

export interface CapabilityRoadmap {
  updatedAt: string;
  completed: number;
  total: number;
  percent: number;
  phases: RoadmapPhase[];
}

const PHASES: RoadmapPhase[] = [
  {
    id: "foundation",
    title: "能力底座",
    goal: "把客户端、角色、任务执行、产物保存和后台能力层分开。",
    items: [
      { id: "local-client", title: "独立客户端和本机服务", outcome: "客户端只负责展示，服务负责记忆、能力和产物。", status: "done" },
      { id: "streaming-delivery", title: "流式任务执行", outcome: "角色执行任务时实时显示状态和输出。", status: "done" },
      { id: "artifact-save", title: "可打开的产物", outcome: "任务结果保存为 MD、HTML、JSON、文本或文档草稿。", status: "done" },
      { id: "capability-panel", title: "能力与任务入口", outcome: "能力、任务、产物集中在左侧入口。", status: "done" },
    ],
  },
  {
    id: "capability-os",
    title: "能力操作系统",
    goal: "让角色拥有可扩展、可审查、可复用的后台能力，而不是一组固定功能。",
    items: [
      { id: "tool-registry", title: "后台工具注册表", outcome: "能力层知道有哪些工具、是否可用、适合什么任务。", status: "done" },
      { id: "source-connectors", title: "来源连接器框架", outcome: "港股使用真实只读资料源；出行和餐旅请求只返回可靠来源类型与核验边界。", status: "done" },
      { id: "skill-files", title: "自学能力写成技能文件", outcome: "生成/自学能力会落盘为 SKILL.md，并记录使用数据。", status: "done" },
      { id: "roadmap-maintained", title: "开发路线可维护", outcome: "设计文档和路线图接口使用同一组可核验状态；客户端不展示无意义的百分比卡片。", status: "done" },
    ],
  },
  {
    id: "open-ended-system",
    title: "无限需求系统",
    goal: "面对未知需求时，系统先判断该怎么解决，再生成或接入能力。",
    items: [
      { id: "unbounded-goal-design", title: "开放式目标重定义", outcome: "系统目标从固定助手升级为可扩展个人 AI 工具。", status: "done" },
      { id: "demand-intake-router", title: "需求识别与能力匹配", outcome: "新需求先进入能力匹配、缺口判断和下一步建议流程。", status: "done" },
      { id: "capability-gap-report", title: "能力缺口报告", outcome: "遇到不能直接完成的事，明确缺什么工具、数据源、账号或人工确认。", status: "done" },
      { id: "auto-skill-draft", title: "自动生成技能草案", outcome: "从一次成功任务中提炼可复用技能、步骤和边界。", status: "done" },
      { id: "connector-proposal", title: "连接器方案生成", outcome: "新领域能自动提出数据源、API、网页自动化或人工核验方案。", status: "done" },
    ],
  },
  {
    id: "real-connectors",
    title: "真实信息源",
    goal: "从通用搜索升级为可验证的结构化来源。",
    items: [
      { id: "market-adapter", title: "港股/市场资料适配器", outcome: "真实读取本机关注列表、港交所官方公告和带时间戳的第三方行情快照，支持盘前/盘后简报。", status: "done" },
      { id: "travel-adapter", title: "动车/航班来源适配器", outcome: "产品明确不接入实时查询与预订适配器；遇到相关请求只说明核验边界。", status: "excluded" },
      { id: "hotel-restaurant-adapter", title: "酒店/餐馆来源适配器", outcome: "产品明确不接入实时查询与预订适配器；不把它列为后续缺口。", status: "excluded" },
      { id: "source-verification-ui", title: "来源可信度展示", outcome: "产物里直接显示已确认、待核验和不可确认的内容。", status: "done" },
    ],
  },
  {
    id: "document-content",
    title: "文档与内容能力",
    goal: "让日常办公输入可以被识别、转换、整理和润色。",
    items: [
      { id: "ocr-support", title: "OCR 文字识别", outcome: "图片、截图、扫描件能进入文字提取、表格重建和不确定项标记流程。", status: "done" },
      { id: "document-conversion-support", title: "文档转换", outcome: "文本、Markdown、HTML、JSON 和文档草稿能按目标格式重组输出。", status: "done" },
      { id: "meeting-minutes-support", title: "会议纪要", outcome: "会议转写、聊天记录和草稿能整理成纪要、决议和行动项。", status: "done" },
      { id: "group-progress-support", title: "群聊进展跟踪", outcome: "群聊、项目讨论和同步记录能整理成进展看板、阻塞项和提醒候选。", status: "done" },
      { id: "article-polish-support", title: "文章润色", outcome: "文章、帖子、报告段落能按目标读者和风格润色并保留改动说明。", status: "done" },
    ],
  },
  {
    id: "learning-maintenance",
    title: "自学习维护",
    goal: "让能力越用越准，同时避免技能库变乱。",
    items: [
      { id: "skill-curator", title: "技能审查和归档", outcome: "长期不用、重复或低质量技能会被标记或归档。", status: "done" },
      { id: "session-artifact-search", title: "会话和产物检索", outcome: "角色能找回以前做过的报告、来源和结论。", status: "done" },
      { id: "skill-pinning", title: "技能固定与状态维护", outcome: "技能支持固定、停用、陈旧提醒和归档，并保留可审查的状态变化。", status: "done" },
      { id: "skill-improvement-loop", title: "使用后改进技能", outcome: "结果页收集可用/需改进证据；只有用户确认后才把成功流程或失败边界写回技能。", status: "done" },
    ],
  },
  {
    id: "workers-plugins",
    title: "后台工作与扩展",
    goal: "把复杂任务交给后台 worker，并允许逐步扩展能力生态。",
    items: [
      { id: "worker-queue", title: "后台 worker 队列", outcome: "复杂任务不堵塞聊天，完成后由角色交付。", status: "done" },
      { id: "subagent-handoff", title: "子任务执行器", outcome: "研究、整理、写作、核验可以拆给不同 worker。", status: "done" },
      { id: "plugin-abi", title: "插件接口", outcome: "新增模型、搜索、浏览器、数据源不需要改核心。", status: "done" },
      { id: "mcp-bridge", title: "MCP 桥接", outcome: "官方 stdio provider 可发现并调用外部 MCP 工具，并按 Agent 运行隔离子进程。", status: "done" },
      { id: "credential-proxy", title: "MCP 凭证代理", outcome: "第三方进程只持有短期代理令牌，真实 Key 由主进程按地址和方法范围代为注入。", status: "done" },
      { id: "mcp-os-sandbox", title: "MCP 操作系统沙箱", outcome: "Node MCP 使用独立 Node 26.5.0 权限沙箱；Python 与直接可执行 MCP 使用 Windows LPAC，均按清单限制文件、进程和网络并失败关闭。", status: "done" },
      { id: "audited-actions", title: "统一写操作审计", outcome: "聊天审批与客户端明确发起的设置、角色、群组、任务和扩展写操作都留下统一运行记录。", status: "done" },
      { id: "durable-delivery", title: "持久结果交付", outcome: "后台结果重启后仍可交付，客户端按 jobId 去重并在显示成功后向服务端确认。", status: "done" },
      { id: "multi-agent-observability", title: "多角色质量与消耗", outcome: "协作任务显示完成率、交付检查、复核状态、模型调用、真实 Token、硬预算和费用估算。", status: "done" },
    ],
  },
  {
    id: "runtime-closure",
    title: "统一执行闭环",
    goal: "把能力目录、六个入口、扩展和开发引擎的声明变成可验证的真实执行能力。",
    items: [
      { id: "all-runtime-tools", title: "核心工具统一登记", outcome: "记忆、任务、技能、委派、产物和开发工具与通用工具出现在同一能力目录。", status: "done" },
      { id: "six-surface-routing", title: "六入口工具路由", outcome: "任务、学习、能力、文件、开发和工作按同一场景规则收窄工具。", status: "done" },
      { id: "extension-policy-routing", title: "扩展权限路由", outcome: "扩展工具进入场景和角色权限筛选，并保留调用审计。", status: "done" },
      { id: "tool-runtime-guard", title: "工具运行保护", outcome: "直接工具有超时、取消、风险元数据和持久执行记录。", status: "done" },
      { id: "extension-update-service", title: "扩展更新检查", outcome: "远端扩展可检查版本、识别权限变化并经确认后升级。", status: "done" },
      { id: "development-engine-closure", title: "开发引擎完整验收", outcome: "五个引擎完成隔离、实时事件、会话恢复、取消和修改模式端到端验证。", status: "done" },
      { id: "general-tool-packs", title: "通用工具插件包", outcome: "浏览器、沙箱分析、邮件日历文件、图像和视频能力有可安装实现与真实就绪检查。", status: "done" },
      { id: "product-real-use-review", title: "完整真实检查", outcome: "构建、全量测试、服务接口、页面路径和安全边界全部复检。", status: "done" },
    ],
  },
];

export function buildCapabilityRoadmap(): CapabilityRoadmap {
  const total = PHASES.reduce((sum, phase) => sum + phase.items.filter((item) => item.status !== "excluded").length, 0);
  const completed = PHASES.reduce((sum, phase) => sum + phase.items.filter((item) => item.status === "done").length, 0);
  return {
    updatedAt: "2026-08-17T00:00:00.000+08:00",
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    phases: PHASES.map((phase) => ({
      ...phase,
      items: phase.items.map((item) => ({ ...item })),
    })),
  };
}
