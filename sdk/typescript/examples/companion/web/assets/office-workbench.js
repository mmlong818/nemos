"use strict";

const STORAGE_KEY = "clownfish-office-workbench-v1";
const MAX_STORED_DOCUMENTS = 80;
const MAX_VERSIONS = 8;
const MAX_TRASH_DOCUMENTS = 30;
const JOB_POLL_INTERVAL = 1400;
const AUTO_CHECKPOINT_INTERVAL = 5 * 60 * 1000;
const CONVERTED_FILE_KINDS = [
  "doc", "docx", "docm", "odt", "rtf", "epub",
  "ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm", "odp",
  "xls", "xlsx", "xlsm", "xlsb", "ods", "csv", "pdf",
];
const CONVERTED_FILE_KIND_SET = new Set(CONVERTED_FILE_KINDS);
const SUPPORTED_FILE_PATTERN = /\.(doc|docx|docm|odt|rtf|epub|ppt|pps|pot|pptx|pptm|ppsx|ppsm|odp|xls|xlsx|xlsm|xlsb|ods|csv|pdf|txt|md|markdown)$/i;

const ICON_PATHS = {
  ...window.ClownfishIcons.paths,
};

function iconSvg(name) {
  return window.ClownfishIcons.render(name, { paths: ICON_PATHS });
}

function hydrateIcons() {
  document.querySelectorAll("[data-app-icon]").forEach((node) => {
    const holder = node.querySelector("span");
    if (holder) holder.innerHTML = iconSvg(node.dataset.appIcon);
  });
  document.querySelectorAll("[data-office-icon]").forEach((node) => {
    const icon = iconSvg(node.dataset.officeIcon);
    if (node.matches("button, label")) node.insertAdjacentHTML("afterbegin", icon);
    else node.innerHTML = icon;
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

function displayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function displayFileSize(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatLabel(kind) {
  return ({
    doc: "DOC", docx: "DOCX", docm: "DOCM", odt: "ODT", rtf: "RTF", epub: "EPUB",
    ppt: "PPT", pps: "PPS", pot: "POT", pptx: "PPTX", pptm: "PPTM", ppsx: "PPSX", ppsm: "PPSM", odp: "ODP",
    xls: "XLS", xlsx: "XLSX", xlsm: "XLSM", xlsb: "XLSB", ods: "ODS", csv: "CSV",
    pdf: "PDF", txt: "TXT", md: "Markdown",
  })[kind] || "文稿";
}

function sourceKind(document) {
  return document?.convertedFrom || document?.kind || "md";
}

function formatGroup(kind) {
  if (["doc", "docx", "docm", "odt", "rtf"].includes(kind)) return "word";
  if (["ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm", "odp"].includes(kind)) return "presentation";
  if (["xls", "xlsx", "xlsm", "xlsb", "ods", "csv"].includes(kind)) return "spreadsheet";
  if (kind === "epub") return "ebook";
  if (kind === "pdf") return "pdf";
  return "text";
}

const FALLBACK_CAPABILITY = {
  formatLabel: "文稿",
  capability: "view",
  capabilityLabel: "仅查看",
  summary: "这个格式目前只能查看。",
  textView: "extract",
  textViewLabel: "提取文字",
  savesTo: "none",
  sourceWritable: false,
  copyOnly: false,
  canSaveCopy: false,
  limitations: [],
};

/** 能力说明由服务端的同一张表提供，界面不按扩展名自行判断"可编辑"。 */
function capabilityOf(kind) {
  return window.ClownfishOfficeCapabilities?.capabilities?.[kind] || FALLBACK_CAPABILITY;
}

function textViewLabel(kind) {
  return capabilityOf(kind).textViewLabel || FALLBACK_CAPABILITY.textViewLabel;
}

function kindTitle(kind, index) {
  if (kind === "pptx" || kind === "pdf") return `第 ${index + 1} 页`;
  if (kind === "xlsx") return `工作表 ${index + 1}`;
  return `段落 ${index + 1}`;
}

const LEGACY_CAPABILITY_KINDS = new Set([
  "research-brief",
  "presentation-builder",
  "thinking-workbench",
  "product-design",
  "business-deal",
  "market-opportunity",
  "ability-builder",
]);

const LEGACY_FIELD_LABELS = {
  question: "研究问题",
  plan: "研究路径",
  audience: "受众",
  purpose: "目标",
  slides: "页面",
  problem: "问题",
  facts: "已知事实",
  assumptions: "假设",
  contradictions: "矛盾",
  options: "可选方案",
  experiments: "验证方法",
  nextActions: "下一步",
  conclusion: "结论",
  limitations: "限制",
  findings: "主要发现",
  sources: "来源",
  user: "用户",
  job: "用户任务",
  flow: "操作流程",
  screens: "关键界面",
  acceptanceChecks: "验收检查",
  stakeholders: "关键人",
  objections: "异议",
  boundaries: "边界",
  scenarios: "情景",
  thesis: "机会假设",
  invalidation: "失效条件",
  qualification: "资格判断",
  spec: "能力定义",
  testCases: "触发测试",
  id: "编号",
  title: "标题",
  url: "链接",
  publisher: "发布者",
  tier: "来源等级",
  score: "可信度",
  checkedAt: "核验时间",
  claims: "主张",
  anchors: "证据锚点",
  claim: "判断",
  evidenceIds: "来源编号",
  anchorIds: "锚点编号",
  confidence: "置信度",
  status: "状态",
  page: "页码",
  span: "位置",
  quote: "引文",
  quoteHash: "引文校验",
  text: "内容",
  risk: "风险",
};

function readableLegacyCapabilityText(value) {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return localizedLegacyHeadings(String(value || ""));
  try {
    const payload = JSON.parse(candidate);
    if (!payload || !LEGACY_CAPABILITY_KINDS.has(payload.kind) || typeof payload.title !== "string" || typeof payload.summary !== "string" || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) return localizedLegacyHeadings(String(value || ""));
    const lines = [`# ${payload.title}`, "", payload.summary, ""];
    Object.entries(payload.data).forEach(([key, item]) => {
      lines.push(`## ${LEGACY_FIELD_LABELS[key] || key}`, "", readableLegacyValue(item), "");
    });
    return lines.join("\n").trim();
  } catch {
    return localizedLegacyHeadings(String(value || ""));
  }
}

function localizedLegacyHeadings(value) {
  let text = String(value || "");
  Object.entries(LEGACY_FIELD_LABELS).forEach(([key, label]) => {
    text = text.replace(new RegExp(`^## ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "gmi"), `## ${label}`);
  });
  return text;
}

function readableLegacyValue(value) {
  if (value === null || value === undefined || value === "") return "（无）";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.length
    ? value.map((item) => item && typeof item === "object"
      ? `- ${Object.entries(item).map(([key, nested]) => `${LEGACY_FIELD_LABELS[key] || key}：${flatLegacyValue(nested)}`).join("；")}`
      : `- ${String(item)}`).join("\n")
    : "（无）";
  if (typeof value === "object") return Object.entries(value).map(([key, nested]) => `- **${LEGACY_FIELD_LABELS[key] || key}**：${flatLegacyValue(nested)}`).join("\n");
  return String(value);
}

function flatLegacyValue(value) {
  if (Array.isArray(value)) return value.map(flatLegacyValue).join("、");
  if (value && typeof value === "object") return Object.values(value).map(flatLegacyValue).join("；");
  return String(value ?? "");
}

function safeWordHtml(value) {
  if (!value) return "";
  const template = document.createElement("template");
  template.innerHTML = String(value).slice(0, 240000);
  const allowed = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "BLOCKQUOTE"]);
  [...template.content.querySelectorAll("*")].forEach((node) => {
    if (!allowed.has(node.tagName)) node.replaceWith(document.createTextNode(node.textContent || ""));
    else [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
  });
  return template.innerHTML;
}

function safeBlock(block, index, kind) {
  return {
    id: String(block?.id || uid("block")),
    title: String(block?.title || kindTitle(kind, index)).slice(0, 120),
    text: readableLegacyCapabilityText(String(block?.text || "")).slice(0, 120000),
    richHtml: safeWordHtml(block?.richHtml),
  };
}

function safeProcessing(value) {
  if (!value || typeof value !== "object" || !value.jobId) return null;
  return {
    jobId: String(value.jobId),
    request: String(value.request || "").slice(0, 2000),
    capabilityId: String(value.capabilityId || "document-draft").slice(0, 80),
    format: ["doc", "pptx", "html", "pdf"].includes(value.format) ? value.format : "doc",
    startedAt: String(value.startedAt || now()),
    status: ["queued", "running", "succeeded", "failed", "cancelled", "uncertain"].includes(value.status) ? value.status : "queued",
    artifactId: value.artifactId ? String(value.artifactId) : "",
    artifactFormat: value.artifactFormat ? String(value.artifactFormat) : "",
    summary: value.summary ? String(value.summary).slice(0, 2000) : "",
  };
}

function safeDocument(item) {
  const kind = ["docx", "pptx", "xlsx", "pdf", "txt", "md"].includes(item?.kind) ? item.kind : "docx";
  const blocks = Array.isArray(item?.blocks) && item.blocks.length
    ? item.blocks.slice(0, 300).map((block, index) => safeBlock(block, index, kind))
    : [safeBlock(null, 0, kind)];
  const versions = Array.isArray(item?.versions) ? item.versions.slice(0, MAX_VERSIONS).map((version) => ({
    id: String(version?.id || uid("version")),
    name: String(version?.name || "保存的版本").slice(0, 80),
    createdAt: String(version?.createdAt || now()),
    blocks: Array.isArray(version?.blocks) ? version.blocks.slice(0, 300).map((block, index) => safeBlock(block, index, kind)) : [],
  })) : [];
  return {
    id: String(item?.id || uid("document")),
    originArtifactId: String(item?.originArtifactId || "").slice(0, 180),
    // 由哪种格式转换而来（空表示不是转换来的）；以及这次转换丢了什么。
    convertedFrom: CONVERTED_FILE_KIND_SET.has(item?.convertedFrom) ? item.convertedFrom : "",
    conversionNotes: Array.isArray(item?.conversionNotes)
      ? item.conversionNotes.slice(0, 20).map((note) => String(note || "").slice(0, 300)).filter(Boolean)
      : [],
    name: String(item?.name || "未命名文稿").slice(0, 120),
    kind,
    sourceSize: Math.max(0, Number(item?.sourceSize || 0)),
    sourceTruncated: Boolean(item?.sourceTruncated),
    createdAt: String(item?.createdAt || now()),
    updatedAt: String(item?.updatedAt || now()),
    sourceStored: Boolean(item?.sourceStored),
    sourceWritable: Boolean(item?.sourceWritable),
    desktopSessionId: String(item?.desktopSessionId || "").slice(0, 80),
    desktopContentHash: String(item?.desktopContentHash || "").slice(0, 64),
    processing: safeProcessing(item?.processing),
    fileRecordId: String(item?.fileRecordId || "").slice(0, 80),
    caretPosition: Math.max(0, Number(item?.caretPosition || 0)),
    editorScrollTop: Math.max(0, Number(item?.editorScrollTop || 0)),
    structuredCellChanges: Array.isArray(item?.structuredCellChanges) ? item.structuredCellChanges.slice(0, 20000).map((cell) => ({
      sheetIndex: Math.max(0, Number(cell?.sheetIndex || 0)),
      address: String(cell?.address || "").toUpperCase().slice(0, 16),
      value: String(cell?.value || "").slice(0, 32000),
    })).filter((cell) => /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(cell.address)) : [],
    lastCheckpointAt: String(item?.lastCheckpointAt || ""),
    sourceVersions: Array.isArray(item?.sourceVersions) ? item.sourceVersions.slice(0, 40).map((version) => ({
      id: String(version?.id || "").slice(0, 80),
      createdAt: String(version?.createdAt || ""),
      reason: String(version?.reason || "external-change").slice(0, 30),
      byteLength: Math.max(0, Number(version?.byteLength || 0)),
    })).filter((version) => version.id) : [],
    sourceEvents: Array.isArray(item?.sourceEvents) ? item.sourceEvents.slice(-120).map((event) => ({
      id: String(event?.id || "").slice(0, 80),
      type: String(event?.type || "").slice(0, 30),
      createdAt: String(event?.createdAt || ""),
    })).filter((event) => event.id) : [],
    blocks,
    versions,
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const documents = Array.isArray(parsed?.documents) ? parsed.documents.map(safeDocument) : [];
    const trash = Array.isArray(parsed?.trash) ? parsed.trash.slice(0, MAX_TRASH_DOCUMENTS).map((item) => ({ ...safeDocument(item), deletedAt: String(item?.deletedAt || item?.updatedAt || now()) })) : [];
    const selectedId = documents.some((document) => document.id === parsed?.selectedId) ? parsed.selectedId : documents[0]?.id || null;
    return { documents, trash, selectedId, saveTimer: 0, revision: 0, saveQueue: Promise.resolve(), saveConflict: false };
  } catch {
    return { documents: [], trash: [], selectedId: null, saveTimer: 0, revision: 0, saveQueue: Promise.resolve(), saveConflict: false };
  }
}

const state = loadState();
state.view = currentDocument()?.sourceSize ? "source" : "edit";
let toastTimer = 0;
let operationTimer = 0;
let operationRetry = null;
let jobPollTimer = 0;
let selectedCapabilityId = "document-draft";
let pendingDeletion = null;
let activeDocumentQuote = null;
let libraryQuery = "";
let libraryFormat = "all";
const activeStructuredSection = new Map();

function setActiveDocumentQuote(text, location) {
  const value = String(text || "").trim().slice(0, 8000);
  activeDocumentQuote = value ? { documentId: currentDocument()?.id || "", text: value, location: String(location || "选中内容").slice(0, 120) } : null;
  const notice = document.querySelector("#selectionContext");
  if (!notice) return;
  if (activeDocumentQuote?.documentId !== currentDocument()?.id) activeDocumentQuote = null;
  notice.hidden = !activeDocumentQuote;
  notice.textContent = activeDocumentQuote ? `将重点处理${activeDocumentQuote.location}，同时保留整份文件作为背景。` : "";
}

function captureEditorSelection(editor) {
  if (!editor || editor.selectionStart === editor.selectionEnd) return;
  const start = editor.selectionStart || 0;
  const end = editor.selectionEnd || start;
  const startLine = editor.value.slice(0, start).split("\n").length;
  const endLine = editor.value.slice(0, end).split("\n").length;
  setActiveDocumentQuote(editor.value.slice(start, end), startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}–${endLine} 行`);
}

function captureSourceSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) return;
  const anchor = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
  const source = anchor?.closest?.("#sourcePreview");
  if (!source) return;
  const page = anchor.closest(".page-preview,.word-preview,.slide-preview,.sheet-preview");
  const pages = page ? [...source.querySelectorAll(".page-preview,.word-preview,.slide-preview,.sheet-preview")] : [];
  const position = page ? pages.indexOf(page) + 1 : 0;
  setActiveDocumentQuote(selection.toString(), position ? `预览第 ${position} 页/段` : "原文件选中内容");
}

function currentDocument() {
  return state.documents.find((document) => document.id === state.selectedId) || null;
}

function setSaveState(text, saving = false) {
  const node = document.querySelector("#saveState");
  node.textContent = text;
  node.classList.toggle("is-saving", saving);
}

function showOperation(message, stateName = "busy", retryAction = null) {
  window.clearTimeout(operationTimer);
  const banner = document.querySelector("#operationBanner");
  const retry = document.querySelector("#operationRetry");
  document.querySelector("#operationText").textContent = message;
  banner.dataset.state = stateName;
  banner.hidden = false;
  operationRetry = typeof retryAction === "function" ? retryAction : null;
  retry.hidden = !operationRetry;
  if (stateName === "success") operationTimer = window.setTimeout(() => { banner.hidden = true; }, 6500);
}

function persistState(message = "已保存到本机") {
  const selected = currentDocument();
  if (selected) selected.updatedAt = now();
  state.documents.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const removedDocuments = state.documents.slice(MAX_STORED_DOCUMENTS);
  state.documents = state.documents.slice(0, MAX_STORED_DOCUMENTS);
  removedDocuments.forEach((item) => void window.ClownfishOfficeSource.remove(item.id).catch(() => {}));
  try {
    writeStoredState();
    queueRemoteSave(message);
  } catch {
    setSaveState("本机空间不足");
    showToast("本机存储空间不足，请先导出草稿", true);
  }
  renderRecentFiles();
}

function writeStoredState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ documents: state.documents, trash: state.trash, selectedId: state.selectedId }));
}

function persistSelection() {
  try {
    writeStoredState();
    queueRemoteSave("已打开本机工作副本");
  } catch {
    setSaveState("无法保存当前选择");
  }
  renderRecentFiles();
}

function scheduleSave() {
  setSaveState("正在保存…", true);
  maybeCreateAutomaticCheckpoint();
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => persistState(), 420);
}

function queueRemoteSave(message) {
  const snapshot = {
    documents: structuredClone(state.documents),
    trash: structuredClone(state.trash),
    selectedId: state.selectedId,
  };
  state.saveQueue = state.saveQueue.catch(() => {}).then(async () => {
    if (state.saveConflict) return;
    try {
      const response = await api("/api/files/workbench", {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: state.revision, ...snapshot }),
      });
      state.revision = response.state.revision;
      setSaveState(message);
    } catch (error) {
      if (error.status === 409) {
        state.saveConflict = true;
        setSaveState("另一窗口有新修改");
        showToast("另一窗口已经修改了文件。当前内容仍保留在本机，请刷新页面核对后再继续。", true);
        return;
      }
      setSaveState("本机备份已保存");
    }
  });
}

function maybeCreateAutomaticCheckpoint() {
  const current = currentDocument();
  if (!current) return;
  const previous = new Date(current.lastCheckpointAt || current.createdAt).getTime();
  if (Date.now() - previous < AUTO_CHECKPOINT_INTERVAL) return;
  current.versions.unshift({
    id: uid("version"),
    name: "自动保存",
    createdAt: now(),
    blocks: current.blocks.map((block) => ({ ...block })),
  });
  current.versions = current.versions.slice(0, MAX_VERSIONS);
  current.lastCheckpointAt = now();
}

/** 允许用 ?view=source|edit|result 深链到某个视图（截图与外部跳转都用得上）。 */
function requestedView() {
  const value = new URLSearchParams(window.location.search).get("view");
  return ["source", "edit", "result"].includes(String(value)) ? String(value) : null;
}

async function hydrateWorkbenchState() {
  try {
    const response = await api("/api/files/workbench");
    const remote = response.state;
    state.revision = Number(remote.revision || 0);
    if (Array.isArray(remote.documents) && (remote.documents.length || remote.trash?.length)) {
      state.documents = remote.documents.map(safeDocument);
      state.trash = Array.isArray(remote.trash) ? remote.trash.map((item) => ({ ...safeDocument(item), deletedAt: String(item?.deletedAt || item?.updatedAt || now()) })) : [];
      state.selectedId = state.documents.some((item) => item.id === remote.selectedId) ? remote.selectedId : state.documents[0]?.id || null;
      state.view = requestedView() || (currentDocument()?.sourceSize ? "source" : "edit");
      writeStoredState();
      render();
      return;
    }
    if (state.documents.length || state.trash.length) queueRemoteSave("已保存到本机");
  } catch {
    setSaveState("使用本机备份");
  }
}

function showToast(message, error = false) {
  finalizePendingDeletion();
  const node = document.querySelector("#officeToast");
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.classList.remove("has-action");
  node.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("is-visible"), 3200);
}

function finalizePendingDeletion() {
  if (!pendingDeletion) return;
  window.clearTimeout(pendingDeletion.timer);
  pendingDeletion = null;
}

function showDeletionToast(documentName) {
  const node = document.querySelector("#officeToast");
  const label = document.createElement("span");
  const undo = document.createElement("button");
  label.textContent = `已移到垃圾桶：「${documentName}」`;
  undo.type = "button";
  undo.className = "toast-action";
  undo.textContent = "撤销";
  undo.addEventListener("click", undoDocumentDeletion);
  node.replaceChildren(label, undo);
  node.classList.remove("is-error");
  node.classList.add("has-action", "is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.classList.remove("is-visible", "has-action");
    finalizePendingDeletion();
  }, 10000);
}

function deleteCurrentDocument() {
  const current = currentDocument();
  if (!current) return;
  finalizePendingDeletion();
  const originalIndex = state.documents.findIndex((item) => item.id === current.id);
  state.documents.splice(originalIndex, 1);
  state.trash.unshift({ ...current, deletedAt: now() });
  const expired = state.trash.splice(MAX_TRASH_DOCUMENTS);
  expired.forEach((item) => void window.ClownfishOfficeSource.remove(item.id).catch(() => {}));
  state.selectedId = state.documents[Math.min(originalIndex, state.documents.length - 1)]?.id || null;
  state.view = currentDocument()?.sourceSize ? "source" : "edit";
  writeStoredState();
  render();
  pendingDeletion = { document: current, index: originalIndex, timer: 0 };
  showDeletionToast(current.name || "未命名文稿");
}

function undoDocumentDeletion() {
  if (!pendingDeletion) return;
  const { document: deleted, index } = pendingDeletion;
  window.clearTimeout(pendingDeletion.timer);
  pendingDeletion = null;
  state.trash = state.trash.filter((item) => item.id !== deleted.id);
  state.documents.splice(Math.min(index, state.documents.length), 0, deleted);
  state.selectedId = deleted.id;
  state.view = deleted.sourceSize ? "source" : "edit";
  writeStoredState();
  render();
  showToast("文件已恢复");
}

function restoreTrashDocument(id) {
  const index = state.trash.findIndex((item) => item.id === id);
  if (index < 0) return;
  finalizePendingDeletion();
  const [restored] = state.trash.splice(index, 1);
  const { deletedAt: _deletedAt, ...document } = restored;
  document.updatedAt = now();
  state.documents.unshift(document);
  state.selectedId = document.id;
  state.view = document.sourceSize ? "source" : "edit";
  persistState("文件已从垃圾桶恢复");
  render();
  showToast("文件已恢复");
}

function permanentlyDeleteTrashDocument(id) {
  const target = state.trash.find((item) => item.id === id);
  if (!target) return;
  if (!window.confirm(`永久删除「${target.name}」？此操作无法撤销。`)) return;
  if (pendingDeletion?.document.id === id) finalizePendingDeletion();
  state.trash = state.trash.filter((item) => item.id !== id);
  writeStoredState();
  renderTrashFiles();
  void window.ClownfishOfficeSource.remove(id).catch(() => {});
  showToast("文件已永久删除");
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `请求失败（${response.status}）`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function textToBlocks(text, kind) {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (kind === "docx" || kind === "txt" || kind === "md") {
    return [safeBlock({ id: "block-1", title: kind === "md" ? "Markdown" : "正文", text: normalized }, 0, kind)];
  }
  const sectionPattern = kind === "md" ? /^#{1,6}\s+(.+)$/gm : /^##\s+(.+)$/gm;
  const matches = [...normalized.matchAll(sectionPattern)];
  if (matches.length) {
    return matches.map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = matches[index + 1]?.index ?? normalized.length;
      return safeBlock({ id: `block-${index + 1}`, title: match[1].trim(), text: normalized.slice(start, end).trim() }, index, kind);
    });
  }
  const parts = normalized.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  return (parts.length ? parts : [""]).slice(0, 300).map((part, index) => safeBlock({
    id: `block-${index + 1}`,
    title: kindTitle(kind, index),
    text: part,
  }, index, kind));
}

function renderRecentFiles() {
  const root = document.querySelector("#recentFiles");
  if (!state.documents.length) {
    root.innerHTML = '<div class="empty-recent">打开过的文件会出现在这里，关闭页面后也能继续。</div>';
    return;
  }
  const visible = state.documents.filter((document) => {
    const formatMatches = libraryFormat === "all" || formatGroup(sourceKind(document)) === libraryFormat;
    return formatMatches && (!libraryQuery || document.name.toLocaleLowerCase("zh-CN").includes(libraryQuery));
  });
  if (!visible.length) {
    root.innerHTML = '<div class="empty-recent">没有符合条件的文件。</div>';
    return;
  }
  root.innerHTML = visible.map((document) => `
    <button class="file-row${document.id === state.selectedId ? " is-current" : ""}" type="button" data-document-id="${escapeHtml(document.id)}">
      <span class="file-row-icon" aria-hidden="true">${iconSvg("file")}</span>
      <span class="file-row-copy"><strong>${escapeHtml(document.name)}</strong><small>${formatLabel(sourceKind(document))} · ${displayDate(document.updatedAt)}</small></span>
    </button>`).join("");
  root.querySelectorAll("[data-document-id]").forEach((button) => button.addEventListener("click", () => {
    state.selectedId = button.dataset.documentId;
    state.view = currentDocument()?.sourceSize ? "source" : "edit";
    activeStructuredSection.delete(state.selectedId);
    persistSelection();
    render();
    closeFilePanel();
  }));
}

function renderTrashFiles() {
  const root = document.querySelector("#trashFiles");
  document.querySelector("#trashCount").textContent = String(state.trash.length);
  if (!state.trash.length) {
    root.innerHTML = '<div class="trash-empty">垃圾桶是空的</div>';
    return;
  }
  root.innerHTML = state.trash.map((document) => `
    <div class="trash-row">
      <span class="trash-row-copy"><strong>${escapeHtml(document.name)}</strong><small>${displayDate(document.deletedAt)}</small></span>
      <button type="button" data-restore-trash="${escapeHtml(document.id)}">恢复</button>
      <button type="button" data-delete-forever="${escapeHtml(document.id)}" aria-label="永久删除 ${escapeHtml(document.name)}">永久删除</button>
    </div>`).join("");
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(44, Math.min(520, textarea.scrollHeight))}px`;
}

function continuousDocumentText(current) {
  if (current.blocks.length === 1 && /^(正文|Markdown)$/.test(current.blocks[0].title)) return current.blocks[0].text;
  if (current.kind === "md") return current.blocks.map((block) => `${block.title ? `## ${block.title}\n\n` : ""}${block.text}`).join("\n\n").trim();
  return current.blocks.map((block) => block.text).join("\n\n").trim();
}

function autoResizeContinuous(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(720, textarea.scrollHeight + 4)}px`;
}

function markdownHeadings(text) {
  return String(text || "").split("\n").flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    return match ? [{ level: match[1].length, title: match[2].replace(/[*_`]/g, "").trim().slice(0, 100), line: index }] : [];
  }).slice(0, 80);
}

function updateMarkdownCompanions(editor) {
  const preview = document.querySelector("#markdownLivePreview");
  const outline = document.querySelector("#markdownOutline");
  if (!editor || !preview || !outline) return;
  preview.innerHTML = window.ClownfishOfficeSource.renderMarkdown(editor.value);
  const headings = markdownHeadings(editor.value);
  outline.innerHTML = headings.length
    ? headings.map((heading) => `<button type="button" style="--heading-level:${heading.level}" data-markdown-line="${heading.line}">${escapeHtml(heading.title)}</button>`).join("")
    : '<p>添加标题后会在这里生成目录。</p>';
}

function markdownSelectionAtLine(editor, lineNumber) {
  const lines = editor.value.split("\n");
  const position = lines.slice(0, lineNumber).reduce((total, line) => total + line.length + 1, 0);
  editor.focus();
  editor.setSelectionRange(position, position + (lines[lineNumber]?.length || 0));
  const ratio = position / Math.max(1, editor.value.length);
  editor.scrollTop = Math.max(0, (editor.scrollHeight - editor.clientHeight) * ratio - 80);
}

function applyMarkdownAction(editor, action) {
  const start = editor.selectionStart || 0;
  const end = editor.selectionEnd || start;
  const selected = editor.value.slice(start, end);
  const actions = {
    heading: { before: "## ", after: "", fallback: "标题" },
    bold: { before: "**", after: "**", fallback: "重点" },
    list: { before: "- ", after: "", fallback: "列表项" },
    quote: { before: "> ", after: "", fallback: "引用" },
    code: { before: "```\n", after: "\n```", fallback: "代码" },
    link: { before: "[", after: "](https://)", fallback: "链接文字" },
  };
  const pattern = actions[action];
  if (!pattern) return;
  const replacement = `${pattern.before}${selected || pattern.fallback}${pattern.after}`;
  editor.setRangeText(replacement, start, end, "end");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.focus();
}

function isWordWorkingCopy(current) {
  return ["doc", "docx", "docm", "odt", "rtf"].includes(String(current.convertedFrom || "").toLowerCase());
}

function wordParagraphs(text) {
  return String(text || "").split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph && !/^(\s*#\s*)+$/.test(paragraph));
}

function renderWordWorkspace(root, current) {
  const meaningful = current.blocks.filter((block) => !(/^#+$/.test(block.title.trim()) && !block.text.trim()));
  const sections = meaningful.length ? meaningful : [safeBlock({ title: "正文", text: "" }, 0, current.kind)];
  root.innerHTML = `<div class="word-workspace">
    <aside class="word-outline" aria-label="文档目录"><strong>目录</strong><nav>${sections.map((block, index) => `<button type="button" data-word-section="${escapeHtml(block.id)}">${escapeHtml(block.title || `第 ${index + 1} 节`)}</button>`).join("")}</nav></aside>
    <section class="word-editor-stage">
      <div class="word-format-toolbar" role="toolbar" aria-label="文字格式"><button type="button" data-word-command="bold"><strong>加粗</strong></button><button type="button" data-word-command="insertUnorderedList">列表</button><button type="button" data-word-command="formatBlock" data-command-value="blockquote">引用</button><span>修改会自动保存到工作副本</span></div>
      <article class="word-paper" aria-label="Word 可编辑副本">${sections.map((block, index) => {
        const level = index === 0 ? 1 : 2;
        const body = block.richHtml || wordParagraphs(block.text).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("") || "<p><br></p>";
        return `<section class="word-section" id="word-section-${escapeHtml(block.id)}" data-word-block="${escapeHtml(block.id)}"><h${level} contenteditable="true" spellcheck="true" data-word-field="title" data-placeholder="输入标题">${escapeHtml(block.title || "")}</h${level}><div class="word-section-body" contenteditable="true" spellcheck="true" data-word-field="text" data-placeholder="在这里输入正文">${body}</div></section>`;
      }).join("")}</article>
    </section>
  </div>`;
}

function renderBlocks(current) {
  const root = window.document.querySelector("#blockList");
  const continuous = current.kind === "docx" || current.kind === "txt" || current.kind === "md";
  const importedStructured = Boolean(current.desktopSessionId && ["docx", "pptx", "xlsx"].includes(current.kind));
  document.querySelector("#addBlock").hidden = continuous || importedStructured;
  document.querySelector("#editViewTab").textContent = current.convertedFrom || current.kind === "docx"
    ? "编辑工作副本"
    : current.kind === "md" || current.kind === "txt" ? "编辑内容" : textViewLabel(current.kind);
  if (isWordWorkingCopy(current)) {
    document.querySelector("#editViewTab").textContent = "编辑文档";
    renderWordWorkspace(root, current);
    return;
  }
  if (current.kind === "md") {
    root.innerHTML = `
      <div class="markdown-workspace">
        <aside class="markdown-outline-panel"><strong>目录</strong><nav id="markdownOutline" aria-label="Markdown 目录"></nav></aside>
        <section class="markdown-editor-panel">
          <div class="markdown-toolbar" role="toolbar" aria-label="Markdown 格式">
            <button type="button" data-markdown-action="heading">标题</button><button type="button" data-markdown-action="bold">加粗</button><button type="button" data-markdown-action="list">列表</button><button type="button" data-markdown-action="quote">引用</button><button type="button" data-markdown-action="code">代码</button><button type="button" data-markdown-action="link">链接</button>
          </div>
          <label class="sr-only" for="continuousEditor">Markdown 内容</label>
          <textarea class="continuous-editor markdown-editor" id="continuousEditor" data-continuous-editor maxlength="120000" spellcheck="true" placeholder="使用 Markdown 编写内容…">${escapeHtml(continuousDocumentText(current))}</textarea>
        </section>
        <section class="markdown-preview-panel" aria-label="Markdown 实时预览"><header><strong>预览</strong><span>随输入更新</span></header><div id="markdownLivePreview"></div></section>
      </div>`;
    const editor = root.querySelector("#continuousEditor");
    updateMarkdownCompanions(editor);
    window.requestAnimationFrame(() => {
      const position = Math.min(current.caretPosition, editor.value.length);
      editor.setSelectionRange(position, position);
      editor.scrollTop = current.editorScrollTop || 0;
    });
    return;
  }
  if (continuous) {
    const label = current.kind === "docx" ? "从 Word 提取的文字" : current.kind === "md" ? "Markdown 工作副本" : "文本工作副本";
    const detail = current.kind === "docx" && current.desktopSessionId
      ? "这里只是提取出来的文字，不是 Word 编辑器。点击“另存为文字副本”会生成一个新的 DOCX，打开的文件不会被改动。"
      : current.kind === "docx" ? "连续编辑正文，导出时生成新的 Word 文件。" : "修改会自动保存在本机工作副本中。";
    root.innerHTML = `
      <header class="continuous-editor-heading"><div><strong>${label}</strong><span>${detail}</span></div><span>自动保存</span></header>
      <label class="sr-only" for="continuousEditor">${label}</label>
      <textarea class="continuous-editor" id="continuousEditor" data-continuous-editor maxlength="120000" spellcheck="true" placeholder="在这里输入内容…">${escapeHtml(continuousDocumentText(current))}</textarea>`;
    const editor = root.querySelector("#continuousEditor");
    autoResizeContinuous(editor);
    window.requestAnimationFrame(() => {
      const position = Math.min(current.caretPosition, editor.value.length);
      editor.setSelectionRange(position, position);
      editor.scrollTop = current.editorScrollTop || 0;
    });
    return;
  }
  if (current.kind === "pptx") {
    renderPresentationWorkspace(root, current);
    return;
  }
  if (current.kind === "xlsx") {
    renderSpreadsheetWorkspace(root, current);
    return;
  }
  root.innerHTML = current.blocks.map((block, index) => `
    <article class="content-block" data-block-id="${escapeHtml(block.id)}">
      <span class="block-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      <label class="sr-only" for="block-title-${index}">内容块标题</label>
      <input class="block-title" id="block-title-${index}" data-field="title" maxlength="120" value="${escapeHtml(block.title)}">
      <label class="sr-only" for="block-text-${index}">内容</label>
      <textarea class="block-text" id="block-text-${index}" data-field="text" maxlength="120000" placeholder="在这里输入内容…">${escapeHtml(block.text)}</textarea>
    </article>`).join("");
  root.querySelectorAll(".block-text").forEach(autoResize);
}

function renderPresentationWorkspace(root, current) {
  const selected = Math.max(0, Math.min(current.blocks.length - 1, Number(activeStructuredSection.get(current.id) || 0)));
  const block = current.blocks[selected];
  root.innerHTML = `
    <div class="presentation-workspace">
      <aside class="slide-filmstrip" aria-label="幻灯片页面">
        <header><strong>${current.blocks.length} 页</strong><span>保留原版式</span></header>
        ${current.blocks.map((item, index) => `<button type="button" class="slide-thumb${index === selected ? " is-current" : ""}" data-structured-section="${index}"><span>${index + 1}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.text.split(/\n/)[0] || "空白页面")}</small></button>`).join("")}
      </aside>
      <article class="slide-editor content-block" data-block-id="${escapeHtml(block.id)}">
        <header><span>第 ${selected + 1} 页</span><strong>修改页面文字</strong><small>现有文本框、图片和页面布局会保留。</small></header>
        <label for="block-title-${selected}">页面名称</label>
        <input class="block-title" id="block-title-${selected}" data-field="title" maxlength="120" value="${escapeHtml(block.title)}">
        <label for="block-text-${selected}">页面文字（每行对应一个现有文本位置）</label>
        <textarea class="block-text slide-text-editor" id="block-text-${selected}" data-field="text" maxlength="120000" placeholder="输入页面文字…">${escapeHtml(block.text)}</textarea>
      </article>
    </div>`;
  root.querySelectorAll(".block-text").forEach(autoResize);
}

function spreadsheetCells(text) {
  const cells = new Map();
  for (const match of String(text || "").matchAll(/(?:^|\|)\s*([A-Z]{1,3}[1-9]\d{0,6})\s*:\s*([^|\n]*)/gim)) cells.set(match[1].toUpperCase(), String(match[2] || "").trim());
  return cells;
}

function spreadsheetColumn(index) {
  let value = index + 1;
  let label = "";
  while (value) { value -= 1; label = String.fromCharCode(65 + (value % 26)) + label; value = Math.floor(value / 26); }
  return label;
}

function spreadsheetAddressParts(address) {
  const match = String(address).match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let column = 0;
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) - 1 };
}

function spreadsheetText(cells) {
  const sorted = [...cells].sort(([left], [right]) => {
    const a = spreadsheetAddressParts(left); const b = spreadsheetAddressParts(right);
    return (a?.row || 0) - (b?.row || 0) || (a?.column || 0) - (b?.column || 0);
  });
  const rows = new Map();
  for (const [address, value] of sorted) {
    const row = spreadsheetAddressParts(address)?.row || 0;
    const values = rows.get(row) || [];
    values.push(`${address}: ${value}`);
    rows.set(row, values);
  }
  return [...rows.values()].map((items) => items.join(" | ")).join("\n");
}

function spreadsheetAnalysis(cells, rows, columns) {
  const values = [...cells.values()].filter((value) => value !== "");
  const numbers = values.map((value) => Number(String(value).replace(/,/g, ""))).filter(Number.isFinite);
  const duplicates = values.length - new Set(values).size;
  const sum = numbers.reduce((total, value) => total + value, 0);
  return {
    filled: values.length,
    blank: Math.max(0, rows * columns - values.length),
    formulas: values.filter((value) => value.startsWith("=")).length,
    duplicates,
    summary: numbers.length ? `数值 ${numbers.length} 个 · 合计 ${sum.toLocaleString("zh-CN")} · 平均 ${(sum / numbers.length).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "当前范围没有可汇总的数值",
  };
}

function renderSpreadsheetWorkspace(root, current) {
  const selected = Math.max(0, Math.min(current.blocks.length - 1, Number(activeStructuredSection.get(current.id) || 0)));
  const block = current.blocks[selected];
  const cells = spreadsheetCells(block.text);
  let maxRow = 0; let maxColumn = 0;
  for (const address of cells.keys()) { const position = spreadsheetAddressParts(address); maxRow = Math.max(maxRow, position?.row || 0); maxColumn = Math.max(maxColumn, position?.column || 0); }
  const rows = Math.min(100, Math.max(12, maxRow + 3));
  const columns = Math.min(30, Math.max(8, maxColumn + 3));
  const analysis = spreadsheetAnalysis(cells, rows, columns);
  const headings = Array.from({ length: columns }, (_, index) => `<th scope="col">${spreadsheetColumn(index)}</th>`).join("");
  const body = Array.from({ length: rows }, (_, row) => `<tr><th scope="row">${row + 1}</th>${Array.from({ length: columns }, (_, column) => {
    const address = `${spreadsheetColumn(column)}${row + 1}`;
    return `<td><input class="sheet-cell-input" aria-label="${address}" data-sheet-index="${selected}" data-cell-address="${address}" value="${escapeHtml(cells.get(address) || "")}"></td>`;
  }).join("")}</tr>`).join("");
  root.innerHTML = `
    <div class="spreadsheet-workspace">
      <nav class="sheet-tabs" aria-label="工作表">${current.blocks.map((item, index) => `<button type="button" class="${index === selected ? "is-current" : ""}" data-structured-section="${index}">${escapeHtml(item.title)}</button>`).join("")}</nav>
      <section class="sheet-analysis" aria-label="当前工作表概览"><div><strong data-sheet-stat="filled">${analysis.filled}</strong><span>有内容</span></div><div><strong data-sheet-stat="blank">${analysis.blank}</strong><span>空白格</span></div><div><strong data-sheet-stat="formulas">${analysis.formulas}</strong><span>公式</span></div><div><strong data-sheet-stat="duplicates">${analysis.duplicates}</strong><span>重复值</span></div><p data-sheet-summary>${analysis.summary}</p></section>
      <div class="spreadsheet-grid" tabindex="0"><table><thead><tr><th></th>${headings}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="sheet-note">输入 = 开头的内容会保存为公式。点击“另存为文字副本”生成新的 XLSX；只写入值和公式，不改动样式，打开的文件不会被改动。</p>
    </div>`;
}

function updateSpreadsheetAnalysis(current, sheetIndex) {
  const analysisRoot = document.querySelector(".sheet-analysis");
  const grid = document.querySelector(".spreadsheet-grid table");
  const block = current.blocks[sheetIndex];
  if (!analysisRoot || !grid || !block) return;
  const rows = Math.max(0, grid.rows.length - 1);
  const columns = Math.max(0, grid.rows[0]?.cells.length - 1);
  const analysis = spreadsheetAnalysis(spreadsheetCells(block.text), rows, columns);
  for (const key of ["filled", "blank", "formulas", "duplicates"]) {
    const node = analysisRoot.querySelector(`[data-sheet-stat="${key}"]`);
    if (node) node.textContent = String(analysis[key]);
  }
  const summary = analysisRoot.querySelector("[data-sheet-summary]");
  if (summary) summary.textContent = analysis.summary;
}

function usesDesktopOriginalFormat(current) {
  return Boolean(current?.desktopSessionId && sourceKind(current) !== "txt" && sourceKind(current) !== "md");
}

function structuredDocumentToBlocks(document, fallbackText, kind) {
  if (!document || document.schema !== "clownfish.document.v1" || !Array.isArray(document.blocks) || !document.blocks.length) {
    return textToBlocks(fallbackText, kind);
  }
  const blocks = [];
  let section = null;
  const flush = () => {
    if (!section) return;
    blocks.push(safeBlock(section, blocks.length, kind));
    section = null;
  };
  document.blocks.slice(0, 600).forEach((block) => {
    const blockKind = String(block?.kind || "paragraph");
    if (blockKind === "heading") {
      flush();
      section = { id: String(block.id || uid("block")), title: String(block.text || "未命名段落"), text: "" };
      return;
    }
    if (!section) section = { id: String(block?.id || uid("block")), title: blocks.length ? `段落 ${blocks.length + 1}` : "正文", text: "" };
    let text = String(block?.text || "");
    if (blockKind === "list") {
      const marker = block.ordered ? (_, index) => `${index + 1}. ` : () => "- ";
      text = text.split("\n").map((item, index) => `${marker(item, index)}${item}`).join("\n");
    } else if (blockKind === "quote") {
      text = text.split("\n").map((line) => `> ${line}`).join("\n");
    } else if (blockKind === "code") {
      text = `\`\`\`\n${text}\n\`\`\``;
    } else if (blockKind === "table" && Array.isArray(block.rows)) {
      text = block.rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
    }
    section.text = [section.text, text].filter(Boolean).join("\n\n");
  });
  flush();
  return blocks.length ? blocks : textToBlocks(fallbackText, kind);
}

function desktopEditLabel(kind) {
  if (["doc", "docx", "docm", "odt", "rtf"].includes(kind)) return "用文字应用打开";
  if (["ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm", "odp"].includes(kind)) return "用演示应用打开";
  if (["xls", "xlsx", "xlsm", "xlsb", "ods", "csv"].includes(kind)) return "用表格应用打开";
  return "用默认应用打开";
}

function renderVersions(current) {
  const root = window.document.querySelector("#versionList");
  const sourceVersions = current?.sourceVersions || [];
  const sourceEvents = current?.sourceEvents || [];
  document.querySelector("#versionCount").textContent = `${(current?.versions.length || 0) + sourceVersions.length} 个版本`;
  if (!current || (!current.versions.length && !sourceVersions.length && !sourceEvents.length)) {
    root.innerHTML = '<p class="version-empty">保存版本后，可以比较变化或恢复到之前的内容。</p>';
    return;
  }
  const workbenchRows = current.versions.map((version) => `
    <div class="version-row">
      <span class="version-row-copy"><strong>${escapeHtml(version.name)}</strong><small>${displayDate(version.createdAt)}</small></span>
      <button type="button" data-compare-version="${escapeHtml(version.id)}">比较</button>
      <button type="button" data-restore-version="${escapeHtml(version.id)}">恢复</button>
    </div>`).join("");
  const reasonLabel = { imported: "导入原文件", "external-change": "桌面修改", "structured-edit": "页内文字替换（旧版本）", "text-edit": "段落修改", restored: "恢复的原文件" };
  const sourceRows = sourceVersions.map((version) => `
    <div class="version-row source-version-row">
      <span class="version-row-copy"><strong>${reasonLabel[version.reason] || "原文件版本"}</strong><small>${displayDate(version.createdAt)} · ${displayFileSize(version.byteLength)}</small></span>
      <button type="button" data-restore-source-version="${escapeHtml(version.id)}">恢复原文件</button>
    </div>`).join("");
  const eventLabel = { imported: "文件已加入工作区", "external-change": "检测到桌面修改", "structured-edit": "文字替换已写入（旧版本）", "structured-copy": "已生成文字副本", "text-edit": "段落修改已写入", restored: "已恢复历史版本", missing: "工作副本已被删除或移走", renamed: "工作副本已重命名或移动" };
  const eventRows = sourceEvents.slice().reverse().slice(0, 12).map((event) => `<div class="version-event"><span>${escapeHtml(eventLabel[event.type] || "文件状态已变化")}</span><small>${displayDate(event.createdAt)}</small></div>`).join("");
  root.innerHTML = `${workbenchRows}${sourceRows}${eventRows ? `<div class="version-events"><strong>文件动态</strong>${eventRows}</div>` : ""}`;
}

async function loadSourceHistory(current = currentDocument()) {
  if (!current?.desktopSessionId) return;
  try {
    const [history, events] = await Promise.all([
      api(`/api/files/session/history?id=${encodeURIComponent(current.desktopSessionId)}`),
      api(`/api/files/session/events?id=${encodeURIComponent(current.desktopSessionId)}`),
    ]);
    current.sourceVersions = history.versions || [];
    current.sourceEvents = events.events || [];
    writeStoredState();
    renderVersions(current);
  } catch {
    // Draft history remains available when the source history cannot be read.
  }
}

async function restoreSourceVersion(versionId) {
  const current = currentDocument();
  if (!current?.desktopSessionId || !versionId) return;
  if (!window.confirm("恢复这个原文件版本？当前原文件会先保留在历史记录中。")) return;
  setSaveState("正在恢复原文件版本…", true);
  try {
    await api("/api/files/session/restore", {
      method: "POST",
      body: JSON.stringify({ id: current.desktopSessionId, versionId, expectedHash: current.desktopContentHash }),
    });
    await refreshDesktopFile();
    await loadSourceHistory(current);
  } catch (error) {
    setSaveState("未恢复");
    showToast(error instanceof Error ? error.message : "原文件版本恢复失败", true);
  }
}

function setDocumentView(view) {
  const current = currentDocument();
  const hasResult = Boolean(current?.processing);
  if (!["source", "edit", "result"].includes(view)) view = current?.sourceSize ? "source" : "edit";
  if (view === "edit" && current?.kind === "pdf") view = "source";
  if (view === "result" && !hasResult) view = current?.sourceSize ? "source" : "edit";
  state.view = view;
  document.querySelectorAll("[data-document-view]").forEach((button) => {
    const selected = button.dataset.documentView === view;
    button.classList.toggle("is-current", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  document.querySelector("#sourcePreview").hidden = view !== "source";
  document.querySelector("#documentSurface").hidden = view !== "edit";
  document.querySelector("#processingResult").hidden = view !== "result";
  if (view === "source" && current) window.ClownfishOfficeSource.render(document.querySelector("#sourcePreview"), current);
}

function processingArtifact(job, processing) {
  return job?.result?.data?.artifact || (processing?.artifactId ? {
    id: processing.artifactId,
    format: processing.artifactFormat,
    summary: processing.summary,
  } : null);
}

function latestJobCheckpoint(job) {
  return Array.isArray(job?.checkpoints) ? job.checkpoints[job.checkpoints.length - 1] || null : null;
}

function renderProcessingState(current, job = null) {
  const processing = current?.processing || null;
  const resultTab = document.querySelector("#resultViewTab");
  const run = document.querySelector("#assistantRun");
  const startButton = document.querySelector("#startOfficeTask");
  resultTab.hidden = !processing;
  run.hidden = !processing;
  if (!processing) {
    startButton.disabled = !current;
    startButton.textContent = "开始处理";
    if (state.view === "result") setDocumentView(current?.sourceSize ? "source" : "edit");
    return;
  }

  const status = job?.status || processing.status;
  const checkpoint = latestJobCheckpoint(job);
  const progress = Math.max(3, Math.min(100, Number(checkpoint?.progress ?? (status === "succeeded" ? 100 : status === "running" ? 18 : 3))));
  const statusText = {
    queued: "正在等待开始",
    running: checkpoint?.status || "小丑鱼正在处理",
    succeeded: "处理完成",
    failed: job?.error?.message || job?.error || "处理失败",
    cancelled: "处理已取消",
    uncertain: "结果待核对，请到运行页面确认是否已经执行",
  }[status] || "正在处理";
  const active = status === "queued" || status === "running";
  startButton.disabled = active || !current;
  startButton.textContent = active ? "正在处理…" : "再次处理";
  document.querySelector("#assistantRunTitle").textContent = active ? "正在处理当前文件" : status === "succeeded" ? "结果已经生成" : "本次处理未完成";
  document.querySelector("#assistantRunText").textContent = statusText;
  document.querySelector("#assistantRunProgress").style.width = `${progress}%`;
  document.querySelector("#cancelOfficeTask").hidden = !active;

  document.querySelector("#processingResultTitle").textContent = status === "succeeded" ? "处理完成" : statusText;
  document.querySelector("#processingResultText").textContent = active
    ? "你可以留在当前页面，完成后结果会自动出现。"
    : status === "succeeded" ? "结果已经保存在本机，可以继续查看或下载。" : "可以修改要求后再次处理。";
  document.querySelector("#processingResultProgress").style.width = `${progress}%`;
  const artifact = processingArtifact(job, processing);
  const frame = document.querySelector("#processingResultFrame");
  const empty = document.querySelector("#processingResultEmpty");
  const actions = document.querySelector("#processingResultActions");
  if (status === "succeeded" && artifact?.id) {
    const previewUrl = `/api/capabilities/artifact/preview?id=${encodeURIComponent(artifact.id)}`;
    if (!frame.src.endsWith(previewUrl)) frame.src = previewUrl;
    frame.hidden = false;
    empty.hidden = true;
    actions.hidden = false;
    document.querySelector("#openProcessingResult").href = previewUrl;
    document.querySelector("#downloadProcessingResult").href = `/api/capabilities/artifact?id=${encodeURIComponent(artifact.id)}&download=1`;
  } else {
    frame.hidden = true;
    frame.removeAttribute("src");
    empty.hidden = false;
    actions.hidden = true;
  }
}

function render() {
  renderRecentFiles();
  renderTrashFiles();
  const current = currentDocument();
  document.querySelector("#editorEmpty").hidden = Boolean(current);
  document.querySelector("#editorWorkspace").hidden = !current;
  document.querySelector("#startOfficeTask").disabled = !current;
  if (!current) {
    closeAssistantPanel();
    renderVersions(null);
    document.querySelector("#diffPanel").hidden = true;
    renderProcessingState(null);
    return;
  }
  const originalKind = sourceKind(current);
  document.querySelector("#formatBadge").textContent = formatLabel(originalKind);
  document.querySelector("#documentName").value = current.name;
  const size = current.sourceSize ? ` · ${Math.max(1, Math.round(current.sourceSize / 1024))} KB` : "";
  const hasWorkingContent = current.blocks.some((block) => block.text.trim());
  document.querySelector("#sourceState").textContent = current.sourceStored
    ? "原文件保留在本机"
    : current.sourceSize || current.convertedFrom || (["docx", "pptx", "xlsx", "pdf"].includes(current.kind) && hasWorkingContent)
      ? "原文件未绑定，可重新打开恢复"
      : "新建文件";
  const desktopEditable = usesDesktopOriginalFormat(current);
  document.querySelector("#openDesktopEditor").hidden = !desktopEditable;
  document.querySelector("#openDesktopEditor").textContent = desktopEditLabel(originalKind);
  document.querySelector("#refreshDesktopFile").hidden = !desktopEditable;
  // 转换过的文档：工作文档是 Markdown，但要按来源格式说明这次转换丢了什么。
  const sourceCapability = current.convertedFrom ? capabilityOf(current.convertedFrom) : null;
  const capability = capabilityOf(current.kind);
  const badge = document.querySelector("#capabilityBadge");
  badge.textContent = sourceCapability ? `${sourceCapability.formatLabel} → 可编辑副本` : capability.capabilityLabel;
  badge.dataset.capability = sourceCapability ? "convert" : capability.capability;
  badge.title = sourceCapability ? sourceCapability.summary : capability.summary;
  const note = document.querySelector("#capabilityNote");
  const conversionNotes = isWordWorkingCopy(current)
    ? (current.conversionNotes || []).map((item) => String(item).includes("Markdown") ? "复杂字体、字号、颜色和对齐未完全保留。" : item)
    : (current.conversionNotes || []);
  const noteText = sourceCapability
    ? ["已转换为可编辑副本，原文件保留、可下载，不会被改写。", ...conversionNotes].join(" ")
    : [capability.summary, ...capability.limitations].join(" ");
  note.textContent = noteText;
  note.hidden = !noteText;
  document.querySelector("#writeBackSource").hidden = !current.sourceWritable || !capability.sourceWritable;
  document.querySelector("#editViewTab").hidden = current.kind === "pdf";
  document.querySelector("#saveStructuredCopy").hidden = true;
  document.querySelector("#documentSurface").classList.toggle("is-markdown", current.kind === "md" && !isWordWorkingCopy(current));
  document.querySelector("#documentSurface").classList.toggle("is-presentation", current.kind === "pptx");
  document.querySelector("#documentSurface").classList.toggle("is-spreadsheet", current.kind === "xlsx");
  const savesToLabel = capability.savesTo === "original"
    ? "修改可写回原文件"
    : capability.savesTo === "copy" ? "文字修改另存为副本，本文件不改动" : "只读";
  document.querySelector("#documentMeta").textContent = usesDesktopOriginalFormat(current)
    ? `原格式文件${size} · ${savesToLabel}`
    : `本机工作副本${size} · 原文件未改动`;
  renderBlocks(current);
  renderVersions(current);
  if (current.processing && ["queued", "running", "succeeded"].includes(current.processing.status)) state.view = "result";
  setDocumentView(state.view);
  renderProcessingState(current);
  if (current.processing) void refreshOfficeJob(current.processing.jobId);
}

function createBlankDocument(kind = "docx") {
  if (!["docx", "md", "txt"].includes(kind)) kind = "docx";
  const createdAt = now();
  const defaultNames = { docx: "未命名 Word 文稿", md: "未命名 Markdown", txt: "未命名文本" };
  const createdDocument = safeDocument({
    id: uid("document"),
    name: defaultNames[kind],
    kind,
    sourceSize: 0,
    createdAt,
    updatedAt: createdAt,
    sourceStored: false,
    blocks: [{ id: uid("block"), title: "正文", text: "" }],
    versions: [],
  });
  state.documents.unshift(createdDocument);
  state.selectedId = createdDocument.id;
  state.view = "edit";
  document.querySelector("#newDocumentDialog").close();
  persistState(`${formatLabel(kind)} 文件已建立`);
  render();
  document.querySelector("#documentName").focus();
  showOperation(`${formatLabel(kind)} 文件已建立，内容会自动保存在本机`, "success");
}

function openNewDocumentDialog() {
  document.querySelector("#newDocumentDialog").showModal();
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function importFile(file, handle = null) {
  if (!file) return;
  if (!SUPPORTED_FILE_PATTERN.test(file.name)) {
    showOperation("无法打开：请选择常见文档、演示文稿、表格、PDF、EPUB、TXT 或 Markdown 文件", "error", () => document.querySelector("#officeFileInput").click());
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showOperation("无法打开：文件不能超过 8 MB", "error", () => document.querySelector("#officeFileInput").click());
    return;
  }
  setSaveState("正在读取文件…", true);
  showOperation(`正在读取并解析「${file.name}」…`, "busy");
  try {
    const response = await api("/api/files/extract", {
      method: "POST",
      body: JSON.stringify({ name: file.name, dataBase64: await fileToBase64(file) }),
    });
    const extraction = response.extraction;
    const conversion = response.conversion;
    // 统一以 Markdown 作为工作文档。原文件仍保留在会话与本机存储里，可下载、可预览，
    // 但不会被 Markdown 写回——那会把一个 .docx 写成 Markdown 文本。
    const converted = Boolean(conversion?.convertedFrom || (conversion && conversion.sourceFormat !== "md" && conversion.sourceFormat !== "txt"));
    const workingKind = conversion ? (conversion.sourceFormat === "txt" ? "txt" : "md") : extraction.kind;
    const workingText = conversion ? conversion.markdown : extraction.text;
    const workingBlocks = conversion?.document
      ? structuredDocumentToBlocks(conversion.document, workingText, workingKind)
      : textToBlocks(workingText, workingKind);
    const createdAt = now();
    const importedDocument = safeDocument({
      id: uid("document"),
      name: file.name.replace(SUPPORTED_FILE_PATTERN, ""),
      kind: workingKind,
      convertedFrom: converted ? conversion.sourceFormat : "",
      conversionNotes: Array.isArray(conversion?.notes) ? conversion.notes : [],
      sourceSize: file.size,
      sourceTruncated: Boolean(conversion?.truncated ?? extraction.truncated),
      createdAt,
      updatedAt: createdAt,
      sourceStored: false,
      desktopSessionId: extraction && response.session?.id,
      desktopContentHash: response.session?.contentHash,
      fileRecordId: response.fileRecord?.id,
      blocks: workingBlocks,
      versions: [{ id: uid("version"), name: "导入原稿", createdAt, blocks: workingBlocks.map((block) => ({ ...block })) }],
      lastCheckpointAt: createdAt,
    });
    try {
      importedDocument.sourceStored = await window.ClownfishOfficeSource.save(importedDocument.id, file, handle);
      // 转换过的文档不提供写回：Markdown 文本不能覆盖原来的二进制或排版文件。
      importedDocument.sourceWritable = !converted && Boolean(handle && await window.ClownfishOfficeSource.canWrite(importedDocument.id));
    } catch {
      importedDocument.sourceStored = false;
    }
    const replaced = state.documents.filter((item) => item.name === importedDocument.name && sourceKind(item) === sourceKind(importedDocument));
    state.documents = state.documents.filter((item) => !(item.name === importedDocument.name && sourceKind(item) === sourceKind(importedDocument)));
    replaced.forEach((item) => void window.ClownfishOfficeSource.remove(item.id).catch(() => {}));
    state.documents.unshift(importedDocument);
    state.selectedId = importedDocument.id;
    state.view = "source";
    await loadSourceHistory(importedDocument);
    persistState(importedDocument.sourceTruncated ? "已读取可处理的前半部分" : "文件已读取");
    render();
    showToast(converted
      ? `已转换为可编辑副本${importedDocument.conversionNotes.length ? `；${importedDocument.conversionNotes.length} 项内容有变化，见下方说明` : ""}。原文件保留，可随时下载`
      : importedDocument.sourceStored ? "文件已打开，原始版本保留在本机" : "文件已打开，工作副本不会覆盖原文件", converted && importedDocument.conversionNotes.length > 0);
    showOperation(converted
      ? `已打开「${file.name}」，并建立可编辑工作副本；原文件未改动`
      : `已打开「${file.name}」，可以继续编辑`, "success");
  } catch (error) {
    setSaveState("读取失败");
    const message = error instanceof Error ? error.message : "文件读取失败";
    showToast(message, true);
    showOperation(`打开失败：${message}`, "error", () => document.querySelector("#officeFileInput").click());
  }
}

async function openDesktopEditor() {
  const current = currentDocument();
  if (!current?.desktopSessionId) return;
  setSaveState("正在打开桌面编辑器…", true);
  try {
    await api("/api/files/session/open", { method: "POST", body: JSON.stringify({ id: current.desktopSessionId }) });
    setSaveState("桌面编辑器已打开");
    showToast("请在桌面应用中保存，完成后点击“载入修改”");
  } catch (error) {
    setSaveState("无法打开");
    showToast(error instanceof Error ? error.message : "无法打开桌面编辑器", true);
  }
}

async function refreshDesktopFile() {
  const current = currentDocument();
  if (!current?.desktopSessionId) return;
  setSaveState("正在检查桌面修改…", true);
  try {
    const response = await api("/api/files/session/refresh", {
      method: "POST",
      body: JSON.stringify({ id: current.desktopSessionId, expectedHash: current.desktopContentHash }),
    });
    if (!response.changed) {
      setSaveState("没有发现新修改");
      showToast("桌面文件没有变化");
      return;
    }
    const bytes = Uint8Array.from(atob(response.dataBase64), (character) => character.charCodeAt(0));
    const file = new File([bytes], response.session.name, { type: "application/octet-stream", lastModified: Date.now() });
    const converted = response.conversion && !["txt", "md"].includes(response.conversion.sourceFormat);
    current.kind = response.conversion?.sourceFormat === "txt" ? "txt" : "md";
    current.convertedFrom = converted ? response.conversion.sourceFormat : "";
    current.conversionNotes = Array.isArray(response.conversion?.notes) ? response.conversion.notes : [];
    current.blocks = response.conversion?.document
      ? structuredDocumentToBlocks(response.conversion.document, response.conversion.markdown, current.kind)
      : textToBlocks(response.conversion?.markdown || response.extraction.text, current.kind);
    current.sourceSize = response.session.byteLength;
    current.desktopContentHash = response.session.contentHash;
    current.sourceStored = await window.ClownfishOfficeSource.save(current.id, file);
    current.versions.unshift({
      id: uid("version"),
      name: "桌面修改",
      createdAt: now(),
      blocks: current.blocks.map((block) => ({ ...block })),
    });
    current.versions = current.versions.slice(0, MAX_VERSIONS);
    await loadSourceHistory(current);
    state.view = "source";
    persistState("桌面修改已载入");
    render();
    showToast(response.extraction.truncated ? "已载入修改；超长内容仅展示可处理部分" : "桌面修改已载入");
  } catch (error) {
    setSaveState("载入失败");
    showToast(error instanceof Error ? error.message : "无法载入桌面修改", true);
  }
}

/** 副本是另一个真实文件，按新文件打开，不覆盖当前文档的历史。 */
async function openCopiedSession(copy) {
  if (!copy?.id) return;
  const response = await api("/api/files/session/refresh", {
    method: "POST",
    body: JSON.stringify({ id: copy.id }),
  });
  const createdAt = now();
  const bytes = Uint8Array.from(atob(response.dataBase64), (character) => character.charCodeAt(0));
  const file = new File([bytes], response.session.name, { type: "application/octet-stream", lastModified: Date.now() });
  const converted = response.conversion && !["txt", "md"].includes(response.conversion.sourceFormat);
  const kind = response.conversion?.sourceFormat === "txt" ? "txt" : "md";
  const blocks = response.conversion?.document
    ? structuredDocumentToBlocks(response.conversion.document, response.conversion.markdown, kind)
    : textToBlocks(response.conversion?.markdown || response.extraction.text, kind);
  const copiedDocument = safeDocument({
    id: uid("document"),
    name: response.session.name.replace(/\.[a-z0-9]+$/i, ""),
    kind,
    convertedFrom: converted ? response.conversion.sourceFormat : "",
    conversionNotes: Array.isArray(response.conversion?.notes) ? response.conversion.notes : [],
    sourceSize: response.session.byteLength,
    sourceTruncated: Boolean(response.extraction.truncated),
    createdAt,
    updatedAt: createdAt,
    sourceStored: false,
    desktopSessionId: response.session.id,
    desktopContentHash: response.session.contentHash,
    blocks,
    versions: [{ id: uid("version"), name: "文字副本", createdAt, blocks: blocks.map((block) => ({ ...block })) }],
    lastCheckpointAt: createdAt,
  });
  try {
    copiedDocument.sourceStored = await window.ClownfishOfficeSource.save(copiedDocument.id, file);
  } catch {
    copiedDocument.sourceStored = false;
  }
  state.documents.unshift(copiedDocument);
  state.selectedId = copiedDocument.id;
  state.view = "source";
  await loadSourceHistory(copiedDocument);
  persistState("文字副本已生成");
  render();
}

async function openOfficeFile() {
  if (typeof window.showOpenFilePicker !== "function") {
    document.querySelector("#officeFileInput").click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "办公与文本文件",
        accept: {
          "application/octet-stream": [".doc", ".docx", ".docm", ".odt", ".rtf", ".epub", ".ppt", ".pps", ".pot", ".pptx", ".pptm", ".ppsx", ".ppsm", ".odp", ".xls", ".xlsx", ".xlsm", ".xlsb", ".ods"],
          "application/pdf": [".pdf"],
          "text/csv": [".csv"],
          "text/plain": [".txt", ".md", ".markdown"],
        },
      }],
    });
    if (handle) await importFile(await handle.getFile(), handle);
  } catch (error) {
    if (error?.name !== "AbortError") showToast(error instanceof Error ? error.message : "无法打开文件", true);
  }
}

async function writeBackSource() {
  const current = currentDocument();
  if (!current || !capabilityOf(current.kind).sourceWritable) return;
  setSaveState("正在写回原文件…", true);
  try {
    await window.ClownfishOfficeSource.writeText(current.id, continuousDocumentText(current));
    current.sourceStored = true;
    persistState("原文件已更新");
    showToast("已安全写回原文件");
  } catch (error) {
    setSaveState("未写回");
    showToast(error instanceof Error ? error.message : "原文件写回失败", true);
  }
}

function artifactKind(format) {
  if (format === "pptx") return "pptx";
  if (format === "xlsx") return "xlsx";
  if (format === "pdf") return "pdf";
  return "docx";
}

async function importArtifactFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const artifactId = String(params.get("artifact") || "").trim().slice(0, 180);
  if (!artifactId) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("artifact");
  try {
    const existing = state.documents.find((item) => item.originArtifactId === artifactId);
    if (existing) {
      state.selectedId = existing.id;
      state.view = "edit";
      persistSelection();
      render();
      showToast("已打开这个结果的本机工作副本");
      return;
    }
    setSaveState("正在打开任务结果…", true);
    const response = await api(`/api/capabilities/artifact/context?id=${encodeURIComponent(artifactId)}`);
    const artifact = response.artifact || {};
    const kind = artifactKind(String(artifact.format || ""));
    const createdAt = now();
    const imported = safeDocument({
      id: uid("document"),
      originArtifactId: artifactId,
      name: String(artifact.title || "任务结果").slice(0, 120),
      kind,
      sourceSize: 0,
      createdAt,
      updatedAt: createdAt,
      sourceStored: false,
      blocks: textToBlocks(String(response.text || artifact.summary || ""), kind),
      versions: [],
    });
    state.documents.unshift(imported);
    state.selectedId = imported.id;
    state.view = "edit";
    persistState("任务结果已保存为工作副本");
    render();
    showToast("任务结果已打开，可以继续编辑和生成新版本");
  } catch (error) {
    setSaveState("任务结果打开失败");
    showToast(error instanceof Error ? error.message : "任务结果打开失败", true);
  } finally {
    window.history.replaceState(null, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  }
}

function addBlock() {
  const current = currentDocument();
  if (!current) return;
  current.blocks.push(safeBlock({ id: uid("block"), title: kindTitle(current.kind, current.blocks.length), text: "" }, current.blocks.length, current.kind));
  scheduleSave();
  renderBlocks(current);
  const textareas = document.querySelectorAll(".block-text");
  textareas[textareas.length - 1]?.focus();
}

function saveVersion() {
  const current = currentDocument();
  if (!current) return;
  const createdAt = now();
  current.versions.unshift({
    id: uid("version"),
    name: `版本 ${current.versions.length + 1}`,
    createdAt,
    blocks: current.blocks.map((block) => ({ ...block })),
  });
  current.versions = current.versions.slice(0, MAX_VERSIONS);
  persistState("版本已保存");
  renderVersions(current);
  showToast("已保存一个可恢复的本机版本");
}

function compareVersion(versionId) {
  const current = currentDocument();
  const version = current?.versions.find((item) => item.id === versionId);
  if (!current || !version) return;
  const baseline = new Map(version.blocks.map((block) => [block.id, block]));
  const active = new Map(current.blocks.map((block) => [block.id, block]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [id, block] of active) {
    const previous = baseline.get(id);
    if (!previous) added += 1;
    else if (previous.title !== block.title || previous.text !== block.text) changed += 1;
  }
  for (const id of baseline.keys()) if (!active.has(id)) removed += 1;
  document.querySelector("#diffTitle").textContent = `与「${version.name}」比较`;
  document.querySelector("#diffSummary").innerHTML = `
    <div class="diff-stat">
      <span><strong>${added}</strong><small>新增</small></span>
      <span><strong>${changed}</strong><small>修改</small></span>
      <span><strong>${removed}</strong><small>移除</small></span>
    </div>`;
  document.querySelector("#diffPanel").hidden = false;
}

function restoreVersion(versionId) {
  const current = currentDocument();
  const version = current?.versions.find((item) => item.id === versionId);
  if (!current || !version) return;
  if (!window.confirm(`恢复到「${version.name}」？当前工作副本仍会自动保存，但未单独保存的版本不会保留。`)) return;
  current.blocks = version.blocks.map((block, index) => safeBlock({ ...block }, index, current.kind));
  persistState("版本已恢复");
  render();
  showToast("版本已恢复");
}

function documentMarkdown(current) {
  if (current.kind === "docx" || current.kind === "txt" || current.kind === "md") return continuousDocumentText(current);
  return current.blocks.map((block) => `## ${block.title}\n\n${block.text}`).join("\n\n").trim();
}

async function exportDraft() {
  const current = currentDocument();
  if (!current) return;
  const format = document.querySelector("#exportFormat").value;
  const filename = `${current.name || "办公文稿"}.${format}`;
  const exportButton = document.querySelector("#exportDraft");
  exportButton.disabled = true;
  showOperation(`正在生成「${filename}」…`, "busy");
  setSaveState("正在请求下载…", true);
  try {
    const response = await fetch("/api/files/export?prepare=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: current.name || "办公文稿",
        format,
        blocks: current.blocks.map(({ title, text }) => ({ title, text })),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.downloadUrl) throw new Error(result.error || "导出失败");
    const warnings = Array.isArray(result.warnings) ? result.warnings.join("\n") : "";
    const link = document.createElement("a");
    link.href = result.downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setSaveState("下载已开始");
    showToast(warnings || "文件下载已开始", Boolean(warnings));
    showOperation(warnings ? `已开始下载「${filename}」；有转换变化，请查看提示` : `「${filename}」已生成并开始下载`, "success");
  } catch (error) {
    setSaveState("导出失败");
    const message = error instanceof Error ? error.message : "导出失败";
    showToast(message, true);
    showOperation(`导出失败：${message}`, "error", exportDraft);
  } finally {
    exportButton.disabled = false;
  }
}

function capabilityForRequest(request, format) {
  if (format === "pptx") return "presentation-builder";
  if (/(会议|纪要|行动项|负责人|截止时间)/i.test(request)) return "meeting-minutes";
  if (/(研究|调研|来源|核验|行业)/i.test(request)) return "research-brief";
  if (/(分析|比较|异常|结论|决策|风险)/i.test(request)) return "decision-brief";
  if (format === "html") return selectedCapabilityId === "decision-brief" ? "decision-brief" : "html-report";
  return "document-draft";
}

function scheduleOfficeJobPoll(jobId, delay = JOB_POLL_INTERVAL) {
  window.clearTimeout(jobPollTimer);
  jobPollTimer = window.setTimeout(() => void refreshOfficeJob(jobId), delay);
}

async function refreshOfficeJob(jobId) {
  const current = currentDocument();
  if (!current?.processing || current.processing.jobId !== jobId) return;
  try {
    const response = await api(`/api/agent/job?id=${encodeURIComponent(jobId)}`);
    const job = response.job;
    if (!job || currentDocument()?.processing?.jobId !== jobId) return;
    const previousStatus = current.processing.status;
    const artifact = processingArtifact(job, current.processing);
    current.processing.status = job.status;
    current.processing.summary = String(job.result?.summary || artifact?.summary || current.processing.summary || "").slice(0, 2000);
    if (artifact?.id) {
      current.processing.artifactId = artifact.id;
      current.processing.artifactFormat = artifact.format || "";
    }
    writeStoredState();
    renderProcessingState(current, job);
    if (job.status === "queued" || job.status === "running") {
      scheduleOfficeJobPoll(jobId);
      return;
    }
    window.clearTimeout(jobPollTimer);
    if (previousStatus !== job.status) {
      if (job.status === "succeeded") showToast("处理完成，结果已经显示在当前页面");
      else if (job.status === "failed") showToast(job.error?.message || job.error || "处理失败，可以修改要求后重试", true);
      else if (job.status === "cancelled") showToast("处理已取消");
      else if (job.status === "uncertain") showToast("结果无法自动确认，请到运行页面核对", true);
    }
  } catch {
    document.querySelector("#assistantRunText").textContent = "连接暂时中断，正在重试…";
    scheduleOfficeJobPoll(jobId, 2600);
  }
}

async function startOfficeTask() {
  const current = currentDocument();
  if (!current) return showToast("先打开一个文件", true);
  const request = document.querySelector("#assistantPrompt").value.trim();
  if (!request) return showToast("先写下希望小丑鱼怎么处理", true);
  if (current.processing && ["queued", "running"].includes(current.processing.status)) return showToast("当前文件正在处理中");
  const format = document.querySelector("#assistantFormat").value;
  const capabilityId = capabilityForRequest(request, format);
  const text = documentMarkdown(current);
  const quote = activeDocumentQuote?.documentId === current.id ? activeDocumentQuote : null;
  const button = document.querySelector("#startOfficeTask");
  button.disabled = true;
  button.textContent = "正在开始…";
  try {
    const response = await api("/api/agent/job", {
      method: "POST",
      body: JSON.stringify({
        kind: "capability-adhoc",
        title: request.slice(0, 60),
        personaId: "clownfish",
        capabilityId,
        instruction: request,
        handoff: {
          source: "office",
          goal: request,
          summary: quote ? `用户要求重点处理${quote.location}。选中原文：\n${quote.text}` : "用户从文件工作台发起处理，整份工作副本已随任务交接。",
          conversation: [],
          materials: [{ name: current.name, text, fileRecordId: current.fileRecordId || "" }],
          decisions: [],
          constraints: ["保留事实、数字和明确约束", "无法确认的内容标记为待核验", "不要覆盖原文件"],
          unresolved: [],
          chain: [],
        },
        format,
        memoryMode: "preferences",
        idempotencyKey: `office-${current.id}-${crypto.randomUUID()}`,
      }),
    });
    const job = response.job;
    if (!job?.id) throw new Error("任务没有成功建立");
    current.processing = safeProcessing({
      jobId: job.id,
      request,
      capabilityId,
      format,
      startedAt: now(),
      status: job.status || "queued",
    });
    writeStoredState();
    state.view = "result";
    setDocumentView("result");
    renderProcessingState(current, job);
    scheduleOfficeJobPoll(job.id, 500);
    showToast("已经开始处理，结果会直接显示在这里");
  } catch (error) {
    button.disabled = false;
    button.textContent = "开始处理";
    showToast(error instanceof Error ? error.message : "任务未能开始", true);
  }
}

async function cancelOfficeTask() {
  const current = currentDocument();
  const jobId = current?.processing?.jobId;
  if (!jobId || !["queued", "running"].includes(current.processing.status)) return;
  try {
    await api("/api/agent/job/cancel", { method: "POST", body: JSON.stringify({ id: jobId }) });
    scheduleOfficeJobPoll(jobId, 100);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "无法取消处理", true);
  }
}

function closeFilePanel() {
  document.querySelector("#filePanel").classList.remove("is-open");
}

function openFilePanel() {
  document.querySelector("#filePanel").classList.add("is-open");
}

function openAssistantPanel(mode) {
  if (!currentDocument()) return showToast("先打开一个文件", true);
  const showingVersions = mode === "versions";
  const quoteNotice = document.querySelector("#selectionContext");
  if (quoteNotice) {
    if (activeDocumentQuote?.documentId !== currentDocument()?.id) activeDocumentQuote = null;
    quoteNotice.hidden = !activeDocumentQuote;
    quoteNotice.textContent = activeDocumentQuote ? `将重点处理${activeDocumentQuote.location}，同时保留整份文件作为背景。` : "";
  }
  document.querySelector("#assistantCard").hidden = showingVersions;
  document.querySelector("#versionCard").hidden = !showingVersions;
  document.querySelector("#assistantPanelTitle").textContent = showingVersions ? "版本记录" : "小丑鱼处理";
  document.querySelector("#assistantPanel").classList.add("is-open");
  document.querySelector("#assistantPanel").setAttribute("aria-hidden", "false");
  document.querySelector("#assistantPanel").removeAttribute("inert");
  document.querySelector("#assistantPanelBackdrop").classList.add("is-open");
  document.querySelector("#openAssistantPanel").setAttribute("aria-expanded", String(!showingVersions));
  document.querySelector("#openVersionPanel").setAttribute("aria-expanded", String(showingVersions));
  document.querySelector("#closeAssistantPanel").focus();
}

function closeAssistantPanel() {
  document.querySelector("#assistantPanel").classList.remove("is-open");
  document.querySelector("#assistantPanel").setAttribute("aria-hidden", "true");
  document.querySelector("#assistantPanel").setAttribute("inert", "");
  document.querySelector("#assistantPanelBackdrop").classList.remove("is-open");
  document.querySelector("#openAssistantPanel").setAttribute("aria-expanded", "false");
  document.querySelector("#openVersionPanel").setAttribute("aria-expanded", "false");
}

function bindEvents() {
  document.querySelector("#newDocument").addEventListener("click", openNewDocumentDialog);
  document.querySelector("#newDocumentEmpty").addEventListener("click", openNewDocumentDialog);
  document.querySelectorAll("[data-new-document-kind]").forEach((button) => button.addEventListener("click", () => createBlankDocument(button.dataset.newDocumentKind)));
  document.querySelector("#closeNewDocumentDialog").addEventListener("click", () => document.querySelector("#newDocumentDialog").close());
  document.querySelector("#operationRetry").addEventListener("click", () => operationRetry?.());
  document.querySelector("#officeFileInput").addEventListener("change", async (event) => {
    await importFile(event.target.files?.[0]);
    event.target.value = "";
  });
  document.querySelectorAll("[data-open-office-file]").forEach((button) => button.addEventListener("click", openOfficeFile));
  document.querySelector("#documentName").addEventListener("input", (event) => {
    const current = currentDocument();
    if (!current) return;
    current.name = event.target.value.slice(0, 120);
    scheduleSave();
  });
  document.querySelector("#blockList").addEventListener("input", (event) => {
    const current = currentDocument();
    const wordField = event.target.closest?.("[data-word-field]");
    const wordSection = wordField?.closest?.("[data-word-block]");
    if (current && wordField && wordSection) {
      const block = current.blocks.find((item) => item.id === wordSection.dataset.wordBlock);
      if (!block) return;
      const value = wordField.innerText.replace(/\n{3,}/g, "\n\n").trim();
      block[wordField.dataset.wordField] = value;
      if (wordField.dataset.wordField === "text") block.richHtml = safeWordHtml(wordField.innerHTML);
      current.updatedAt = new Date().toISOString();
      scheduleSave();
      return;
    }
    if (current && event.target.matches("[data-cell-address]")) {
      const sheetIndex = Number(event.target.dataset.sheetIndex || 0);
      const address = String(event.target.dataset.cellAddress || "").toUpperCase();
      const block = current.blocks[sheetIndex];
      if (!block || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address)) return;
      const cells = spreadsheetCells(block.text);
      const value = event.target.value.slice(0, 32000);
      if (value) cells.set(address, value); else cells.delete(address);
      block.text = spreadsheetText(cells);
      const changes = current.structuredCellChanges || [];
      const existing = changes.find((cell) => cell.sheetIndex === sheetIndex && cell.address === address);
      if (existing) existing.value = value; else changes.push({ sheetIndex, address, value });
      current.structuredCellChanges = changes.slice(-20000);
      updateSpreadsheetAnalysis(current, sheetIndex);
      scheduleSave();
      return;
    }
    if (current && event.target.matches("[data-continuous-editor]")) {
      current.blocks = [safeBlock({ id: current.blocks[0]?.id || uid("block"), title: current.kind === "md" ? "Markdown" : "正文", text: event.target.value }, 0, current.kind)];
      current.caretPosition = event.target.selectionStart || 0;
      current.editorScrollTop = event.target.scrollTop || 0;
      if (current.kind === "md") updateMarkdownCompanions(event.target);
      else autoResizeContinuous(event.target);
      scheduleSave();
      return;
    }
    const row = event.target.closest("[data-block-id]");
    const block = current?.blocks.find((item) => item.id === row?.dataset.blockId);
    if (!block || !event.target.dataset.field) return;
    block[event.target.dataset.field] = event.target.value;
    if (event.target.matches("textarea")) autoResize(event.target);
    scheduleSave();
  });
  document.querySelector("#blockList").addEventListener("scroll", (event) => {
    if (!event.target.matches?.("[data-continuous-editor]")) return;
    const current = currentDocument();
    if (current) current.editorScrollTop = event.target.scrollTop || 0;
  }, true);
  document.querySelector("#blockList").addEventListener("click", (event) => {
    const editor = document.querySelector("#continuousEditor");
    const action = event.target.closest("[data-markdown-action]");
    const heading = event.target.closest("[data-markdown-line]");
    const wordSectionLink = event.target.closest("[data-word-section]");
    const wordCommand = event.target.closest("[data-word-command]");
    if (wordSectionLink) document.querySelector(`#word-section-${CSS.escape(wordSectionLink.dataset.wordSection)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (wordCommand) document.execCommand(wordCommand.dataset.wordCommand, false, wordCommand.dataset.commandValue || null);
    if (editor && action) applyMarkdownAction(editor, action.dataset.markdownAction);
    if (editor && heading) markdownSelectionAtLine(editor, Number(heading.dataset.markdownLine || 0));
    const section = event.target.closest("[data-structured-section]");
    if (section) {
      const current = currentDocument();
      if (current) {
        activeStructuredSection.set(current.id, Number(section.dataset.structuredSection || 0));
        renderBlocks(current);
      }
    }
  });
  document.querySelector("#blockList").addEventListener("select", (event) => captureEditorSelection(event.target));
  document.querySelector("#blockList").addEventListener("keyup", (event) => {
    if (event.target.matches?.("textarea")) captureEditorSelection(event.target);
  });
  document.addEventListener("selectionchange", captureSourceSelection);
  document.querySelector("#addBlock").addEventListener("click", addBlock);
  document.querySelector("#deleteDocument").addEventListener("click", deleteCurrentDocument);
  document.querySelector("#saveVersion").addEventListener("click", saveVersion);
  document.querySelector("#openAssistantPanel").addEventListener("click", () => openAssistantPanel("assistant"));
  document.querySelector("#openVersionPanel").addEventListener("click", () => openAssistantPanel("versions"));
  document.querySelector("#closeAssistantPanel").addEventListener("click", closeAssistantPanel);
  document.querySelector("#assistantPanelBackdrop").addEventListener("click", closeAssistantPanel);
  document.querySelector("#exportDraft").addEventListener("click", exportDraft);
  document.querySelector("#writeBackSource").addEventListener("click", writeBackSource);
  document.querySelector("#openDesktopEditor").addEventListener("click", openDesktopEditor);
  document.querySelector("#refreshDesktopFile").addEventListener("click", refreshDesktopFile);
  document.querySelector("#startOfficeTask").addEventListener("click", startOfficeTask);
  document.querySelector("#cancelOfficeTask").addEventListener("click", cancelOfficeTask);
  document.querySelectorAll("[data-document-view]").forEach((button) => button.addEventListener("click", () => setDocumentView(button.dataset.documentView)));
  document.querySelector("#versionList").addEventListener("click", (event) => {
    const compare = event.target.closest("[data-compare-version]");
    const restore = event.target.closest("[data-restore-version]");
    const restoreSource = event.target.closest("[data-restore-source-version]");
    if (compare) compareVersion(compare.dataset.compareVersion);
    if (restore) restoreVersion(restore.dataset.restoreVersion);
    if (restoreSource) void restoreSourceVersion(restoreSource.dataset.restoreSourceVersion);
  });
  document.querySelector("#closeDiff").addEventListener("click", () => { document.querySelector("#diffPanel").hidden = true; });
  document.querySelector("#trashFiles").addEventListener("click", (event) => {
    const restore = event.target.closest("[data-restore-trash]");
    const remove = event.target.closest("[data-delete-forever]");
    if (restore) restoreTrashDocument(restore.dataset.restoreTrash);
    if (remove) permanentlyDeleteTrashDocument(remove.dataset.deleteForever);
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
    selectedCapabilityId = button.dataset.capability || "document-draft";
    document.querySelector("#assistantPrompt").value = button.dataset.prompt;
    document.querySelector("#assistantFormat").value = button.dataset.format || "doc";
    document.querySelectorAll("[data-prompt]").forEach((item) => item.classList.toggle("is-selected", item === button));
    document.querySelector("#assistantPrompt").focus();
  }));
  document.querySelector("#assistantFormat").addEventListener("change", (event) => {
    selectedCapabilityId = event.target.value === "pptx" ? "presentation-builder" : event.target.value === "html" ? "html-report" : "document-draft";
    document.querySelectorAll("[data-prompt]").forEach((item) => item.classList.remove("is-selected"));
  });
  document.querySelector("#toggleFiles").addEventListener("click", openFilePanel);
  document.querySelector("#closeFiles").addEventListener("click", closeFilePanel);
  document.querySelector("#filePanelBackdrop").addEventListener("click", closeFilePanel);
  document.querySelector("#fileLibrarySearch").addEventListener("input", (event) => {
    libraryQuery = event.target.value.trim().toLocaleLowerCase("zh-CN");
    renderRecentFiles();
  });
  document.querySelector("#fileLibraryFormat").addEventListener("change", (event) => {
    libraryFormat = event.target.value;
    renderRecentFiles();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFilePanel();
      closeAssistantPanel();
    }
  });
  window.addEventListener("resize", () => { if (window.innerWidth > 720) closeFilePanel(); });
  window.addEventListener("beforeunload", () => {
    window.clearTimeout(jobPollTimer);
    finalizePendingDeletion();
    window.ClownfishOfficeSource.release();
  });
}

hydrateIcons();
bindEvents();
render();
void hydrateWorkbenchState().then(() => importArtifactFromQuery());
