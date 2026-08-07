const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const workViews = new Set(["tasks", "artifacts", "runs", "memory"]);
const viewFromLocation = () => {
  const route = location.pathname.replace(/^\/+|\/+$/g, "");
  return workViews.has(route) ? route : "tasks";
};
let view = viewFromLocation();
const state = { snapshot: null, jobs: [], runs: [], memories: [] };
const loadedViews = new Set();
let loadSequence = 0;
let activeStoryTaskId = "";

function hydrateIcons() {
  window.ClownfishIcons.hydrate({ root: document });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function date(value) {
  if (!value) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function api(url, options) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options?.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

let toastTimer;
function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("is-error", error);
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), 2600);
}

const pageCopy = {
  tasks: ["持续工作", "任务", "把需要重复执行的事情留在这里；新用户仍可直接从聊天开始。"],
  artifacts: ["可复用结果", "结果", "所有交付物都保留原版本，可以预览、下载或继续加工。"],
  runs: ["执行记录", "运行", "查看后台工作、失败原因和中断后可恢复的执行。"],
  memory: ["由你控制", "记忆", "这里只显示小丑鱼整理出的事实、经历与习惯，你可以随时修正或忘记。"],
};

function setPage() {
  const copy = pageCopy[view] || pageCopy.tasks;
  $("#pageEyebrow").textContent = copy[0];
  $("#pageTitle").textContent = copy[1];
  $("#pageDescription").textContent = copy[2];
  $$('.tabs a').forEach((link) => {
    const current = link.dataset.view === view;
    link.classList.toggle("is-current", current);
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `${copy[1]} · 小丑鱼`;
}

function showLoading() {
  const content = $("#content");
  content.setAttribute("aria-busy", "true");
  content.innerHTML = '<div class="loading" role="status">正在读取本机数据…</div>';
}

async function load() {
  const requestedView = view;
  const sequence = ++loadSequence;
  const content = $("#content");
  content.setAttribute("aria-busy", "true");
  try {
    let result;
    if (requestedView === "tasks") {
      const [snapshot, jobs] = await Promise.all([api("/api/capabilities"), api("/api/agent/jobs?limit=100")]);
      result = { snapshot, jobs: jobs.jobs || [] };
    }
    if (requestedView === "artifacts") result = await api("/api/capabilities");
    if (requestedView === "runs") {
      const [jobs, runs] = await Promise.all([api("/api/agent/jobs?limit=100"), api("/api/agent/runs?limit=100")]);
      result = { jobs: jobs.jobs || [], runs: runs.runs || [] };
    }
    if (requestedView === "memory") result = (await api("/api/memory?who=me")).facts || [];
    if (sequence !== loadSequence || requestedView !== view) return;
    if (requestedView === "tasks") {
      state.snapshot = result.snapshot;
      state.jobs = result.jobs;
    }
    if (requestedView === "artifacts") state.snapshot = result;
    if (requestedView === "runs") {
      state.jobs = result.jobs;
      state.runs = result.runs;
    }
    if (requestedView === "memory") state.memories = result;
    loadedViews.add(requestedView);
    render();
    if (activeStoryTaskId && $("#storyDialog")?.open) refreshOpenStoryline();
  } catch (error) {
    if (sequence !== loadSequence || requestedView !== view) return;
    if (loadedViews.has(requestedView)) toast(error.message || "读取失败", true);
    else content.innerHTML = `<div class="empty">${escapeHtml(error.message || "读取失败")}</div>`;
  } finally {
    if (sequence === loadSequence && requestedView === view) content.removeAttribute("aria-busy");
  }
}

function render() {
  if (view === "tasks") return renderTasks();
  if (view === "artifacts") return renderArtifacts();
  if (view === "runs") return renderRuns();
  return renderMemory();
}

function activateView(nextView, historyMode = "none") {
  if (!workViews.has(nextView) || nextView === view) return;
  view = nextView;
  if (historyMode === "push") history.pushState({ workView: view }, "", `/${view}`);
  setPage();
  if (loadedViews.has(view)) render();
  else showLoading();
  void load();
}

$(".tabs").addEventListener("click", (event) => {
  const link = event.target.closest("a[data-view]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  activateView(link.dataset.view, "push");
});

window.addEventListener("popstate", () => activateView(viewFromLocation()));

function abilityName(id) {
  const labels = {
    "presentation-builder": "做 PPT", "document-draft": "写正式文档", "research-brief": "深度研究",
    "market-briefing": "查港股资料", "thinking-workbench": "梳理复杂问题", "product-design": "设计产品界面",
    "project-development": "开发项目", "meeting-minutes": "整理会议纪要", "html-report": "做网页报告",
    "decision-brief": "比较方案", "business-deal": "推进商务合作", "market-opportunity": "模拟市场机会",
    "ability-builder": "生成新能力",
  };
  return labels[id] || state.snapshot?.abilities?.find((item) => item.id === id)?.name || id;
}

function scheduleLabel(task) {
  if (task.schedule?.mode === "daily") return `每天 ${task.schedule.time || "09:00"}`;
  if (task.schedule?.mode === "turns") return `每 ${task.schedule.everyTurns || 10} 轮对话`;
  return "手动执行";
}

function storylineOf(task) {
  return task.storyline || {
    status: "active",
    summary: "任务已建立，等待首次执行。",
    nextAction: "先运行一次，检查结果是否符合预期。",
    experts: [],
    decisions: [],
    events: [],
  };
}

function personaName(id) {
  return state.snapshot?.personas?.find((item) => item.id === id)?.name || id || "小丑鱼";
}

function storylineStatusLabel(status) {
  return { active: "推进中", waiting: "等待中", paused: "已暂停", completed: "已完成" }[status] || "推进中";
}

function taskJobs(taskId) {
  return state.jobs
    .filter((job) => job.payload?.taskId === taskId || job.metadata?.workTaskId === taskId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

function renderTaskCard(task) {
  const story = storylineOf(task);
  const jobs = taskJobs(task.id);
  const activeJob = jobs.find((job) => job.status === "running" || job.status === "queued");
  const checkpoint = activeJob?.checkpoints?.at(-1);
  const liveText = checkpoint?.status || (activeJob?.status === "running" ? "小丑鱼正在处理" : activeJob ? "任务正在排队" : "");
  const status = activeJob ? "协作中" : storylineStatusLabel(story.status);
  const statusTone = activeJob || story.status === "waiting" ? "warn" : story.status === "completed" ? "ok" : story.status === "paused" ? "bad" : "ok";
  const expertCount = story.experts?.length || 0;
  return `<article class="card task-card">
    <div>
      <h2>${escapeHtml(task.title)}</h2>
      <p>${escapeHtml(task.instruction)}</p>
      <div class="task-storyline-preview">
        <div><span>当前进展</span><p>${escapeHtml(liveText || story.summary)}</p></div>
        <div class="next-step"><span>下一步</span><strong>${escapeHtml(story.nextAction)}</strong></div>
      </div>
      <div class="meta">
        <span class="pill ${statusTone}">${escapeHtml(status)}</span>
        <span class="pill">${escapeHtml(abilityName(task.capabilityId))}</span>
        <span class="pill">${escapeHtml(scheduleLabel(task))}</span>
        <span class="pill">${escapeHtml(String(task.format).toUpperCase())}</span>
        ${expertCount ? `<span class="pill">${expertCount} 位专家</span>` : ""}
      </div>
    </div>
    <div class="actions task-actions">
      <button data-open-story="${task.id}">查看脉络</button>
      <button class="primary" data-run-task="${task.id}">运行</button>
      <details class="task-more">
        <summary>更多</summary>
        <div class="task-more-menu">
          <button data-edit-task="${task.id}">编辑</button>
          <button data-toggle-task="${task.id}">${task.enabled ? "暂停" : "启用"}</button>
          <button class="danger" data-delete-task="${task.id}">删除</button>
        </div>
      </details>
    </div>
  </article>`;
}

function renderTasks() {
  const tasks = state.snapshot?.tasks || [];
  const activeCount = tasks.filter((task) => storylineOf(task).status !== "completed").length;
  const runningCount = tasks.filter((task) => taskJobs(task.id).some((job) => job.status === "queued" || job.status === "running")).length;
  const priority = tasks.find((task) => storylineOf(task).status === "active") || tasks[0];
  $("#content").innerHTML = `<div class="toolbar"><input id="filterInput" type="search" placeholder="搜索任务…"><button class="primary" id="newTask">新建任务</button></div>
    <div class="task-overview"><span><strong>${activeCount} 项</strong>正在推进${runningCount ? ` · ${runningCount} 项正在协作` : ""}</span><span>${priority ? `优先下一步：${escapeHtml(storylineOf(priority).nextAction)}` : "从聊天或能力页开始，长期工作再留到这里。"}</span></div>
    <div class="list" id="taskList"></div>`;
  const draw = () => {
    const query = $("#filterInput").value.trim().toLowerCase();
    const visible = tasks.filter((task) => `${task.title} ${task.instruction}`.toLowerCase().includes(query));
    $("#taskList").innerHTML = visible.length ? visible.map(renderTaskCard).join("") : '<div class="empty">还没有符合条件的任务。</div>';
  };
  draw();
  $("#filterInput").addEventListener("input", draw);
  $("#newTask").onclick = () => openTaskDialog();
  $("#taskList").onclick = async (event) => {
    const run = event.target.closest("[data-run-task]");
    const story = event.target.closest("[data-open-story]");
    const edit = event.target.closest("[data-edit-task]");
    const toggle = event.target.closest("[data-toggle-task]");
    const remove = event.target.closest("[data-delete-task]");
    if (run) return runTask(run.dataset.runTask);
    if (story) return openStoryline(tasks.find((item) => item.id === story.dataset.openStory));
    if (edit) return openTaskDialog(tasks.find((item) => item.id === edit.dataset.editTask));
    if (toggle) {
      const task = tasks.find((item) => item.id === toggle.dataset.toggleTask);
      await saveTask({ ...task, enabled: !task.enabled });
    }
    if (remove && confirm("删除这个任务？已经生成的结果不会被删除。")) {
      await api("/api/capabilities/task/delete", { method: "POST", body: JSON.stringify({ id: remove.dataset.deleteTask }) });
      toast("任务已删除");
      await load();
    }
  };
}

function expertOptions(selectedId = "") {
  const experts = (state.snapshot?.personas || []).filter((item) => item.expert);
  const known = experts.some((item) => item.id === selectedId);
  const options = experts.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.tag || "专业判断")}</option>`).join("");
  return `${!known && selectedId ? `<option value="${escapeHtml(selectedId)}" selected>${escapeHtml(personaName(selectedId))}</option>` : ""}${options}`;
}

function addExpertAssignment(assignment = {}) {
  const experts = (state.snapshot?.personas || []).filter((item) => item.expert);
  if (!experts.length) return toast("当前没有可分配的专家", true);
  if ($$(".expert-assignment", $("#expertAssignments")).length >= 6) return toast("一个任务最多保留 6 项专家职责", true);
  const row = document.createElement("div");
  row.className = "expert-assignment";
  row.innerHTML = `<select data-expert-id aria-label="专家" required>${expertOptions(assignment.personaId || experts[0].id)}</select><input data-expert-responsibility aria-label="职责" maxlength="180" required placeholder="负责判断什么…" value="${escapeHtml(assignment.responsibility || "")}"><button type="button" data-remove-expert aria-label="移除这项专家职责">×</button>`;
  $("#expertAssignments").append(row);
}

function renderExpertAssignments(assignments) {
  $("#expertAssignments").innerHTML = "";
  (assignments || []).forEach(addExpertAssignment);
}

function collectExpertAssignments() {
  return $$(".expert-assignment", $("#expertAssignments")).map((row) => ({
    personaId: $("[data-expert-id]", row).value,
    responsibility: $("[data-expert-responsibility]", row).value.trim(),
  })).filter((item) => item.personaId && item.responsibility);
}

function renderDecisionList(task) {
  const decisions = storylineOf(task).decisions || [];
  $("#decisionList").innerHTML = decisions.length ? decisions.map((item) => `<article class="decision-item ${item.status === "superseded" ? "is-superseded" : ""}"><strong>${escapeHtml(item.text)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}<small>${item.status === "superseded" ? "已被后续决定替代" : "当前有效"} · ${date(item.createdAt)}</small></article>`).join("") : '<div class="story-empty">还没有关键决定。只记录会影响后续工作的结论。</div>';
  const active = decisions.filter((item) => item.status === "active");
  $("#decisionSupersedes").innerHTML = '<option value="">不替代</option>' + active.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.text.slice(0, 48))}</option>`).join("");
}

function taskActivity(task) {
  const stored = (storylineOf(task).events || []).map((event) => ({ ...event, source: "story" }));
  const fromJobs = taskJobs(task.id).slice(0, 8).flatMap((job) => {
    const items = [{
      id: `job-${job.id}-created`,
      type: "progress",
      text: job.type === "orchestration" ? "专家协作已进入后台队列" : "任务已进入后台队列",
      createdAt: job.createdAt,
      personaId: "clownfish",
      source: "job",
    }];
    for (const checkpoint of job.checkpoints || []) items.push({
      id: `job-${job.id}-${checkpoint.at}`,
      type: checkpoint.status.includes("失败") ? "error" : checkpoint.progress === 100 ? "result" : "progress",
      text: checkpoint.status + (Number.isFinite(checkpoint.progress) ? ` · ${checkpoint.progress}%` : ""),
      createdAt: checkpoint.at,
      personaId: "clownfish",
      source: "job",
    });
    if (["failed", "cancelled", "uncertain"].includes(job.status)) items.push({
      id: `job-${job.id}-ended`,
      type: "error",
      text: job.status === "cancelled" ? "本次后台工作已取消" : job.status === "uncertain" ? "执行结果待人工核对，系统不会自动重试" : (job.error || "本次后台工作未完成"),
      createdAt: job.updatedAt,
      personaId: "clownfish",
      source: "job",
    });
    return items;
  });
  const seen = new Set();
  return [...stored, ...fromJobs]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .filter((item) => {
      const key = `${item.text}|${String(item.createdAt).slice(0, 16)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function renderStoryActivity(task) {
  const activity = taskActivity(task);
  const activeJob = taskJobs(task.id).find((job) => job.status === "running" || job.status === "queued");
  $("#activityStatus").textContent = activeJob ? (activeJob.status === "running" ? "正在协作" : "正在排队") : (activity[0] ? date(activity[0].createdAt) : "暂无记录");
  $("#storyActivity").innerHTML = activity.length ? activity.map((item) => `<li class="${item.type === "error" ? "is-error" : item.type === "result" ? "is-result" : ""}"><strong>${escapeHtml(item.text)}</strong><span>${escapeHtml(personaName(item.personaId))} · ${date(item.createdAt)}</span>${item.artifactId ? `<span class="activity-links"><a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.artifactId)}" target="_blank">查看结果</a><a href="/office?artifact=${encodeURIComponent(item.artifactId)}">继续编辑</a></span>` : ""}</li>`).join("") : '<li><strong>还没有协作记录</strong><span>运行任务后会自动记录进度。</span></li>';
}

function renderStoryline(task, hydrateForm = true) {
  const story = storylineOf(task);
  $("#storyTitle").textContent = task.title;
  $("#storyTaskId").value = task.id;
  if (hydrateForm) {
    $("#storyStatus").value = story.status;
    $("#storySummary").value = story.summary;
    $("#storyNextAction").value = story.nextAction;
    renderExpertAssignments(story.experts);
  }
  renderDecisionList(task);
  renderStoryActivity(task);
}

function openStoryline(task) {
  if (!task) return;
  activeStoryTaskId = task.id;
  renderStoryline(task);
  $("#decisionForm").reset();
  renderDecisionList(task);
  $("#storyDialog").showModal();
  $("#storyDialog .storyline-dialog-card").scrollTop = 0;
}

function refreshOpenStoryline() {
  const task = state.snapshot?.tasks?.find((item) => item.id === activeStoryTaskId);
  if (task) renderStoryline(task, false);
}

function openTaskDialog(task) {
  const abilities = state.snapshot?.abilities || [];
  $("#taskCapability").innerHTML = `<option value="" disabled>请选择能力</option>${abilities.map((ability) => `<option value="${escapeHtml(ability.id)}">${escapeHtml(ability.name)}</option>`).join("")}`;
  $("#taskId").value = task?.id || "";
  $("#taskTitle").value = task?.title || "";
  $("#taskInstruction").value = task?.instruction || "";
  $("#taskCapability").value = task?.capabilityId || "";
  $("#taskFormat").value = task?.format || abilities.find((item) => item.id === $("#taskCapability").value)?.defaultFormat || "html";
  $("#taskSchedule").value = task?.schedule?.mode || "manual";
  $("#taskTime").value = task?.schedule?.time || "09:00";
  $("#taskDialogTitle").textContent = task ? "编辑任务" : "新建任务";
  updateScheduleField(task?.schedule?.everyTurns || 10, task?.schedule?.time || "09:00");
  $("#taskDialog").showModal();
}

function updateScheduleField(turns = 10, time = "09:00") {
  const mode = $("#taskSchedule").value;
  const label = $("#scheduleDetail");
  if (mode === "turns") label.innerHTML = `轮数<input id="taskTurns" type="number" min="1" max="1000" value="${turns}">`;
  else if (mode === "daily") label.innerHTML = `时间<input id="taskTime" type="time" value="${time}">`;
  else label.innerHTML = '<span>按需运行</span><input type="text" value="不会自动执行" disabled>';
}

async function saveTask(existing) {
  const mode = existing?.schedule?.mode || $("#taskSchedule")?.value || "manual";
  const body = existing || {
    id: $("#taskId").value || undefined,
    title: $("#taskTitle").value.trim(),
    instruction: $("#taskInstruction").value.trim(),
    personaId: "clownfish",
    capabilityId: $("#taskCapability").value,
    format: $("#taskFormat").value,
    enabled: true,
    schedule: mode === "daily" ? { mode, time: $("#taskTime")?.value || "09:00", timezone: "Asia/Shanghai" } : mode === "turns" ? { mode, everyTurns: Number($("#taskTurns")?.value || 10) } : { mode },
  };
  await api("/api/capabilities/task", { method: "POST", body: JSON.stringify(body) });
  $("#taskDialog").close();
  toast("任务已保存");
  await load();
}

async function runTask(id) {
  await api("/api/agent/job", { method: "POST", body: JSON.stringify({ kind: "capability-task", taskId: id, idempotencyKey: crypto.randomUUID() }) });
  toast("任务已放到后台运行");
  await load();
}

function artifactDisplayTitle(item) {
  const title = String(item?.title || "").trim();
  if (!title || /^(可以|好|好的|行|没问题|继续|就这样|看起来可以|我没想好|不知道|随便)[。！!？?，,\s]*$/.test(title)) {
    return abilityName(item?.capabilityId) || "能力结果";
  }
  return title;
}
function renderArtifacts() {
  const artifacts = state.snapshot?.artifacts || [];
  $("#content").innerHTML = `<div class="toolbar"><input id="filterInput" placeholder="搜索结果"><a class="button" href="/office">打开办公文件</a></div><div class="list" id="artifactList"></div>`;
  const draw = () => {
    const query = $("#filterInput").value.trim().toLowerCase();
    const visible = artifacts.filter((item) => `${item.title} ${item.summary}`.toLowerCase().includes(query));
    $("#artifactList").innerHTML = visible.length ? visible.map((item) => `<article class="card"><div><h2>${escapeHtml(artifactDisplayTitle(item))}</h2><p>${escapeHtml(item.summary || "已生成结果")}</p><div class="meta"><span class="pill ok">已完成</span><span class="pill">${escapeHtml(abilityName(item.capabilityId))}</span><span class="pill">${escapeHtml(String(item.format).toUpperCase())}</span><span class="pill">${date(item.createdAt)}</span></div></div><div class="actions"><a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.id)}" target="_blank">预览</a><a href="/api/capabilities/artifact?id=${encodeURIComponent(item.id)}" download>下载</a><button data-feedback-useful="\${item.id}">有帮助</button><button data-feedback-improve="\${item.id}">需改进</button></div></article>`).join("") : '<div class="empty">完成能力任务后，结果会自动出现在这里。</div>';
  };
  draw();
  $("#filterInput").addEventListener("input", draw);
  $("#artifactList").onclick = async (event) => {
    const useful = event.target.closest("[data-feedback-useful]");
    const improve = event.target.closest("[data-feedback-improve]");
    if (!useful && !improve) return;
    const id = useful?.dataset.feedbackUseful || improve?.dataset.feedbackImprove;
    const outcome = useful ? "useful" : "needs-work";
    const note = useful ? "产物被确认可直接使用。" : prompt("哪里需要改进？这条反馈可用于更新对应能力。", "")?.trim();
    if (improve && !note) return;
    const applyToSkill = confirm("如果这是自学习或安装的能力，是否把这条已验证经验写回能力文件？");
    const result = await api("/api/capabilities/artifact/feedback", { method: "POST", body: JSON.stringify({ id, outcome, note, applyToSkill }) });
    toast(result.applied ? "反馈已记录，并更新了对应能力" : "反馈已记录");
  };
}

function orchestrationDetail(job) {
  if (job.type !== "orchestration") return "";
  const tasks = Array.isArray(job.payload?.tasks) ? job.payload.tasks : [];
  const quality = job.result?.data?.orchestration?.quality;
  const assignments = tasks.map((task) => '<span class="pill">' + escapeHtml(task.title || task.id) + ' · ' + escapeHtml(task.metadata?.personaId || "小丑鱼") + '</span>').join("");
  const checks = Array.isArray(quality?.checks) ? quality.checks.map((check) => '<span class="pill ' + (check.status === "passed" ? "ok" : check.status === "failed" ? "bad" : "warn") + '">' + escapeHtml(check.id === "review" ? "最终复核" : check.id === "deliverables" ? "交付检查" : "完成度") + ' · ' + escapeHtml(check.status) + '</span>').join("") : "";
  return '<div class="meta orchestration-meta">' + assignments + checks + (quality?.score !== undefined ? '<span class="pill">质量 ' + escapeHtml(String(quality.score)) + '</span>' : "") + '</div>';
}

function statusPill(status) {
  if (["succeeded", "completed"].includes(status)) return "ok";
  if (["failed", "cancelled", "error"].includes(status)) return "bad";
  return "warn";
}

function jobStatusLabel(status) {
  return {
    queued: "排队中",
    running: "执行中",
    succeeded: "已完成",
    failed: "未完成",
    cancelled: "已取消",
    uncertain: "待核对",
    completed: "已完成",
    interrupted: "已中断",
    paused: "已暂停",
  }[status] || status;
}

function renderRuns() {
  const jobs = state.jobs;
  const runs = state.runs;
  const jobCards = jobs.map((job) => {
    const uncertainActions = job.status === "uncertain"
      ? `<button class="primary" data-reconcile-job="${job.id}" data-outcome="succeeded">确认已执行</button><button data-reconcile-job="${job.id}" data-outcome="not_applied">确认未执行</button>`
      : "";
    return `<article class="card"><div><h2>${escapeHtml(job.payload?.title || job.type || "后台任务")}</h2><p>${escapeHtml(job.result?.summary || job.error || (job.status === "uncertain" ? "执行结果无法自动确认，请先核对，系统不会自动重试。" : "由小丑鱼在后台执行"))}</p>${orchestrationDetail(job)}<div class="meta"><span class="pill ${statusPill(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</span><span class="pill">${date(job.updatedAt || job.createdAt)}</span><span class="pill">尝试 ${job.attempts || 0}/${job.maxAttempts || 1}</span></div></div><div class="actions">${["queued", "running"].includes(job.status) ? `<button data-cancel-job="${job.id}">取消</button>` : ""}${["failed", "cancelled"].includes(job.status) ? `<button data-retry-job="${job.id}">重试</button>` : ""}${uncertainActions}</div></article>`;
  }).join("");
  const runCards = runs.slice(0, 20).map((run) => `<article class="card"><div><h2>${escapeHtml(run.metadata?.objective || "对话处理")}</h2><p>${escapeHtml(run.output?.slice(0, 180) || run.error || "已保存执行记录，需要时可以恢复或排查。")}</p><div class="meta"><span class="pill ${statusPill(run.status)}">${escapeHtml(jobStatusLabel(run.status))}</span><span class="pill">${date(run.updatedAt || run.createdAt)}</span></div></div><div class="actions">${["interrupted", "paused", "failed"].includes(run.status) ? `<button data-resume-run="${run.runId}">恢复</button>` : ""}</div></article>`).join("");
  $("#content").innerHTML = `<div class="toolbar"><span></span><button id="refreshRuns">刷新</button></div><div class="list">${jobCards || runCards ? jobCards + runCards : '<div class="empty">还没有运行记录。</div>'}</div>`;
  $("#refreshRuns").onclick = load;
  $("#content").onclick = async (event) => {
    const cancel = event.target.closest("[data-cancel-job]");
    const retry = event.target.closest("[data-retry-job]");
    const reconcile = event.target.closest("[data-reconcile-job]");
    const resume = event.target.closest("[data-resume-run]");
    try {
      if (cancel) await api("/api/agent/job/cancel", { method: "POST", body: JSON.stringify({ id: cancel.dataset.cancelJob }) });
      if (retry) await api("/api/agent/job/retry", { method: "POST", body: JSON.stringify({ id: retry.dataset.retryJob }) });
      if (reconcile) {
        const applied = reconcile.dataset.outcome === "succeeded";
        const note = prompt(applied ? "请填写确认依据，例如目标文件或记录已经存在：" : "请填写确认依据，例如目标内容确实未生成：", "")?.trim();
        if (!note) return;
        await api("/api/agent/job/reconcile", {
          method: "POST",
          body: JSON.stringify({ id: reconcile.dataset.reconcileJob, outcome: reconcile.dataset.outcome, note }),
        });
      }
      if (resume) await api("/api/agent/run/resume", { method: "POST", body: JSON.stringify({ id: resume.dataset.resumeRun }) });
      if (cancel || retry || reconcile || resume) { toast("操作已提交"); await load(); }
    } catch (error) { toast(error.message, true); }
  };
}

const layerNames = { procedural: "习惯与做法", personal_semantic: "长期偏好", semantic: "稳定事实", episodic: "经历与进展" };

function memorySourceMeta(item) {
  const source = item.source || {};
  const parts = [];
  if (source.sourceMessageId) parts.push("消息 " + source.sourceMessageId);
  if (source.speakerId) parts.push("说话人 " + source.speakerId);
  if (source.subjectId) parts.push("主体 " + source.subjectId);
  if (source.conversationId) parts.push("会话 " + source.conversationId);
  return parts.join(" · ") || "这条记忆没有可显示的消息标识";
}

function openMemoryDetail(item) {
  const source = item.source || {};
  $("#memoryCorrectionId").value = item.id;
  $("#memoryDetailTitle").textContent = item.correctable ? "查看来源并修正" : "查看来源";
  $("#memorySourceExcerpt").textContent = source.excerpt || "没有找到对应的消息片段";
  $("#memorySourceMeta").textContent = memorySourceMeta(item);
  $("#memoryCorrectionContent").value = item.content;
  $("#memoryCorrectionField").hidden = !item.correctable;
  $("#memoryCorrectionNote").hidden = !item.correctable;
  $("#submitMemoryCorrection").hidden = !item.correctable;
  $("#memoryDetailDialog").showModal();
}

function renderMemory() {
  const groups = Object.entries(layerNames).map(([layer, name]) => {
    const items = state.memories.filter((item) => item.layer === layer);
    if (!items.length) return "";
    const cards = items.map((item) => {
      const actions = `<div class="memory-actions"><button data-memory-detail="${escapeHtml(item.id)}">${item.correctable ? "查看与修正" : "查看来源"}</button><button class="danger" data-forget="${escapeHtml(item.id)}">忘记</button></div>`;
      return `<article class="memory-item"><div><p>${escapeHtml(item.content)}</p><small>${escapeHtml(item.who)} · ${date(item.created)}${item.source?.sourceMessageId ? " · 有原始来源" : ""}</small></div>${actions}</article>`;
    }).join("");
    return `<section class="memory-group"><h2>${name}<span>${items.length} 条</span></h2>${cards}</section>`;
  }).join("");
  $("#content").innerHTML = `<form class="memory-form" id="memoryForm"><textarea id="memoryPreference" maxlength="500" placeholder="例如：正式文档先给结论，段落尽量短；演示稿偏好 16:9 和少量文字。"></textarea><button class="primary" type="submit">记住这项习惯</button></form>${groups || '<div class="empty">还没有可展示的记忆。直接聊天即可，必要内容会逐步沉淀。</div>'}`;
  $("#memoryForm").onsubmit = async (event) => {
    event.preventDefault();
    const content = $("#memoryPreference").value.trim();
    if (!content) return toast("先写下希望小丑鱼记住的习惯", true);
    await api("/api/memory/preference", { method: "POST", body: JSON.stringify({ content }) });
    toast("这项习惯已保存");
    await load();
  };
  $("#content").onclick = async (event) => {
    const detail = event.target.closest("[data-memory-detail]");
    if (detail) {
      const item = state.memories.find((memory) => memory.id === detail.dataset.memoryDetail);
      if (item) openMemoryDetail(item);
      return;
    }
    const button = event.target.closest("[data-forget]");
    if (!button || !confirm("忘记这条整理后的记忆？聊天记录不会改变。")) return;
    await api("/api/memory/forget", { method: "POST", body: JSON.stringify({ id: button.dataset.forget }) });
    toast("已忘记这条内容");
    await load();
  };
}

$("#closeMemoryDetail").onclick = () => $("#memoryDetailDialog").close();
$("#memoryCorrectionForm").onsubmit = async (event) => {
  event.preventDefault();
  const id = $("#memoryCorrectionId").value;
  const content = $("#memoryCorrectionContent").value.trim();
  if (!id || !content) return toast("请填写修正后的内容", true);
  try {
    await api("/api/memory/correct", { method: "POST", body: JSON.stringify({ id, content }) });
    $("#memoryDetailDialog").close();
    toast("记忆已修正，聊天记录不会改变");
    await load();
  } catch (error) {
    toast(error.message, true);
  }
};

$("#taskSchedule").addEventListener("change", () => updateScheduleField());
$("#taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveTask(); } catch (error) { toast(error.message, true); }
});
$("#storyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/capabilities/task/storyline", {
      method: "POST",
      body: JSON.stringify({
        id: $("#storyTaskId").value,
        status: $("#storyStatus").value,
        summary: $("#storySummary").value.trim(),
        nextAction: $("#storyNextAction").value.trim(),
        experts: collectExpertAssignments(),
      }),
    });
    state.snapshot = result.snapshot;
    const task = state.snapshot.tasks.find((item) => item.id === activeStoryTaskId);
    if (task) renderStoryline(task);
    if (view === "tasks") renderTasks();
    toast("任务脉络已保存");
  } catch (error) { toast(error.message, true); }
});
$("#decisionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/capabilities/task/decision", {
      method: "POST",
      body: JSON.stringify({
        id: activeStoryTaskId,
        text: $("#decisionText").value.trim(),
        note: $("#decisionNote").value.trim(),
        supersedesId: $("#decisionSupersedes").value || undefined,
      }),
    });
    state.snapshot = result.snapshot;
    $("#decisionForm").reset();
    const task = state.snapshot.tasks.find((item) => item.id === activeStoryTaskId);
    if (task) {
      renderDecisionList(task);
      renderStoryActivity(task);
    }
    if (view === "tasks") renderTasks();
    toast("关键决定已记录");
  } catch (error) { toast(error.message, true); }
});
$("#addExpertAssignment").addEventListener("click", () => addExpertAssignment());
$("#expertAssignments").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-expert]");
  if (button) button.closest(".expert-assignment")?.remove();
});
$$('[data-close-dialog]').forEach((button) => button.onclick = () => $("#taskDialog").close());
$("[data-close-story]").onclick = () => $("#storyDialog").close();
$("#storyDialog").addEventListener("close", () => { activeStoryTaskId = ""; });

let agentRefreshTimer;
let agentEventSource;
function queueAgentRefresh() {
  if (view !== "tasks" && view !== "runs") return;
  clearTimeout(agentRefreshTimer);
  agentRefreshTimer = setTimeout(() => void load(), 500);
}
if (window.EventSource) {
  agentEventSource = new EventSource("/api/agent/events");
  agentEventSource.addEventListener("job", queueAgentRefresh);
}
window.addEventListener("beforeunload", () => agentEventSource?.close());

hydrateIcons();
setPage();
showLoading();
void load();
