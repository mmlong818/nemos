"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $("#developForm");
  const transcript = $("#transcript");
  const emptyStateCopy = $("#codingEmpty").cloneNode(true);
  emptyStateCopy.querySelector("#developForm")?.remove();
  const emptyTranscriptTemplate = emptyStateCopy.outerHTML;

  const escapeHtml = (value) => String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.userMessage || data.error || `请求失败（${response.status}）`);
    return data;
  }

  function readPreference() {
    try {
      return JSON.parse(localStorage.getItem("clownfish-development-settings") || "{}");
    } catch {
      return {};
    }
  }

  const preference = readPreference();
  const params = new URLSearchParams(location.search);
  let activeJobId = params.get("job") || "";
  let activeWorkspace = "";
  let activeJobStatus = "idle";
  let renderedJobId = "";
  let renderedThreadRootId = "";
  let pollTimer = 0;
  let developmentHistory = [];
  let managedProjectsRoot = "";
  let archivedRootJobIds = new Set();

  const approvalPolicies = {
    request: { label: "请求批准", summary: "修改完成后由你确认是否写入" },
    auto: { label: "帮我批准", summary: "没有检查失败时自动写入项目" },
    full: { label: "完全控制", summary: "Codex 直接操作当前项目，不经过确认区" },
  };
  const engineApprovalPolicies = {
    pi: ["request", "auto"],
    dsh: ["request", "auto"],
    kilo: ["request", "auto"],
    opencode: ["request", "auto"],
    codex: ["request", "auto", "full"],
  };
  const savedApprovalPolicies = preference.approvalPolicies && typeof preference.approvalPolicies === "object"
    ? { ...preference.approvalPolicies }
    : {};

  function accessModeValue() {
    return $("#accessMode").value === "inspect" ? "inspect" : "develop";
  }

  function setAccessMode(value) {
    const normalized = value === "inspect" ? "inspect" : "develop";
    $("#accessMode").value = normalized;
    document.querySelectorAll('[name="accessModeChoice"]').forEach((option) => {
      option.checked = option.value === normalized;
    });
    syncExecutionControls();
  }

  function approvalPolicyValue() {
    return Object.hasOwn(approvalPolicies, $("#approvalPolicy").value) ? $("#approvalPolicy").value : "request";
  }

  function allowedApprovalPolicies() {
    return engineApprovalPolicies[developmentEngineValue()] || engineApprovalPolicies.pi;
  }

  function setApprovalPolicy(value, { remember = true } = {}) {
    const engine = developmentEngineValue();
    const allowed = allowedApprovalPolicies();
    const normalized = accessModeValue() === "inspect" || !allowed.includes(value) ? "request" : value;
    $("#approvalPolicy").value = normalized;
    if (remember && accessModeValue() === "develop") savedApprovalPolicies[engine] = normalized;
    $("#approvalPolicyLabel").textContent = accessModeValue() === "inspect" ? "无需批准" : approvalPolicies[normalized].label;
    $("#approvalPolicySummary").textContent = accessModeValue() === "inspect"
      ? "只读检查不会修改任何文件"
      : approvalPolicies[normalized].summary;
    document.querySelectorAll("[data-approval-policy]").forEach((option) => {
      const policy = option.dataset.approvalPolicy;
      option.hidden = !allowed.includes(policy);
      option.setAttribute("aria-selected", String(policy === normalized));
    });
    $("#approvalPolicyTrigger").classList.toggle("is-danger", normalized === "full" && accessModeValue() === "develop");
  }

  function closeApprovalPolicyMenu({ restoreFocus = false } = {}) {
    const trigger = $("#approvalPolicyTrigger");
    const menu = $("#approvalPolicyMenu");
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }

  function openApprovalPolicyMenu() {
    const trigger = $("#approvalPolicyTrigger");
    const menu = $("#approvalPolicyMenu");
    if (trigger.disabled) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    menu.querySelector('[aria-selected="true"]')?.focus();
  }

  const developmentEngines = {
    pi: { name: "Pi Agent（默认）", hint: "内置执行，适合大多数开发任务", presence: "Pi Agent · 灵活编排" },
    dsh: { name: "DeepSeek Harness", hint: "完整工具链引擎，适合复杂开发任务", presence: "DeepSeek Harness · 结构化执行" },
    kilo: { name: "Kilo Code", hint: "独立 CLI 引擎，在隔离目录中执行", presence: "Kilo Code · 专注实现" },
    opencode: { name: "OpenCode", hint: "开放式 CLI 引擎，适合多模型开发任务", presence: "OpenCode · 开放工作流" },
    codex: { name: "Codex", hint: "Responses API 编程引擎，适合复杂修改与检查", presence: "Codex · 精确开发" },
  };

  const developmentReasoning = {
    fast: "快速",
    balanced: "标准",
    deep: "深入",
  };

  function developmentEngineValue() {
    const value = $("#developmentEngine").value;
    return Object.hasOwn(developmentEngines, value) ? value : "pi";
  }

  function updateDevelopmentEngineHint() {
    const value = developmentEngineValue();
    const option = $("#developmentEngine").querySelector(`option[value="${value}"]`);
    $("#developmentEngineHint").textContent = option?.disabled
      ? `${developmentEngines[value].name} 当前不可用`
      : developmentEngines[value].hint;
    const presence = $("#developmentEnginePresence");
    if (presence) presence.textContent = developmentEngines[value].presence;
    document.body.dataset.developmentEngine = value;
  }

  function setDevelopmentEngine(value) {
    const select = $("#developmentEngine");
    const normalized = Object.hasOwn(developmentEngines, value) ? value : "pi";
    select.value = !select.querySelector(`option[value="${normalized}"]`)?.disabled ? normalized : "pi";
    updateDevelopmentEngineHint();
    setApprovalPolicy(savedApprovalPolicies[developmentEngineValue()] || "request", { remember: false });
    syncExecutionControls();
  }

  function developmentModelValue() {
    const value = String($("#developmentModel").value || "").trim();
    return value !== "default" && /^[a-z0-9._:/-]{1,120}$/i.test(value) ? value : "";
  }

  function setDevelopmentModel(value) {
    const select = $("#developmentModel");
    const normalized = String(value || "").trim();
    if (normalized && normalized !== "default" && /^[a-z0-9._:/-]{1,120}$/i.test(normalized)
      && ![...select.options].some((option) => option.value === normalized)) {
      const option = document.createElement("option");
      option.value = normalized;
      option.textContent = normalized;
      select.append(option);
    }
    select.value = normalized && [...select.options].some((option) => option.value === normalized) ? normalized : "default";
  }

  function developmentReasoningValue() {
    const value = $("#developmentReasoning").value;
    return Object.hasOwn(developmentReasoning, value) ? value : "balanced";
  }

  function setDevelopmentReasoning(value) {
    $("#developmentReasoning").value = Object.hasOwn(developmentReasoning, value) ? value : "balanced";
  }

  function syncExecutionControls() {
    const inspect = accessModeValue() === "inspect";
    const running = activeJobStatus === "queued" || activeJobStatus === "running";
    $("#approvalPolicyTrigger").disabled = running || inspect;
    $("#installDependencies").disabled = running || inspect;
    $("#approvalPolicyHint").textContent = inspect
      ? "只读检查不会写入文件，因此不需要批准。"
      : developmentEngineValue() === "codex"
        ? "Codex 额外支持完全控制；使用时会再次确认风险。"
        : `${developmentEngines[developmentEngineValue()].name.replace("（默认）", "")} 支持请求批准和帮我批准。`;
    setApprovalPolicy(inspect ? "request" : savedApprovalPolicies[developmentEngineValue()] || approvalPolicyValue(), { remember: false });
  }

  function updateSafetyNote() {
    const policy = approvalPolicyValue();
    $(".development-safety-note").textContent = accessModeValue() === "inspect"
      ? "只会检查，不会改动项目"
      : policy === "full"
        ? "Codex 将直接操作当前项目"
        : policy === "auto"
          ? "没有检查失败时自动写入"
          : "修改内容会先等待确认";
  }

  setDevelopmentEngine(preference.defaultDevelopmentEngine);
  setDevelopmentModel(preference.defaultModel);
  setDevelopmentReasoning(preference.defaultReasoning);
  setAccessMode(preference.defaultAccessMode);
  setApprovalPolicy(savedApprovalPolicies[developmentEngineValue()] || preference.defaultApprovalPolicy || "request", { remember: false });
  $("#installDependencies").checked = preference.installDependencies !== false;
  updateSafetyNote();

  const statusLabel = {
    queued: "等待开始",
    running: "正在开发",
    succeeded: "已完成",
    failed: "未完成",
    cancelled: "已取消",
    uncertain: "等待核对",
  };

  function projectName(path) {
    return path.split(/[\\/]/).filter(Boolean).pop() || path;
  }

  function setTaskTitle(title) {
    $("#taskTitle .hname").textContent = title;
  }

  function setTaskMeta(text) {
    $("#taskMeta").textContent = text;
  }

  function selectWorkspace(path) {
    activeWorkspace = path.trim();
    $("#workspaceLabel").textContent = activeWorkspace ? projectName(activeWorkspace) : "小丑鱼项目";
    $("#workspaceHint").textContent = activeWorkspace || managedProjectsRoot || "新项目会自动建立独立目录";
    if (!activeJobId) setTaskMeta(activeWorkspace ? projectName(activeWorkspace) : "项目将自动建立");
  }

  async function loadManagedProjectsRoot() {
    try {
      const result = await api("/api/development/projects");
      managedProjectsRoot = String(result.root || "");
      if (!activeWorkspace) selectWorkspace("");
    } catch {
      $("#workspaceHint").textContent = "新项目会自动建立独立目录";
    }
  }

  async function loadDevelopmentEngines() {
    try {
      const result = await api("/api/platform/readiness");
      for (const [id, engine] of Object.entries(developmentEngines)) {
        if (id === "pi") continue;
        const option = $("#developmentEngine").querySelector(`option[value="${id}"]`);
        option.disabled = result.development?.[id]?.available !== true;
        option.textContent = option.disabled ? `${engine.name}（不可用）` : engine.name;
      }
      setDevelopmentEngine(preference.defaultDevelopmentEngine);
    } catch {
      for (const [id, engine] of Object.entries(developmentEngines)) {
        if (id === "pi") continue;
        const option = $("#developmentEngine").querySelector(`option[value="${id}"]`);
        option.disabled = true;
        option.textContent = `${engine.name}（状态未知）`;
      }
      setDevelopmentEngine("pi");
    }
  }

  async function loadDevelopmentModels() {
    const select = $("#developmentModel");
    const preferred = preference.defaultModel || "default";
    try {
      const state = await api("/api/llm");
      const taskModel = String(state.taskModel || state.model || "").trim();
      const dailyModel = String(state.dailyChatModel || "").trim();
      select.innerHTML = "";
      const addOption = (value, label) => {
        if (!value || [...select.options].some((option) => option.value === value)) return;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
      };
      if (state.live && taskModel) {
        addOption("default", `任务模型 · ${taskModel}`);
        addOption(taskModel, taskModel);
        if (dailyModel && dailyModel !== taskModel) addOption(dailyModel, `${dailyModel} · 轻量`);
        select.disabled = false;
      } else {
        addOption("default", "尚未连接模型");
        select.disabled = true;
      }
      setDevelopmentModel(preferred);
    } catch {
      select.innerHTML = '<option value="default">模型状态未知</option>';
      select.disabled = true;
    }
  }

  function persistTaskSettings() {
    localStorage.setItem("clownfish-development-settings", JSON.stringify({
      ...readPreference(),
      defaultAccessMode: accessModeValue(),
      defaultDevelopmentEngine: developmentEngineValue(),
      defaultModel: developmentModelValue() || "default",
      defaultReasoning: developmentReasoningValue(),
      defaultApprovalPolicy: approvalPolicyValue(),
      approvalPolicies: savedApprovalPolicies,
      installDependencies: $("#installDependencies").checked,
    }));
    updateSafetyNote();
    updateDevelopmentEngineHint();
  }

  document.querySelectorAll('[name="accessModeChoice"]').forEach((option) => option.addEventListener("change", () => {
    if (!option.checked) return;
    setAccessMode(option.value);
    persistTaskSettings();
  }));
  $("#approvalPolicyTrigger").addEventListener("click", () => {
    if ($("#approvalPolicyMenu").hidden) openApprovalPolicyMenu();
    else closeApprovalPolicyMenu();
  });
  document.querySelectorAll("[data-approval-policy]").forEach((option) => option.addEventListener("click", () => {
    setApprovalPolicy(option.dataset.approvalPolicy);
    persistTaskSettings();
    closeApprovalPolicyMenu({ restoreFocus: true });
  }));
  document.addEventListener("click", (event) => {
    if (!$("#approvalPermission").contains(event.target)) closeApprovalPolicyMenu();
  });
  $("#approvalPermission").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#approvalPolicyMenu").hidden) {
      event.preventDefault();
      closeApprovalPolicyMenu({ restoreFocus: true });
    }
  });
  $("#developmentEngine").addEventListener("change", () => {
    setDevelopmentEngine($("#developmentEngine").value);
    persistTaskSettings();
  });
  $("#developmentModel").addEventListener("change", persistTaskSettings);
  $("#developmentReasoning").addEventListener("change", persistTaskSettings);
  $("#installDependencies").addEventListener("change", persistTaskSettings);

  function developmentJobs(items) {
    return items.filter((job) => job.payload?.capabilityId === "project-development");
  }

  function developmentThread(job, jobs = developmentHistory) {
    const byId = new Map(jobs.map((item) => [item.id, item]));
    const seen = new Set();
    let root = job;
    while (root?.payload?.parentJobId && !seen.has(root.id)) {
      seen.add(root.id);
      const parent = byId.get(root.payload.parentJobId);
      if (!parent) break;
      root = parent;
    }
    const belongsToRoot = (item) => {
      const visited = new Set();
      let current = item;
      while (current && !visited.has(current.id)) {
        if (current.id === root.id) return true;
        visited.add(current.id);
        current = byId.get(current.payload?.parentJobId);
      }
      return false;
    };
    const turns = jobs.filter(belongsToRoot).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return { root, turns, latest: turns.at(-1) || job };
  }

  function developmentThreads(jobs = developmentHistory) {
    const roots = new Map();
    for (const job of jobs) {
      const thread = developmentThread(job, jobs);
      roots.set(thread.root.id, thread);
    }
    return [...roots.values()].sort((a, b) => String(b.latest.createdAt).localeCompare(String(a.latest.createdAt)));
  }

  function renderHistory(items) {
    const jobs = developmentJobs(items);
    developmentHistory = jobs;
    const threads = developmentThreads(jobs);
    $("#developmentList").innerHTML = threads.length ? threads.map(({ root, latest }) => `
      <div class="development-list-row ${latest.id === activeJobId ? "is-current" : ""}">
        <button type="button" class="development-item" data-job="${escapeHtml(latest.id)}" aria-current="${latest.id === activeJobId ? "true" : "false"}">
          <b>${escapeHtml(root.payload?.title || "开发任务")}</b>
          <span><i class="job-dot ${escapeHtml(latest.status)}"></i>${escapeHtml(statusLabel[latest.status] || latest.status)}</span>
        </button>
        <button type="button" class="development-archive-action" data-archive-project="${escapeHtml(root.id)}" aria-label="归档${escapeHtml(root.payload?.title || "开发项目")}" title="${["queued", "running"].includes(latest.status) ? "任务执行中，暂时不能归档" : "归档项目"}" ${["queued", "running"].includes(latest.status) ? "disabled" : ""}><span data-app-icon="boxes" aria-hidden="true"><span></span></span></button>
      </div>`).join("") : '<p>还没有开发任务</p><a class="development-empty-archive" href="/develop/archive">查看归档项目</a>';
    window.ClownfishIcons?.hydrate({ root: $("#developmentList") });
  }

  function renderDevelopmentSearchResults(queryText) {
    const query = String(queryText || "").trim().toLowerCase();
    const threads = developmentThreads().filter(({ root, latest }) => {
      const title = root.payload?.title || "开发任务";
      const status = statusLabel[latest.status] || latest.status;
      return !query || `${title} ${status}`.toLowerCase().includes(query);
    });
    $("#developmentSearchResults").innerHTML = threads.length ? threads.map(({ root, latest }) => `
      <button class="app-search-result" type="button" role="option" data-search-development="${escapeHtml(latest.id)}">
        <span><strong>${escapeHtml(root.payload?.title || "开发任务")}</strong><small>${escapeHtml(latest.payload?.instruction || "打开任务记录")}</small></span>
        <small>${escapeHtml(statusLabel[latest.status] || latest.status)}</small>
      </button>`).join("") : '<div class="app-search-empty">没有找到匹配的开发任务</div>';
  }

  function messageBlock(role, title, content, extra = "") {
    const avatar = role === "assistant" ? '<img src="/assets/brand/clownfish-mark.svg" alt="">' : "";
    return `<article class="coding-message ${role}"><header>${avatar}<b>${escapeHtml(title)}</b></header><div>${escapeHtml(content).replace(/\n/g, "<br>")}</div>${extra}</article>`;
  }

  function renderProcessPanel(job) {
    const panel = $("#developmentProcess");
    const running = job.status === "queued" || job.status === "running";
    const failed = job.status === "failed" || job.status === "cancelled";
    const rawCheckpoints = Array.isArray(job.checkpoints) ? job.checkpoints.slice(-12) : [];
    const checkpoints = rawCheckpoints.length
      ? rawCheckpoints.reduce((rows, item) => {
          if (rows.at(-1)?.status === item.status) rows[rows.length - 1] = item;
          else rows.push(item);
          return rows;
        }, []).slice(-6)
      : [{ status: job.status === "queued" ? "等待开始" : "正在读取项目并建立计划" }];
    const completed = running ? Math.max(0, checkpoints.length - 1) : checkpoints.length;
    const wasCollapsed = panel.classList.contains("is-collapsed");
    const rows = checkpoints.map((item, index) => {
      const current = running && index === checkpoints.length - 1;
      const state = current ? "is-current" : failed && index === checkpoints.length - 1 ? "is-error" : "is-complete";
      return `<li class="${state}"><i></i><span>${escapeHtml(item.status || "正在处理")}</span>${Number.isFinite(item.progress) ? `<small>${item.progress}%</small>` : ""}</li>`;
    }).join("");
    panel.innerHTML = `<header>
      <div><b>进程</b><span>${completed}/${checkpoints.length}</span></div>
      <button type="button" data-process-toggle aria-label="${wasCollapsed ? "展开进程" : "收起进程"}" aria-expanded="${String(!wasCollapsed)}">${wasCollapsed ? "+" : "−"}</button>
    </header>
    <div class="development-process-body">
      <ol>${rows}</ol>
      <footer>${running ? '<span class="progress-spinner"></span>任务会在后台继续运行' : failed ? "任务未完成，可查看记录后重试" : "任务已完成，可查看修改与验证"}</footer>
    </div>`;
    panel.hidden = false;
    panel.classList.toggle("is-collapsed", wasCollapsed);
    panel.closest(".task-workbench-main").classList.add("has-process");
  }

  function outcomeActions(job, failed = false) {
    const detailLabel = failed ? "查看原因与记录" : "查看修改与验证";
    return `<div class="development-result-actions">
      <a class="review-result" href="/development?job=${encodeURIComponent(job.id)}">${detailLabel}</a>
      <button type="button" data-continue-task>${failed ? "修改说明后重试" : "继续调整"}</button>
    </div>`;
  }

  function placeComposer(mode) {
    const host = $("#developmentComposerHost");
    if (form.parentElement !== host) host.append(form);
    form.classList.remove("is-hero");
  }

  function setComposerState(status) {
    const running = status === "queued" || status === "running";
    activeJobStatus = status;
    $("#instruction").disabled = running;
    $("#developmentEngine").disabled = running;
    $("#developmentModel").disabled = running || $("#developmentModel").options[0]?.textContent === "尚未连接模型";
    $("#developmentReasoning").disabled = running;
    document.querySelectorAll('[name="accessModeChoice"]').forEach((option) => { option.disabled = running; });
    if (running) closeApprovalPolicyMenu();
    syncExecutionControls();
    $("#instruction").placeholder = running
      ? "当前任务完成后，可以继续说明需要调整的地方…"
      : status === "idle"
        ? "例如：修复首页按钮没有反应的问题，并检查有没有类似错误"
        : "继续说明需要调整的地方…";
    $("#startDevelop").hidden = running;
    $("#startDevelop").textContent = activeJobId ? "继续任务" : "开始任务";
    $("#cancelDevelop").hidden = !running;
  }

  function renderJob(job) {
    const thread = developmentThread(job);
    const switchedProject = renderedThreadRootId !== thread.root.id;
    const workspace = job.payload?.workspacePath || thread.root.payload?.workspacePath || "";
    if (workspace) selectWorkspace(workspace);
    if (job.payload?.developmentEngine) setDevelopmentEngine(job.payload.developmentEngine);
    if (job.payload?.model) setDevelopmentModel(job.payload.model);
    if (job.payload?.reasoning) setDevelopmentReasoning(job.payload.reasoning);
    if (job.payload?.accessMode) setAccessMode(job.payload.accessMode);
    if (job.payload?.approvalPolicy) setApprovalPolicy(job.payload.approvalPolicy, { remember: false });
    if (typeof job.payload?.installDependencies === "boolean") {
      $("#installDependencies").checked = job.payload.installDependencies;
    }
    updateSafetyNote();
    activeJobStatus = job.status;
    placeComposer("active");
    setComposerState(job.status);
    setTaskTitle(thread.root.payload?.title || "开发任务");
    setTaskMeta(`${projectName(workspace) || "项目"} · ${statusLabel[job.status] || job.status}`);
    $("#activityContext").textContent = `${projectName(workspace) || "项目"} · ${statusLabel[job.status] || job.status}`;
    $("#openReview").hidden = false;
    $("#openReview").href = `/development?job=${encodeURIComponent(job.id)}`;
    renderProcessPanel(job);

    const html = thread.turns.map((turn) => {
      const instruction = turn.payload?.instruction || turn.payload?.title || "开发任务";
      let turnHtml = messageBlock("user", "你", instruction);
      const isLatest = turn.id === job.id;
      if (turn.status === "succeeded") {
        turnHtml += messageBlock("assistant", "小丑鱼", turn.result?.summary || "开发任务已经完成。", isLatest ? outcomeActions(turn) : "");
      } else if (!["queued", "running"].includes(turn.status)) {
        const reason = turn.error || (turn.status === "cancelled" ? "任务已停止，项目中尚未确认的修改不会写入。" : "这次开发没有完成，请查看记录了解原因。");
        turnHtml += messageBlock("assistant", "小丑鱼", reason, isLatest ? outcomeActions(turn, true) : "");
      }
      return turnHtml;
    }).join("");
    transcript.innerHTML = html;
    transcript.scrollTop = switchedProject ? 0 : transcript.scrollHeight;
    renderedJobId = job.id;
    renderedThreadRootId = thread.root.id;
  }

  async function loadJobs(renderActive = true) {
    const requestedJobId = activeJobId;
    try {
      const [result, archive] = await Promise.all([
        api("/api/agent/jobs?limit=500"),
        api("/api/development/project-archive"),
      ]);
      archivedRootJobIds = new Set(archive.archivedRootJobIds || []);
      const allJobs = developmentJobs(result.jobs || []);
      const jobs = allJobs.filter((job) => !archivedRootJobIds.has(developmentThread(job, allJobs).root.id));
      renderHistory(jobs);
      if (!renderActive || !requestedJobId || requestedJobId !== activeJobId) return;
      const requested = allJobs.find((item) => item.id === requestedJobId);
      if (requested && archivedRootJobIds.has(developmentThread(requested, allJobs).root.id)) {
        resetTask();
        return;
      }
      const job = jobs.find((item) => item.id === requestedJobId)
        || (await api(`/api/agent/job?id=${encodeURIComponent(requestedJobId)}`)).job;
      if (requestedJobId !== activeJobId) return;
      renderJob(job);
      if (["queued", "running"].includes(job.status)) schedulePoll();
    } catch (error) {
      $("#developStatus").className = "status error";
      $("#developStatus").textContent = error.message;
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => loadJobs(true), 2200);
  }

  function openDevelopmentJob(jobId) {
    const nextJobId = String(jobId || "").trim();
    if (!nextJobId || (nextJobId === activeJobId && renderedJobId === nextJobId)) return;
    clearTimeout(pollTimer);
    activeJobId = nextJobId;
    history.replaceState(null, "", `/develop?job=${encodeURIComponent(activeJobId)}`);
    renderHistory(developmentHistory);
    const cached = developmentHistory.find((item) => item.id === activeJobId);
    if (cached) renderJob(cached);
    loadJobs(true);
  }

  $("#developmentList").onclick = (event) => {
    const archive = event.target.closest("[data-archive-project]");
    if (archive) {
      archiveDevelopmentProject(archive.dataset.archiveProject);
      return;
    }
    const button = event.target.closest("[data-job]");
    if (!button) return;
    openDevelopmentJob(button.dataset.job);
  };

  function confirmArchiveProject(title) {
    const dialog = $("#projectArchiveDialog");
    $("#projectArchiveTitle").textContent = `归档「${title}」？`;
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
      dialog.showModal();
    });
  }

  async function archiveDevelopmentProject(rootJobId) {
    const thread = developmentThreads().find((item) => item.root.id === rootJobId);
    if (!thread || !(await confirmArchiveProject(thread.root.payload?.title || "开发项目"))) return;
    try {
      await api("/api/development/project/archive", {
        method: "POST",
        body: JSON.stringify({ rootJobId }),
      });
      if (thread.turns.some((job) => job.id === activeJobId)) resetTask();
      else await loadJobs(false);
    } catch (error) {
      $("#developStatus").className = "status error";
      $("#developStatus").textContent = error.message;
    }
  }

  function resetTask() {
    clearTimeout(pollTimer);
    activeJobId = "";
    activeJobStatus = "idle";
    renderedJobId = "";
    renderedThreadRootId = "";
    activeWorkspace = "";
    history.replaceState(null, "", "/develop");
    setTaskTitle("新开发任务");
    setTaskMeta("项目将自动建立");
    $("#activityContext").textContent = "新任务";
    transcript.innerHTML = emptyTranscriptTemplate;
    updateDevelopmentEngineHint();
    placeComposer("hero");
    setComposerState("idle");
    $("#openReview").hidden = true;
    $("#developmentProcess").hidden = true;
    $("#developmentProcess").classList.remove("is-collapsed");
    $("#developmentProcess").closest(".task-workbench-main").classList.remove("has-process");
    $("#instruction").value = "";
    selectWorkspace("");
    $("#developStatus").textContent = "";
    window.ClownfishIcons?.hydrate({ root: transcript });
    $("#instruction").focus();
    loadJobs(false);
  }

  $("#newDevelopment").onclick = resetTask;
  const developmentSearchOverlay = window.AppSearchOverlay.bind({
    dialog: "#developmentSearchDialog",
    trigger: "#developmentSearchToggle",
    input: "#developmentSearch",
    close: "#closeDevelopmentSearch",
    render: renderDevelopmentSearchResults,
  });
  $("#developmentSearchResults").onclick = (event) => {
    const result = event.target.closest("[data-search-development]");
    if (!result) return;
    developmentSearchOverlay.close();
    openDevelopmentJob(result.dataset.searchDevelopment);
  };

  transcript.addEventListener("click", (event) => {
    if (event.target.closest("[data-continue-task]")) $("#instruction").focus();
  });

  $("#developmentProcess").onclick = (event) => {
    const toggle = event.target.closest("[data-process-toggle]");
    if (!toggle) return;
    const collapsed = $("#developmentProcess").classList.toggle("is-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "展开进程" : "收起进程");
    toggle.textContent = collapsed ? "+" : "−";
  };

  $("#instruction").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  };

  $("#cancelDevelop").onclick = async () => {
    if (!activeJobId || !["queued", "running"].includes(activeJobStatus)) return;
    const button = $("#cancelDevelop");
    button.disabled = true;
    $("#developStatus").textContent = "正在停止任务…";
    try {
      await api("/api/agent/job/cancel", { method: "POST", body: JSON.stringify({ id: activeJobId }) });
      await loadJobs(true);
    } catch (error) {
      $("#developStatus").className = "status error";
      $("#developStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };

  function confirmFullControl() {
    const dialog = $("#fullControlDialog");
    return new Promise((resolve) => {
      const closed = () => resolve(dialog.returnValue === "confirm");
      dialog.addEventListener("close", closed, { once: true });
      dialog.showModal();
    });
  }

  function activeContinuationContext() {
    if (!activeJobId || !activeWorkspace) return { parentJobId: "", continuationTaskId: "", title: "" };
    const active = developmentHistory.find((item) => item.id === activeJobId);
    if (!active || ["queued", "running"].includes(active.status)) return { parentJobId: "", continuationTaskId: "", title: "" };
    const thread = developmentThread(active);
    const taskTurn = [...thread.turns].reverse().find((item) => item.result?.data?.artifact?.taskId);
    return {
      parentJobId: active.id,
      continuationTaskId: taskTurn?.result?.data?.artifact?.taskId || "",
      title: thread.root.payload?.title || "",
    };
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    const instruction = $("#instruction").value.trim();
    const button = $("#startDevelop");
    const status = $("#developStatus");
    if (!instruction) return $("#instruction").focus();
    const continuation = activeContinuationContext();
    const approvalPolicy = approvalPolicyValue();
    const fullControlConfirmed = approvalPolicy === "full" ? await confirmFullControl() : false;
    if (approvalPolicy === "full" && !fullControlConfirmed) return;
    button.disabled = true;
    status.className = "status";
    status.textContent = continuation.parentJobId
      ? "正在继续当前项目…"
      : activeWorkspace ? "正在建立开发任务…" : "正在创建项目并建立任务…";
    try {
      const result = await api("/api/agent/job", {
        method: "POST",
        body: JSON.stringify({
          kind: "capability-adhoc",
          title: continuation.title || instruction.slice(0, 42),
          capabilityId: "project-development",
          instruction,
          workspacePath: activeWorkspace,
          parentJobId: continuation.parentJobId,
          continuationTaskId: continuation.continuationTaskId,
          accessMode: accessModeValue(),
          approvalPolicy,
          fullControlConfirmed,
          installDependencies: $("#installDependencies").checked,
          developmentEngine: developmentEngineValue(),
          model: developmentModelValue(),
          reasoning: developmentReasoningValue(),
          format: "md",
          memoryMode: "preferences",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      activeJobId = result.job.id;
      developmentHistory = [result.job, ...developmentHistory.filter((item) => item.id !== result.job.id)];
      history.replaceState(null, "", `/develop?job=${encodeURIComponent(activeJobId)}`);
      $("#instruction").value = "";
      status.textContent = "";
      renderHistory(developmentHistory);
      renderJob(result.job);
      await loadJobs(false);
      schedulePoll();
    } catch (error) {
      status.className = "status error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };

  window.ClownfishIcons?.hydrate();
  loadManagedProjectsRoot();
  loadDevelopmentEngines();
  loadDevelopmentModels();
  if (activeJobId) loadJobs(true);
  else loadJobs(false);
})();
