const state = { proposal: null, receipt: null, workspaceFiles: [], fileView: "changes", selected: new Set(), activePath: "", afterOnly: false };
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function proposalId() { return new URLSearchParams(location.search).get("id") || ""; }
function jobId() { return new URLSearchParams(location.search).get("job") || ""; }

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function stateLabel(value) {
  return ({ staging: "正在生成", pending: "等待你确认", applied: "已写入项目", rejected: "已放弃", conflicted: "项目已有新变化", failed: "生成失败", rolled_back: "已恢复" })[value] || value;
}

function fileByPath(path) { return state.proposal?.files.find((file) => file.path === path); }

function renderFiles() {
  const query = $("#fileSearch").value.trim().toLowerCase();
  const showingChanges = state.fileView === "changes";
  const files = (showingChanges ? state.proposal.files : state.workspaceFiles).filter((file) => file.path.toLowerCase().includes(query));
  $(".selection-tools").hidden = !showingChanges;
  $("#fileList").innerHTML = files.map((file) => showingChanges ? `<button class="file-row${file.path === state.activePath ? " is-active" : ""}" type="button" data-file="${escapeHtml(file.path)}">
    <input class="file-check" type="checkbox" aria-label="选择 ${escapeHtml(file.path)}" data-select-file="${escapeHtml(file.path)}" ${state.selected.has(file.path) ? "checked" : ""}>
    <span title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span><small>${file.operation === "create" ? "新增" : "修改"}</small>
  </button>` : `<button class="file-row is-workspace${file.path === state.activePath ? " is-active" : ""}" type="button" data-workspace-file="${escapeHtml(file.path)}" ${file.readable ? "" : "disabled"}><span class="file-kind">${file.readable ? "·" : "◇"}</span><span title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span><small>${formatBytes(file.byteLength)}</small></button>`).join("") || '<p class="decision-copy" style="padding:12px">没有匹配的文件</p>';
  document.querySelectorAll("[data-file]").forEach((button) => button.addEventListener("click", (event) => {
    if (event.target.matches("input")) return;
    state.activePath = button.dataset.file;
    renderFiles(); renderActiveFile();
  }));
  document.querySelectorAll("[data-select-file]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.selected.add(input.dataset.selectFile); else state.selected.delete(input.dataset.selectFile);
    renderSelection();
  }));
  document.querySelectorAll("[data-workspace-file]").forEach((button) => button.addEventListener("click", () => openWorkspaceFile(button.dataset.workspaceFile)));
  renderSelection();
}

async function openWorkspaceFile(path) {
  try {
    const scope = state.proposal ? `id=${encodeURIComponent(state.proposal.id)}` : `job=${encodeURIComponent(jobId())}`;
    const data = await api(`/api/development/workspace?${scope}&path=${encodeURIComponent(path)}`);
    state.activePath = path;
    renderFiles();
    $("#activeFile").textContent = path;
    $("#fileOperation").textContent = "项目文件 · 只读";
    $("#beforeContent").textContent = "";
    $("#afterContent").textContent = data.file.content;
    $("#compareView").classList.add("is-after-only");
    $("#toggleView").hidden = true;
  } catch (error) { $("#message").className = "message is-error"; $("#message").textContent = error.message; }
}

function renderSelection() {
  if (!state.proposal) return;
  const total = state.proposal.files.length;
  const count = state.selected.size;
  $("#selectionCount").textContent = `已选 ${count}/${total}`;
  $("#selectAll").checked = count === total && total > 0;
  $("#selectAll").indeterminate = count > 0 && count < total;
  $("#applyButton").disabled = count === 0;
  $("#applyButton").textContent = count ? `写入所选修改（${count}）` : "请先选择文件";
}

function renderActiveFile() {
  const file = fileByPath(state.activePath);
  if (!file) return;
  $("#activeFile").textContent = file.path;
  $("#fileOperation").textContent = file.operation === "create" ? "新增文件" : "修改文件";
  $("#beforeContent").textContent = file.operation === "create" ? "（新文件）" : file.before;
  $("#afterContent").textContent = file.after;
  $("#toggleView").hidden = false;
  $("#compareView").classList.toggle("is-after-only", state.afterOnly);
}

function renderEvidence(environment) {
  const checks = Array.isArray(state.receipt?.checks) ? state.receipt.checks : [];
  const passed = checks.filter((check) => check.passed).length;
  $("#checkSummary").textContent = checks.length ? `${passed}/${checks.length} 通过` : "未运行自动检查";
  $("#checkList").innerHTML = checks.length ? checks.map((check) => `<div class="check-item"><span class="check-mark ${check.passed ? "is-pass" : "is-fail"}">${check.passed ? "✓" : "×"}</span><span><strong>${escapeHtml(check.command)}</strong><small>${escapeHtml(String(check.output || "").split(/\r?\n/)[0])}</small></span></div>`).join("") : '<p class="decision-copy">本次没有可识别的测试或构建命令，结果仍需人工核对。</p>';
  const entries = Object.entries(environment || {});
  const available = entries.filter(([, value]) => value?.available).length;
  $("#environmentSummary").textContent = `${available}/${entries.length} 可用`;
  $("#environmentList").innerHTML = entries.map(([name, value]) => `<div class="environment-item"><span class="check-mark ${value.available ? "is-pass" : "is-fail"}">${value.available ? "✓" : "×"}</span><span><strong>${escapeHtml(({node:"Node.js",git:"Git",python:"Python"})[name] || name)}</strong><small>${escapeHtml(value.version || "未安装或不可用")}</small></span></div>`).join("");
  $("#isolationState").textContent = state.receipt?.isolatedWorkspace
    ? "在独立项目副本中执行，不占用原工作区"
    : "当前项目不适合创建隔离副本，仍通过修改提案保护原文件";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderState() {
  const proposal = state.proposal;
  const badge = $("#stateBadge");
  badge.textContent = stateLabel(proposal.state);
  badge.className = `status-pill is-${proposal.state}`;
  const pending = proposal.state === "pending" || proposal.state === "conflicted";
  $("#applyButton").hidden = !pending;
  $("#rejectButton").hidden = !pending;
  $("#rollbackButton").hidden = proposal.state !== "applied";
  $("#continueButton").hidden = false;
  $("#continueButton").href = `/capabilities?continueProposal=${encodeURIComponent(proposal.id)}`;
  if (proposal.state === "applied") $("#writeState").textContent = `${proposal.appliedPaths?.length || proposal.files.length} 个文件已写入，可恢复`;
  else if (proposal.state === "rolled_back") $("#writeState").textContent = "项目已经恢复到写入前";
  else if (proposal.state === "rejected") $("#writeState").textContent = "这份修改已放弃，项目未改变";
  else if (proposal.state === "conflicted") $("#writeState").textContent = "检测到其他修改，已停止覆盖";
}

async function load() {
  try {
    if (jobId()) { await loadRunningJob(); return; }
    if (!proposalId()) throw new Error("缺少开发修改编号。");
    const [data, workspace, readiness] = await Promise.all([
      api(`/api/development/proposal?id=${encodeURIComponent(proposalId())}`),
      api(`/api/development/workspace?id=${encodeURIComponent(proposalId())}`),
      api("/api/platform/readiness"),
    ]);
    state.proposal = data.proposal;
    state.receipt = data.receipt;
    state.workspaceFiles = workspace.files || [];
    state.selected = new Set(data.proposal.state === "applied" && data.proposal.appliedPaths?.length ? data.proposal.appliedPaths : data.proposal.files.map((file) => file.path));
    state.activePath = data.proposal.files[0]?.path || "";
    const normalized = String(data.proposal.workspacePath || "").replace(/[\\/]+$/, "");
    $("#projectName").textContent = normalized.split(/[\\/]/).pop() || "项目";
    $("#projectPath").textContent = data.proposal.workspacePath;
    $("#projectPath").title = data.proposal.workspacePath;
    renderFiles(); renderActiveFile(); renderState(); renderEvidence(readiness.development);
    $("#workbench").removeAttribute("aria-busy");
  } catch (error) {
    $("#workbench").hidden = true; $("#emptyScreen").hidden = false; $("#emptyMessage").textContent = error.message;
    $("#stateBadge").textContent = "无法打开"; $("#stateBadge").className = "status-pill is-failed";
  }
}

async function loadRunningJob() {
  const [jobData, workspace, readiness] = await Promise.all([
    api(`/api/agent/job?id=${encodeURIComponent(jobId())}`),
    api(`/api/development/workspace?job=${encodeURIComponent(jobId())}`),
    api("/api/platform/readiness"),
  ]);
  const job = jobData.job;
  const proposal = job.result?.data?.artifact?.metadata?.development?.proposal;
  if (proposal?.id) { location.replace(`/development?id=${encodeURIComponent(proposal.id)}`); return; }
  state.fileView = "workspace";
  state.workspaceFiles = workspace.files || [];
  state.activePath = state.workspaceFiles.find((file) => file.readable)?.path || "";
  const path = String(job.payload?.workspacePath || "").replace(/[\\/]+$/, "");
  $("#projectName").textContent = path.split(/[\\/]/).pop() || "项目";
  $("#projectPath").textContent = path;
  $("#projectPath").title = path;
  const labels = { queued: "等待开始", running: "正在执行", succeeded: "已完成", failed: "执行失败", cancelled: "已取消", uncertain: "等待核对" };
  $("#stateBadge").textContent = labels[job.status] || job.status;
  $("#stateBadge").className = `status-pill ${job.status === "failed" ? "is-failed" : job.status === "succeeded" ? "is-applied" : "is-pending"}`;
  document.querySelector('[data-file-view="changes"]').hidden = true;
  document.querySelector('[data-file-view="workspace"]').setAttribute("aria-selected", "true");
  $(".selection-tools").hidden = true;
  $("#applyButton").hidden = true; $("#rollbackButton").hidden = true; $("#rejectButton").hidden = true; $("#continueButton").hidden = true;
  $(".decision-panel h2").textContent = job.status === "failed" ? "这次执行没有完成" : "小丑鱼正在处理项目";
  $(".decision-copy").textContent = job.status === "failed" ? "项目原文件仍受修改提案保护，可以返回能力页调整要求后重试。" : "你可以离开此页面；任务会在后台继续，进度来自真实运行记录。";
  renderEvidence(readiness.development);
  const checkpoints = Array.isArray(job.checkpoints) ? job.checkpoints : [];
  $("#checkSummary").textContent = checkpoints.length ? `${checkpoints.length} 条记录` : "等待第一条记录";
  $("#checkList").innerHTML = checkpoints.length ? checkpoints.slice().reverse().map((item) => `<div class="check-item"><span class="check-mark is-pass">·</span><span><strong>${escapeHtml(item.status || "正在执行")}</strong><small>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : "")}${Number.isFinite(item.progress) ? ` · ${item.progress}%` : ""}</small></span></div>`).join("") : '<p class="decision-copy">任务进入执行后，读取、修改和检查步骤会显示在这里。</p>';
  $("#isolationState").textContent = "任务执行期间只展示可核对的运行事件；正式修改仍需完成后确认";
  renderFiles();
  if (state.activePath) await openWorkspaceFile(state.activePath);
  $("#workbench").removeAttribute("aria-busy");
  if (job.status === "queued" || job.status === "running") window.setTimeout(() => location.reload(), 2500);
}

async function decide(action) {
  const messages = { apply: `确认把选中的 ${state.selected.size} 个文件写入项目？`, reject: "确认放弃整份修改？项目文件不会改变。", rollback: "确认恢复到本次写入之前？之后产生的新修改不会被强行覆盖。" };
  if (!window.confirm(messages[action])) return;
  const buttons = [$("#applyButton"), $("#rejectButton"), $("#rollbackButton")];
  buttons.forEach((button) => { button.disabled = true; });
  $("#message").className = "message"; $("#message").textContent = "正在核对项目文件……";
  try {
    const body = { id: state.proposal.id };
    if (action === "apply") body.selectedPaths = [...state.selected];
    const data = await api(`/api/development/proposal/${action}`, { method: "POST", body: JSON.stringify(body) });
    state.proposal = { ...state.proposal, ...data.proposal };
    renderState();
    $("#message").textContent = action === "apply" ? "修改已安全写入项目。" : action === "rollback" ? "项目已恢复到写入前。" : "修改已放弃，项目没有改变。";
  } catch (error) {
    $("#message").className = "message is-error"; $("#message").textContent = error.message;
    await load();
  } finally { buttons.forEach((button) => { button.disabled = false; }); }
}

$("#fileSearch").addEventListener("input", renderFiles);
document.querySelectorAll("[data-file-view]").forEach((button) => button.addEventListener("click", () => {
  state.fileView = button.dataset.fileView;
  document.querySelectorAll("[data-file-view]").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
  state.activePath = state.fileView === "changes" ? state.proposal.files[0]?.path || "" : state.workspaceFiles.find((file) => file.readable)?.path || "";
  renderFiles();
  if (state.fileView === "changes") renderActiveFile(); else if (state.activePath) openWorkspaceFile(state.activePath);
}));
$("#selectAll").addEventListener("change", (event) => {
  state.selected = event.target.checked ? new Set(state.proposal.files.map((file) => file.path)) : new Set();
  renderFiles();
});
$("#toggleView").addEventListener("click", () => {
  state.afterOnly = !state.afterOnly; $("#compareView").classList.toggle("is-after-only", state.afterOnly);
  $("#toggleView").textContent = state.afterOnly ? "对照查看" : "只看修改后";
});
$("#applyButton").addEventListener("click", () => decide("apply"));
$("#rejectButton").addEventListener("click", () => decide("reject"));
$("#rollbackButton").addEventListener("click", () => decide("rollback"));
load();
