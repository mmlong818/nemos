"use strict";

const RECENT_WORKSPACES_KEY = "clownfish-recent-workspaces-v1";

const CATALOG = [
  { id: "presentation", backendId: "presentation-builder", name: "做 PPT", icon: "presentation", summary: "生成可放映、可继续编辑的演示文稿", description: "先梳理受众和叙事主线，再生成有版式变化、演讲备注和网页预览的 PowerPoint。", use: "汇报、提案、课程分享、路演", deliverable: "可编辑 PPTX 与网页预览", format: "pptx", featured: true, detail: "生成页面结构、版式、备注和可编辑文件" },
  { id: "document", backendId: "document-draft", name: "写正式文档", icon: "document", summary: "起草、改写和整理正式内容", description: "根据目标和材料生成结构完整的文稿，也能沿用你的常用文笔与排版习惯。", use: "方案、总结、说明、长文", deliverable: "可编辑文稿", format: "doc", featured: true, detail: "形成结构清楚、可以继续编辑的文稿" },
  { id: "research", backendId: "research-brief", name: "深度研究", icon: "search", summary: "搜索来源、核验声明并形成可追溯结论", description: "围绕一个问题规划研究路径，搜索并分级来源，对关键声明做独立复核，清楚标出证据和限制。", use: "行业研究、竞品、专题调研", deliverable: "带来源台账的研究报告", format: "html", featured: true, detail: "规划、搜索、来源分级、事实核验和结论复审" },
  { id: "marketBrief", backendId: "market-briefing", name: "查港股资料", icon: "trend", summary: "读取公告、行情快照并整理盘前盘后简报", description: "按股票代码读取港交所官方公告和带查询时间的第三方行情快照；明确延迟、来源和待核验项，不提供交易指令。", use: "自选股、公告核验、盘前盘后复盘", deliverable: "带来源与时间戳的市场资料简报", format: "html", detail: "读取关注代码、官方公告、行情快照和风险边界" },
  { id: "thinking", backendId: "thinking-workbench", name: "梳理复杂问题", icon: "lightbulb", summary: "把模糊问题变成可操作的思考工作台", description: "分开事实、假设、矛盾和未知，保留多个选项，形成可以勾选和补充的验证计划。", use: "问题拆解、创意探索、复盘", deliverable: "可交互思考工作台", format: "html", featured: true, detail: "梳理问题、假设、选择和验证办法" },
  { id: "product", backendId: "product-design", name: "设计产品界面", icon: "layout", summary: "从用户任务形成页面和交互方案", description: "先理清真实用户路径，再产出信息结构、关键界面、交互说明和验收要点。", use: "新功能、界面改版、产品方案", deliverable: "产品设计说明", format: "html", featured: true, detail: "形成用户流程、页面结构与设计说明" },
  { id: "developer", backendId: "project-development", name: "开发项目", icon: "code", summary: "读取本地项目，生成可核对的修改提案", description: "在你指定的项目文件夹内真实读取、开发和验证；修改先作为提案保存，由你确认后再写入项目。", use: "开发功能、修复问题、项目检查", deliverable: "修改提案、可运行结果与验证记录", format: "md", featured: true, detail: "读取项目规则、实施修改、运行检查，再由你确认写入" },
  { id: "meeting", backendId: "meeting-minutes", name: "整理会议纪要", icon: "checklist", summary: "从记录中提炼结论和行动项", description: "把会议文字整理成摘要、决定、责任人、截止时间、风险和未决问题。", use: "会议记录、访谈、讨论复盘", deliverable: "纪要与行动表", format: "doc", featured: true, detail: "提炼决定、行动项与未决问题" },
  { id: "web", backendId: "html-report", name: "做网页报告", icon: "globe", summary: "把内容制作成独立网页", description: "生成不依赖外部服务、可直接在浏览器打开的单页内容。", use: "报告、说明页、互动展示", deliverable: "独立 HTML 网页", format: "html", detail: "制作可直接打开的独立网页" },
  { id: "decision", backendId: "decision-brief", name: "比较方案", icon: "scale", summary: "比较证据、风险与行动条件", description: "把零散信息整理成可判断的选择，说明收益、代价、风险和什么时候应该改变决定。", use: "选型、取舍、优先级判断", deliverable: "决策简报", format: "md", detail: "比较方案、风险和行动条件" },
  { id: "business", backendId: "business-deal", name: "推进商务合作", icon: "handshake", summary: "建立关键人、异议和跟进工作台", description: "梳理双方价值、关键人、异议、谈判边界和跟进动作，话术可以直接复制使用。", use: "合作、销售、谈判、跟进", deliverable: "可执行商务推进台", format: "html", detail: "准备合作策略、异议处理与跟进动作" },
  { id: "market", backendId: "market-opportunity", name: "模拟市场机会", icon: "trend", summary: "用多种情景检验机会是否成立", description: "从用户、竞争、执行和不确定性出发，调整权重比较不同情景，形成机会判断和低成本验证计划。", use: "市场洞察、机会评估、定位", deliverable: "可调节情景模拟台", format: "html", detail: "比较需求、竞争和执行情景，明确失效条件" },
  { id: "ability", backendId: "ability-builder", name: "生成新能力", icon: "branch", summary: "把重复工作沉淀成真正可用的能力", description: "先判断是否值得沉淀，再生成触发边界、输入、步骤、异常路径和测试；通过检查后会加入本机能力库。", use: "重复工作、团队方法、固定交付", deliverable: "已验证并安装的 小丑鱼能力", format: "html", detail: "资格判断、触发测试、能力生成和本机安装" },
];

const ICON_PATHS = {
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  history: '<path d="M4.5 9a8 8 0 1 1 .4 7"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4l2.8 1.8"/>',
  brain: '<path d="M10 5a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 5.7 14 3 3 0 0 0 10 18.5V5ZM14 5a3 3 0 0 1 5 2.2 3.5 3.5 0 0 1-.7 6.8 3 3 0 0 1-4.3 4.5V5Z"/><path d="M7 9.5h3M14 9.5h3M7.5 14H10M14 14h2.5"/>',
  presentation: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M8 20l4-5 4 5M8 8.5h5M8 11.5h8"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5M8.5 10.5h4M10.5 8.5v4"/>',
  lightbulb: '<path d="M8.5 15.5c-1.5-1.1-2.5-2.7-2.5-4.7a6 6 0 1 1 12 0c0 2-1 3.6-2.5 4.7L14.5 18h-5z"/><path d="M9.5 21h5M9.5 18h5"/>',
  layout: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M9 9v11"/>',
  checklist: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="m7.5 9 1.5 1.5 2.5-3M13.5 9h3M7.5 15l1.5 1.5 2.5-3M13.5 15h3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z"/>',
  scale: '<path d="M12 4v16M7 6h10M5 6l-3 6h6L5 6ZM19 6l-3 6h6l-3-6ZM8 20h8"/>',
  handshake: '<path d="m4 8 4-3 4 2 4-2 4 3-4 7-4 2-4-2-4-7Z"/><path d="m8 9 3 3a2 2 0 0 0 3 0l1-1M8 15l2-2M16 15l-2-2"/>',
  trend: '<path d="M4 18V6M4 18h16"/><path d="m7 14 4-4 3 2 5-6"/><path d="M15.5 6H19v3.5"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M6 7v5a5 5 0 0 0 5 5h5M8 7h8M11 7v5a5 5 0 0 0 5 5"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M14 4l-4 16"/>',
  ...window.ClownfishIcons.paths,
};

function iconSvg(name) {
  return window.ClownfishIcons.render(name, { paths: ICON_PATHS });
}

function renderStaticIcons() {
  document.querySelectorAll("[data-app-icon]").forEach((node) => {
    const holder = node.querySelector("span");
    if (holder) holder.innerHTML = iconSvg(node.dataset.appIcon);
  });
  document.querySelectorAll("[data-empty-icon]").forEach((node) => {
    node.innerHTML = iconSvg(node.dataset.emptyIcon);
  });
}

const MATCH_RULES = [
  ["ability", /(生成|创建|新增|沉淀|锻造).{0,8}(能力|技能)|做成.{0,6}(能力|技能)/i],
  ["presentation", /PPT|演示|汇报|路演|幻灯|提案|课件/i],
  ["meeting", /会议|纪要|访谈|录音|讨论记录/i],
  ["document", /(?:周报|月报|日报|材料|素材|内容).{0,18}(?:整理|摘要|总结|归纳|提炼)|(?:整理|摘要|总结|归纳|提炼).{0,18}(?:周报|月报|日报|材料|素材|内容)|管理层摘要|正式文档/i],
  ["product", /产品|界面|交互|原型|用户体验|功能设计/i],
  ["developer", /开发|写代码|改代码|修复.{0,6}(问题|bug)|项目检查|构建|测试/i],
  ["business", /商务|合作|销售|客户|谈判|成交|跟进/i],
  ["marketBrief", /港股|股票|行情|公告|财报|盘前|盘后|自选|持仓|HKEX/i],
  ["market", /市场|赛道|机会|定位|竞品|增长/i],
  ["research", /研究|调研|资料|调查|行业|搜集|分析报告/i],
  ["decision", /决策|比较|选择|取舍|评估|该不该/i],
  ["ability", /流程|自动化|重复工作|SOP|工作流/i],
  ["web", /网页|HTML|页面|网站|可视化/i],
  ["document", /文档|文章|总结|说明|方案|写作|润色/i],
  ["thinking", /思考|梳理|头脑风暴|复盘|想法|困惑/i],
];

const EXAMPLE_PROMPTS = {
  presentation: "例如：把季度总结做成 10 页管理层汇报，重点突出增长、风险和下一步行动",
  document: "例如：根据这些材料起草一份正式方案，结构清楚，语气专业",
  research: "例如：研究国内 AI 办公市场，核验主要数据并附上可追溯来源",
  marketBrief: "例如：整理 02513.HK 最近公告和行情变化，标明来源、时间与风险",
  thinking: "例如：帮我梳理是否应该进入这个市场，分开事实、假设和待验证问题",
  product: "例如：重新设计新用户首页，减少认知负担并给出关键交互说明",
  developer: "例如：修复页面切换抖动，检查根因，完成修改并运行相关测试",
  meeting: "例如：把会议记录整理成结论、行动项、负责人和截止时间",
  web: "例如：把这份报告做成可直接打开的单页网页",
  decision: "例如：比较三个方案的收益、代价、风险和改变决定的条件",
  business: "例如：为这次客户合作准备关键人、异议处理和下一步跟进话术",
  market: "例如：用乐观、中性和保守情景检验这个市场机会是否成立",
  ability: "例如：把每周资料简报沉淀成可重复运行的能力",
};

const ICON_TONES = {
  presentation: "#c45b32",
  document: "#3f6f91",
  research: "#39786f",
  marketBrief: "#356b8c",
  thinking: "#a36a1f",
  product: "#9a476b",
  developer: "#546b8b",
  meeting: "#4c765e",
  web: "#3c7873",
  decision: "#765f92",
  business: "#9a6138",
  market: "#4f7b4b",
  ability: "#a24f58",
};

const STATUS_TEXT = { queued: "等待开始", running: "正在执行", succeeded: "已完成", failed: "执行失败", cancelled: "已取消", uncertain: "等待核对" };
const FORMAT_LABELS = { pptx: "可编辑 PowerPoint", html: "可交互网页", doc: "可编辑 Word", pdf: "PDF", xlsx: "Excel", md: "可编辑文稿", json: "结构化数据", txt: "纯文本" };

function migrateStorageKey(codes, target, storage) {
  const source = String.fromCharCode(...codes);
  const existing = storage.getItem(source);
  if (existing !== null && storage.getItem(target) === null) storage.setItem(target, existing);
  if (source !== target) storage.removeItem(source);
}
migrateStorageKey([110, 101, 109, 111, 115, 45, 99, 97, 112, 97, 98, 105, 108, 105, 116, 121, 45, 99, 101, 110, 116, 101, 114, 45, 100, 114, 97, 102, 116, 45, 118, 49], "clownfish-capability-center-draft-v1", localStorage);
migrateStorageKey([110, 101, 109, 111, 115, 45, 99, 97, 112, 97, 98, 105, 108, 105, 116, 121, 45, 97, 99, 116, 105, 118, 105, 116, 121, 45, 118, 49], "clownfish-capability-activity-v1", localStorage);
migrateStorageKey([110, 101, 109, 111, 115, 45, 99, 97, 112, 97, 98, 105, 108, 105, 116, 121, 45, 104, 97, 110, 100, 111, 102, 102, 45, 118, 49], "clownfish-capability-handoff-v1", sessionStorage);

const DRAFT_KEY = "clownfish-capability-center-draft-v1";
const ACTIVITY_KEY = "clownfish-capability-activity-v1";
const HANDOFF_KEY = "clownfish-capability-handoff-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: "start",
  selectedId: "presentation",
  snapshot: { abilities: [], artifacts: [] },
  llm: { live: false },
  jobs: [],
  personas: [],
  materials: [],
  memoryCount: 0,
  pollTimer: 0,
  handoffApplied: false,
  handoffContext: "",
  handoffSummary: "",
  handoffConversation: [],
  handoffMessageCount: 0,
  handoffSource: "",
  handoffSourceCapabilityId: "",
  returnConversationKey: "",
  returnUrl: "/",
  parentJobId: "",
  continuationTaskId: "",
  handoffChain: [],
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function displayDate(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function setDevelopmentMode(mode, persist = true) {
  const value = mode === "inspect" ? "inspect" : "develop";
  $("#accessModeSelect").value = value;
  $$('[data-access-mode]').forEach((button) => {
    const selected = button.dataset.accessMode === value;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const labels = value === "inspect" ? ["理解项目", "检查问题", "核对证据", "整理结论"] : ["理解项目", "完成修改", "运行检查", "交付结果"];
  $$("#developerFlow li").forEach((item, index) => { const marker = item.querySelector("span"); item.textContent = labels[index]; if (marker) item.prepend(marker); });
  updateLaunchState();
  if (persist) saveDraft();
}

function recentWorkspaces() {
  try {
    const paths = JSON.parse(localStorage.getItem(RECENT_WORKSPACES_KEY) || "[]");
    return Array.isArray(paths) ? paths.filter((item) => typeof item === "string" && item.trim()).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function renderRecentWorkspaces() {
  const paths = recentWorkspaces();
  $("#recentWorkspacePaths").innerHTML = paths.map((path) => `<option value="${escapeHtml(path)}"></option>`).join("");
  $("#useRecentWorkspace").hidden = !paths.length;
}

function rememberWorkspace(path) {
  const normalized = String(path || "").trim();
  if (!normalized) return;
  const paths = [normalized, ...recentWorkspaces().filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 5);
  localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(paths));
  renderRecentWorkspaces();
}
function selectedCapability() {
  return CATALOG.find((item) => item.id === state.selectedId) || CATALOG[0];
}

function capabilityForBackend(id) {
  return CATALOG.find((item) => item.backendId === id) || CATALOG.find((item) => item.id === id) || CATALOG[1];
}

function isAvailable(item) {
  return availability(item).ready;
}

function availability(item) {
  const wired = state.snapshot.abilities.some((ability) => ability.id === item.backendId && !ability.archived);
  if (!wired) return { ready: false, label: "尚未接入", action: "此能力尚未接入" };
  if (!state.llm.live) return { ready: false, label: "需设置模型", action: "设置模型后即可使用" };
  const search = state.snapshot.tools?.find((tool) => tool.id === "web.search");
  if (item.id === "research" && !search?.available) return { ready: false, label: "需联网搜索", action: "配置联网搜索后使用" };
  return { ready: true, label: "可直接使用", action: "开始使用" };
}

function supportedFormats(item) {
  if (item.id === "developer") return ["md"];
  if (item.id === "presentation") return ["pptx", "pdf", "html", "json", "md"];
  if (["research", "marketBrief", "thinking", "product", "business", "market", "ability"].includes(item.id)) return ["html", "pdf", "doc", "json", "md"];
  if (item.id === "web") return ["html", "pdf", "md", "json"];
  if (["document", "meeting"].includes(item.id)) return ["doc", "pdf", "md", "txt"];
  return ["md", "html", "doc", "json", "txt"];
}

function renderFormatOptions(item) {
  const select = $("#formatSelect");
  const previous = select.value;
  const formats = supportedFormats(item);
  select.innerHTML = formats.map((format) => `<option value="${format}">${item.id === "developer" ? "项目修改、可运行结果与验证记录" : FORMAT_LABELS[format]}</option>`).join("");
  select.value = formats.includes(previous) ? previous : item.format;
  select.disabled = item.id === "developer";
}

async function api(path, options = {}) {
  const init = { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } };
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

let toastTimer = 0;
function showToast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("is-visible"), 3000);
}

function renderCatalog() {
  const root = $("#capabilityGrid");
  root.innerHTML = CATALOG.slice(0, 20).map((item) => `
    <button class="cap-card${item.id === state.selectedId ? " is-selected" : ""}" type="button" data-capability="${item.id}" style="--cap-color:${ICON_TONES[item.id] || "#8f2f59"}">
      <span class="cap-icon" aria-hidden="true">${iconSvg(item.icon)}</span>
      <strong>${item.name}</strong>
      <small>${item.summary}</small>
      <span class="availability">${availability(item).label}</span>
    </button>`).join("");
  $$('[data-capability]', root).forEach((button) => button.addEventListener("click", () => activateCapability(button.dataset.capability)));
}

function renderExecutionState() {
  const item = selectedCapability();
  const status = availability(item);
  const button = $("#startTask");
  const hasInstruction = Boolean($("#goalInput").value.trim() || $("#instructionInput").value.trim());
  const hasWorkspace = item.id !== "developer" || Boolean($("#workspaceInput").value.trim());
  button.disabled = !status.ready || !hasInstruction || !hasWorkspace;
  button.textContent = !status.ready ? status.action : !hasInstruction ? "先说清楚想完成什么" : !hasWorkspace ? "先填写项目文件夹" : item.id === "developer" ? ($("#accessModeSelect").value === "inspect" ? "让小丑鱼开始检查" : "让小丑鱼开始开发") : "开始执行";
  $(".run-note").textContent = !status.ready
    ? "请先在设置中配置模型；任务不会用离线回声生成假结果。"
    : hasInstruction && hasWorkspace
      ? "任务会在后台继续；离开此页后，可在“进行中”查看。"
      : item.id === "developer" && !hasWorkspace ? "填写要处理的本地项目文件夹。" : "填写任务要求后即可开始。";
}

function selectCapability(id) {
  state.selectedId = CATALOG.some((item) => item.id === id) ? id : "document";
  renderCatalog();
  renderExecutionState();
  updateLaunchState();
}

function activateCapability(id) {
  selectCapability(id);
  openCapability($("#goalInput").value.trim(), { focusInput: true });
}

function matchCapability(goal) {
  const rule = MATCH_RULES.find(([, expression]) => expression.test(goal));
  return rule?.[0] || "thinking";
}

async function recommendCapability(goal) {
  try {
    const response = await fetch("/api/capabilities/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal,
        materialNames: state.materials.map((item) => item.name),
        workspacePath: $("#workspaceInput")?.value || "",
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.route?.catalogId) throw new Error(result.error || "无法自动选择能力");
    return result.route.catalogId;
  } catch {
    return matchCapability(goal);
  }
}

function openCapability(goal = $("#goalInput").value.trim(), options = {}) {
  const item = selectedCapability();
  if (goal) {
    $("#goalInput").value = goal;
    if (!$("#instructionInput").value.trim()) $("#instructionInput").value = goal;
  }
  $("#launchTitle").textContent = item.name;
  $("#launchSummary").textContent = item.summary;
  $("#instructionLabel").textContent = item.id === "developer" ? "想让小丑鱼完成什么" : "任务要求";
  $("#instructionInput").placeholder = EXAMPLE_PROMPTS[item.id] || "说清楚要完成什么，也可以补充受众、重点、语气或格式";
  $("#developerFields").hidden = item.id !== "developer";
  $("#formatField").hidden = item.id === "developer";
  $("#materialDrop").hidden = item.id === "developer";
  $("#materialList").hidden = item.id === "developer";
  $("#advancedSettings").hidden = item.id === "developer";
  $("#launchPanel").classList.toggle("is-developer", item.id === "developer");
  renderFormatOptions(item);
  $("#formatSelect").value = item.format;
  $("#launchPanel").hidden = false;
  $(".start-wrap").classList.add("is-launching");
  updateLaunchState();
  renderExecutionState();
  saveDraft();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    if (options.focusInput && !goal && window.matchMedia("(min-width: 721px)").matches) {
      $("#instructionInput").focus({ preventScroll: true });
    }
  });
}

function closeCapability() {
  $("#launchPanel").hidden = true;
  $(".start-wrap").classList.remove("is-launching");
  window.scrollTo({ top: 0, behavior: "auto" });
  saveDraft();
  window.requestAnimationFrame(() => $(`[data-capability="${state.selectedId}"]`)?.focus());
}

function updateLaunchState() {
  renderExecutionState();
}

function renderMaterials() {
  $("#materialList").innerHTML = state.materials.map((file, index) => `
    <div class="material-item"><span>${escapeHtml(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB</span><button type="button" data-remove-material="${index}" aria-label="移除 ${escapeHtml(file.name)}">移除</button></div>`).join("");
  $$('[data-remove-material]').forEach((button) => button.addEventListener("click", () => {
    state.materials.splice(Number(button.dataset.removeMaterial), 1);
    renderMaterials();
    saveDraft();
  }));
  updateLaunchState();
}

async function addMaterial(file) {
  if (!file) return;
  const isText = /\.(txt|md|markdown|json|html?|htm)$/i.test(file.name);
  const isOffice = /\.(doc|docx|docm|odt|rtf|epub|ppt|pps|pot|pptx|pptm|ppsx|ppsm|odp|xls|xlsx|xlsm|xlsb|ods|csv|pdf)$/i.test(file.name);
  if (!isText && !isOffice) return showToast("支持文字、常见文档、演示文稿、表格、PDF 和 EPUB 材料", true);
  if (isText && file.size > 1024 * 1024) return showToast("文字材料不能超过 1 MB", true);
  if (isOffice && file.size > 8 * 1024 * 1024) return showToast("办公文件不能超过 8 MB", true);
  try {
    showToast(isOffice ? "正在读取办公文件…" : "正在读取材料…");
    let text = "";
    let kind = "text";
    if (isText) {
      text = await file.text();
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const response = await api("/api/files/extract", {
        method: "POST",
        body: JSON.stringify({ name: file.name, dataBase64: btoa(binary) }),
      });
      text = response.extraction?.text || "";
      kind = response.extraction?.kind || "office";
    }
    state.materials = [{ name: file.name, size: file.size, text, kind }];
    renderMaterials();
    saveDraft();
    showToast(responseMessageForMaterial(isOffice, text));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "文件读取失败", true);
  }
}

function responseMessageForMaterial(isOffice, text) {
  if (!isOffice) return "材料已加入";
  return text.includes("[内容较长") ? "文件较长，已读取可处理的前半部分" : "办公文件已读取，可以开始执行";
}

function saveDraft() {
  const draft = {
    goal: $("#goalInput").value,
    instruction: $("#instructionInput").value,
    selectedId: state.selectedId,
    format: $("#formatSelect").value,
    memoryMode: $("#memoryToggle").checked ? "preferences" : "off",
    materials: state.materials,
    workspacePath: $("#workspaceInput").value,
    accessMode: $("#accessModeSelect").value,
    parentJobId: state.parentJobId,
    continuationTaskId: state.continuationTaskId,
    handoffChain: state.handoffChain,
    handoffSummary: state.handoffSummary,
    handoffConversation: state.handoffConversation,
    handoffSource: state.handoffSource,
    handoffSourceCapabilityId: state.handoffSourceCapabilityId,
    returnConversationKey: state.returnConversationKey,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  updateContinueButton();
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}


function updateContinueButton() {
  const draft = loadDraft();
  $("#continueLast").hidden = !draft?.goal && !draft?.instruction;
}

function restoreLast() {
  const draft = loadDraft();
  if (!draft?.goal && !draft?.instruction) return showToast("没有可继续的内容", true);

  state.selectedId = CATALOG.some((item) => item.id === draft.selectedId) ? draft.selectedId : "document";
  state.materials = Array.isArray(draft.materials) ? draft.materials.slice(-8) : [];
  $("#goalInput").value = draft.goal || "";
  $("#instructionInput").value = draft.instruction || "";
  $("#memoryToggle").checked = draft.memoryMode !== "off";
  $("#workspaceInput").value = draft.workspacePath || "";
  setDevelopmentMode(draft.accessMode, false);
  state.parentJobId = String(draft.parentJobId || "");
  state.continuationTaskId = String(draft.continuationTaskId || "");
  state.handoffChain = Array.isArray(draft.handoffChain) ? draft.handoffChain.slice(0, 12) : [];
  state.handoffSummary = String(draft.handoffSummary || "");
  state.handoffConversation = Array.isArray(draft.handoffConversation) ? draft.handoffConversation.slice(-120) : [];
  state.handoffMessageCount = state.handoffConversation.length;
  state.handoffSource = draft.handoffSource === "capability" ? "capability" : draft.handoffSource === "chat" ? "chat" : "";
  state.handoffSourceCapabilityId = String(draft.handoffSourceCapabilityId || "");
  state.returnConversationKey = String(draft.returnConversationKey || "");
  renderCatalog();
  renderMaterials();
  openCapability();
  if ([...$("#formatSelect").options].some((option) => option.value === draft.format)) $("#formatSelect").value = draft.format;
}

function resetDraft() {
  localStorage.removeItem(DRAFT_KEY);
  $("#goalInput").value = "";
  $("#instructionInput").value = "";
  $("#workspaceInput").value = "";
  setDevelopmentMode("develop", false);
  state.materials = [];
  state.handoffContext = "";
  state.handoffSummary = "";
  state.handoffConversation = [];
  state.handoffMessageCount = 0;
  state.handoffSource = "";
  state.handoffSourceCapabilityId = "";
  state.returnConversationKey = "";
  state.parentJobId = "";
  state.continuationTaskId = "";
  state.handoffChain = [];
  renderMaterials();
  $("#chatContext").hidden = true;
  $("#launchPanel").hidden = true;
  $(".start-wrap").classList.remove("is-launching");
  updateContinueButton();
}

async function startTask() {
  const item = selectedCapability();
  const goal = $("#goalInput").value.trim();
  const details = $("#instructionInput").value.trim();
  const instruction = details || goal;
  if (!instruction) return showToast("先写下想完成的事情", true);
  if (item.id === "developer" && !$("#workspaceInput").value.trim()) return showToast("先填写项目文件夹", true);
  if (item.id === "developer") rememberWorkspace($("#workspaceInput").value);
  if (!isAvailable(item)) return showToast(availability(item).action, true);
  const button = $("#startTask");
  button.disabled = true;
  button.textContent = item.id === "developer" ? "正在理解项目…" : "正在加入任务…";
  const hasHandoff = Boolean(state.handoffSummary || state.handoffConversation.length || state.parentJobId);
  const materials = !hasHandoff && state.materials.length
    ? `\n\n用户提供的材料：\n${state.materials.map((item) => `--- ${item.name} ---\n${item.text}`).join("\n\n")}`
    : "";
  const handoff = hasHandoff ? {
    source: state.handoffSource || (state.parentJobId ? "capability" : "chat"),
    sourceConversationKey: state.returnConversationKey,
    sourceJobId: state.parentJobId,
    sourceCapabilityId: state.handoffSourceCapabilityId,
    goal,
    summary: state.handoffSummary,
    conversation: state.handoffConversation,
    materials: state.materials,
    decisions: [], constraints: [], unresolved: [],
    chain: state.handoffChain,
  } : undefined;
  try {
    const response = await api("/api/agent/job", {
      method: "POST",
      body: JSON.stringify({
        kind: "capability-adhoc",
        title: (goal || instruction).slice(0, 60),
        personaId: "clownfish",
        capabilityId: item.backendId,
        instruction: `${instruction}${materials}`,
        handoff,
        conversationKey: state.returnConversationKey,
        continuationTaskId: state.continuationTaskId,
        workspacePath: item.id === "developer" ? $("#workspaceInput").value.trim() : "",
        accessMode: item.id === "developer" && $("#accessModeSelect").value === "inspect" ? "inspect" : "develop",
        parentJobId: state.parentJobId,
        handoffChain: [...state.handoffChain, item.backendId].slice(-12),
        format: $("#formatSelect").value,
        memoryMode: $("#memoryToggle").checked ? "preferences" : "off",
        idempotencyKey: `capability-center-${crypto.randomUUID()}`,
      }),
    });
    const job = response.job || null;
    if (job) localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ jobId: job.id, title: goal || instruction, personaId: "clownfish", startedAt: new Date().toISOString() }));
    resetDraft();
    await refreshData();
    if (job) {
      $("#runConversationBridge").hidden = false;
      $("#runConversationText").textContent = "你可以继续聊天；完成后，结果会由小丑鱼直接送回。";
    }
    openView("runs");
    showToast("任务已开始；可以回到对话继续，结果会自动送回");
  } catch (error) {
    showToast(error.message || "任务未能开始", true);
  } finally {
    renderExecutionState();
  }
}

function jobTitle(job) {
  return String(job.payload?.title || job.result?.data?.artifact?.title || "未命名任务");
}

function artifactDisplayTitle(artifact) {
  const title = String(artifact?.title || "").trim();
  if (!title || /^(可以|好|好的|行|没问题|继续|就这样|看起来可以|我没想好|不知道|随便)[。！!？?，,\s]*$/.test(title)) {
    return capabilityForBackend(artifact?.capabilityId).name || "能力结果";
  }
  return title;
}

function jobCapability(job) {
  return capabilityForBackend(job.payload?.capabilityId || job.result?.data?.artifact?.capabilityId);
}

function latestCheckpoint(job) {
  return job.checkpoints?.[job.checkpoints.length - 1] || null;
}

function artifactFromJob(job) {
  const recorded = job.result?.data?.artifact || null;
  if (!recorded) return null;
  return (state.snapshot.artifacts || []).find((artifact) => artifact.id === recorded.id) || recorded;
}

function artifactLinks(artifact, compact = false) {
  if (!artifact) return "";
  const preview = `<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(artifact.id)}" target="_blank" rel="noopener">${compact ? "预览" : "打开结果"}</a>`;
  const editUrl = `/office?artifact=${encodeURIComponent(artifact.id)}`;
  const edit = `<a href="${editUrl}" data-artifact-edit="${editUrl}">${compact ? "继续编辑" : "在文件中继续"}</a>`;
  const download = `<a href="/api/capabilities/artifact?id=${encodeURIComponent(artifact.id)}&download=1" download>${compact ? "下载" : `下载 ${String(artifact.format || "文件").toUpperCase()}`}</a>`;
  return preview + edit + download;
}

function jobMemoryUsage(job) {
  const preferences = Array.isArray(job?.payload?.appliedPreferences)
    ? job.payload.appliedPreferences.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
    : [];
  if (job?.payload?.memoryMode === "off") return '<p class="task-memory is-off">本次未使用习惯记忆</p>';
  if (!preferences.length) return "";
  return `<details class="task-memory"><summary>本次使用了 ${preferences.length} 条习惯</summary><ul>${preferences.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`;
}

function developmentProposalActions(artifact) {
  const proposal = artifact?.metadata?.development?.proposal;
  if (!proposal) return "";
  const preview = `<a href="/development?id=${encodeURIComponent(proposal.id)}">审阅修改</a>`;
  if (proposal.state === "pending") return `${preview}<button type="button" data-apply-proposal="${escapeHtml(proposal.id)}">应用修改</button><button type="button" data-reject-proposal="${escapeHtml(proposal.id)}">放弃</button>`;
  if (proposal.state === "conflicted") return `${preview}<span class="proposal-state">项目已变化，未覆盖</span><button type="button" data-reject-proposal="${escapeHtml(proposal.id)}">放弃</button>`;
  if (proposal.state === "applied") return `<span class="proposal-state">修改已应用</span>${preview}`;
  if (proposal.state === "rejected") return `<span class="proposal-state">提案已放弃</span>`;
  if (proposal.state === "failed") return `<span class="proposal-state">提案生成失败</span>`;
  return preview;
}

function artifactProofLabel(artifact) {
  return ({ produced: "已生成", validated: "已校验", verified: "已核验", approved: "已确认" })[artifact?.proof?.level] || "未检查";
}
function chatHref() {
  const url = new URL(state.returnUrl || "/", location.origin);
  return `${url.pathname}${url.hash}`;
}

function developmentProgress(job, item, progress) {
  if (item.id !== "developer") return "";
  const labels = job.payload?.accessMode === "inspect"
    ? ["理解项目", "检查问题", "核对证据", "整理结论"]
    : ["理解项目", "完成修改", "运行检查", "交付结果"];
  const current = job.status === "queued" ? 0 : Math.min(3, Math.max(0, Math.floor(progress / 25)));
  return `<div class="development-steps" aria-label="开发进度">${labels.map((label, index) => `<span class="development-step${index < current ? " is-done" : index === current ? " is-current" : ""}">${escapeHtml(label)}</span>`).join("")}</div>`;
}

function developmentReceipt(artifact) {
  const receipt = artifact?.metadata?.development;
  if (!receipt) return "";
  const files = (receipt.proposal?.files || receipt.changedFiles || []).map((item) => typeof item === "string" ? item : item.path).filter(Boolean);
  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  const passed = checks.filter((check) => check.passed).length;
  const risks = Array.isArray(receipt.unverifiedRisks) ? receipt.unverifiedRisks.filter(Boolean) : [];
  const mode = receipt.accessMode === "inspect" ? "只读检查" : "修改提案";
  return `<section class="development-receipt" aria-label="开发结果摘要">
    <div class="development-receipt-summary"><span>${mode}</span><span>${files.length} 个文件</span><span>${checks.length ? `${passed}/${checks.length} 项检查通过` : "未运行自动检查"}</span></div>
    ${files.length ? `<ul class="development-file-list">${files.slice(0, 8).map((file) => `<li title="${escapeHtml(file)}">${escapeHtml(file)}</li>`).join("")}${files.length > 8 ? `<li>另有 ${files.length - 8} 个文件</li>` : ""}</ul>` : ""}
    ${risks.length ? `<p class="development-risk">仍需注意：${escapeHtml(risks[0])}${risks.length > 1 ? `，另有 ${risks.length - 1} 项` : ""}</p>` : ""}
  </section>`;
}
function renderRuns() {
  const jobs = state.jobs.filter((job) => job.status === "queued" || job.status === "running");
  $("#runsEmpty").hidden = jobs.length > 0;
  $("#runsList").innerHTML = jobs.map((job) => {
    const item = jobCapability(job);
    const checkpoint = latestCheckpoint(job);
    const progress = Math.max(3, Math.min(100, Number(checkpoint?.progress ?? (job.status === "running" ? 12 : 3))));
    return `<article class="task-row">
      <span class="task-row-icon" aria-hidden="true" style="--cap-color:${ICON_TONES[item.id] || "#8f2f59"}">${iconSvg(item.icon)}</span>
      <div><h2>${escapeHtml(jobTitle(job))}</h2><p class="status-line"><span class="status-dot ${job.status}"></span>${STATUS_TEXT[job.status]} · ${escapeHtml(checkpoint?.status || item.name)} · ${displayDate(job.updatedAt)}</p>${jobMemoryUsage(job)}${developmentProgress(job, item, progress)}<div class="progress-track" aria-label="进度 ${progress}%"><span style="width:${progress}%"></span></div></div>
      <div class="task-actions">${item.id === "developer" ? `<a href="/development?job=${encodeURIComponent(job.id)}">查看工作台</a>` : ""}<a href="${escapeHtml(chatHref(job.id))}">回到对话</a><button type="button" data-cancel-job="${escapeHtml(job.id)}">取消任务</button></div>
    </article>`;
  }).join("");
  $$('[data-cancel-job]').forEach((button) => button.addEventListener("click", () => cancelJob(button.dataset.cancelJob)));
  const bridge = $("#runConversationBridge");
  bridge.hidden = jobs.length === 0;
  if (jobs[0]) {
    $("#runConversationText").textContent = `「${jobTitle(jobs[0])}」正在进行；完成后会直接送回对话。`;
  }
  const badge = $("#runningCount");
  badge.textContent = jobs.length;
  badge.hidden = jobs.length === 0;
}

async function cancelJob(id) {
  try {
    await api("/api/agent/job/cancel", { method: "POST", body: JSON.stringify({ id }) });
    await refreshData();
    showToast("任务已取消，记录仍会保留");
  } catch (error) { showToast(error.message, true); }
}

function renderHistory() {
  const jobs = state.jobs.filter((job) => ["succeeded", "failed", "cancelled", "uncertain"].includes(job.status));
  $("#historyEmpty").hidden = jobs.length > 0;
  $("#historyList").innerHTML = jobs.map((job) => {
    const item = jobCapability(job);
    const artifact = artifactFromJob(job);
    const open = artifactLinks(artifact);
    const installed = artifact?.metadata?.generatedAbilityId ? " · 已加入能力库" : "";
    return `<article class="task-row">
      <span class="task-row-icon" aria-hidden="true" style="--cap-color:${ICON_TONES[item.id] || "#8f2f59"}">${iconSvg(item.icon)}</span>
      <div><h2>${escapeHtml(jobTitle(job))}</h2><p class="status-line"><span class="status-dot ${job.status}"></span>${STATUS_TEXT[job.status]} · ${item.name}${installed} · ${artifactProofLabel(artifact)} · ${displayDate(job.completedAt || job.updatedAt)}${job.error ? ` · ${escapeHtml(job.error)}` : ""}</p>${jobMemoryUsage(job)}</div>
      ${developmentReceipt(artifact)}
      <div class="task-actions">${job.status === "succeeded" ? `${item.id === "developer" ? `<button type="button" data-revise-job="${escapeHtml(job.id)}">继续调整</button>` : ""}<button type="button" data-handoff-job="${escapeHtml(job.id)}">交给其他能力</button><a href="${escapeHtml(chatHref(job.id))}">在对话中查看</a>` : ""}${job.status === "uncertain" ? `<a href="/runs">去核对</a>` : ""}${developmentProposalActions(artifact)}${open}</div>
    </article>`;
  }).join("");
  $$('[data-handoff-job]').forEach((button) => button.addEventListener("click", () => handoffJob(button.dataset.handoffJob)));
  $$('[data-revise-job]').forEach((button) => button.addEventListener("click", () => continueDevelopment(button.dataset.reviseJob)));
  $$('[data-apply-proposal]').forEach((button) => button.addEventListener("click", () => decideDevelopmentProposal(button.dataset.applyProposal, "apply")));
  $$('[data-reject-proposal]').forEach((button) => button.addEventListener("click", () => decideDevelopmentProposal(button.dataset.rejectProposal, "reject")));
}

async function decideDevelopmentProposal(id, action) {
  const applying = action === "apply";
  if (!window.confirm(applying ? "确认应用这份修改？小丑鱼会先检查项目是否发生变化。" : "确认放弃这份修改提案？项目文件不会改变。")) return;
  try {
    await api(`/api/development/proposal/${action}`, { method: "POST", body: JSON.stringify({ id }) });
    await refreshData();
    showToast(applying ? "修改已应用到项目" : "修改提案已放弃");
  } catch (error) {
    await refreshData();
    showToast(error.message || "操作未完成", true);
  }
}

async function continueDevelopment(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return showToast("没有找到这次开发记录", true);
  await handoffJob(id);
  selectCapability("developer");
  $("#workspaceInput").value = String(job.payload?.workspacePath || "");
  $("#instructionInput").value = "";
  $("#instructionInput").placeholder = "继续告诉小丑鱼要调整什么，例如：按钮还是会抖动，请检查原因并修复";
  setDevelopmentMode(job.payload?.accessMode, false);
  openCapability("", { focusInput: true });
  saveDraft();
}
async function handoffJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  const artifact = artifactFromJob(job || {});
  if (!job || job.status !== "succeeded" || !artifact) return showToast("这个任务还没有可交接的结果", true);
  try {
    const context = await api(`/api/capabilities/artifact/context?id=${encodeURIComponent(artifact.id)}`);
    const sourceCapability = jobCapability(job);
    const text = String(context.text || artifact.summary || "").slice(0, 160000);
    state.parentJobId = job.id;
    state.continuationTaskId = String(artifact.taskId || "");
    state.handoffChain = [...(Array.isArray(job.payload?.handoffChain) ? job.payload.handoffChain : []), sourceCapability.backendId].slice(-12);
    const inheritedMaterials = Array.isArray(job.payload?.handoff?.materials) ? job.payload.handoff.materials.slice(-7) : [];
    state.materials = [...inheritedMaterials, { name: `${jobTitle(job)}-上一步结果.md`, size: new Blob([text]).size, text, kind: "handoff", artifactId: artifact.id }];
    state.handoffSummary = `上一步由「${sourceCapability.name}」完成。请选择下一项能力，并说明要继续完成什么。`;
    state.handoffConversation = Array.isArray(job.payload?.handoff?.conversation) ? job.payload.handoff.conversation.slice(-120) : [];
    state.handoffMessageCount = state.handoffConversation.length;
    state.handoffSource = "capability";
    state.handoffSourceCapabilityId = sourceCapability.backendId;
    state.handoffContext = state.handoffConversation.map((entry) => `${entry.speaker}：${entry.text}`).join("\n\n");
    $("#goalInput").value = "";
    $("#instructionInput").value = "";
    $("#launchPanel").hidden = true;
    $(".start-wrap").classList.remove("is-launching");
    $("#chatContext").hidden = true;

    renderMaterials();
    saveDraft();
    openView("start");
    $("#goalInput").focus({ preventScroll: true });
    showToast("上一步结果已带入，请选择下一项能力");
  } catch (error) {
    showToast(error.message || "结果交接失败", true);
  }
}

function renderFiles() {
  const artifacts = Array.isArray(state.snapshot.artifacts) ? [...state.snapshot.artifacts] : [];
  artifacts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const groups = new Map();
  for (const artifact of artifacts) {
    const key = `${artifact.capabilityId || "file"}:${artifactDisplayTitle(artifact) || artifact.taskId || artifact.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(artifact);
  }
  $("#filesEmpty").hidden = groups.size > 0;
  $("#filesList").innerHTML = [...groups.values()].map((versions) => {
    const latest = versions[0];
    const capability = capabilityForBackend(latest.capabilityId);
    return `<article class="file-card">
      <div class="file-card-top"><div><h2>${escapeHtml(artifactDisplayTitle(latest))}</h2><p>${capability.name} · ${versions.length > 1 ? `${versions.length} 个版本` : displayDate(latest.createdAt)}</p></div><span class="file-type">${escapeHtml(String(latest.format || "file").toUpperCase())}</span></div>
      <div class="versions">${versions.slice(0, 5).map((file, index) => `<div class="version-row"><span>${versions.length > 1 ? `版本 ${versions.length - index}` : "最新结果"} · ${artifactProofLabel(file)} · ${displayDate(file.createdAt)}</span><span class="version-actions">${artifactLinks(file, true)}</span></div>`).join("")}</div>
    </article>`;
  }).join("");
}

function openView(view, updateUrl = true) {
  if (!["start", "runs", "history", "files"].includes(view)) view = "start";
  state.view = view;
  $$("[data-view]").forEach((node) => node.classList.toggle("is-active", node.dataset.view === view));
  $$('[data-view-target]').forEach((node) => {
    const current = node.dataset.viewTarget === view;
    node.classList.toggle("is-current", current);
    if (current) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  if (updateUrl) history.replaceState(null, "", view === "start" ? location.pathname : `#${view}`);
  document.title = `${{ start: "能力", runs: "进行中", history: "已完成", files: "文件" }[view]} · 小丑鱼`;
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function refreshData() {
  try {
    const [snapshot, jobsResponse, appState, memory, llm] = await Promise.all([
      api("/api/capabilities"),
      api("/api/agent/jobs?limit=200"),
      api("/api/state"),
      api("/api/memory?who=me"),
      api("/api/llm"),
    ]);
    state.snapshot = snapshot || { abilities: [], artifacts: [] };
    state.jobs = Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : [];
    state.personas = Array.isArray(appState.personas) ? appState.personas : [];
    state.memoryCount = Array.isArray(memory.facts) ? memory.facts.filter((fact) => fact.layer === "procedural" || fact.layer === "personal_semantic").length : 0;
    state.llm = llm || { live: false };
    $("#memorySummary").textContent = state.memoryCount > 0 ? `可轻量参考 ${state.memoryCount} 条写作、排版或格式习惯` : "会轻量参考文笔、排版和格式偏好";
    renderCatalog();
    renderExecutionState();
    renderRuns();
    renderHistory();
    renderFiles();
  } catch (error) {
    showToast(`暂时无法读取能力数据：${error.message}`, true);
  }
}

function loadChatHandoff() {
  try {
    const handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || "null");
    if (!handoff || Date.now() - Number(handoff.createdAt || 0) > 10 * 60_000) return null;
    return handoff;
  } catch { return null; }
}

function configureReturnLinks() {
  const handoff = loadChatHandoff();
  const requestedReturn = handoff?.returnTo || "/";
  state.returnUrl = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/";
  const returnTarget = new URL(state.returnUrl, location.origin);
  $$('a[href="/"]').forEach((link) => {
    if (link.id === "runConversationLink" || link.id === "chatContextReturn" || link.classList.contains("back-chat") || link.classList.contains("brand")) {
      link.pathname = returnTarget.pathname;
      link.hash = returnTarget.hash;
    }
  });
}

function loadHandoffConversation(handoff, chatName) {
  const key = String(handoff.conversationKey || "");
  let messages = [];
  try {
    const trees = JSON.parse(localStorage.getItem("clownfish-conversation-trees-v20260813b") || "{}");
    const tree = trees[key];
    if (tree && tree.nodes && tree.nodes[tree.activeId] && Array.isArray(tree.nodes[tree.activeId].messages)) {
      messages = tree.nodes[tree.activeId].messages;
    }
  } catch {}
  if (!messages.length) {
    try {
      const logs = JSON.parse(localStorage.getItem("clownfish-chat-logs-v20260813b") || "{}");
      if (Array.isArray(logs[key])) messages = logs[key];
    } catch {}
  }
  if (!messages.length && Array.isArray(handoff.conversation)) messages = handoff.conversation;
  return messages.filter((entry) => entry && typeof entry.text === "string" && entry.text.trim()).map((entry, index) => {
    const persona = entry.pid ? state.personas.find((item) => item.id === entry.pid) : null;
    const role = entry.side === "me" || entry.side === "user" ? "user" : "assistant";
    const speakerId = role === "user" ? "user:current" : `agent:${entry.pid || persona?.id || "clownfish"}`;
    return {
      sourceMessageId: String(entry.id || `${key || "conversation"}:${index + 1}`).slice(0, 160),
      role, speakerId, subjectId: speakerId,
      speaker: String(entry.speaker || (role === "user" ? "用户" : entry.who || persona?.name || chatName)).slice(0, 60),
      text: entry.text,
    };
  });
}

async function applyChatHandoff() {
  if (state.handoffApplied) return;
  state.handoffApplied = true;
  const handoff = loadChatHandoff();
  if (!handoff) return;
  sessionStorage.removeItem(HANDOFF_KEY);
  const goal = String(handoff.goal || "").trim().slice(0, 2000);
  const chatName = String(handoff.chatName || "当前对话").slice(0, 40);
  const incomingConversation = loadHandoffConversation(handoff, chatName);
  state.handoffConversation = incomingConversation;
  state.handoffContext = incomingConversation.map((entry) => `${entry.speaker}：${entry.text}`).join("\n\n");
  state.handoffSummary = String(handoff.summary || goal).trim();
  state.handoffMessageCount = incomingConversation.length;
  state.handoffSource = "chat";
  state.handoffSourceCapabilityId = "";
  state.continuationTaskId = String(handoff.sourceTaskId || "");
  state.returnConversationKey = /^(persona|group):[^:][^\r\n]{0,180}$/.test(String(handoff.conversationKey || ""))
    ? String(handoff.conversationKey)
    : "";
  const fromChat = handoff.source === "chat";

  const incomingMaterials = Array.isArray(handoff.materials)
    ? handoff.materials.filter((item) => item && typeof item.name === "string" && typeof item.text === "string" && item.text.trim()).slice(0, 8).map((item) => ({
      name: item.name.slice(0, 160),
      size: Math.max(0, Number(item.size || 0)),
      text: item.text.slice(0, 120000),
      kind: String(item.kind || "text").slice(0, 16),
      fileRecordId: /^file-[a-f0-9-]{36}$/i.test(String(item.fileRecordId || "")) ? String(item.fileRecordId) : "",
    }))
    : [];
  $("#chatContext").hidden = !fromChat;
  if (fromChat) {
    $("#chatContextTitle").textContent = `从「${chatName}」继续`;
    $("#chatContextText").textContent = state.handoffMessageCount
      ? `已带入当前分支的 ${state.handoffMessageCount} 条完整原文和一份上下文提要；两者都会交给能力执行。`
      : goal ? "目标已经带过来，确认做法后即可开始。" : "从对话带来的任务会在这里准备，完成后仍回到原对话。";
    $("#chatContextReturn").textContent = "回到对话";
  }
  if (incomingMaterials.length) {
    state.materials = incomingMaterials;
    renderMaterials();
  }
  if (goal) {
    selectCapability(await recommendCapability(goal));
    $("#goalInput").value = goal;
    $("#instructionInput").value = state.handoffSummary || goal;
  }
  if (goal) openCapability(goal);
}

async function applyDevelopmentContinuation() {
  const proposalId = new URLSearchParams(location.search).get("continueProposal");
  if (!proposalId) return;
  try {
    const data = await api(`/api/development/proposal?id=${encodeURIComponent(proposalId)}`);
    selectCapability("developer");
    $("#workspaceInput").value = String(data.proposal?.workspacePath || "");
    $("#instructionInput").value = "";
    $("#instructionInput").placeholder = "说明还需要调整什么，或粘贴刚才检查中发现的问题";
    setDevelopmentMode("develop", false);
    openCapability("", { focusInput: true });
    history.replaceState(null, "", "/capabilities#start");
  } catch (error) { showToast(`无法继续这次项目任务：${error.message}`, true); }
}

function bindEvents() {
  $$('[data-view-target]').forEach((button) => button.addEventListener("click", () => openView(button.dataset.viewTarget)));
  $("#goalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const goal = $("#goalInput").value.trim();
    if (!goal) return showToast("先写下想完成的事情", true);
    selectCapability(await recommendCapability(goal));
    openCapability(goal);
  });
  $("#continueLast").addEventListener("click", restoreLast);
  $("#closeLaunch").addEventListener("click", closeCapability);
  $("#goalInput").addEventListener("input", () => { updateLaunchState(); saveDraft(); });
  $("#instructionInput").addEventListener("input", () => { updateLaunchState(); saveDraft(); });
  $("#workspaceInput").addEventListener("input", () => { updateLaunchState(); saveDraft(); });
  $("#useRecentWorkspace").addEventListener("click", () => {
    const path = recentWorkspaces()[0];
    if (!path) return;
    $("#workspaceInput").value = path;
    updateLaunchState();
    saveDraft();
  });
  $$('[data-access-mode]').forEach((button) => button.addEventListener("click", () => setDevelopmentMode(button.dataset.accessMode)));
  $("#formatSelect").addEventListener("change", saveDraft);
  $("#memoryToggle").addEventListener("change", saveDraft);
  $("#materialInput").addEventListener("change", async (event) => { await addMaterial(event.target.files?.[0]); event.target.value = ""; });
  $("#startTask").addEventListener("click", startTask);
  $("#memoryHelp").addEventListener("click", () => $("#memoryDialog").showModal());
  window.addEventListener("hashchange", () => openView(location.hash.slice(1) || "start", false));
  document.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-artifact-edit]");
    if (!edit || event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    window.location.assign(edit.dataset.artifactEdit);
  });
}

async function init() {
  renderStaticIcons();
  configureReturnLinks();
  bindEvents();
  renderRecentWorkspaces();
  renderCatalog();
  renderMaterials();
  updateContinueButton();
  openView(location.hash.slice(1) || "start", false);
  await refreshData();
  await applyDevelopmentContinuation();
  await applyChatHandoff();
  state.pollTimer = window.setInterval(refreshData, 4000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshData();
  });
}

init();
