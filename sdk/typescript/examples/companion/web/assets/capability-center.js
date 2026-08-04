"use strict";

const CATALOG = [
  { id: "presentation", backendId: "presentation-builder", name: "做 PPT", icon: "presentation", summary: "生成可放映、可继续编辑的演示文稿", description: "先梳理受众和叙事主线，再生成有版式变化、演讲备注和网页预览的 PowerPoint。", use: "汇报、提案、课程分享、路演", deliverable: "可编辑 PPTX 与网页预览", format: "pptx", featured: true, detail: "生成页面结构、版式、备注和可编辑文件" },
  { id: "document", backendId: "document-draft", name: "写正式文档", icon: "document", summary: "起草、改写和整理正式内容", description: "根据目标和材料生成结构完整的文稿，也能沿用你的常用文笔与排版习惯。", use: "方案、总结、说明、长文", deliverable: "可编辑文稿", format: "doc", featured: true, detail: "形成结构清楚、可以继续编辑的文稿" },
  { id: "research", backendId: "research-brief", name: "深度研究", icon: "search", summary: "搜索来源、核验声明并形成可追溯结论", description: "围绕一个问题规划研究路径，搜索并分级来源，对关键声明做独立复核，清楚标出证据和限制。", use: "行业研究、竞品、专题调研", deliverable: "带来源台账的研究报告", format: "html", featured: true, detail: "规划、搜索、来源分级、事实核验和结论复审" },
  { id: "thinking", backendId: "thinking-workbench", name: "梳理复杂问题", icon: "lightbulb", summary: "把模糊问题变成可操作的思考工作台", description: "分开事实、假设、矛盾和未知，保留多个选项，形成可以勾选和补充的验证计划。", use: "问题拆解、创意探索、复盘", deliverable: "可交互思考工作台", format: "html", featured: true, detail: "梳理问题、假设、选择和验证办法" },
  { id: "product", backendId: "product-design", name: "设计产品界面", icon: "layout", summary: "从用户任务形成页面和交互方案", description: "先理清真实用户路径，再产出信息结构、关键界面、交互说明和验收要点。", use: "新功能、界面改版、产品方案", deliverable: "产品设计说明", format: "html", featured: true, detail: "形成用户流程、页面结构与设计说明" },
  { id: "meeting", backendId: "meeting-minutes", name: "整理会议纪要", icon: "checklist", summary: "从记录中提炼结论和行动项", description: "把会议文字整理成摘要、决定、责任人、截止时间、风险和未决问题。", use: "会议记录、访谈、讨论复盘", deliverable: "纪要与行动表", format: "doc", featured: true, detail: "提炼决定、行动项与未决问题" },
  { id: "web", backendId: "html-report", name: "做网页报告", icon: "globe", summary: "把内容制作成独立网页", description: "生成不依赖外部服务、可直接在浏览器打开的单页内容。", use: "报告、说明页、互动展示", deliverable: "独立 HTML 网页", format: "html", detail: "制作可直接打开的独立网页" },
  { id: "decision", backendId: "decision-brief", name: "比较方案", icon: "scale", summary: "比较证据、风险与行动条件", description: "把零散信息整理成可判断的选择，说明收益、代价、风险和什么时候应该改变决定。", use: "选型、取舍、优先级判断", deliverable: "决策简报", format: "md", detail: "比较方案、风险和行动条件" },
  { id: "business", backendId: "business-deal", name: "推进商务合作", icon: "handshake", summary: "建立关键人、异议和跟进工作台", description: "梳理双方价值、关键人、异议、谈判边界和跟进动作，话术可以直接复制使用。", use: "合作、销售、谈判、跟进", deliverable: "可执行商务推进台", format: "html", detail: "准备合作策略、异议处理与跟进动作" },
  { id: "market", backendId: "market-opportunity", name: "模拟市场机会", icon: "trend", summary: "用多种情景检验机会是否成立", description: "从用户、竞争、执行和不确定性出发，调整权重比较不同情景，形成机会判断和低成本验证计划。", use: "市场洞察、机会评估、定位", deliverable: "可调节情景模拟台", format: "html", detail: "比较需求、竞争和执行情景，明确失效条件" },
  { id: "ability", backendId: "ability-builder", name: "生成新能力", icon: "branch", summary: "把重复工作沉淀成真正可用的能力", description: "先判断是否值得沉淀，再生成触发边界、输入、步骤、异常路径和测试；通过检查后会加入本机能力库。", use: "重复工作、团队方法、固定交付", deliverable: "已验证并安装的 Nemos 能力", format: "html", detail: "资格判断、触发测试、能力生成和本机安装" },
];

const ICON_PATHS = {
  message: '<path d="M4 5.5h16v11H9l-5 3v-14Z"/><path d="M8 9h8M8 12.5h5"/>',
  boxes: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  file: '<path d="M7 3.5h7l4 4V20H7z"/><path d="M14 3.5V8h4M9.5 12h5M9.5 15.5h5"/>',
  history: '<path d="M4.5 9a8 8 0 1 1 .4 7"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4l2.8 1.8"/>',
  brain: '<path d="M10 5a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 5.7 14 3 3 0 0 0 10 18.5V5ZM14 5a3 3 0 0 1 5 2.2 3.5 3.5 0 0 1-.7 6.8 3 3 0 0 1-4.3 4.5V5Z"/><path d="M7 9.5h3M14 9.5h3M7.5 14H10M14 14h2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14h-.2v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  presentation: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M8 20l4-5 4 5M8 8.5h5M8 11.5h8"/>',
  document: '<path d="M7 3.5h7l4 4V20H7z"/><path d="M14 3.5V8h4M9.5 12h5M9.5 15.5h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5M8.5 10.5h4M10.5 8.5v4"/>',
  lightbulb: '<path d="M8.5 15.5c-1.5-1.1-2.5-2.7-2.5-4.7a6 6 0 1 1 12 0c0 2-1 3.6-2.5 4.7L14.5 18h-5z"/><path d="M9.5 21h5M9.5 18h5"/>',
  layout: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M9 9v11"/>',
  checklist: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="m7.5 9 1.5 1.5 2.5-3M13.5 9h3M7.5 15l1.5 1.5 2.5-3M13.5 15h3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z"/>',
  scale: '<path d="M12 4v16M7 6h10M5 6l-3 6h6L5 6ZM19 6l-3 6h6l-3-6ZM8 20h8"/>',
  handshake: '<path d="m4 8 4-3 4 2 4-2 4 3-4 7-4 2-4-2-4-7Z"/><path d="m8 9 3 3a2 2 0 0 0 3 0l1-1M8 15l2-2M16 15l-2-2"/>',
  trend: '<path d="M4 18V6M4 18h16"/><path d="m7 14 4-4 3 2 5-6"/><path d="M15.5 6H19v3.5"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M6 7v5a5 5 0 0 0 5 5h5M8 7h8M11 7v5a5 5 0 0 0 5 5"/>',
};

function iconSvg(name) {
  const paths = ICON_PATHS[name] || ICON_PATHS.boxes;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
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
  ["product", /产品|界面|交互|原型|用户体验|功能设计/i],
  ["business", /商务|合作|销售|客户|谈判|成交|跟进/i],
  ["market", /市场|赛道|机会|定位|竞品|增长/i],
  ["research", /研究|调研|资料|调查|行业|搜集|分析报告/i],
  ["decision", /决策|比较|选择|取舍|评估|该不该/i],
  ["ability", /流程|自动化|重复工作|SOP|工作流/i],
  ["web", /网页|HTML|页面|网站|可视化/i],
  ["document", /文档|文章|总结|说明|方案|写作|润色/i],
  ["thinking", /思考|梳理|头脑风暴|复盘|想法|困惑/i],
];

const STATUS_TEXT = { queued: "等待开始", running: "正在执行", succeeded: "已完成", failed: "执行失败", cancelled: "已取消" };
const FORMAT_LABELS = { pptx: "可编辑 PowerPoint", html: "可交互网页", doc: "Word 就绪文稿", md: "可编辑文稿", json: "结构化数据", txt: "纯文本" };
const DRAFT_KEY = "nemos-capability-center-draft-v1";
const RECENT_KEY = "nemos-capability-center-recent-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: "start",
  selectedId: "presentation",
  showAll: false,
  snapshot: { abilities: [], artifacts: [] },
  llm: { live: false },
  jobs: [],
  personas: [],
  materials: [],
  memoryCount: 0,
  pollTimer: 0,
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
  return { ready: true, label: "可直接使用", action: "准备这个能力" };
}

function supportedFormats(item) {
  if (item.id === "presentation") return ["pptx", "html", "json", "md"];
  if (["research", "thinking", "product", "business", "market", "ability"].includes(item.id)) return ["html", "json", "md", "doc"];
  if (item.id === "web") return ["html", "md", "json"];
  if (["document", "meeting"].includes(item.id)) return ["doc", "md", "txt"];
  return ["md", "html", "doc", "json", "txt"];
}

function renderFormatOptions(item) {
  const select = $("#formatSelect");
  const previous = select.value;
  const formats = supportedFormats(item);
  select.innerHTML = formats.map((format) => `<option value="${format}">${FORMAT_LABELS[format]}</option>`).join("");
  select.value = formats.includes(previous) ? previous : item.format;
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
  root.innerHTML = CATALOG.map((item) => `
    <button class="cap-card${item.id === state.selectedId ? " is-selected" : ""}" type="button" data-capability="${item.id}" ${!state.showAll && !item.featured ? "hidden" : ""}>
      <span class="cap-icon" aria-hidden="true">${iconSvg(item.icon)}</span>
      <strong>${item.name}</strong>
      <small>${item.summary}</small>
      <span class="availability">${availability(item).label}</span>
    </button>`).join("");
  $$('[data-capability]', root).forEach((button) => button.addEventListener("click", () => selectCapability(button.dataset.capability)));
  $("#toggleAll").textContent = state.showAll ? "只看常用" : "查看全部 11 项";
}

function renderDetail() {
  const item = selectedCapability();
  $("#detailIcon").innerHTML = iconSvg(item.icon);
  $("#detailTitle").textContent = item.name;
  $("#detailDescription").textContent = item.description;
  $("#detailUse").textContent = item.use;
  $("#detailDeliverable").textContent = item.deliverable;
  const button = $("#prepareSelected");
  const status = availability(item);
  button.disabled = !status.ready;
  button.textContent = status.action;
}

function renderExecutionState() {
  const item = selectedCapability();
  const status = availability(item);
  const button = $("#startTask");
  button.disabled = !status.ready;
  button.textContent = status.ready ? "开始执行" : status.action;
  $(".run-note").textContent = status.ready
    ? "任务会在后台继续。离开此页后，可在“进行中”查看。"
    : "请先在设置中配置模型；任务不会用离线回声生成假结果。";
}

function selectCapability(id) {
  state.selectedId = CATALOG.some((item) => item.id === id) ? id : "document";
  renderCatalog();
  renderDetail();
  renderExecutionState();
  updatePreview();
}

function matchCapability(goal) {
  const rule = MATCH_RULES.find(([, expression]) => expression.test(goal));
  return rule?.[0] || "thinking";
}

function prepareTask(goal = $("#goalInput").value.trim()) {
  const item = selectedCapability();
  if (goal) {
    $("#goalInput").value = goal;
    if (!$("#instructionInput").value.trim()) $("#instructionInput").value = goal;
  }
  $("#prepareTitle").textContent = `准备：${item.name}`;
  renderFormatOptions(item);
  $("#formatSelect").value = item.format;
  $("#preparePanel").hidden = false;
  $("#capabilityPicker").open = false;
  updatePreview();
  renderExecutionState();
  saveDraft();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("#preparePanel").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function updatePreview() {
  const item = selectedCapability();
  const goal = $("#goalInput").value.trim() || $("#instructionInput").value.trim();
  $("#previewKind").textContent = item.name;
  $("#previewTitle").textContent = goal || "等待填写目标";
  $("#previewDetail").textContent = item.detail;
}

function renderMaterials() {
  $("#materialList").innerHTML = state.materials.map((file, index) => `
    <div class="material-item"><span>${escapeHtml(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB</span><button type="button" data-remove-material="${index}" aria-label="移除 ${escapeHtml(file.name)}">移除</button></div>`).join("");
  $$('[data-remove-material]').forEach((button) => button.addEventListener("click", () => {
    state.materials.splice(Number(button.dataset.removeMaterial), 1);
    renderMaterials();
    saveDraft();
  }));
}

async function addMaterial(file) {
  if (!file) return;
  const allowed = /\.(txt|md|markdown|csv|json|html?|htm)$/i.test(file.name);
  if (!allowed) return showToast("目前只支持文字材料", true);
  if (file.size > 1024 * 1024) return showToast("单个材料不能超过 1 MB", true);
  state.materials = [{ name: file.name, size: file.size, text: await file.text() }];
  renderMaterials();
  saveDraft();
}

function saveDraft() {
  const draft = {
    goal: $("#goalInput").value,
    instruction: $("#instructionInput").value,
    selectedId: state.selectedId,
    format: $("#formatSelect").value,
    personaId: $("#personaSelect").value,
    memoryMode: $("#memoryToggle").checked ? "preferences" : "off",
    materials: state.materials,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  updateContinueButton();
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "null"); } catch { return null; }
}

function updateContinueButton() {
  const draft = loadDraft();
  const recent = loadRecent();
  const button = $("#continueLast");
  button.hidden = !draft?.goal && !draft?.instruction && !recent?.goal;
  button.textContent = draft?.goal || draft?.instruction ? "继续未完成内容" : `再次使用：${String(recent?.goal || "").slice(0, 22)}`;
}

function restoreLast() {
  const draft = loadDraft();
  if (!draft?.goal && !draft?.instruction) {
    const recent = loadRecent();
    if (!recent?.goal) return showToast("没有可继续的内容", true);
    selectCapability(recent.selectedId);
    $("#goalInput").value = recent.goal;
    $("#instructionInput").value = recent.goal;
    prepareTask(recent.goal);
    return;
  }
  state.selectedId = CATALOG.some((item) => item.id === draft.selectedId) ? draft.selectedId : "document";
  state.materials = Array.isArray(draft.materials) ? draft.materials.slice(0, 1) : [];
  $("#goalInput").value = draft.goal || "";
  $("#instructionInput").value = draft.instruction || "";
  $("#memoryToggle").checked = draft.memoryMode !== "off";
  renderCatalog();
  renderDetail();
  renderMaterials();
  prepareTask();
  if ([...$("#formatSelect").options].some((option) => option.value === draft.format)) $("#formatSelect").value = draft.format;
  if ([...$("#personaSelect").options].some((option) => option.value === draft.personaId)) $("#personaSelect").value = draft.personaId;
}

function resetDraft() {
  localStorage.removeItem(DRAFT_KEY);
  $("#goalInput").value = "";
  $("#instructionInput").value = "";
  state.materials = [];
  renderMaterials();
  $("#preparePanel").hidden = true;
  updateContinueButton();
}

async function startTask() {
  const item = selectedCapability();
  const goal = $("#goalInput").value.trim();
  const details = $("#instructionInput").value.trim();
  const instruction = details || goal;
  if (!instruction) return showToast("先写下想完成的事情", true);
  if (!isAvailable(item)) return showToast(availability(item).action, true);
  const button = $("#startTask");
  button.disabled = true;
  button.textContent = "正在加入任务…";
  const materials = state.materials.length ? `\n\n用户提供的材料：\n--- ${state.materials[0].name} ---\n${state.materials[0].text}` : "";
  try {
    await api("/api/agent/job", {
      method: "POST",
      body: JSON.stringify({
        kind: "capability-adhoc",
        title: (goal || instruction).slice(0, 60),
        personaId: $("#personaSelect").value || "zhiwei",
        capabilityId: item.backendId,
        instruction: `${instruction}${materials}`,
        format: $("#formatSelect").value,
        memoryMode: $("#memoryToggle").checked ? "preferences" : "off",
        idempotencyKey: `capability-center-${crypto.randomUUID()}`,
      }),
    });
    localStorage.setItem(RECENT_KEY, JSON.stringify({ goal: goal || instruction, selectedId: item.id, at: new Date().toISOString() }));
    resetDraft();
    await refreshData();
    openView("runs");
    showToast("任务已开始，可以放心离开此页");
  } catch (error) {
    showToast(error.message || "任务未能开始", true);
  } finally {
    renderExecutionState();
  }
}

function jobTitle(job) {
  return String(job.payload?.title || job.result?.data?.artifact?.title || "未命名任务");
}

function jobCapability(job) {
  return capabilityForBackend(job.payload?.capabilityId || job.result?.data?.artifact?.capabilityId);
}

function latestCheckpoint(job) {
  return job.checkpoints?.[job.checkpoints.length - 1] || null;
}

function artifactFromJob(job) {
  return job.result?.data?.artifact || null;
}

function artifactLinks(artifact, compact = false) {
  if (!artifact) return "";
  const preview = `<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(artifact.id)}" target="_blank" rel="noopener">${compact ? "预览" : "打开结果"}</a>`;
  const download = artifact.format === "pptx"
    ? `<a href="/api/capabilities/artifact?id=${encodeURIComponent(artifact.id)}&download=1">${compact ? "下载" : "下载 PPTX"}</a>`
    : "";
  return preview + download;
}

function renderRuns() {
  const jobs = state.jobs.filter((job) => job.status === "queued" || job.status === "running");
  $("#runsEmpty").hidden = jobs.length > 0;
  $("#runsList").innerHTML = jobs.map((job) => {
    const item = jobCapability(job);
    const checkpoint = latestCheckpoint(job);
    const progress = Math.max(3, Math.min(100, Number(checkpoint?.progress ?? (job.status === "running" ? 12 : 3))));
    return `<article class="task-row">
      <span class="task-row-icon" aria-hidden="true">${iconSvg(item.icon)}</span>
      <div><h2>${escapeHtml(jobTitle(job))}</h2><p class="status-line"><span class="status-dot ${job.status}"></span>${STATUS_TEXT[job.status]} · ${escapeHtml(checkpoint?.status || item.name)} · ${displayDate(job.updatedAt)}</p><div class="progress-track" aria-label="进度 ${progress}%"><span style="width:${progress}%"></span></div></div>
      <div class="task-actions"><button type="button" data-cancel-job="${escapeHtml(job.id)}">取消任务</button></div>
    </article>`;
  }).join("");
  $$('[data-cancel-job]').forEach((button) => button.addEventListener("click", () => cancelJob(button.dataset.cancelJob)));
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
  const jobs = state.jobs.filter((job) => ["succeeded", "failed", "cancelled"].includes(job.status));
  $("#historyEmpty").hidden = jobs.length > 0;
  $("#historyList").innerHTML = jobs.map((job) => {
    const item = jobCapability(job);
    const artifact = artifactFromJob(job);
    const open = artifactLinks(artifact);
    const installed = artifact?.metadata?.generatedAbilityId ? " · 已加入能力库" : "";
    return `<article class="task-row">
      <span class="task-row-icon" aria-hidden="true">${iconSvg(item.icon)}</span>
      <div><h2>${escapeHtml(jobTitle(job))}</h2><p class="status-line"><span class="status-dot ${job.status}"></span>${STATUS_TEXT[job.status]} · ${item.name}${installed} · ${displayDate(job.completedAt || job.updatedAt)}${job.error ? ` · ${escapeHtml(job.error)}` : ""}</p></div>
      <div class="task-actions">${open}<button type="button" data-reuse-job="${escapeHtml(job.id)}">再次使用</button></div>
    </article>`;
  }).join("");
  $$('[data-reuse-job]').forEach((button) => button.addEventListener("click", () => reuseJob(button.dataset.reuseJob)));
}

function reuseJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const capability = jobCapability(job);
  state.selectedId = capability.id;
  $("#goalInput").value = jobTitle(job);
  $("#instructionInput").value = String(job.payload?.instruction || jobTitle(job));
  $("#memoryToggle").checked = job.payload?.memoryMode !== "off";
  state.materials = [];
  renderMaterials();
  renderCatalog();
  renderDetail();
  openView("start");
  prepareTask(jobTitle(job));
  if ([...$("#formatSelect").options].some((option) => option.value === job.payload?.format)) $("#formatSelect").value = job.payload.format;
  showToast("已复制为新任务，原结果不会改变");
}

function renderFiles() {
  const artifacts = Array.isArray(state.snapshot.artifacts) ? [...state.snapshot.artifacts] : [];
  artifacts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const groups = new Map();
  for (const artifact of artifacts) {
    const key = `${artifact.capabilityId || "file"}:${artifact.title || artifact.taskId || artifact.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(artifact);
  }
  $("#filesEmpty").hidden = groups.size > 0;
  $("#filesList").innerHTML = [...groups.values()].map((versions) => {
    const latest = versions[0];
    const capability = capabilityForBackend(latest.capabilityId);
    return `<article class="file-card">
      <div class="file-card-top"><div><h2>${escapeHtml(latest.title || "未命名文件")}</h2><p>${capability.name} · ${versions.length > 1 ? `${versions.length} 个版本` : displayDate(latest.createdAt)}</p></div><span class="file-type">${escapeHtml(String(latest.format || "file").toUpperCase())}</span></div>
      <div class="versions">${versions.slice(0, 5).map((file, index) => `<div class="version-row"><span>${versions.length > 1 ? `版本 ${versions.length - index}` : "最新结果"} · ${displayDate(file.createdAt)}</span><span class="version-actions">${artifactLinks(file, true)}</span></div>`).join("")}</div>
    </article>`;
  }).join("");
}

function renderPersonas() {
  const select = $("#personaSelect");
  const previous = select.value;
  select.innerHTML = state.personas.map((persona) => `<option value="${escapeHtml(persona.id)}">${escapeHtml(persona.name)}</option>`).join("");
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  else if ([...select.options].some((option) => option.value === "zhiwei")) select.value = "zhiwei";
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
  document.title = `${{ start: "能力", runs: "进行中", history: "已完成", files: "文件" }[view]} · Nemos`;
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
    renderDetail();
    renderExecutionState();
    renderPersonas();
    renderRuns();
    renderHistory();
    renderFiles();
  } catch (error) {
    showToast(`暂时无法读取能力数据：${error.message}`, true);
  }
}

function bindEvents() {
  $$('[data-view-target]').forEach((button) => button.addEventListener("click", () => openView(button.dataset.viewTarget)));
  $("#toggleAll").addEventListener("click", () => { state.showAll = !state.showAll; renderCatalog(); });
  $("#goalForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const goal = $("#goalInput").value.trim();
    if (!goal) return showToast("先写下想完成的事情", true);
    selectCapability(matchCapability(goal));
    prepareTask(goal);
  });
  $("#prepareSelected").addEventListener("click", () => prepareTask());
  $("#continueLast").addEventListener("click", restoreLast);
  $("#closePrepare").addEventListener("click", () => { $("#preparePanel").hidden = true; saveDraft(); });
  $("#goalInput").addEventListener("input", () => { updatePreview(); saveDraft(); });
  $("#instructionInput").addEventListener("input", () => { updatePreview(); saveDraft(); });
  $("#formatSelect").addEventListener("change", saveDraft);
  $("#personaSelect").addEventListener("change", saveDraft);
  $("#memoryToggle").addEventListener("change", saveDraft);
  $("#materialInput").addEventListener("change", async (event) => { await addMaterial(event.target.files?.[0]); event.target.value = ""; });
  $("#startTask").addEventListener("click", startTask);
  $("#memoryHelp").addEventListener("click", () => $("#memoryDialog").showModal());
  $("#capabilityPicker").addEventListener("toggle", () => {
    const action = $("#capabilityPicker .picker-action");
    if (action) action.textContent = $("#capabilityPicker").open ? "收起" : "展开";
  });
  window.addEventListener("hashchange", () => openView(location.hash.slice(1) || "start", false));
}

async function init() {
  renderStaticIcons();
  bindEvents();
  renderCatalog();
  renderDetail();
  renderMaterials();
  updateContinueButton();
  openView(location.hash.slice(1) || "start", false);
  await refreshData();
  state.pollTimer = window.setInterval(refreshData, 4000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshData();
  });
}

init();
