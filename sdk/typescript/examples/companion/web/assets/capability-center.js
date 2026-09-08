"use strict";

const CATALOG = () => window.ClownfishWorkflowCatalog.capabilities;

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
  translate: '<path d="M4 5h10M9 3v2c0 5-2 8-6 10M5.5 9c1.8 2.7 4.1 4.6 7 5.5M14 19l3.5-9 3.5 9M15.3 16h4.4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  polish: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.5 8 3 3M5.5 15.5l3 3M19 3v3M17.5 4.5h3M20 14v4M18 16h4"/>',
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
  ["thinking", /(?:按|依照).{0,8}(?:紧急程度|优先级).{0,8}(?:整理|安排|排序)|(?:紧急程度|优先级).{0,8}(?:整理|安排|排序)/i],
  ["presentation", /PPT|演示文稿|路演|幻灯|课件|(?:生成|制作|做成|输出).{0,8}(汇报|提案)|(?:汇报|提案).{0,8}(PPT|演示|大纲|材料)/i],
  ["speech", /语音转写|音频转写|录音转写|视频转写|识别音频|听写/i],
  ["translate", /翻译|中译英|英译中|译成|译文/i],
  ["polish", /轻量润色|文字润色|校对错别字|清理标点/i],
  ["meeting", /会议|纪要|访谈|录音|讨论记录/i],
  ["document", /(?:周报|月报|日报|材料|素材|内容).{0,18}(?:整理|摘要|总结|归纳|提炼)|(?:整理|摘要|总结|归纳|提炼).{0,18}(?:周报|月报|日报|材料|素材|内容)|管理层摘要|正式文档/i],
  ["product", /产品|界面|交互|原型|用户体验|功能设计|用户路径|操作流程|能力页|文件工作流|工作台设计/i],
  ["business", /商务|合作|销售|客户|谈判|成交|跟进/i],
  ["marketBrief", /港股|股票|行情|公告|财报|盘前|盘后|自选|持仓|HKEX/i],
  ["market", /市场|赛道|机会|定位|竞品|增长/i],
  ["research", /研究|调研|资料|调查|行业|搜集|分析报告|核验|威胁建模|提示注入|安全审计|隐私风险/i],
  ["decision", /决策|比较|选择|取舍|评估|该不该/i],
  ["ability", /流程|自动化|重复工作|SOP|工作流/i],
  ["web", /网页|HTML|页面|网站|可视化/i],
  ["document", /文档|文章|总结|说明|方案|写作|润色|项目复盘/i],
  ["thinking", /思考|梳理|头脑风暴|复盘|想法|困惑|优先级|紧急程度|时间安排/i],
];

const EXAMPLE_PROMPTS = {
  presentation: "例如：把季度总结做成 10 页管理层汇报，重点突出增长、风险和下一步行动",
  document: "例如：根据这些材料起草一份正式方案，结构清楚，语气专业",
  research: "例如：研究国内 AI 办公市场，核验主要数据并附上可追溯来源",
  marketBrief: "例如：整理 02513.HK 最近公告和行情变化，标明来源、时间与风险",
  thinking: "例如：帮我梳理是否应该进入这个市场，分开事实、假设和待验证问题",
  product: "例如：重新设计新用户首页，减少认知负担并给出关键交互说明",
  meeting: "例如：把会议记录整理成结论、行动项、负责人和截止时间",
  translate: "把要翻译的文字放到这里",
  speech: "选择音频、视频，或直接开始录音",
  polish: "把要润色的文字放到这里",
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
  meeting: "#4c765e",
  translate: "#4d7584",
  speech: "#9a5d4a",
  polish: "#8a5e75",
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
migrateStorageKey([110, 101, 109, 111, 115, 45, 99, 97, 112, 97, 98, 105, 108, 105, 116, 121, 45, 104, 97, 110, 100, 111, 102, 102, 45, 118, 49], "clownfish-capability-handoff-v1", sessionStorage);

const DRAFT_KEY = "clownfish-capability-center-draft-v1";
const DRAFTS_KEY = "clownfish-capability-drafts-v1";
const HANDOFF_KEY = "clownfish-capability-handoff-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: "start",
  selectedId: "presentation",
  snapshot: { abilities: [], artifacts: [] },
  registry: { skills: [], tools: [], engines: [], providers: [], extensions: [], surfaces: [] },
  llm: { live: false },
  toolSettings: {},
  toolStatus: { hasZhipuKey: false },
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
  activeDraftId: "",
  activeConversationTaskId: "",
  activeConversationJobId: "",
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
  return CATALOG().find((item) => item.id === state.selectedId) || CATALOG()[0];
}

function capabilityForBackend(id) {
  return CATALOG().find((item) => item.backendId === id) || CATALOG().find((item) => item.id === id) || CATALOG()[1];
}

function isAvailable(item) {
  return availability(item).ready;
}

function isQuickTool(item = selectedCapability()) {
  return item?.quickTool === true;
}

function availability(item) {
  if (isQuickTool(item)) {
    if (item.id === "speech" && !state.toolStatus.hasZhipuKey && !state.llm.live) {
      return { ready: false, label: "需设置语音服务", action: "设置语音服务后使用" };
    }
    return { ready: true, label: "打开后检查依赖", action: "开始使用" };
  }
  const wired = state.registry.skills.length
    ? state.registry.skills.some((ability) => ability.id === item.backendId && ability.available)
    : state.snapshot.abilities.some((ability) => ability.id === item.backendId && !ability.archived);
  if (!wired) return { ready: false, label: "尚未接入", action: "此能力尚未接入" };
  if (!state.llm.live) return { ready: false, label: "需设置模型", action: "设置模型后即可使用" };
  const search = (state.registry.tools.length ? state.registry.tools : state.snapshot.tools)?.find((tool) => tool.id === "web.search");
  if (item.id === "research" && !search?.available) return { ready: false, label: "需联网搜索", action: "配置联网搜索后使用" };
  return { ready: true, label: "已配置 · 执行时检查", action: "开始使用" };
}

function supportedFormats(item) {
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
  select.innerHTML = formats.map((format) => `<option value="${format}">${FORMAT_LABELS[format]}</option>`).join("");
  select.value = formats.includes(previous) ? previous : item.format;
  select.disabled = false;
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
  root.innerHTML = window.ClownfishWorkflowCatalog.tools.map((item) => `
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
  const quick = isQuickTool(item);
  const hasInstruction = quick
    ? item.id === "speech" ? Boolean($("#quickSpeechFile").files?.[0]) : Boolean($("#quickInput").value.trim())
    : Boolean($("#goalInput").value.trim() || $("#instructionInput").value.trim());
  button.disabled = Boolean(state.preparingMaterials || state.receivingMaterials) || !status.ready || !hasInstruction;
  const quickAction = { translate: "开始翻译", speech: "开始转写", polish: "开始润色" }[item.id] || "开始处理";
  button.textContent = !status.ready ? status.action : !hasInstruction ? (item.id === "speech" ? "先选择文件或开始录音" : "先输入要处理的文字") : quick ? quickAction : "开始执行";
  $(".run-note").textContent = !status.ready
    ? (quick ? "请先在设置中完成对应服务配置。" : "请先在设置中配置模型；任务不会用离线回声生成假结果。")
    : hasInstruction
      ? (quick ? "处理完成后可直接复制或保存结果。" : "任务会在后台继续；离开此页后，可在“进行中”查看。")
      : quick
        ? (item.id === "speech" ? "选择音频、视频，或直接开始录音。" : "输入文字后即可开始处理。")
        : "填写任务要求后即可开始。";
}

function selectCapability(id) {
  const previousId = state.selectedId;
  state.selectedId = CATALOG().some((item) => item.id === id) ? id : "document";
  if (previousId !== state.selectedId) {
    $("#quickResult").value = "";
    $("#quickResultWrap").hidden = true;
    $("#quickStatus").textContent = "";
  }
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
  const quick = isQuickTool(item);
  if (goal) {
    $("#goalInput").value = goal;
    if (quick && item.id !== "speech" && !$("#quickInput").value.trim()) $("#quickInput").value = goal;
    if (!quick && !$("#instructionInput").value.trim()) $("#instructionInput").value = goal;
  }
  const workflow = window.ClownfishWorkflowCatalog.resolve(item.id);
  $("#workflowBotContext").hidden = !workflow;
  $("#workflowBotName").textContent = workflow ? workflow.name + " · 执行技能" : "";
  $("#launchTitle").textContent = workflow?.name || item.name;
  $("#launchSummary").textContent = item.summary;
  $("#instructionLabel").textContent = "任务要求";
  $("#instructionInput").placeholder = EXAMPLE_PROMPTS[item.id] || "说清楚要完成什么，也可以补充受众、重点、语气或格式";
  $("#standardTaskFields").hidden = quick;
  $("#quickAbilityFields").hidden = !quick;
  $("#quickTextInput").hidden = !quick || item.id === "speech";
  $("#quickSpeechInput").hidden = item.id !== "speech";
  if (quick && item.id !== "speech") {
    $("#quickInputLabel").textContent = item.id === "translate" ? "需要翻译的文字" : "需要润色的文字";
    $("#quickInput").placeholder = EXAMPLE_PROMPTS[item.id];
  }
  $("#formatField").hidden = quick;
  $("#materialDrop").hidden = quick;
  $("#materialList").hidden = quick;
  $("#advancedSettings").hidden = quick;
  $("#launchPanel").classList.toggle("is-quick", quick);
  renderFormatOptions(item);
  $("#formatSelect").value = item.format;
  $("#launchPanel").hidden = false;
  $(".start-wrap").classList.add("is-launching");
  updateLaunchState();
  renderExecutionState();
  if (goal) saveDraft();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    if (options.focusInput && window.matchMedia("(min-width: 721px)").matches) {
      if (quick && item.id !== "speech") $("#quickInput").focus({ preventScroll: true });
      else if (!quick && !goal) $("#instructionInput").focus({ preventScroll: true });
    }
  });
}

function closeCapability() {
  $("#workflowBotContext").hidden = true;
  $("#launchPanel").hidden = true;
  $(".start-wrap").classList.remove("is-launching");
  window.scrollTo({ top: 0, behavior: "auto" });
  saveDraft();
  state.activeDraftId = "";
  localStorage.removeItem(DRAFT_KEY);
  window.requestAnimationFrame(() => $(`[data-capability="${state.selectedId}"]`)?.focus());
}

function updateLaunchState() {
  renderExecutionState();
}

function renderMaterials() {
  if ($("#materialStatus")) $("#materialStatus").textContent = "";
  $("#materialList").innerHTML = state.materials.map((file, index) => `
    <div class="material-item"><span>${escapeHtml(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB${file.pending ? (file.file ? " · 开始执行时读取" : " · 需重新选择文件") : ""}</span><button type="button" data-remove-material="${index}" aria-label="移除 ${escapeHtml(file.name)}">移除</button></div>`).join("");
  $$('[data-remove-material]').forEach((button) => button.addEventListener("click", () => {
    state.materials.splice(Number(button.dataset.removeMaterial), 1);
    renderMaterials();
    saveDraft();
  }));
  updateLaunchState();
}

async function addMaterial(file) {
  if (state.preparingMaterials || state.receivingMaterials) return;
  const files = Array.isArray(file) ? file : file ? [file] : [];
  if (!files.length) return;
  try {
    if (state.materials.length + files.length > 8) throw Error("最多添加 8 个附件");
    const pending = files.map(window.ClownfishPendingMaterials.pending);
    state.materials.push(...pending);
    renderMaterials();
    saveDraft();
    showToast("附件已加入，开始执行时读取正文");
  } catch (error) { showToast(error.message || "添加附件失败", true); }
}

function saveDraft() {
  const draft = {
    id: state.activeDraftId || "",
    goal: $("#goalInput").value,
    instruction: $("#instructionInput").value,
    quickInput: $("#quickInput").value,
    quickResult: $("#quickResult").value,
    selectedId: state.selectedId,
    format: $("#formatSelect").value,
    memoryMode: $("#memoryToggle").checked ? "preferences" : "off",
    materials: window.ClownfishPendingMaterials.saved(state.materials),
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
  if (!draftHasWork(draft)) {
    localStorage.removeItem(DRAFT_KEY);
    if (draft.id) localStorage.setItem(DRAFTS_KEY, JSON.stringify(loadDrafts().filter((item) => item.id !== draft.id)));
    renderDraftList();
    return;
  }
  if (!draft.id) draft.id = crypto.randomUUID();
  state.activeDraftId = draft.id;
  draft.title = draftTitle(draft);
  const drafts = loadDrafts().filter((item) => item.id !== draft.id);
  drafts.unshift(draft);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 20)));
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  renderDraftList();
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}


function loadDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]");
    return Array.isArray(drafts) ? drafts.filter((item) => item && typeof item.id === "string") : [];
  } catch { return []; }
}

function draftHasWork(draft) {
  return Boolean(String(draft?.goal || "").trim()
    || String(draft?.instruction || "").trim()
    || String(draft?.quickInput || "").trim()
    || String(draft?.quickResult || "").trim()
    || (Array.isArray(draft?.materials) && draft.materials.length)
    || String(draft?.handoffSummary || "").trim()
    || (Array.isArray(draft?.handoffConversation) && draft.handoffConversation.length)
    || String(draft?.parentJobId || "").trim());
}

function draftTitle(draft) {
  const item = CATALOG().find((entry) => entry.id === draft.selectedId);
  const source = String(draft.goal || draft.instruction || draft.quickInput || draft.quickResult || "").trim().replace(/\s+/g, " ");
  return source ? source.slice(0, 30) : `${item?.name || "能力"}未完成内容`;
}

function renderDraftList() {
  const drafts = loadDrafts().filter((draft) => draftHasWork(draft) && !draft.archivedAt);
  $("#capabilityDraftSection").hidden = drafts.length === 0;
  $("#capabilityDraftCount").textContent = String(drafts.length);
  $("#capabilityDraftList").innerHTML = drafts.map((draft) => {
    const item = CATALOG().find((entry) => entry.id === draft.selectedId);
    return `<div class="capability-draft-row"><button type="button" data-capability-draft="${escapeHtml(draft.id)}"><strong>${escapeHtml(draft.title || draftTitle(draft))}</strong><small>${escapeHtml(item?.name || "能力")} · ${escapeHtml(displayDate(draft.updatedAt))}</small></button><button type="button" class="capability-row-action" data-archive-capability-draft="${escapeHtml(draft.id)}" aria-label="归档${escapeHtml(draft.title || draftTitle(draft))}">归档</button></div>`;
  }).join("");
}

function archiveDraftById(id) {
  const now = new Date().toISOString();
  const drafts = loadDrafts().map((draft) => draft.id === id ? { ...draft, archivedAt: now, updatedAt: now } : draft);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  if (state.activeDraftId === id) resetDraft({ removeRecord: false });
  renderDraftList();
  renderArchiveList();
  showToast("未完成内容已归档");
}

function restoreArchivedDraft(id) {
  const drafts = loadDrafts().map((draft) => draft.id === id ? { ...draft, archivedAt: "", updatedAt: new Date().toISOString() } : draft);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  restoreDraftById(id);
  renderArchiveList();
  showToast("已打开未完成内容");
}

function deleteArchivedDraft(id) {
  const draft = loadDrafts().find((item) => item.id === id && item.archivedAt);
  if (!draft || !confirm(`彻底删除「${draft.title || draftTitle(draft)}」？`)) return;
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(loadDrafts().filter((item) => item.id !== id)));
  renderArchiveList();
  showToast("归档内容已删除");
}

function migrateLegacyDraft() {
  const draft = loadDraft();
  if (!draft || !draftHasWork(draft)) return;
  draft.id = draft.id || crypto.randomUUID();
  draft.title = draft.title || draftTitle(draft);
  const drafts = loadDrafts().filter((item) => item.id !== draft.id);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify([draft, ...drafts].slice(0, 20)));
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function restoreDraftById(id) {
  const draft = loadDrafts().find((item) => item.id === id) || (loadDraft()?.id === id ? loadDraft() : null);
  if (!draft || !draftHasWork(draft)) return showToast("这条未完成记录已经不存在", true);
  const detachedFromChat = draft.handoffSource === "chat";
  state.activeDraftId = draft.id;

  state.selectedId = CATALOG().some((item) => item.id === draft.selectedId) ? draft.selectedId : "document";
  state.materials = Array.isArray(draft.materials) ? draft.materials.slice(-8) : [];
  $("#goalInput").value = draft.goal || "";
  $("#instructionInput").value = draft.instruction || "";
  $("#quickInput").value = draft.quickInput || "";
  $("#quickResult").value = draft.quickResult || "";
  $("#quickResultWrap").hidden = !String(draft.quickResult || "").trim();
  $("#memoryToggle").checked = draft.memoryMode !== "off";
  state.parentJobId = detachedFromChat ? "" : String(draft.parentJobId || "");
  state.continuationTaskId = detachedFromChat ? "" : String(draft.continuationTaskId || "");
  state.handoffChain = Array.isArray(draft.handoffChain) ? draft.handoffChain.slice(0, 12) : [];
  state.handoffSummary = detachedFromChat ? "" : String(draft.handoffSummary || "");
  state.handoffConversation = detachedFromChat ? [] : Array.isArray(draft.handoffConversation) ? draft.handoffConversation.slice(-120) : [];
  state.handoffMessageCount = state.handoffConversation.length;
  state.handoffSource = draft.handoffSource === "capability" ? "capability" : "";
  state.handoffSourceCapabilityId = detachedFromChat ? "" : String(draft.handoffSourceCapabilityId || "");
  state.returnConversationKey = "";
  renderCatalog();
  renderMaterials();
  openCapability();
  if ([...$("#formatSelect").options].some((option) => option.value === draft.format)) $("#formatSelect").value = draft.format;
}

function restoreLast() {
  const draft = loadDraft();
  if (!draft?.id) return showToast("没有可继续的内容", true);
  restoreDraftById(draft.id);
}

function resetDraft(options = {}) {
  const activeId = state.activeDraftId;
  localStorage.removeItem(DRAFT_KEY);
  if (options.removeRecord && activeId) {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(loadDrafts().filter((draft) => draft.id !== activeId)));
  }
  state.activeDraftId = "";
  $("#goalInput").value = "";
  $("#instructionInput").value = "";
  $("#quickInput").value = "";
  $("#quickResult").value = "";
  $("#quickResultWrap").hidden = true;
  $("#quickStatus").textContent = "";
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
  $("#launchPanel").hidden = true;
  $(".start-wrap").classList.remove("is-launching");
  renderDraftList();
}

function showQuickResult(text, status) {
  const value = String(text || "").trim();
  $("#quickResult").value = value;
  $("#quickResultWrap").hidden = !value;
  $("#quickStatus").textContent = status || (value ? "处理完成" : "没有得到可用结果");
  saveDraft();
}

async function readQuickClipboard() {
  if (!navigator.clipboard?.readText) throw new Error("当前环境无法读取剪贴板");
  $("#quickInput").value = await navigator.clipboard.readText();
  updateLaunchState();
  saveDraft();
}

async function copyQuickResult() {
  const text = $("#quickResult").value.trim();
  if (!text) return showToast("还没有可复制的结果", true);
  if (!navigator.clipboard?.writeText) throw new Error("当前环境无法写入剪贴板");
  await navigator.clipboard.writeText(text);
  showToast("结果已复制");
}

function downloadQuickResult() {
  const text = $("#quickResult").value.trim();
  if (!text) return showToast("还没有可保存的结果", true);
  const item = selectedCapability();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  link.download = `${item.name}-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function audioBlobToWav(blob) {
  const sourceBuffer = await blob.arrayBuffer();
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await context.decodeAudioData(sourceBuffer);
  await context.close();
  const sourceRate = decoded.sampleRate;
  const targetRate = 16000;
  const source = decoded.getChannelData(0);
  const ratio = sourceRate / targetRate;
  const sampleCount = Math.floor(source.length / ratio);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const position = index * ratio;
    const start = Math.floor(position);
    const fraction = position - start;
    samples[index] = (source[start] || 0) * (1 - fraction) + (source[start + 1] || 0) * fraction;
  }
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  write(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, sampleCount * 2, true);
  for (let index = 0, offset = 44; index < sampleCount; index += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function splitQuickWav(wav, maxSeconds = 25) {
  const source = await wav.arrayBuffer();
  const view = new DataView(source);
  if (source.byteLength < 44 || String.fromCharCode(...new Uint8Array(source, 0, 4)) !== "RIFF") return [wav];
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  let cursor = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (cursor + 8 <= source.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(source, cursor, 4));
    const size = view.getUint32(cursor + 4, true);
    if (id === "data") { dataOffset = cursor + 8; dataSize = size; break; }
    cursor += 8 + size + (size & 1);
  }
  if (dataOffset < 0 || !channels || !sampleRate || !bits) return [wav];
  const bytesPerFrame = channels * (bits / 8);
  const maxBytes = Math.floor(sampleRate * maxSeconds) * bytesPerFrame;
  if (dataSize <= maxBytes) return [wav];
  const pcm = new Uint8Array(source, dataOffset, dataSize);
  const chunks = [];
  for (let start = 0; start < dataSize; start += maxBytes) {
    const size = Math.min(maxBytes, dataSize - start);
    const chunk = new ArrayBuffer(44 + size);
    const chunkView = new DataView(chunk);
    const write = (offset, value) => { for (let index = 0; index < value.length; index += 1) chunkView.setUint8(offset + index, value.charCodeAt(index)); };
    write(0, "RIFF"); chunkView.setUint32(4, 36 + size, true); write(8, "WAVE");
    write(12, "fmt "); chunkView.setUint32(16, 16, true); chunkView.setUint16(20, 1, true); chunkView.setUint16(22, channels, true);
    chunkView.setUint32(24, sampleRate, true); chunkView.setUint32(28, sampleRate * bytesPerFrame, true); chunkView.setUint16(32, bytesPerFrame, true); chunkView.setUint16(34, bits, true);
    write(36, "data"); chunkView.setUint32(40, size, true);
    new Uint8Array(chunk, 44).set(pcm.subarray(start, start + size));
    chunks.push(new Blob([chunk], { type: "audio/wav" }));
  }
  return chunks;
}

async function transcribeQuickAudio(blob) {
  if (!blob || blob.size < 1200) throw new Error("音频太短或为空");
  if (blob.size > 100 * 1024 * 1024) throw new Error("音频或视频不能超过 100 MB");
  $("#quickStatus").textContent = "正在转换音频…";
  const wav = await audioBlobToWav(blob);
  const maxSeconds = Math.min(29, Math.max(10, Number(state.toolSettings.asrSegmentSeconds || 25)));
  const chunks = await splitQuickWav(wav, maxSeconds);
  const parts = [];
  for (let index = 0; index < chunks.length; index += 1) {
    $("#quickStatus").textContent = chunks.length > 1 ? `正在转写 ${index + 1}/${chunks.length}…` : "正在转写…";
    const response = await fetch("/api/asr", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: chunks[index] });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) throw new Error(result.error || `转写失败（${response.status}）`);
    if (result.text) parts.push(String(result.text).trim());
  }
  let text = parts.filter(Boolean).join("\n").trim();
  if (text && state.toolSettings.asrLiveCorrection !== false) {
    $("#quickStatus").textContent = "正在整理标点和断句…";
    try {
      const corrected = await api("/api/tools/asr-correct", { method: "POST", body: JSON.stringify({ text }) });
      text = corrected.text || text;
    } catch { /* 转写正文仍可交付 */ }
  }
  return text;
}

async function runQuickAbility(inputBlob) {
  const item = selectedCapability();
  const button = $("#startTask");
  button.disabled = true;
  button.textContent = "正在处理…";
  $("#quickStatus").textContent = "正在处理…";
  try {
    let result;
    let provider = "";
    if (item.id === "speech") {
      const blob = inputBlob || $("#quickSpeechFile").files?.[0];
      if (!blob) throw new Error("先选择音频、视频，或直接开始录音");
      result = await transcribeQuickAudio(blob);
    } else {
      const text = $("#quickInput").value.trim();
      if (!text) throw new Error("先输入要处理的文字");
      const response = await api(item.id === "translate" ? "/api/tools/translate" : "/api/tools/polish", { method: "POST", body: JSON.stringify({ text }) });
      result = response.text;
      provider = response.provider || "";
    }
    showQuickResult(result, result ? `处理完成${provider ? ` · ${provider}` : ""}` : "没有得到可用结果");
  } catch (error) {
    $("#quickStatus").textContent = error.message || "处理失败";
    showToast(error.message || "处理失败", true);
  } finally {
    renderExecutionState();
  }
}

let quickRecorder = null;
let quickRecordingParts = [];
async function toggleQuickRecording() {
  const button = $("#quickRecord");
  if (quickRecorder?.state === "recording") {
    quickRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    quickRecorder = new MediaRecorder(stream);
    quickRecordingParts = [];
    quickRecorder.ondataavailable = (event) => { if (event.data?.size) quickRecordingParts.push(event.data); };
    quickRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      button.textContent = "开始录音";
      await runQuickAbility(new Blob(quickRecordingParts, { type: quickRecorder?.mimeType || "audio/webm" }));
    };
    quickRecorder.start();
    button.textContent = "停止并转写";
    $("#quickStatus").textContent = "录音中…";
  } catch (error) {
    $("#quickStatus").textContent = `麦克风打不开：${error.message || error}`;
  }
}

async function startTask() {
  if (state.preparingMaterials || state.receivingMaterials) return;
  const item = selectedCapability();
  if (isQuickTool(item)) return runQuickAbility();
  const goal = $("#goalInput").value.trim();
  const details = $("#instructionInput").value.trim();
  const instruction = details || goal;
  if (!instruction) return showToast("先写下想完成的事情", true);
  if (!isAvailable(item)) return showToast(availability(item).action, true);
  const button = $("#startTask");
  button.disabled = true;
  button.textContent = "正在加入任务…";
  state.preparingMaterials = true;
  if ($("#materialStatus")) $("#materialStatus").textContent = "正在读取附件，请稍候…";
  const originalMaterials = state.materials.slice();
  const originalId = state.selectedId;
  const panel = $("#launchPanel");
  if (panel) panel.inert = true;
  try {
  const prepared = await window.ClownfishPendingMaterials.prepare(originalMaterials);
  if (state.selectedId !== originalId || $("#goalInput").value.trim() !== goal || $("#instructionInput").value.trim() !== details || state.materials.length !== originalMaterials.length || state.materials.some((file, index) => file !== originalMaterials[index])) throw Error("准备内容已改变，请检查后重新开始");
  if (prepared.reduce((sum, file) => sum + String(file.text || "").length, 0) > 24000) throw Error("附件正文超过 24000 字符，请减少附件或拆分任务");
  const hasHandoff = state.handoffSource === "capability" && Boolean(state.handoffSummary || state.handoffConversation.length || state.parentJobId);
  const materials = !hasHandoff && prepared.length
    ? `\n\n用户提供的材料：\n${prepared.map((item) => `--- ${item.name} ---\n${item.text}`).join("\n\n")}`
    : "";
  const handoff = hasHandoff ? {
    source: "capability",
    sourceConversationKey: "",
    sourceJobId: state.parentJobId,
    sourceCapabilityId: state.handoffSourceCapabilityId,
    goal,
    summary: state.handoffSummary,
    conversation: state.handoffConversation,
    materials: prepared,
    decisions: [], constraints: [], unresolved: [],
    chain: state.handoffChain,
  } : undefined;
    const response = await api("/api/agent/job", {
      method: "POST",
      body: JSON.stringify({
        kind: "capability-adhoc",
        surface: "capabilities",
        title: (goal || instruction).slice(0, 60),
        personaId: "clownfish",
        capabilityId: item.backendId,
        instruction: `${instruction}${materials}`,
        handoff,
        conversationKey: "",
        continuationTaskId: state.continuationTaskId,
        parentJobId: state.parentJobId,
        handoffChain: [...state.handoffChain, item.backendId].slice(-12),
        format: $("#formatSelect").value,
        memoryMode: $("#memoryToggle").checked ? "preferences" : "off",
        idempotencyKey: `capability-center-${crypto.randomUUID()}`,
      }),
    });
    const job = response.job || null;
    state.activeConversationJobId = job?.id || "";
    state.activeConversationTaskId = state.continuationTaskId || "";
    resetDraft({ removeRecord: true });
    await refreshData();
    openConversation(state.activeConversationTaskId, state.activeConversationJobId);
    showToast("任务已提交，可在流程与工具记录中继续查看");
  } catch (error) {
    showToast(error.message || "任务未能开始", true);
    if ($("#materialStatus")) $("#materialStatus").textContent = error.message || "任务未能开始，附件已保留";
  } finally {
    state.preparingMaterials = false;
    if (panel) panel.inert = false;
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
  const edit = `<a href="${editUrl}" data-artifact-edit="${editUrl}">${compact ? "去文件编辑" : "在文件中继续"}</a>`;
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

function artifactProofLabel(artifact) {
  return ({ produced: "已生成", validated: "已校验", verified: "已核验", approved: "已确认" })[artifact?.proof?.level] || "未检查";
}
function capabilityJobs() {
  return state.jobs.filter((job) => job.type === "capability-adhoc" && job.payload?.surface === "capabilities");
}

function taskIdForJob(job) {
  const persisted = (state.snapshot.tasks || []).find((task) => task.origin?.jobId === job?.id);
  return String(job?.result?.data?.artifact?.taskId || job?.payload?.continuationTaskId || persisted?.id || "");
}

function capabilityConversationTasks(archived) {
  const linked = new Set(capabilityJobs().map(taskIdForJob).filter(Boolean));
  return (state.snapshot.tasks || [])
    .filter((task) => task.oneOff && linked.has(task.id) && Boolean(task.archivedAt) === archived)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function renderConversationList() {
  const tasks = capabilityConversationTasks(false);
  const pending = capabilityJobs().filter((job) => !taskIdForJob(job) && ["queued", "running"].includes(job.status));
  const rows = [
    ...pending.map((job) => ({ id: "", jobId: job.id, title: jobTitle(job), updatedAt: job.updatedAt, capabilityId: job.payload.capabilityId })),
    ...tasks.map((task) => ({ id: task.id, jobId: "", title: task.title, updatedAt: task.updatedAt, capabilityId: task.capabilityId })),
  ];
  $("#capabilityConversationCount").textContent = rows.length;
  $("#capabilityConversationCount").hidden = rows.length === 0;
  $(".capability-conversations").hidden = rows.length === 0;
  $("#capabilityConversationList").innerHTML = rows.map((row) => {
    const item = capabilityForBackend(row.capabilityId);
    const current = row.id ? row.id === state.activeConversationTaskId : row.jobId === state.activeConversationJobId;
    return `<button type="button" class="capability-conversation-item${current ? " is-current" : ""}" data-open-capability-task="${escapeHtml(row.id)}" data-open-capability-job="${escapeHtml(row.jobId)}"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(item.name)} · ${displayDate(row.updatedAt)}</small></button>`;
  }).join("");
  $$('[data-open-capability-task]').forEach((button) => button.addEventListener("click", () => openConversation(button.dataset.openCapabilityTask, button.dataset.openCapabilityJob)));
}

function renderArchiveList() {
  const tasks = capabilityConversationTasks(true);
  const drafts = loadDrafts().filter((draft) => draftHasWork(draft) && draft.archivedAt);
  const rows = [
    ...tasks.map((task) => {
    const item = capabilityForBackend(task.capabilityId);
      return `<div class="capability-archive-row"><button type="button" data-open-archived-capability-task="${escapeHtml(task.id)}"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(item.name)} · ${displayDate(task.archivedAt)}</small></button><button type="button" class="capability-row-action danger" data-delete-capability-task="${escapeHtml(task.id)}" aria-label="删除${escapeHtml(task.title)}">删除</button></div>`;
    }),
    ...drafts.map((draft) => {
      const item = CATALOG().find((entry) => entry.id === draft.selectedId);
      return `<div class="capability-archive-row"><button type="button" data-open-archived-capability-draft="${escapeHtml(draft.id)}"><strong>${escapeHtml(draft.title || draftTitle(draft))}</strong><small>未完成 · ${escapeHtml(item?.name || "能力")} · ${displayDate(draft.archivedAt)}</small></button><button type="button" class="capability-row-action danger" data-delete-archived-capability-draft="${escapeHtml(draft.id)}" aria-label="删除${escapeHtml(draft.title || draftTitle(draft))}">删除</button></div>`;
    }),
  ];
  $("#capabilityArchiveCount").textContent = String(rows.length);
  $("#capabilityArchiveCount").hidden = rows.length === 0;
  $("#capabilityArchiveList").innerHTML = rows.length ? rows.join("") : '<div class="capability-archive-empty-state"><span data-app-icon="boxes" aria-hidden="true"><span></span></span><p>还没有归档</p></div>';
  if (!rows.length) renderStaticIcons();
  $$('[data-open-archived-capability-task]').forEach((button) => button.addEventListener("click", () => openConversation(button.dataset.openArchivedCapabilityTask)));
  $$('[data-open-archived-capability-draft]').forEach((button) => button.addEventListener("click", () => restoreArchivedDraft(button.dataset.openArchivedCapabilityDraft)));
  $$('[data-delete-capability-task]').forEach((button) => button.addEventListener("click", () => askDeleteCapabilityConversation(button.dataset.deleteCapabilityTask)));
  $$('[data-delete-archived-capability-draft]').forEach((button) => button.addEventListener("click", () => deleteArchivedDraft(button.dataset.deleteArchivedCapabilityDraft)));
  renderConversationList();
  renderActiveConversation();
}

function openConversation(taskId = "", jobId = "") {
  state.activeConversationTaskId = String(taskId || "");
  state.activeConversationJobId = String(jobId || "");
  $(".start-wrap").hidden = true;
  $("#capabilityThread").hidden = false;
  openView("start");
  renderConversationList();
  renderActiveConversation();
}

function newCapabilityConversation() {
  state.activeConversationTaskId = "";
  state.activeConversationJobId = "";
  state.continuationTaskId = "";
  $("#capabilityThread").hidden = true;
  $(".start-wrap").hidden = false;
  resetDraft({ removeRecord: false });
  openView("start");
  $("#goalInput").focus({ preventScroll: true });
  renderConversationList();
}

function conversationJobs(taskId, jobId) {
  return capabilityJobs().filter((job) => job.id === jobId || (taskId && taskIdForJob(job) === taskId))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function resultText(job, artifact) {
  return String(job?.result?.data?.reply || artifact?.summary || job?.result?.summary || job?.error || "").trim();
}

function renderActiveConversation() {
  if ($("#capabilityThread").hidden) return;
  if (!state.activeConversationTaskId && state.activeConversationJobId) {
    const current = state.jobs.find((job) => job.id === state.activeConversationJobId);
    const resolved = taskIdForJob(current);
    if (resolved) state.activeConversationTaskId = resolved;
  }
  const task = (state.snapshot.tasks || []).find((item) => item.id === state.activeConversationTaskId);
  const jobs = conversationJobs(state.activeConversationTaskId, state.activeConversationJobId);
  const firstJob = jobs[0];
  const item = capabilityForBackend(task?.capabilityId || firstJob?.payload?.capabilityId);
  $("#capabilityThreadTitle").textContent = task?.title || (firstJob ? jobTitle(firstJob) : "能力对话");
  $("#capabilityThreadAbility").textContent = item.name;
  const archived = Boolean(task?.archivedAt);
  $("#archiveCapabilityConversation").hidden = !task || archived;
  $("#restoreCapabilityConversation").hidden = !archived;
  $("#deleteCapabilityConversation").hidden = !archived;
  $("#capabilityThreadMessages").innerHTML = jobs.map((job) => {
    const artifact = artifactFromJob(job);
    const running = job.status === "queued" || job.status === "running";
    const assistant = running
      ? `<div class="capability-message assistant is-running"><span class="message-author">小丑鱼 · ${escapeHtml(STATUS_TEXT[job.status])}</span><p>${escapeHtml(latestCheckpoint(job)?.status || "正在处理你的要求…")}</p></div>`
      : `<div class="capability-message assistant"><span class="message-author">小丑鱼</span><div class="message-copy">${escapeHtml(resultText(job, artifact)).replace(/\n/g, "<br>") || "本轮没有生成可显示的文字。"}</div>${artifact ? `<div class="message-artifact">${artifactLinks(artifact)}</div>` : ""}</div>`;
    return `<div class="capability-message user"><span class="message-author">你</span><div class="message-copy">${escapeHtml(String(job.payload?.instruction || "")).replace(/\n/g, "<br>")}</div></div>${assistant}`;
  }).join("") || '<div class="capability-thread-empty">这条对话还没有内容。</div>';
  const running = jobs.some((job) => job.status === "queued" || job.status === "running");
  $("#capabilityThreadForm").hidden = archived;
  $("#capabilityThreadInput").disabled = running || !task || archived;
  $("#capabilityThreadForm").querySelector('button[type="submit"]').disabled = running || !task || archived;
  $("#capabilityThreadStatus").textContent = archived ? "这条对话已归档，恢复后可以继续。" : running ? "小丑鱼正在处理，完成后可以继续追问。" : "任务与成果保留在流程与工具记录中，直到你主动归档。";
  const messages = $("#capabilityThreadMessages");
  messages.scrollTop = messages.scrollHeight;
}

async function continueCapabilityConversation(instruction) {
  const task = (state.snapshot.tasks || []).find((item) => item.id === state.activeConversationTaskId);
  if (!task || task.archivedAt) return showToast("这条对话不可继续，请先恢复", true);
  const previous = conversationJobs(task.id, "").at(-1);
  const response = await api("/api/agent/job", {
    method: "POST",
    body: JSON.stringify({
      kind: "capability-adhoc",
      surface: "capabilities",
      title: task.title,
      personaId: "clownfish",
      capabilityId: task.capabilityId,
      instruction,
      continuationTaskId: task.id,
      format: task.format,
      memoryMode: previous?.payload?.memoryMode || "preferences",
      idempotencyKey: `capability-conversation-${crypto.randomUUID()}`,
    }),
  });
  state.activeConversationJobId = response.job?.id || "";
  $("#capabilityThreadInput").value = "";
  await refreshData();
}

async function archiveCapabilityConversation() {
  if (!state.activeConversationTaskId) return;
  try {
    await api("/api/capability-conversations/archive", { method: "POST", body: JSON.stringify({ taskId: state.activeConversationTaskId }) });
    await refreshData();
    newCapabilityConversation();
    showToast("对话已归档，可在归档中恢复");
  } catch (error) { showToast(error.message || "归档失败", true); }
}

async function restoreCapabilityConversation(taskId) {
  try {
    await api("/api/capability-conversations/restore", { method: "POST", body: JSON.stringify({ taskId }) });
    await refreshData();
    openConversation(taskId);
    showToast("对话已恢复到首页");
  } catch (error) { showToast(error.message || "恢复失败", true); }
}

let pendingJobDelete = null;
let pendingCapabilityTaskDelete = null;

function askDeleteCapabilityConversation(taskId) {
  const task = (state.snapshot.tasks || []).find((item) => item.id === taskId && item.archivedAt);
  if (!task) return;
  pendingCapabilityTaskDelete = task;
  $("#jobDeleteTitle").textContent = `删除「${task.title}」？`;
  $("#jobDeleteSummary").textContent = "删除后无法恢复。你可以只删除对话记录并保留产出文件，也可以一并删除。";
  $("#jobDeleteDialog").showModal();
}

function askDeleteJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  pendingJobDelete = job;
  const artifact = artifactFromJob(job);
  $("#jobDeleteTitle").textContent = `删除「${jobTitle(job)}」？`;
  $("#jobDeleteSummary").textContent = artifact
    ? "可以同时删除产出文件，或只删任务记录、把文件保留在本机目录。"
    : "这条任务没有产出文件，只会删除任务记录。";
  $("#jobDeleteDialog").showModal();
}

$("#jobDeleteDialog").addEventListener("close", async () => {
  const capabilityTask = pendingCapabilityTaskDelete;
  pendingCapabilityTaskDelete = null;
  const capabilityDecision = $("#jobDeleteDialog").returnValue;
  if (capabilityTask && (capabilityDecision === "all" || capabilityDecision === "keep")) {
    try {
      await api("/api/capability-conversations/delete", { method: "POST", body: JSON.stringify({ taskId: capabilityTask.id, deleteFiles: capabilityDecision === "all" }) });
      await refreshData();
      showToast(capabilityDecision === "all" ? "归档对话和产出文件已删除" : "归档对话已删除，产出文件仍保留在文件库");
    } catch (error) { showToast(error.message || "删除失败", true); }
    return;
  }
  const job = pendingJobDelete;
  pendingJobDelete = null;
  const decision = $("#jobDeleteDialog").returnValue;
  if (!job || (decision !== "all" && decision !== "keep")) return;
  try {
    await api("/api/agent/job/delete", { method: "POST", body: JSON.stringify({ id: job.id, deleteFiles: decision === "all" }) });
    state.jobs = state.jobs.filter((item) => item.id !== job.id);
    await refreshData();
    showToast(decision === "all" ? "任务和产出文件已删除" : "任务记录已删除，产出文件保留在本机");
  } catch (error) {
    showToast(error.message || "删除失败", true);
  }
});

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
    // 助理自报的没把握之处。显示条数而不是内容：状态行放不下，点开产物能看到全文；
    // 但"有几处需要你自己判断"必须在列表上就看得见，否则用户不会知道要去看。
    const openCount = artifact?.metadata?.openQuestions?.length || 0;
    const openNote = openCount ? ` · <strong>${openCount} 处待你确认</strong>` : "";
    return `<article class="task-row">
      <span class="task-row-icon" aria-hidden="true" style="--cap-color:${ICON_TONES[item.id] || "#8f2f59"}">${iconSvg(item.icon)}</span>
      <div><h2>${escapeHtml(jobTitle(job))}</h2><p class="status-line"><span class="status-dot ${job.status}"></span>${STATUS_TEXT[job.status]} · ${item.name}${installed}${openNote} · ${artifactProofLabel(artifact)} · ${displayDate(job.completedAt || job.updatedAt)}${job.error ? ` · ${escapeHtml(job.error)}` : ""}</p>${jobMemoryUsage(job)}</div>
      <div class="task-actions">${job.status === "succeeded" ? `<button type="button" data-handoff-job="${escapeHtml(job.id)}">交给其他能力</button>` : ""}${job.status === "uncertain" ? `<a href="/runs">去核对</a>` : ""}${open}</div>
    </article>`;
  }).join("");
  $('[data-handoff-job]').forEach((button) => button.addEventListener("click", () => handoffJob(button.dataset.handoffJob)));
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
    renderMaterials();
    saveDraft();
    openView("start");
    $("#goalInput").focus({ preventScroll: true });
    showToast("上一步结果已带入，请选择下一项能力");
  } catch (error) {
    showToast(error.message || "结果交接失败", true);
  }
}

function openView(view, updateUrl = true) {
  const archiveRequested = ["record", "runs", "history", "files"].includes(view);
  view = "start";
  state.view = view;
  $$("[data-view]").forEach((node) => node.classList.toggle("is-active", node.dataset.view === view));
  const viewTitle = $("#capabilityViewTitle");
  if (viewTitle) viewTitle.textContent = "能力";
  if (updateUrl || archiveRequested) history.replaceState(null, "", location.pathname);
  document.title = "工具与连接 · 小丑鱼";
  window.scrollTo({ top: 0, behavior: "auto" });
  if (archiveRequested) $("#capabilityArchiveSection")?.scrollIntoView({ block: "nearest" });
}

async function refreshData() {
  try {
    const [snapshot, registry, jobsResponse, appState, memory, llm, toolStatus] = await Promise.all([
      api("/api/capabilities"),
      api("/api/capabilities/registry"),
      api("/api/agent/jobs?limit=200&surface=capabilities"),
      api("/api/state"),
      api("/api/memory?who=me"),
      api("/api/llm"),
      api("/api/tool-settings"),
    ]);
    state.snapshot = snapshot || { abilities: [], artifacts: [] };
    state.registry = registry || { skills: [], tools: [], engines: [], providers: [], extensions: [], surfaces: [] };
    state.jobs = Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : [];
    state.personas = Array.isArray(appState.personas) ? appState.personas : [];
    state.memoryCount = Array.isArray(memory.facts) ? memory.facts.filter((fact) => fact.layer === "procedural" || fact.layer === "personal_semantic").length : 0;
    state.llm = llm || { live: false };
    state.toolSettings = toolStatus.settings || {};
    state.toolStatus = toolStatus || { hasZhipuKey: false };
    $("#memorySummary").textContent = state.memoryCount > 0 ? `可轻量参考 ${state.memoryCount} 条写作、排版或格式习惯` : "会轻量参考文笔、排版和格式偏好";
    renderCatalog();
    renderExecutionState();
    renderArchiveList();
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

function bindEvents() {
  $("#capabilityArchiveToggle").addEventListener("click", () => {
    const list = $("#capabilityArchiveList");
    const open = list.hidden;
    list.hidden = !open;
    $("#capabilityArchiveToggle").setAttribute("aria-expanded", String(open));
  });
  $$('[data-view-target]').forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.viewTarget === "start") newCapabilityConversation();
    else openView(button.dataset.viewTarget);
  }));
  $("#archiveCapabilityConversation").addEventListener("click", archiveCapabilityConversation);
  $("#restoreCapabilityConversation").addEventListener("click", () => restoreCapabilityConversation(state.activeConversationTaskId));
  $("#deleteCapabilityConversation").addEventListener("click", () => askDeleteCapabilityConversation(state.activeConversationTaskId));
  $("#capabilityThreadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const instruction = $("#capabilityThreadInput").value.trim();
    if (!instruction) return;
    try { await continueCapabilityConversation(instruction); }
    catch (error) { showToast(error.message || "发送失败", true); }
  });
  $("#goalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const goal = $("#goalInput").value.trim();
    if (!goal) return showToast("先写下想完成的事情", true);
    selectCapability(await recommendCapability(goal));
    openCapability(goal);
  });
  $("#closeLaunch").addEventListener("click", closeCapability);
  $("#goalInput").addEventListener("input", () => { updateLaunchState(); saveDraft(); });
  $("#instructionInput").addEventListener("input", () => { updateLaunchState(); saveDraft(); });
  $("#quickInput").addEventListener("input", () => { updateLaunchState(); saveDraft(); });
  $("#quickPaste").addEventListener("click", () => readQuickClipboard().catch((error) => showToast(error.message || "读取剪贴板失败", true)));
  $("#quickSpeechFile").addEventListener("change", () => {
    const file = $("#quickSpeechFile").files?.[0];
    $("#quickSpeechFileName").textContent = file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024 / 1024))} MB` : "支持常见音频和 MP4、WebM 视频";
    updateLaunchState();
  });
  $("#quickRecord").addEventListener("click", toggleQuickRecording);
  $("#quickCopy").addEventListener("click", () => copyQuickResult().catch((error) => showToast(error.message || "复制失败", true)));
  $("#quickDownload").addEventListener("click", downloadQuickResult);
  $("#formatSelect").addEventListener("change", saveDraft);
  $("#memoryToggle").addEventListener("change", saveDraft);
  $("#materialInput").addEventListener("change", async (event) => { await addMaterial([...event.target.files]); event.target.value = ""; });
  $("#startTask").addEventListener("click", startTask);
  $("#memoryHelp").addEventListener("click", () => $("#memoryDialog").showModal());
  window.addEventListener("hashchange", () => openView(location.hash.slice(1) || "start", false));
  document.addEventListener("click", (event) => {
    const archiveDraft = event.target.closest("[data-archive-capability-draft]");
    if (archiveDraft) {
      archiveDraftById(archiveDraft.dataset.archiveCapabilityDraft);
      return;
    }
    const draft = event.target.closest("[data-capability-draft]");
    if (draft) {
      restoreDraftById(draft.dataset.capabilityDraft);
      return;
    }
    const edit = event.target.closest("[data-artifact-edit]");
    if (!edit || event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    window.location.assign(edit.dataset.artifactEdit);
  });
}

async function init() {
  const requestedBot = new URLSearchParams(location.search).get("bot");
  renderStaticIcons();
  sessionStorage.removeItem(HANDOFF_KEY);
  migrateLegacyDraft();
  bindEvents();
  renderCatalog();
  renderMaterials();
  renderDraftList();
  openView(location.hash.slice(1) || "start", false);
  await refreshData();
  if (requestedBot) {
    const workflow = window.ClownfishWorkflowCatalog.resolve(requestedBot);
    if (workflow) {
      selectCapability(workflow.id); openCapability("", { focusInput: true });
      const token=new URLSearchParams(location.search).get("transfer");
      if(token&&window.ClownfishSkillHandoff){
        try{
          const payload=window.ClownfishSkillHandoff.take(sessionStorage,token,workflow.id,window.ClownfishWorkflowCatalog);
          if($("#instructionInput").value.trim() || state.materials.length)throw Error("准备页已有内容，未覆盖；请回到原任务核对");
          state.receivingMaterials=true;
          const panel=$("#launchPanel"); if(panel)panel.inert=true;
          updateLaunchState();
          const files=payload.fileCount ? await window.ClownfishSkillFiles.receive(token,payload.fileCount) : [];
          if($("#instructionInput").value.trim() || state.materials.length)throw Error("准备页已有内容，未覆盖；请回到原任务核对");
          state.materials=files.map(window.ClownfishPendingMaterials.pending);
          renderMaterials();
          $("#instructionInput").value=payload.instruction;$("#memoryToggle").checked=false;
          updateLaunchState();
          showToast("已带入任务与附件，未读取正文、未开始执行。请确认工具与模型设置。",false);
        }catch(error){showToast(error.message,true);if($("#materialStatus"))$("#materialStatus").textContent=error.message;}
        finally{state.receivingMaterials=false;const panel=$("#launchPanel");if(panel)panel.inert=false;updateLaunchState();}
        const url=new URL(location.href);url.searchParams.delete("transfer");history.replaceState(null,"",url.pathname+url.search+url.hash);
      }
    }
    else showToast("未找到这项执行技能，请返回技能库重新选择。", true);
  }
  state.pollTimer = window.setInterval(refreshData, 4000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshData();
  });
}

init();
