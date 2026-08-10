"use strict";

const STORAGE_KEY = "clownfish-office-workbench-v1";
const MAX_STORED_DOCUMENTS = 80;
const MAX_VERSIONS = 8;
const MAX_TRASH_DOCUMENTS = 30;
const JOB_POLL_INTERVAL = 1400;
const AUTO_CHECKPOINT_INTERVAL = 5 * 60 * 1000;

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
  return ({ docx: "DOCX", pptx: "PPTX", xlsx: "XLSX", pdf: "PDF", txt: "TXT", md: "Markdown" })[kind] || "文稿";
}

const FALLBACK_CAPABILITY = {
  formatLabel: "文稿",
  capability: "view",
  capabilityLabel: "仅查看",
  summary: "这个格式目前只能查看。",
  textView: "extract",
  sourceWritable: false,
  copyOnly: false,
  limitations: [],
};

/** 能力说明由服务端的同一张表提供，界面不按扩展名自行判断"可编辑"。 */
function capabilityOf(kind) {
  return window.ClownfishOfficeCapabilities?.capabilities?.[kind] || FALLBACK_CAPABILITY;
}

function textViewLabel(kind) {
  if (capabilityOf(kind).textView === "edit") return kind === "md" ? "编辑 Markdown" : "编辑文本";
  return "提取文字";
}

function kindTitle(kind, index) {
  if (kind === "pptx" || kind === "pdf") return `第 ${index + 1} 页`;
  if (kind === "xlsx") return `工作表 ${index + 1}`;
  return `段落 ${index + 1}`;
}

function safeBlock(block, index, kind) {
  return {
    id: String(block?.id || uid("block")),
    title: String(block?.title || kindTitle(kind, index)).slice(0, 120),
    text: String(block?.text || "").slice(0, 120000),
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
    docxEdits: Array.isArray(item?.docxEdits) ? item.docxEdits.slice(0, 5000).map((edit) => ({
      docxIndex: Math.max(0, Number(edit?.docxIndex || 0)),
      text: String(edit?.text ?? "").slice(0, 120000),
    })).filter((edit) => Number.isInteger(edit.docxIndex)) : [],
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
let jobPollTimer = 0;
let selectedCapabilityId = "document-draft";
let pendingDeletion = null;
let activeDocumentQuote = null;
let libraryQuery = "";
let libraryFormat = "all";
const activeStructuredSection = new Map();
/** DOCX 的段落结构随时可以从会话重新取回，因此只放内存，不进本机状态。 */
const docxBlocksByDocument = new Map();
const docxBlocksRequested = new Set();

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

async function hydrateWorkbenchState() {
  try {
    const response = await api("/api/files/workbench");
    const remote = response.state;
    state.revision = Number(remote.revision || 0);
    if (Array.isArray(remote.documents) && (remote.documents.length || remote.trash?.length)) {
      state.documents = remote.documents.map(safeDocument);
      state.trash = Array.isArray(remote.trash) ? remote.trash.map((item) => ({ ...safeDocument(item), deletedAt: String(item?.deletedAt || item?.updatedAt || now()) })) : [];
      state.selectedId = state.documents.some((item) => item.id === remote.selectedId) ? remote.selectedId : state.documents[0]?.id || null;
      state.view = currentDocument()?.sourceSize ? "source" : "edit";
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
    const formatMatches = libraryFormat === "all" || document.kind === libraryFormat;
    return formatMatches && (!libraryQuery || document.name.toLocaleLowerCase("zh-CN").includes(libraryQuery));
  });
  if (!visible.length) {
    root.innerHTML = '<div class="empty-recent">没有符合条件的文件。</div>';
    return;
  }
  root.innerHTML = visible.map((document) => `
    <button class="file-row${document.id === state.selectedId ? " is-current" : ""}" type="button" data-document-id="${escapeHtml(document.id)}">
      <span class="file-row-icon" aria-hidden="true">${iconSvg("file")}</span>
      <span class="file-row-copy"><strong>${escapeHtml(document.name)}</strong><small>${formatLabel(document.kind)} · ${displayDate(document.updatedAt)}</small></span>
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

/** 段落结构由服务端的 DOCX 引擎给出，界面按 docxIndex 定位，不按位置猜。 */
async function loadDocxBlocks(current) {
  if (!current || current.kind !== "docx" || !current.desktopSessionId) return;
  try {
    const response = await api(`/api/files/session/docx-blocks?id=${encodeURIComponent(current.desktopSessionId)}`);
    docxBlocksByDocument.set(current.id, Array.isArray(response.blocks) ? response.blocks : []);
    if (currentDocument()?.id === current.id) render();
  } catch {
    docxBlocksByDocument.delete(current.id);
  }
}

function docxEditsOf(current) {
  const edits = new Map();
  for (const edit of current.docxEdits || []) edits.set(Number(edit.docxIndex), String(edit.text ?? ""));
  return edits;
}

function docxParagraphText(current, block) {
  const pending = docxEditsOf(current);
  return pending.has(block.docxIndex) ? pending.get(block.docxIndex) : block.text;
}

function renderDocxWorkspace(root, current, blocks) {
  const pending = docxEditsOf(current);
  const changed = blocks.filter((block) => pending.has(block.docxIndex) && pending.get(block.docxIndex) !== block.text).length;
  const editable = blocks.filter((block) => block.textEditable).length;
  root.innerHTML = `
    <header class="continuous-editor-heading">
      <div><strong>按段落修改</strong><span>只有你改过的段落会被写入；其余内容、表格和图片保持原样。</span></div>
      <span>${changed ? `${changed} 段待写入` : `${editable} 段可改`}</span>
    </header>
    <div class="docx-paragraph-list">
      ${blocks.map((block, index) => block.textEditable
        ? `<article class="docx-paragraph${pending.has(block.docxIndex) && pending.get(block.docxIndex) !== block.text ? " is-changed" : ""}">
             <span class="docx-paragraph-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
             <label class="sr-only" for="docx-para-${block.docxIndex}">第 ${index + 1} 段</label>
             <textarea class="docx-paragraph-text" id="docx-para-${block.docxIndex}" data-docx-index="${block.docxIndex}" maxlength="120000" spellcheck="true">${escapeHtml(docxParagraphText(current, block))}</textarea>
           </article>`
        : `<article class="docx-passthrough">
             <span class="docx-paragraph-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
             <p><strong>${escapeHtml(block.label || "其他内容")}</strong><span>原样保留，不在这里编辑</span></p>
           </article>`).join("")}
    </div>`;
  root.querySelectorAll(".docx-paragraph-text").forEach(autoResize);
}

function renderBlocks(current) {
  const root = window.document.querySelector("#blockList");
  const docxBlocks = current.kind === "docx" ? docxBlocksByDocument.get(current.id) : null;
  const continuous = (current.kind === "docx" && !docxBlocks?.length) || current.kind === "txt" || current.kind === "md";
  const importedStructured = Boolean(current.desktopSessionId && ["docx", "pptx", "xlsx"].includes(current.kind));
  document.querySelector("#addBlock").hidden = continuous || importedStructured;
  document.querySelector("#editViewTab").textContent = textViewLabel(current.kind);
  if (docxBlocks?.length) {
    renderDocxWorkspace(root, current, docxBlocks);
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
  return Boolean(current?.sourceSize && ["docx", "pptx", "xlsx", "pdf"].includes(current.kind));
}

function desktopEditLabel(kind) {
  return ({ docx: "用 Word 编辑", pptx: "用 PowerPoint 编辑", xlsx: "用 Excel 编辑", pdf: "用默认应用打开" })[kind] || "用桌面应用编辑";
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
  const reasonLabel = { imported: "导入原文件", "external-change": "桌面修改", "structured-edit": "页内文字替换（旧版本）", restored: "恢复的原文件" };
  const sourceRows = sourceVersions.map((version) => `
    <div class="version-row source-version-row">
      <span class="version-row-copy"><strong>${reasonLabel[version.reason] || "原文件版本"}</strong><small>${displayDate(version.createdAt)} · ${displayFileSize(version.byteLength)}</small></span>
      <button type="button" data-restore-source-version="${escapeHtml(version.id)}">恢复原文件</button>
    </div>`).join("");
  const eventLabel = { imported: "文件已加入工作区", "external-change": "检测到桌面修改", "structured-edit": "文字替换已写入（旧版本）", "structured-copy": "已生成文字副本", restored: "已恢复历史版本", missing: "工作副本已被删除或移走", renamed: "工作副本已重命名或移动" };
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
  document.querySelector("#formatBadge").textContent = formatLabel(current.kind);
  document.querySelector("#documentName").value = current.name;
  const size = current.sourceSize ? ` · ${Math.max(1, Math.round(current.sourceSize / 1024))} KB` : "";
  document.querySelector("#sourceState").textContent = current.sourceStored ? "原文件保留在本机" : current.sourceSize ? "重新打开可恢复原始版式" : "空白文稿";
  const desktopEditable = Boolean(current.desktopSessionId && ["docx", "pptx", "xlsx", "pdf"].includes(current.kind));
  document.querySelector("#openDesktopEditor").hidden = !desktopEditable;
  document.querySelector("#openDesktopEditor").textContent = desktopEditLabel(current.kind);
  document.querySelector("#refreshDesktopFile").hidden = !desktopEditable;
  const capability = capabilityOf(current.kind);
  const badge = document.querySelector("#capabilityBadge");
  badge.textContent = capability.capabilityLabel;
  badge.dataset.capability = capability.capability;
  badge.title = capability.summary;
  const note = document.querySelector("#capabilityNote");
  const noteText = [capability.summary, ...capability.limitations].join(" ");
  note.textContent = noteText;
  note.hidden = !noteText;
  document.querySelector("#writeBackSource").hidden = !current.sourceWritable || !capability.sourceWritable;
  document.querySelector("#editViewTab").hidden = current.kind === "pdf";
  document.querySelector("#saveStructuredCopy").hidden = !Boolean(current.desktopSessionId && capability.copyOnly);
  document.querySelector("#documentSurface").classList.toggle("is-markdown", current.kind === "md");
  document.querySelector("#documentSurface").classList.toggle("is-presentation", current.kind === "pptx");
  document.querySelector("#documentSurface").classList.toggle("is-spreadsheet", current.kind === "xlsx");
  document.querySelector("#documentMeta").textContent = usesDesktopOriginalFormat(current)
    ? `原格式文件${size} · ${capability.copyOnly ? "文字修改另存为副本，本文件不改动" : "只读"}`
    : `本机工作副本${size} · 原文件未改动`;
  if (current.kind === "docx" && current.desktopSessionId && !docxBlocksRequested.has(current.id)) {
    docxBlocksRequested.add(current.id);
    void loadDocxBlocks(current);
  }
  renderBlocks(current);
  renderVersions(current);
  if (current.processing && ["queued", "running", "succeeded"].includes(current.processing.status)) state.view = "result";
  setDocumentView(state.view);
  renderProcessingState(current);
  if (current.processing) void refreshOfficeJob(current.processing.jobId);
}

function createBlankDocument() {
  const createdAt = now();
  const createdDocument = safeDocument({
    id: uid("document"),
    name: "未命名文稿",
    kind: "docx",
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
  persistState("空白文稿已建立");
  render();
  document.querySelector("#documentName").focus();
  showToast("空白文稿已建立，内容会自动保存在本机");
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
  if (!/\.(docx|pptx|xlsx|pdf|txt|md|markdown)$/i.test(file.name)) return showToast("支持 Word、PowerPoint、Excel、PDF、TXT 和 Markdown 文件", true);
  if (file.size > 8 * 1024 * 1024) return showToast("文件不能超过 8 MB", true);
  setSaveState("正在读取文件…", true);
  try {
    const response = await api("/api/files/extract", {
      method: "POST",
      body: JSON.stringify({ name: file.name, dataBase64: await fileToBase64(file) }),
    });
    const extraction = response.extraction;
    const createdAt = now();
    const importedDocument = safeDocument({
      id: uid("document"),
      name: file.name.replace(/\.(docx|pptx|xlsx|pdf|txt|md|markdown)$/i, ""),
      kind: extraction.kind,
      sourceSize: file.size,
      sourceTruncated: Boolean(extraction.truncated),
      createdAt,
      updatedAt: createdAt,
      sourceStored: false,
      desktopSessionId: extraction && response.session?.id,
      desktopContentHash: response.session?.contentHash,
      fileRecordId: response.fileRecord?.id,
      blocks: textToBlocks(extraction.text, extraction.kind),
      versions: [{ id: uid("version"), name: "导入原稿", createdAt, blocks: textToBlocks(extraction.text, extraction.kind).map((block) => ({ ...block })) }],
      lastCheckpointAt: createdAt,
    });
    try {
      importedDocument.sourceStored = await window.ClownfishOfficeSource.save(importedDocument.id, file, handle);
      importedDocument.sourceWritable = Boolean(handle && await window.ClownfishOfficeSource.canWrite(importedDocument.id));
    } catch {
      importedDocument.sourceStored = false;
    }
    const replaced = state.documents.filter((item) => item.name === importedDocument.name && item.kind === importedDocument.kind);
    state.documents = state.documents.filter((item) => !(item.name === importedDocument.name && item.kind === importedDocument.kind));
    replaced.forEach((item) => void window.ClownfishOfficeSource.remove(item.id).catch(() => {}));
    state.documents.unshift(importedDocument);
    state.selectedId = importedDocument.id;
    state.view = "source";
    await loadSourceHistory(importedDocument);
    persistState(extraction.truncated ? "已读取可处理的前半部分" : "文件已读取");
    render();
    showToast(extraction.truncated ? "文件较长，已保留原文件和可处理的前半部分" : importedDocument.sourceStored ? "文件已打开，原始版本保留在本机" : "文件已打开，工作副本不会覆盖原文件");
  } catch (error) {
    setSaveState("读取失败");
    showToast(error instanceof Error ? error.message : "文件读取失败", true);
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
    current.blocks = textToBlocks(response.extraction.text, response.extraction.kind);
    current.sourceSize = response.session.byteLength;
    current.desktopContentHash = response.session.contentHash;
    current.sourceStored = await window.ClownfishOfficeSource.save(current.id, file);
    // 文件在外部变了，段落结构和未提交的段落修改都不再对得上。
    docxBlocksByDocument.delete(current.id);
    docxBlocksRequested.delete(current.id);
    current.docxEdits = [];
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

async function saveStructuredCopy() {
  const current = currentDocument();
  if (!current?.desktopSessionId || !capabilityOf(current.kind).copyOnly) return;
  if (docxBlocksByDocument.get(current.id)?.length) return saveDocxTextCopy(current);
  const button = document.querySelector("#saveStructuredCopy");
  button.disabled = true;
  setSaveState("正在生成副本…", true);
  try {
    const response = await api("/api/files/session/structured-copy", {
      method: "POST",
      body: JSON.stringify({
        id: current.desktopSessionId,
        expectedHash: current.desktopContentHash,
        blocks: current.blocks.map(({ title, text }) => ({ title, text })),
        cells: current.structuredCellChanges || [],
        complete: !current.sourceTruncated,
      }),
    });
    current.structuredCellChanges = [];
    await openCopiedSession(response.copy);
    setSaveState("副本已生成");
    const checks = response.validation?.checks?.length || 0;
    showToast(checks ? `已生成新文件，结构检查 ${checks} 项全部通过；打开的原文件没有改动` : "已生成新文件；打开的原文件没有改动");
  } catch (error) {
    setSaveState("未生成副本");
    showToast(error instanceof Error ? error.message : "无法生成副本", true);
  } finally {
    button.disabled = false;
  }
}

/** 保真路径：只把改过的段落按 docxIndex 送出，未改动的内容保持原字节。 */
async function saveDocxTextCopy(current) {
  const blocks = docxBlocksByDocument.get(current.id) || [];
  const pending = docxEditsOf(current);
  const edits = blocks
    .filter((block) => block.textEditable && pending.has(block.docxIndex) && pending.get(block.docxIndex) !== block.text)
    .map((block) => ({ docxIndex: block.docxIndex, text: pending.get(block.docxIndex) }));
  if (!edits.length) return showToast("还没有改动任何段落", true);
  const button = document.querySelector("#saveStructuredCopy");
  button.disabled = true;
  setSaveState("正在生成副本…", true);
  try {
    const response = await api("/api/files/session/docx-copy", {
      method: "POST",
      body: JSON.stringify({ id: current.desktopSessionId, expectedHash: current.desktopContentHash, edits }),
    });
    current.docxEdits = [];
    await openCopiedSession(response.copy);
    setSaveState("副本已生成");
    const skipped = Array.isArray(response.skipped) ? response.skipped.length : 0;
    const changed = Array.isArray(response.changed) ? response.changed.length : edits.length;
    showToast(`已写入 ${changed} 段并生成新文件${skipped ? `，${skipped} 处内容未改动` : ""}；打开的原文件没有改动`, skipped > 0);
  } catch (error) {
    setSaveState("未生成副本");
    showToast(error instanceof Error ? error.message : "无法生成副本", true);
  } finally {
    button.disabled = false;
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
  const blocks = textToBlocks(response.extraction.text, response.extraction.kind);
  const copiedDocument = safeDocument({
    id: uid("document"),
    name: response.session.name.replace(/\.[a-z0-9]+$/i, ""),
    kind: response.extraction.kind,
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
          "application/octet-stream": [".docx", ".pptx", ".xlsx"],
          "application/pdf": [".pdf"],
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
  if (!current || !["txt", "md"].includes(current.kind)) return;
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
  let fileHandle = null;
  if (typeof window.showSaveFilePicker === "function") {
    try {
      fileHandle = await window.showSaveFilePicker({ suggestedName: filename });
    } catch (error) {
      if (error?.name === "AbortError") {
        setSaveState("未导出");
        return;
      }
      setSaveState("导出失败");
      showToast(error instanceof Error ? error.message : "无法打开保存位置", true);
      return;
    }
  }
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
    if (fileHandle) {
      const download = await fetch(result.downloadUrl);
      if (!download.ok) throw new Error("文件保存失败（" + download.status + "）");
      const writable = await fileHandle.createWritable();
      await writable.write(await download.blob());
      await writable.close();
      setSaveState("文件已保存");
      showToast(warnings || "文件已保存", Boolean(warnings));
      return;
    }
    window.location.href = result.downloadUrl;
    setSaveState("下载已开始");
    showToast(warnings || "文件下载已开始", Boolean(warnings));
  } catch (error) {
    setSaveState("导出失败");
    showToast(error instanceof Error ? error.message : "导出失败", true);
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
  document.querySelector("#newDocument").addEventListener("click", createBlankDocument);
  document.querySelector("#newDocumentEmpty").addEventListener("click", createBlankDocument);
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
    if (current && event.target.matches("[data-docx-index]")) {
      const docxIndex = Number(event.target.dataset.docxIndex);
      if (!Number.isInteger(docxIndex)) return;
      const edits = (current.docxEdits || []).filter((edit) => Number(edit.docxIndex) !== docxIndex);
      edits.push({ docxIndex, text: event.target.value.slice(0, 120000) });
      current.docxEdits = edits.slice(-5000);
      autoResize(event.target);
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
  document.querySelector("#saveStructuredCopy").addEventListener("click", saveStructuredCopy);
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
