const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const workViews = new Set(["tasks", "spaces", "automations", "collaboration", "resources", "artifacts", "runs", "memory"]);
const viewFromLocation = () => {
  const route = location.pathname.replace(/^\/+|\/+$/g, "");
  return workViews.has(route) ? route : "tasks";
};
let view = viewFromLocation();
const state = { snapshot: null, jobs: [], runs: [], memories: [], knowledge: [], sources: null, platform: null, extensions: [], reviewQueue: [] };
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
  spaces: ["多个任务，一件事情", "工作空间", "把相关任务、结果和决定放在一起；工作变复杂时再创建。"],
  automations: ["按计划完成", "自动化", "把固定频率的工作交给小丑鱼；随时暂停，也可以立即运行。"],
  collaboration: ["需要时再组织", "协作", "小丑鱼会按任务动态调用合适的专家，最后统一完成交付。"],
  resources: ["任务所需的上下文", "资料", "保存本地笔记、文本和链接，并在执行任务时明确选择。"],
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
      const [snapshot, jobs, knowledge] = await Promise.all([api("/api/capabilities"), api("/api/agent/jobs?limit=100"), api("/api/knowledge")]);
      result = { snapshot, jobs: jobs.jobs || [], knowledge: knowledge.items || [] };
    }
    if (requestedView === "spaces") result = await api("/api/capabilities");
    if (requestedView === "automations" || requestedView === "collaboration") {
      const [snapshot, jobs, knowledge] = await Promise.all([api("/api/capabilities"), api("/api/agent/jobs?limit=100"), api("/api/knowledge")]);
      result = { snapshot, jobs: jobs.jobs || [], knowledge: knowledge.items || [] };
    }
    if (requestedView === "resources") {
      const [snapshot, knowledge, sources, platform, extensions] = await Promise.all([api("/api/capabilities"), api("/api/knowledge?archived=1"), api("/api/sources"), api("/api/platform/readiness"), api("/api/agent/extensions")]);
      result = { snapshot, knowledge: knowledge.items || [], sources, platform, extensions: extensions.extensions || [] };
    }
    if (requestedView === "artifacts") result = await api("/api/capabilities");
    if (requestedView === "runs") {
      const [jobs, runs, reviewQueue] = await Promise.all([api("/api/agent/jobs?limit=100"), api("/api/agent/runs?limit=100"), api("/api/review-queue")]);
      result = { jobs: jobs.jobs || [], runs: runs.runs || [], reviewQueue: reviewQueue.items || [] };
    }
    if (requestedView === "memory") result = (await api("/api/memory?who=me")).facts || [];
    if (sequence !== loadSequence || requestedView !== view) return;
    if (requestedView === "tasks") {
      state.snapshot = result.snapshot;
      state.jobs = result.jobs;
      state.knowledge = result.knowledge;
    }
    if (requestedView === "spaces") state.snapshot = result;
    if (requestedView === "automations" || requestedView === "collaboration") {
      state.snapshot = result.snapshot;
      state.jobs = result.jobs;
      state.knowledge = result.knowledge;
    }
    if (requestedView === "resources") {
      state.snapshot = result.snapshot;
      state.knowledge = result.knowledge;
      state.sources = result.sources;
      state.platform = result.platform;
      state.extensions = result.extensions;
    }
    if (requestedView === "artifacts") state.snapshot = result;
    if (requestedView === "runs") {
      state.jobs = result.jobs;
      state.runs = result.runs;
      state.reviewQueue = result.reviewQueue;
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
  if (view === "spaces") return renderSpaces();
  if (view === "automations") return renderAutomations();
  if (view === "collaboration") return renderCollaboration();
  if (view === "resources") return renderResources();
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

const PUBLIC_CAPABILITY_IDS = [
  "presentation-builder", "document-draft", "research-brief", "market-briefing", "thinking-workbench",
  "product-design", "project-development", "meeting-minutes", "html-report", "decision-brief",
  "business-deal", "market-opportunity", "ability-builder",
];

function publicAbilities() {
  const byId = new Map((state.snapshot?.abilities || []).map((ability) => [ability.id, ability]));
  return PUBLIC_CAPABILITY_IDS.flatMap((id) => {
    const ability = byId.get(id);
    return ability ? [{ ...ability, name: abilityName(id) }] : [];
  });
}

function scheduleLabel(task) {
  if (task.schedule?.mode === "daily") return `每天 ${task.schedule.time || "09:00"}`;
  if (task.schedule?.mode === "turns") return `每完成 ${task.schedule.everyTurns || 10} 次对话后`;
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

function spaceById(id) {
  return state.snapshot?.spaces?.find((item) => item.id === id);
}

function storylineStatusLabel(status) {
  return { active: "推进中", waiting: "等待中", paused: "已暂停", completed: "已完成" }[status] || "推进中";
}

function taskJobs(taskId) {
  return state.jobs
    .filter((job) => job.payload?.taskId === taskId || job.metadata?.workTaskId === taskId || job.result?.data?.artifact?.taskId === taskId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

function taskArtifact(task) {
  const executionId = task.execution?.artifactId;
  return [...(state.snapshot?.artifacts || [])]
    .reverse()
    .find((item) => item.id === executionId || item.taskId === task.id);
}

function taskOriginLabel(task) {
  if (!task.oneOff) return "长期任务";
  return {
    chat: "来自对话",
    capability: "能力接力",
    orchestration: "专家任务",
    automation: "自动执行",
    direct: "直接任务",
  }[task.origin?.kind] || "一次任务";
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
  const artifact = taskArtifact(task);
  const versionCount = (state.snapshot?.artifacts || []).filter((item) => item.taskId === task.id).length;
  const completedOneOff = task.oneOff && story.status === "completed" && artifact;
  const primaryAction = completedOneOff
    ? `<a class="primary" href="/api/capabilities/artifact/preview?id=${encodeURIComponent(artifact.id)}" target="_blank">查看结果</a><button data-continue-task="${task.id}">继续处理</button>`
    : `<button class="primary" data-run-task="${task.id}">${task.oneOff ? "重试" : "运行"}</button>`;
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
        <span class="pill">${escapeHtml(taskOriginLabel(task))}</span>
        ${task.spaceId ? `<a class="pill space-pill" href="/tasks?space=${encodeURIComponent(task.spaceId)}">${escapeHtml(spaceById(task.spaceId)?.title || "已归档空间")}</a>` : ""}
        ${task.oneOff ? "" : `<span class="pill">${escapeHtml(scheduleLabel(task))}</span>`}
        <span class="pill">${escapeHtml(String(task.format).toUpperCase())}</span>
        ${versionCount > 1 ? `<span class="pill">${versionCount} 个版本</span>` : ""}
        ${task.workspace?.path ? `<span class="pill" title="${escapeHtml(task.workspace.path)}">${task.workspace.accessMode === "inspect" ? "只读检查" : "开发模式"}</span>` : ""}
        ${task.knowledgeIds?.length ? `<span class="pill">${task.knowledgeIds.length} 份资料</span>` : ""}
        ${expertCount ? `<span class="pill">${expertCount} 位专家</span>` : ""}
      </div>
    </div>
    <div class="actions task-actions">
      <button data-open-story="${task.id}">查看脉络</button>
      ${primaryAction}
      <details class="task-more">
        <summary>更多</summary>
        <div class="task-more-menu">
          ${task.oneOff ? `<button data-promote-task="${task.id}">设为重复任务</button>` : `<button data-edit-task="${task.id}">编辑</button><button data-toggle-task="${task.id}">${task.enabled ? "暂停" : "启用"}</button>`}
          <button class="danger" data-delete-task="${task.id}">删除</button>
        </div>
      </details>
    </div>
  </article>`;
}

function renderTasks() {
  const tasks = state.snapshot?.tasks || [];
  const selectedSpaceId = new URLSearchParams(location.search).get("space") || "";
  const selectedSpace = selectedSpaceId ? spaceById(selectedSpaceId) : null;
  const scopedTasks = selectedSpaceId ? tasks.filter((task) => task.spaceId === selectedSpaceId) : tasks;
  const activeCount = scopedTasks.filter((task) => storylineOf(task).status !== "completed").length;
  const runningCount = scopedTasks.filter((task) => taskJobs(task.id).some((job) => job.status === "queued" || job.status === "running")).length;
  const priority = scopedTasks.find((task) => storylineOf(task).status === "active") || scopedTasks[0];
  $("#content").innerHTML = `${selectedSpace ? `<div class="context-bar"><div><span>工作空间</span><strong>${escapeHtml(selectedSpace.title)}</strong></div><a href="/tasks">查看全部任务</a></div>` : ""}<div class="toolbar"><input id="filterInput" type="search" placeholder="搜索任务…"><div class="toolbar-actions"><a class="button" href="/spaces">工作空间</a><button class="primary" id="newTask">新建任务</button></div></div>
    <div class="task-overview"><span><strong>${activeCount} 项</strong>正在推进${runningCount ? ` · ${runningCount} 项正在协作` : ""}</span><span>${priority ? `优先下一步：${escapeHtml(storylineOf(priority).nextAction)}` : "从聊天或能力页开始，长期工作再留到这里。"}</span></div>
    <div class="list" id="taskList"></div>`;
  const draw = () => {
    const query = $("#filterInput").value.trim().toLowerCase();
    const visible = scopedTasks.filter((task) => `${task.title} ${task.instruction}`.toLowerCase().includes(query));
    $("#taskList").innerHTML = visible.length ? visible.map(renderTaskCard).join("") : `<div class="empty">${selectedSpace ? "这个空间还没有任务。新建或编辑任务时可以归入这里。" : "还没有符合条件的任务。"}</div>`;
  };
  draw();
  $("#filterInput").addEventListener("input", draw);
  $("#newTask").onclick = () => openTaskDialog();
  $("#taskList").onclick = async (event) => {
    const run = event.target.closest("[data-run-task]");
    const continueTask = event.target.closest("[data-continue-task]");
    const story = event.target.closest("[data-open-story]");
    const edit = event.target.closest("[data-edit-task]");
    const promote = event.target.closest("[data-promote-task]");
    const toggle = event.target.closest("[data-toggle-task]");
    const remove = event.target.closest("[data-delete-task]");
    if (run) return runTask(run.dataset.runTask);
    if (continueTask) return continueOneOffTask(tasks.find((item) => item.id === continueTask.dataset.continueTask));
    if (story) return openStoryline(tasks.find((item) => item.id === story.dataset.openStory));
    if (edit) return openTaskDialog(tasks.find((item) => item.id === edit.dataset.editTask));
    if (promote) return openTaskDialog(tasks.find((item) => item.id === promote.dataset.promoteTask), true);
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

function renderSpaceRow(space) {
  const tasks = (state.snapshot?.tasks || []).filter((task) => task.spaceId === space.id);
  const artifacts = state.snapshot?.artifacts || [];
  const resultCount = artifacts.filter((artifact) => tasks.some((task) => task.id === artifact.taskId)).length;
  const nextTask = tasks.find((task) => storylineOf(task).status === "active") || tasks[0];
  return `<article class="space-row">
    <a class="space-main" href="/tasks?space=${encodeURIComponent(space.id)}">
      <div class="space-mark" aria-hidden="true"></div>
      <div><h2>${escapeHtml(space.title)}</h2><p>${escapeHtml(space.description || "尚未填写目标说明")}</p></div>
    </a>
    <div class="space-progress"><span>${tasks.length} 个任务 · ${resultCount} 个结果</span><strong>${nextTask ? escapeHtml(storylineOf(nextTask).nextAction) : "先添加第一个任务"}</strong></div>
    <div class="actions"><a href="/tasks?space=${encodeURIComponent(space.id)}">查看任务</a><button data-edit-space="${space.id}">编辑</button><button data-archive-space="${space.id}">归档</button></div>
  </article>`;
}

function renderSpaces() {
  const spaces = state.snapshot?.spaces || [];
  const active = spaces.filter((space) => space.status !== "archived");
  const archived = spaces.filter((space) => space.status === "archived");
  $("#content").innerHTML = `<div class="toolbar space-toolbar"><p>单个任务无需建空间；同一件事出现多个任务时再归档。</p>${active.length ? '<button class="primary" id="newSpace">新建工作空间</button>' : ""}</div>
    <div class="space-list" id="spaceList">${active.length ? active.map(renderSpaceRow).join("") : `<div class="space-empty"><span>01</span><h2>先从任务开始</h2><p>当一件工作包含多个任务、结果或决定时，再建立工作空间把它们放在一起。</p><button class="primary" data-create-first-space>新建第一个工作空间</button></div>`}</div>
    ${archived.length ? `<details class="archived-spaces"><summary>${archived.length} 个已归档空间</summary><div>${archived.map((space) => `<div class="archived-space"><span><strong>${escapeHtml(space.title)}</strong><small>${escapeHtml(space.description || "无说明")}</small></span><button data-restore-space="${space.id}">恢复</button></div>`).join("")}</div></details>` : ""}`;
  $("#newSpace")?.addEventListener("click", () => openSpaceDialog());
  $("[data-create-first-space]")?.addEventListener("click", () => openSpaceDialog());
  $("#content").onclick = async (event) => {
    const edit = event.target.closest("[data-edit-space]");
    const archive = event.target.closest("[data-archive-space]");
    const restore = event.target.closest("[data-restore-space]");
    if (edit) return openSpaceDialog(spaceById(edit.dataset.editSpace));
    if (archive && confirm("归档这个工作空间？其中的任务和结果会保留。")) return setSpaceStatus(archive.dataset.archiveSpace, "archived");
    if (restore) return setSpaceStatus(restore.dataset.restoreSpace, "active");
  };
}

async function continueOneOffTask(task) {
  const artifact = taskArtifact(task);
  if (!artifact) return toast("还没有可以继续处理的结果");
  const context = await api(`/api/capabilities/artifact/context?id=${encodeURIComponent(artifact.id)}`);
  sessionStorage.setItem("clownfish-capability-handoff-v1", JSON.stringify({
    createdAt: Date.now(),
    source: task.origin?.kind === "chat" ? "chat" : "capability",
    sourceTaskId: task.id,
    conversationKey: task.origin?.conversationKey || "",
    chatName: "原任务",
    goal: task.instruction,
    summary: `继续处理「${task.title}」的已有结果。`,
    materials: [{
      name: `${artifactDisplayTitle(artifact)}-已有结果.md`,
      size: new Blob([context.text || ""]).size,
      text: context.text || "",
      kind: "handoff",
    }],
    returnTo: "/tasks",
  }));
  location.href = "/capabilities";
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
  }
  $("#expertSummary").innerHTML = story.experts?.length
    ? story.experts.map((item) => `<span class="pill">专业检查 · ${escapeHtml(item.responsibility)}</span>`).join("")
    : '<span class="field-hint">尚未启动专家协作；普通任务会直接由小丑鱼完成。</span>';
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

function openTaskDialog(task, promote = false) {
  const abilities = publicAbilities();
  const spaces = (state.snapshot?.spaces || []).filter((space) => space.status === "active");
  const requestedSpaceId = task?.spaceId || new URLSearchParams(location.search).get("space") || "";
  $("#taskCapability").innerHTML = `<option value="" disabled>请选择能力</option>${abilities.map((ability) => `<option value="${escapeHtml(ability.id)}">${escapeHtml(ability.name)}</option>`).join("")}`;
  $("#taskSpace").innerHTML = `<option value="">暂不归类</option>${spaces.map((space) => `<option value="${escapeHtml(space.id)}">${escapeHtml(space.title)}</option>`).join("")}`;
  $("#taskId").value = task?.id || "";
  $("#taskTitle").value = task?.title || "";
  $("#taskInstruction").value = task?.instruction || "";
  $("#taskCapability").value = task?.capabilityId || "";
  $("#taskSpace").value = spaces.some((space) => space.id === requestedSpaceId) ? requestedSpaceId : "";
  $("#taskFormat").value = task?.format || abilities.find((item) => item.id === $("#taskCapability").value)?.defaultFormat || "html";
  $("#taskSchedule").value = task?.schedule?.mode || "manual";
  $("#taskTime").value = task?.schedule?.time || "09:00";
  const selectedKnowledge = new Set(task?.knowledgeIds || []);
  $("#taskKnowledge").innerHTML = state.knowledge.filter((item) => !item.archivedAt).length
    ? state.knowledge.filter((item) => !item.archivedAt).map((item) => `<label><input type="checkbox" value="${escapeHtml(item.id)}" ${selectedKnowledge.has(item.id) ? "checked" : ""}><span>${escapeHtml(item.title)}<small>${escapeHtml(item.excerpt || "")}</small></span></label>`).join("")
    : '<span class="resource-empty">资料库还是空的，可先到“资料”页添加。</span>';
  if (promote) $("#taskSchedule").value = "daily";
  $("#taskId").dataset.promote = promote ? "true" : "";
  $("#taskDialogTitle").textContent = promote ? "设为重复任务" : task ? "编辑任务" : "新建任务";
  updateScheduleField(task?.schedule?.everyTurns || 10, task?.schedule?.time || "09:00");
  $("#taskDialog").showModal();
}

function updateScheduleField(turns = 10, time = "09:00") {
  const mode = $("#taskSchedule").value;
  const label = $("#scheduleDetail");
  if (mode === "turns") label.innerHTML = `对话次数<input id="taskTurns" type="number" min="1" max="1000" value="${turns}">`;
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
    spaceId: $("#taskSpace").value || null,
    knowledgeIds: $$('#taskKnowledge input:checked').slice(0, 8).map((input) => input.value),
    promote: $("#taskId").dataset.promote === "true",
    schedule: mode === "daily" ? { mode, time: $("#taskTime")?.value || "09:00", timezone: "Asia/Shanghai" } : mode === "turns" ? { mode, everyTurns: Number($("#taskTurns")?.value || 10) } : { mode },
  };
  await api("/api/capabilities/task", { method: "POST", body: JSON.stringify(body) });
  $("#taskDialog").close();
  toast("任务已保存");
  await load();
}

function openSpaceDialog(space) {
  $("#spaceId").value = space?.id || "";
  $("#spaceTitle").value = space?.title || "";
  $("#spaceDescription").value = space?.description || "";
  $("#spaceDialogTitle").textContent = space ? "编辑工作空间" : "新建工作空间";
  $("#spaceDialog").showModal();
}

async function saveSpace() {
  const result = await api("/api/capabilities/space", {
    method: "POST",
    body: JSON.stringify({
      id: $("#spaceId").value || undefined,
      title: $("#spaceTitle").value.trim(),
      description: $("#spaceDescription").value.trim(),
    }),
  });
  state.snapshot = result.snapshot;
  $("#spaceDialog").close();
  toast("工作空间已保存");
  renderSpaces();
}

async function setSpaceStatus(id, status) {
  const result = await api("/api/capabilities/space", { method: "POST", body: JSON.stringify({ id, status }) });
  state.snapshot = result.snapshot;
  toast(status === "archived" ? "工作空间已归档" : "工作空间已恢复");
  renderSpaces();
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

function runDisplayTitle(run) {
  const objective = String(run?.metadata?.objective || "").trim();
  if (objective) return objective.slice(0, 60);
  const output = String(run?.output || "").replace(/\s+/g, " ").trim();
  if (output) return `对话 · ${output.slice(0, 34)}${output.length > 34 ? "…" : ""}`;
  return run?.metadata?.mode === "task" ? "任务执行" : "对话记录";
}

function renderAutomations() {
  const tasks = (state.snapshot?.tasks || []).filter((task) => !task.oneOff && task.schedule?.mode !== "manual");
  const rows = tasks.map((task) => `<article class="compact-row">
    <div><h3 class="automation-state ${task.enabled ? "" : "is-paused"}">${escapeHtml(task.title)}</h3><p>${escapeHtml(scheduleLabel(task))} · ${escapeHtml(abilityName(task.capabilityId))}${task.lastRunAt ? ` · 上次 ${date(task.lastRunAt)}` : " · 尚未运行"}</p></div>
    <div class="actions"><button data-run-automation="${task.id}">立即运行</button><button data-edit-automation="${task.id}">编辑</button><button data-toggle-automation="${task.id}">${task.enabled ? "暂停" : "启用"}</button></div>
  </article>`).join("");
  $("#content").innerHTML = `<section class="platform-panel"><header><div><h2>自动执行的工作</h2><p>只有你明确设置频率的任务会出现在这里。</p></div><button class="primary" id="newAutomation">新建自动化</button></header><div class="compact-list">${rows || '<div class="resource-empty">还没有自动化。适合从日报、定期整理和固定检查开始。</div>'}</div></section>`;
  $("#newAutomation").onclick = () => { openTaskDialog(); $("#taskSchedule").value = "daily"; updateScheduleField(10, "09:00"); };
  $("#content").onclick = async (event) => {
    const run = event.target.closest("[data-run-automation]");
    const edit = event.target.closest("[data-edit-automation]");
    const toggle = event.target.closest("[data-toggle-automation]");
    if (run) return runTask(run.dataset.runAutomation);
    const task = tasks.find((item) => item.id === (edit?.dataset.editAutomation || toggle?.dataset.toggleAutomation));
    if (edit) return openTaskDialog(task);
    if (toggle && task) return saveTask({ ...task, enabled: !task.enabled });
  };
}

function collaborationJob(taskId) {
  return taskJobs(taskId).find((job) => job.type === "orchestration");
}

function renderCollaboration() {
  const tasks = (state.snapshot?.tasks || []).filter((task) => !task.oneOff && storylineOf(task).status !== "completed");
  const rows = tasks.map((task) => {
    const job = collaborationJob(task.id);
    const working = job && ["queued", "running"].includes(job.status);
    return `<article class="compact-row"><div><h3>${escapeHtml(task.title)}</h3><p>${job ? `最近协作：${escapeHtml(jobStatusLabel(job.status))} · ${date(job.updatedAt || job.createdAt)}` : `${escapeHtml(abilityName(task.capabilityId))} · 尚未组织专家协作`}</p></div><div class="actions">${working ? '<span class="pill warn">小丑鱼正在组织</span>' : `<button class="primary" data-collaborate="${task.id}">组织协作</button>`}<button data-open-collaboration-story="${task.id}">查看脉络</button></div></article>`;
  }).join("");
  $("#content").innerHTML = `<section class="collaboration-hero"><div><h2>只在任务需要时调用专家</h2><p>你只需要说明目标。小丑鱼会为每次任务重新挑选专家并行检查，再把意见合并为一个可用结果；专家不会取代小丑鱼成为新的操作入口。</p></div><a class="button" href="/tasks">查看全部任务</a></section><section class="platform-panel"><header><div><h2>可组织的任务</h2><p>简单任务直接运行；涉及多专业判断、开发或重要决策时再使用协作。</p></div></header><div class="compact-list">${rows || '<div class="resource-empty">当前没有需要推进的任务。</div>'}</div></section>`;
  $("#content").onclick = async (event) => {
    const start = event.target.closest("[data-collaborate]");
    const story = event.target.closest("[data-open-collaboration-story]");
    if (story) return openStoryline(tasks.find((item) => item.id === story.dataset.openCollaborationStory));
    if (!start) return;
    try {
      await api("/api/capabilities/task/collaborate", { method: "POST", body: JSON.stringify({ id: start.dataset.collaborate }) });
      toast("小丑鱼已开始组织协作");
      await load();
    } catch (error) { toast(error.message, true); }
  };
}

function resourceKindLabel(kind) {
  return { note: "文字笔记", file: "文本文件", link: "网页链接" }[kind] || "资料";
}

function connectionCards() {
  const sources = state.sources?.sources || {};
  const wechat = sources.wechat || {};
  const x = sources.x || {};
  return [
    '<article class="connection-card"><strong>本地资料</strong><small>可直接使用；内容只保存在本机。</small></article>',
    `<article class="connection-card"><strong>微信资料</strong><small>${wechat.enabled ? `已启用 · 最近 ${wechat.recentFiles || 0} 个文件` : "未启用"}</small></article>`,
    `<article class="connection-card"><strong>X 资料</strong><small>${state.sources?.savedXToken || x.hasBearerToken || x.hasUserAccessToken ? "已连接" : x.enabled ? "已启用，尚未连接账号" : "未启用"}</small></article>`,
    '<article class="connection-card"><strong>联网搜索</strong><small>仅在已连接的模型或搜索工具可用时执行，不把网页摘要当作最终证据。</small></article>',
  ].join("");
}

function platformCards() {
  const labels = { ready: "已连接", available: "已安装，未启用", "not-installed": "未安装" };
  return (state.platform?.connectors || []).map((item) => `<article class="connection-card"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(labels[item.state] || item.state)} · ${escapeHtml(item.purpose)}</small></article>`).join("");
}

function extensionRows() {
  if (!state.extensions.length) return '<div class="resource-empty">还没有安装扩展。连接器安装后会在这里统一管理。</div>';
  return state.extensions.map((item) => `<article class="compact-row"><div><h3>${escapeHtml(item.manifest?.name || item.manifest?.id || "未命名扩展")}</h3><p>${escapeHtml(item.manifest?.version || "")} · ${item.enabled ? "正在使用" : "已停用"}${item.runtimeError ? ` · ${escapeHtml(item.runtimeError)}` : ""}</p></div><div class="actions"><button data-toggle-extension="${escapeHtml(item.manifest.id)}" data-enabled="${item.enabled ? "1" : "0"}">${item.enabled ? "停用" : "启用"}</button><button data-uninstall-extension="${escapeHtml(item.manifest.id)}">卸载</button></div></article>`).join("");
}

function capabilityPackRows() {
  return (state.platform?.capabilityPacks || []).map((pack) => `<article class="compact-row"><div><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.quality.join(" · "))}</p></div><span class="pill">${pack.abilities.length} 项能力</span></article>`).join("");
}

function developmentReadiness() {
  const tools = state.platform?.development || {};
  const names = { node: "Node.js", git: "Git", python: "Python" };
  return Object.entries(tools).map(([id, item]) => `<article class="connection-card"><strong>${names[id] || id}</strong><small>${item.available ? escapeHtml(item.version) : "未安装；相关检查会明确跳过"}</small></article>`).join("");
}

function renderResources() {
  const active = state.knowledge.filter((item) => !item.archivedAt);
  const archived = state.knowledge.filter((item) => item.archivedAt);
  const rows = active.map((item) => `<article class="compact-row"><div><span class="resource-kind">${resourceKindLabel(item.kind)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.excerpt || item.sourceUrl || "无文字摘要")} · ${item.characterCount || 0} 字</p></div><div class="actions"><button data-preview-resource="${item.id}">查看</button><button data-archive-resource="${item.id}">归档</button></div></article>`).join("");
  $("#content").innerHTML = `<div class="platform-grid"><section class="platform-panel"><header><div><h2>任务资料</h2><p>需要时明确选入任务，不会默认把所有内容都塞给模型。</p></div><button class="primary" id="newKnowledge">添加资料</button></header><div class="compact-list">${rows || '<div class="resource-empty">还没有资料。可以添加笔记、文本文件或网页链接。</div>'}</div>${archived.length ? `<details><summary>${archived.length} 项已归档资料</summary><div class="compact-list">${archived.map((item) => `<article class="compact-row"><div><h3>${escapeHtml(item.title)}</h3></div><button data-restore-resource="${item.id}">恢复</button></article>`).join("")}</div></details>` : ""}</section><section class="platform-panel"><header><div><h2>数据连接</h2><p>只有扩展真实启用后才显示为已连接。</p></div></header><div class="connection-grid">${connectionCards()}${platformCards()}</div><header class="subsection-head"><div><h2>开发环境</h2><p>开发能力会先检查这些本机工具，不要求新手打开命令行。</p></div></header><div class="connection-grid">${developmentReadiness()}</div></section><section class="platform-panel"><header><div><h2>领域能力包</h2><p>按工作类型组合能力、结果形式和交付检查。</p></div></header><div class="compact-list">${capabilityPackRows()}</div></section><section class="platform-panel"><header><div><h2>能力扩展</h2><p>在一处查看、启用、停用和卸载；权限扩大时仍需单独确认。</p></div></header><div class="compact-list">${extensionRows()}</div></section></div>`;
  $("#newKnowledge").onclick = openKnowledgeDialog;
  $("#content").onclick = async (event) => {
    const preview = event.target.closest("[data-preview-resource]");
    const archive = event.target.closest("[data-archive-resource]");
    const restore = event.target.closest("[data-restore-resource]");
    const toggleExtension = event.target.closest("[data-toggle-extension]");
    const uninstallExtension = event.target.closest("[data-uninstall-extension]");
    if (toggleExtension) {
      await api("/api/agent/extension/enabled", { method: "POST", body: JSON.stringify({ id: toggleExtension.dataset.toggleExtension, enabled: toggleExtension.dataset.enabled !== "1" }) });
      await load();
      return;
    }
    if (uninstallExtension && confirm("卸载这个扩展？本地资料不会删除，但它提供的工具会立即停止。")) {
      await api("/api/agent/extension/uninstall", { method: "POST", body: JSON.stringify({ id: uninstallExtension.dataset.uninstallExtension }) });
      await load();
      return;
    }
    if (preview) {
      const result = await api(`/api/knowledge?id=${encodeURIComponent(preview.dataset.previewResource)}`);
      alert(`${result.item.title}\n\n${result.item.content || result.item.sourceUrl || ""}`);
    }
    if (archive && confirm("归档这份资料？已有任务中的引用会暂时失效，但资料可以恢复。")) {
      await api("/api/knowledge/archive", { method: "POST", body: JSON.stringify({ id: archive.dataset.archiveResource }) });
      await load();
    }
    if (restore) {
      await api("/api/knowledge/restore", { method: "POST", body: JSON.stringify({ id: restore.dataset.restoreResource }) });
      await load();
    }
  };
}

function openKnowledgeDialog() {
  const spaces = (state.snapshot?.spaces || []).filter((space) => space.status === "active");
  $("#knowledgeForm").reset();
  $("#knowledgeSpace").innerHTML = `<option value="">暂不归类</option>${spaces.map((space) => `<option value="${escapeHtml(space.id)}">${escapeHtml(space.title)}</option>`).join("")}`;
  updateKnowledgeFields();
  $("#knowledgeDialog").showModal();
}

function updateKnowledgeFields() {
  const kind = $("#knowledgeKind").value;
  $("#knowledgeUrlField").hidden = kind !== "link";
  $("#knowledgeFileField").hidden = kind !== "file";
}

function renderArtifactCard(item) {
  const version = Number(item.metadata?.lineage?.version || 1);
  const previousId = String(item.metadata?.lineage?.previousArtifactId || "");
  return `<article class="card"><div><h2>${escapeHtml(artifactDisplayTitle(item))}</h2><p>${escapeHtml(item.summary || "已生成结果")}</p><div class="meta"><span class="pill ok">已完成</span><span class="pill">${escapeHtml(abilityName(item.capabilityId))}</span><span class="pill">${escapeHtml(String(item.format).toUpperCase())}</span>${version > 1 ? `<span class="pill">第 ${version} 版</span>` : ""}<span class="pill">${date(item.createdAt)}</span></div></div><div class="actions"><a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.id)}" target="_blank">预览</a>${previousId ? `<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(previousId)}" target="_blank">上一版</a>` : ""}<a href="/api/capabilities/artifact?id=${encodeURIComponent(item.id)}" download>下载</a><button data-feedback-useful="${item.id}">有帮助</button><button data-feedback-improve="${item.id}">需改进</button></div></article>`;
}

function renderArtifacts() {
  const artifacts = state.snapshot?.artifacts || [];
  $("#content").innerHTML = `<div class="toolbar"><input id="filterInput" placeholder="搜索结果"><a class="button" href="/office">打开办公文件</a></div><div class="list" id="artifactList"></div>`;
  const draw = () => {
    const query = $("#filterInput").value.trim().toLowerCase();
    const visible = artifacts.filter((item) => `${item.title} ${item.summary}`.toLowerCase().includes(query));
    $("#artifactList").innerHTML = visible.length ? visible.map(renderArtifactCard).join("") : '<div class="empty">完成能力任务后，结果会自动出现在这里。</div>';
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
  const assignments = tasks.map((task) => '<span class="pill">' + escapeHtml(task.metadata?.role === "reviewer" || task.metadata?.personaId === "clownfish" ? "小丑鱼最终复核" : task.title || "专业检查") + '</span>').join("");
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
  const runCards = runs.slice(0, 20).map((run) => `<article class="card"><div><h2>${escapeHtml(runDisplayTitle(run))}</h2><p>${escapeHtml(run.output?.slice(0, 180) || run.error || "已保存执行记录，需要时可以恢复或排查。")}</p><div class="meta"><span class="pill ${statusPill(run.status)}">${escapeHtml(jobStatusLabel(run.status))}</span><span class="pill">${date(run.updatedAt || run.createdAt)}</span></div></div><div class="actions">${["interrupted", "paused", "failed"].includes(run.status) ? `<button data-resume-run="${run.runId}">恢复</button>` : ""}</div></article>`).join("");
  const reviewCards = state.reviewQueue.map((item) => `<article class="compact-row"><div><span class="resource-kind">${item.kind === "approval" ? "等待确认" : item.kind === "development-proposal" ? "修改待审" : "运行异常"}</span><h3>${escapeHtml(item.title)}</h3><p>${date(item.at)}</p></div><a class="button" href="${item.kind === "development-proposal" ? `/api/development/proposal/preview?id=${encodeURIComponent(item.sourceId)}` : item.kind === "approval" ? "/runs" : `/api/agent/job?id=${encodeURIComponent(item.sourceId)}`}">查看</a></article>`).join("");
  $("#content").innerHTML = `<section class="platform-panel review-queue"><header><div><h2>待你审阅</h2><p>只集中展示需要决定或人工核对的事项；普通后台任务不会打扰你。</p></div><span class="pill ${state.reviewQueue.length ? "warn" : "ok"}">${state.reviewQueue.length} 项</span></header><div class="compact-list">${reviewCards || '<div class="resource-empty">当前没有需要你处理的事项。</div>'}</div></section><div class="toolbar"><span></span><button id="refreshRuns">刷新</button></div><div class="list">${jobCards || runCards ? jobCards + runCards : '<div class="empty">还没有运行记录。</div>'}</div>`;
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
$("#taskCapability").addEventListener("change", () => {
  const ability = publicAbilities().find((item) => item.id === $("#taskCapability").value);
  if (ability?.defaultFormat) $("#taskFormat").value = ability.defaultFormat;
});
$("#taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveTask(); } catch (error) { toast(error.message, true); }
});
$("#spaceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveSpace(); } catch (error) { toast(error.message, true); }
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
$("#knowledgeKind").addEventListener("change", updateKnowledgeFields);
$("#knowledgeFile").addEventListener("change", async () => {
  const file = $("#knowledgeFile").files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    $("#knowledgeFile").value = "";
    return toast("文本资料不能超过 2 MB", true);
  }
  $("#knowledgeTitle").value ||= file.name.replace(/\.[^.]+$/, "");
  $("#knowledgeContent").value = await file.text();
});
$("#knowledgeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#knowledgeFile").files?.[0];
  try {
    await api("/api/knowledge", { method: "POST", body: JSON.stringify({
      title: $("#knowledgeTitle").value.trim(),
      kind: $("#knowledgeKind").value,
      content: $("#knowledgeContent").value,
      sourceUrl: $("#knowledgeUrl").value.trim(),
      fileName: file?.name,
      mimeType: file?.type,
      spaceId: $("#knowledgeSpace").value || undefined,
    }) });
    $("#knowledgeDialog").close();
    toast("资料已保存");
    await load();
  } catch (error) { toast(error.message, true); }
});
$$('[data-close-dialog]').forEach((button) => button.onclick = () => $("#taskDialog").close());
$('[data-close-space]').onclick = () => $("#spaceDialog").close();
$('[data-close-knowledge]').onclick = () => $("#knowledgeDialog").close();
$("[data-close-story]").onclick = () => $("#storyDialog").close();
$("#storyDialog").addEventListener("close", () => { activeStoryTaskId = ""; });

let agentRefreshTimer;
let agentEventSource;
function queueAgentRefresh() {
  if (view !== "tasks" && view !== "runs" && view !== "automations" && view !== "collaboration") return;
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
