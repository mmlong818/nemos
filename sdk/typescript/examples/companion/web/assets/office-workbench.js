"use strict";

const STORAGE_KEY = "clownfish-office-workbench-v1";
const MAX_STORED_DOCUMENTS = 6;
const MAX_VERSIONS = 8;
const MAX_TRASH_DOCUMENTS = 30;
const JOB_POLL_INTERVAL = 1400;

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

function formatLabel(kind) {
  return ({ docx: "DOCX", pptx: "PPTX", xlsx: "XLSX", pdf: "PDF", txt: "TXT", md: "Markdown" })[kind] || "文稿";
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
    createdAt: String(item?.createdAt || now()),
    updatedAt: String(item?.updatedAt || now()),
    sourceStored: Boolean(item?.sourceStored),
    processing: safeProcessing(item?.processing),
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
    return { documents, trash, selectedId, saveTimer: 0 };
  } catch {
    return { documents: [], trash: [], selectedId: null, saveTimer: 0 };
  }
}

const state = loadState();
state.view = currentDocument()?.sourceSize ? "source" : "edit";
let toastTimer = 0;
let jobPollTimer = 0;
let selectedCapabilityId = "document-draft";
let pendingDeletion = null;

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
    setSaveState(message);
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
    setSaveState("已打开本机工作副本");
  } catch {
    setSaveState("无法保存当前选择");
  }
  renderRecentFiles();
}

function scheduleSave() {
  setSaveState("正在保存…", true);
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => persistState(), 420);
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
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
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
  root.innerHTML = state.documents.map((document) => `
    <button class="file-row${document.id === state.selectedId ? " is-current" : ""}" type="button" data-document-id="${escapeHtml(document.id)}">
      <span class="file-row-icon" aria-hidden="true">${iconSvg("file")}</span>
      <span class="file-row-copy"><strong>${escapeHtml(document.name)}</strong><small>${formatLabel(document.kind)} · ${displayDate(document.updatedAt)}</small></span>
    </button>`).join("");
  root.querySelectorAll("[data-document-id]").forEach((button) => button.addEventListener("click", () => {
    state.selectedId = button.dataset.documentId;
    state.view = currentDocument()?.sourceSize ? "source" : "edit";
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

function renderBlocks(current) {
  const root = window.document.querySelector("#blockList");
  const continuous = current.kind === "docx" || current.kind === "txt" || current.kind === "md";
  document.querySelector("#addBlock").hidden = continuous;
  document.querySelector("#editViewTab").textContent = current.kind === "docx" ? "编辑文字" : current.kind === "md" ? "编辑 Markdown" : current.kind === "txt" ? "编辑文本" : "编辑内容";
  if (continuous) {
    const label = current.kind === "docx" ? "文字工作副本" : current.kind === "md" ? "Markdown 工作副本" : "文本工作副本";
    const detail = current.kind === "docx" ? "在这里连续修改文字；原文件的排版、图片和页眉页脚不会被覆盖。" : "修改会自动保存在本机工作副本中。";
    root.innerHTML = `
      <header class="continuous-editor-heading"><div><strong>${label}</strong><span>${detail}</span></div><span>自动保存</span></header>
      <label class="sr-only" for="continuousEditor">${label}</label>
      <textarea class="continuous-editor" id="continuousEditor" data-continuous-editor maxlength="120000" spellcheck="true" placeholder="在这里输入内容…">${escapeHtml(continuousDocumentText(current))}</textarea>`;
    autoResizeContinuous(root.querySelector("#continuousEditor"));
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

function renderVersions(current) {
  const root = window.document.querySelector("#versionList");
  document.querySelector("#versionCount").textContent = `${current?.versions.length || 0} 个`;
  if (!current || !current.versions.length) {
    root.innerHTML = '<p class="version-empty">保存版本后，可以比较变化或恢复到之前的内容。</p>';
    return;
  }
  root.innerHTML = current.versions.map((version) => `
    <div class="version-row">
      <span class="version-row-copy"><strong>${escapeHtml(version.name)}</strong><small>${displayDate(version.createdAt)}</small></span>
      <button type="button" data-compare-version="${escapeHtml(version.id)}">比较</button>
      <button type="button" data-restore-version="${escapeHtml(version.id)}">恢复</button>
    </div>`).join("");
}

function setDocumentView(view) {
  const current = currentDocument();
  const hasResult = Boolean(current?.processing);
  if (!["source", "edit", "result"].includes(view)) view = current?.sourceSize ? "source" : "edit";
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
  document.querySelector("#documentMeta").textContent = `本机工作副本${size} · 原文件未改动`;
  document.querySelector("#sourceState").textContent = current.sourceStored ? "原文件保留在本机" : current.sourceSize ? "重新打开可恢复原始版式" : "空白文稿";
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

async function importFile(file) {
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
      createdAt,
      updatedAt: createdAt,
      sourceStored: false,
      blocks: textToBlocks(extraction.text, extraction.kind),
      versions: [],
    });
    try {
      importedDocument.sourceStored = await window.ClownfishOfficeSource.save(importedDocument.id, file);
    } catch {
      importedDocument.sourceStored = false;
    }
    const replaced = state.documents.filter((item) => item.name === importedDocument.name && item.kind === importedDocument.kind);
    state.documents = state.documents.filter((item) => !(item.name === importedDocument.name && item.kind === importedDocument.kind));
    replaced.forEach((item) => void window.ClownfishOfficeSource.remove(item.id).catch(() => {}));
    state.documents.unshift(importedDocument);
    state.selectedId = importedDocument.id;
    state.view = "source";
    persistState(extraction.truncated ? "已读取可处理的前半部分" : "文件已读取");
    render();
    showToast(extraction.truncated ? "文件较长，已保留原文件和可处理的前半部分" : importedDocument.sourceStored ? "文件已打开，原始版本保留在本机" : "文件已打开，工作副本不会覆盖原文件");
  } catch (error) {
    setSaveState("读取失败");
    showToast(error instanceof Error ? error.message : "文件读取失败", true);
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
        instruction: `${request}\n\n请基于下面的当前工作副本完成任务。保留事实、数字和明确约束；无法确认的内容标记为待核验。不要覆盖原文件。\n\n--- ${current.name}（${formatLabel(current.kind)} 工作副本）---\n${text}`,
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
  document.querySelector("#documentName").addEventListener("input", (event) => {
    const current = currentDocument();
    if (!current) return;
    current.name = event.target.value.slice(0, 120);
    scheduleSave();
  });
  document.querySelector("#blockList").addEventListener("input", (event) => {
    const current = currentDocument();
    if (current && event.target.matches("[data-continuous-editor]")) {
      current.blocks = [safeBlock({ id: current.blocks[0]?.id || uid("block"), title: current.kind === "md" ? "Markdown" : "正文", text: event.target.value }, 0, current.kind)];
      autoResizeContinuous(event.target);
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
  document.querySelector("#addBlock").addEventListener("click", addBlock);
  document.querySelector("#deleteDocument").addEventListener("click", deleteCurrentDocument);
  document.querySelector("#saveVersion").addEventListener("click", saveVersion);
  document.querySelector("#openAssistantPanel").addEventListener("click", () => openAssistantPanel("assistant"));
  document.querySelector("#openVersionPanel").addEventListener("click", () => openAssistantPanel("versions"));
  document.querySelector("#closeAssistantPanel").addEventListener("click", closeAssistantPanel);
  document.querySelector("#assistantPanelBackdrop").addEventListener("click", closeAssistantPanel);
  document.querySelector("#exportDraft").addEventListener("click", exportDraft);
  document.querySelector("#startOfficeTask").addEventListener("click", startOfficeTask);
  document.querySelector("#cancelOfficeTask").addEventListener("click", cancelOfficeTask);
  document.querySelectorAll("[data-document-view]").forEach((button) => button.addEventListener("click", () => setDocumentView(button.dataset.documentView)));
  document.querySelector("#versionList").addEventListener("click", (event) => {
    const compare = event.target.closest("[data-compare-version]");
    const restore = event.target.closest("[data-restore-version]");
    if (compare) compareVersion(compare.dataset.compareVersion);
    if (restore) restoreVersion(restore.dataset.restoreVersion);
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
void importArtifactFromQuery();
