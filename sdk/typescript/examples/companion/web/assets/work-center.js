const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const workViews = new Set(["tasks", "spaces", "automations", "collaboration", "resources", "artifacts", "runs", "memory"]);
const viewFromLocation = () => window.ClownfishNavigation.workView();
let view;
const state = { snapshot: null, jobs: [], runs: [], memories: [], knowledge: [], sources: null, platform: null, extensions: [], reviewQueue: [], reviewGroups: [], approvals: [], sessionGrants: [], relationshipMemory: null, productReviews: [], productReviewSummary: null };
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
  tasks: ["流程管理", "流程管理", "管理此流程的配置与操作；日常进度、处理过程和成果统一在任务工作区查看。"],
  spaces: ["多个任务，一件事情", "项目", "把相关任务、结果和决定放在一起；工作变复杂时再创建。"],
  automations: ["按计划完成", "自动化", "把固定频率的工作交给小丑鱼；随时暂停，也可以立即运行。"],
  collaboration: ["流程设置", "流程协作设置", "保留原有组织协作操作；处理过程与成果统一在对应任务详情中查看。"],
  resources: ["任务所需的上下文", "参考资料", "保存本地笔记、文本和链接，并在执行任务时明确选择。"],
  artifacts: ["文件", "文件", "资料、成果与编辑副本，在这里找回并继续使用。"],
  runs: ["高级排错", "运行日志", "查看后台工作、失败原因和中断后可恢复的执行。"],
  memory: ["由你控制", "记忆", "已记住的事实、经历与习惯，以及等待你确认的学习提议。你可以随时修正、不学习或忘记。"],
};

function setPage() {
  const copy = pageCopy[view] || pageCopy.automations;
  $("#pageEyebrow").textContent = copy[0];
  const pageTitle = $("#pageTitle");
  if (pageTitle) pageTitle.textContent = copy[1];
  $("#pageDescription").textContent = copy[2];
  $$('.tabs a').forEach((link) => {
    const current = link.dataset.view === view;
    link.classList.toggle("is-current", current);
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `${copy[1]} · 小丑鱼`;
  const createLabel={spaces:"新建项目",automations:"新建自动化",resources:"添加资料"}[view];
  const createButton=$("#newTaskSide");createButton.hidden=!createLabel;
  createButton.querySelector('span:last-child').textContent=createLabel || '新建';
  createButton.setAttribute('aria-label',createLabel || '新建');createButton.title=createLabel || '新建';
  $("#workStartTask").hidden=view!=="tasks";
  $("#workSearchToggle").hidden=view==="memory"||view==="artifacts";
  window.ClownfishNavigation.sync();
  $("#workSearchEyebrow").textContent = copy[1];
  $("#workSearchTitle").textContent = `搜索${copy[1]}`;
  $("#workSearch").placeholder = `输入${copy[1]}名称或内容`;
  $("#workSearchToggle .app-search-label").textContent = `搜索${copy[1]}`;
  updatePrimaryWorkNavigation();
}

function updatePrimaryWorkNavigation() {
  const projectLink = $("#projectsViewLink");
  if (!projectLink) return;
  const spaces = state.snapshot?.spaces || [];
  const longRunningTasks = (state.snapshot?.tasks || []).filter((task) => !task.oneOff);
  projectLink.hidden = view !== "spaces" && spaces.length === 0 && longRunningTasks.length < 2;
}

function workSearchEntries() {
  if (view === "tasks" || view === "automations" || view === "collaboration") {
    return (state.snapshot?.tasks || []).map((item) => ({ id: item.id, kind: "task", title: item.title || "未命名任务", summary: item.instruction || storylineOf(item).nextAction || "查看任务", meta: view === "automations" ? "自动化" : view === "collaboration" ? "协作任务" : "任务" }));
  }
  if (view === "spaces") return (state.snapshot?.spaces || []).map((item) => ({ id: item.id, kind: "space", title: item.title || "未命名项目", summary: item.description || "查看项目中的任务", meta: "项目" }));
  if (view === "resources") return state.knowledge.map((item) => ({ id: item.id, kind: "resource", title: item.title || "未命名资料", summary: item.excerpt || item.sourceUrl || "查看资料", meta: item.archivedAt ? "已归档" : "资料" }));
  if (view === "artifacts") return (state.snapshot?.artifacts || []).map((item) => ({ id: item.id, kind: "artifact", title: artifactDisplayTitle(item), summary: item.summary || "预览结果", meta: String(item.format || "结果").toUpperCase() }));
  if (view === "runs") {
    return [...state.jobs.map((item) => ({ id: item.id, kind: "run", title: item.payload?.title || item.type || "后台任务", summary: item.result?.summary || item.error || "查看运行记录", meta: jobStatusLabel(item.status) })), ...state.runs.map((item) => ({ id: item.runId, kind: "run", title: runDisplayTitle(item), summary: item.output || item.error || "查看运行记录", meta: jobStatusLabel(item.status) }))];
  }
  return state.memories.map((item) => ({ id: item.id, kind: "memory", title: item.content || "记忆", summary: layerNames[item.layer] || "整理后的记忆", meta: "记忆" }));
}

function renderWorkSearchResults(queryText) {
  const query = String(queryText || "").trim().toLowerCase();
  const entries = workSearchEntries().filter((item) => !query || `${item.title} ${item.summary} ${item.meta}`.toLowerCase().includes(query));
  $("#workSearchResults").innerHTML = entries.length ? entries.slice(0, 80).map((item) => `<button class="app-search-result" type="button" role="option" data-work-search-kind="${escapeHtml(item.kind)}" data-work-search-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(String(item.summary).slice(0, 120))}</small></span><small>${escapeHtml(item.meta)}</small></button>`).join("") : '<div class="app-search-empty">没有找到匹配的内容</div>';
}

function showLoading() {
  const content = $("#content");
  content.setAttribute("aria-busy", "true");
  content.innerHTML = '<div class="loading" role="status" aria-label="正在读取本机数据"><span class="cf-skeleton"></span><span class="cf-skeleton is-mid"></span><span class="cf-skeleton is-short"></span></div>';
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
      const [snapshot, jobs, knowledge, review] = await Promise.all([api("/api/capabilities"), api("/api/agent/jobs?limit=100"), api("/api/knowledge"), api("/api/review-queue")]);
      result = { snapshot, jobs: jobs.jobs || [], knowledge: knowledge.items || [], review };
    }
    if (requestedView === "resources") {
      const [snapshot, knowledge, sources, platform, extensions] = await Promise.all([api("/api/capabilities"), api("/api/knowledge?archived=1"), api("/api/sources"), api("/api/platform/readiness"), api("/api/agent/extensions")]);
      result = { snapshot, knowledge: knowledge.items || [], sources, platform, extensions: extensions.extensions || [] };
    }
    if (requestedView === "artifacts") {
      const reads=await Promise.allSettled([api("/api/capabilities"),api("/api/files/workbench"),api("/api/knowledge")]);
      result={snapshot:reads[0].status==='fulfilled'?reads[0].value:state.snapshot||{artifacts:[]},documents:reads[1].status==='fulfilled'?reads[1].value.state?.documents||[]:state.documents||[],knowledge:reads[2].status==='fulfilled'?reads[2].value.items||[]:state.knowledge||[],warnings:reads.flatMap((r,i)=>r.status==='rejected'?[[ '成果','本机文件','参考资料'][i]+'暂时无法刷新；如有已加载内容会继续保留，其他来源仍可查看']:[])};
    }
    if (requestedView === "runs") {
      const [jobs, runs, reviewQueue, productReviews, approvals] = await Promise.all([api("/api/agent/jobs?limit=1000"), api("/api/agent/runs?limit=500"), api("/api/review-queue"), api("/api/product-reviews"), api("/api/agent/approvals?status=pending&limit=500")]);
      result = { jobs: jobs.jobs || [], runs: runs.runs || [], reviewQueue: reviewQueue.items || [], review: reviewQueue, approvals: approvals.approvals || [], sessionGrants: approvals.sessionGrants || [], productReviews: productReviews.runs || [], productReviewSummary: productReviews.summary || null };
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
    if (result?.review) {
      state.reviewQueue = result.review.items || [];
      state.reviewGroups = result.review.groups || [];
      state.relationshipMemory = result.review.relationshipMemory;
    }
    if (requestedView === "resources") {
      state.snapshot = result.snapshot;
      state.knowledge = result.knowledge;
      state.sources = result.sources;
      state.platform = result.platform;
      state.extensions = result.extensions;
    }
    if (requestedView === "artifacts") {state.snapshot=result.snapshot;state.documents=result.documents;state.knowledge=result.knowledge;state.fileWarnings=result.warnings;}
    if (requestedView === "runs") {
      state.jobs = result.jobs;
      state.runs = result.runs;
      state.reviewQueue = result.reviewQueue;
      state.approvals = result.approvals;
      state.sessionGrants = result.sessionGrants || [];
      state.productReviews = result.productReviews;
      state.productReviewSummary = result.productReviewSummary;
    }
    if (requestedView === "memory") state.memories = result;
    loadedViews.add(requestedView);
    render();
    if(requestedView==='resources'&&new URLSearchParams(location.search).get('create')==='1'){
      const next=new URL(location.href);next.searchParams.delete('create');history.replaceState(null,'',next.pathname+next.search+next.hash);openKnowledgeDialog();
    }
    if (location.hash.startsWith("#review-") || location.hash.startsWith("#record-")) {
      try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "nearest" }); } catch { /* Invalid external fragment. */ }
    }
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
  if (!workViews.has(nextView)) return;
  view = nextView;
  if (historyMode === "push") history.pushState({ workView: view }, "", `/${view}`);
  setPage();
  showLoading();
  void load();
}

$(".tabs")?.addEventListener("click", (event) => {
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
    "meeting-minutes": "整理会议纪要", "html-report": "做网页报告",
    "decision-brief": "比较方案", "business-deal": "推进商务合作", "market-opportunity": "模拟市场机会",
    "ability-builder": "生成新能力",
  };
  return labels[id] || state.snapshot?.abilities?.find((item) => item.id === id)?.name || id;
}

const PUBLIC_CAPABILITY_IDS = [
  "presentation-builder", "document-draft", "research-brief", "market-briefing", "thinking-workbench",
  "product-design", "meeting-minutes", "html-report", "decision-brief",
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
    office: "来自文件",
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
        ${task.spaceId ? `<a class="pill space-pill" href="/tasks?space=${encodeURIComponent(task.spaceId)}">${escapeHtml(spaceById(task.spaceId)?.title || "已归档项目")}</a>` : ""}
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
  const requestedTask=new URLSearchParams(location.search).get('task');
  const scopedTasks = tasks.filter(task=>(!selectedSpaceId||task.spaceId===selectedSpaceId)&&(!requestedTask||task.id===requestedTask));
  const activeCount = scopedTasks.filter((task) => storylineOf(task).status !== "completed").length;
  const runningCount = scopedTasks.filter((task) => taskJobs(task.id).some((job) => job.status === "queued" || job.status === "running")).length;
  const priority = scopedTasks.find((task) => storylineOf(task).status === "active") || scopedTasks[0];
  const projectEntry = (state.snapshot?.spaces || []).length || tasks.filter((task) => !task.oneOff).length >= 2 ? '<a class="button" href="/spaces">项目</a>' : "";
  $("#content").innerHTML = `${selectedSpace ? `<div class="context-bar"><div><span>项目</span><strong>${escapeHtml(selectedSpace.title)}</strong></div><a href="/tasks">查看全部任务</a></div>` : ""}<div class="toolbar"><span></span><div class="toolbar-actions">${projectEntry}</div></div>
    <div class="task-overview"><span><strong>${activeCount} 项</strong>正在推进${runningCount ? ` · ${runningCount} 项正在协作` : ""}</span><span>${priority ? `优先下一步：${escapeHtml(storylineOf(priority).nextAction)}` : "从聊天或能力页开始，长期工作再留到这里。"}</span></div>
    <div class="list" id="taskList"></div>`;
  $("#taskList").innerHTML = scopedTasks.length ? scopedTasks.map(renderTaskCard).join("") : `<div class="empty">${selectedSpace ? "这个项目还没有任务。新建或编辑任务时可以归入这里。" : "还没有任务。"}</div>`;
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
  $("#content").innerHTML = `<p class="work-list-summary">${active.length} 个项目</p>
    <div class="space-list" id="spaceList">${active.length ? active.map(renderSpaceRow).join("") : `<div class="space-empty"><h2>还没有项目</h2><p>点击“新建项目”，把同一件事的任务和成果放在一起。单个任务不必建项目。</p></div>`}</div>
    ${archived.length ? `<details class="archived-spaces"><summary>${archived.length} 个已归档项目</summary><div>${archived.map((space) => `<div class="archived-space"><span><strong>${escapeHtml(space.title)}</strong><small>${escapeHtml(space.description || "无说明")}</small></span><button data-restore-space="${space.id}">恢复</button></div>`).join("")}</div></details>` : ""}`;
  $("#content").onclick = async (event) => {
    const edit = event.target.closest("[data-edit-space]");
    const archive = event.target.closest("[data-archive-space]");
    const restore = event.target.closest("[data-restore-space]");
    if (edit) return openSpaceDialog(spaceById(edit.dataset.editSpace));
    if (archive && confirm("归档这个项目？其中的任务和结果会保留。")) return setSpaceStatus(archive.dataset.archiveSpace, "archived");
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
  const statusLabel = { candidate: "待确认", active: "当前有效", conflicted: "存在冲突", superseded: "已被后续决定替代", withdrawn: "已撤回" };
  $("#decisionList").innerHTML = decisions.length ? decisions.map((item) => {
    const confidence = Number.isFinite(item.confidence) ? ` · 可信度 ${Math.round(item.confidence * 100)}%` : "";
    const evidence = Array.isArray(item.evidenceIds) && item.evidenceIds.length ? ` · ${item.evidenceIds.length} 项依据` : "";
    return `<article class="decision-item ${item.status === "superseded" || item.status === "withdrawn" ? "is-superseded" : ""}"><strong>${escapeHtml(item.text)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}<small>${escapeHtml(statusLabel[item.status] || "当前有效")}${confidence}${evidence} · ${date(item.createdAt)}</small></article>`;
  }).join("") : '<div class="story-empty">还没有关键决定。只记录会影响后续工作的结论。</div>';
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

function keepInlineDraft(formId) {
  const host=$("#workInlineEditor");
  return !host.hidden && host.contains($("#"+formId));
}

function showWorkEditor(dialogId) {
  const forms={taskDialog:"taskForm",spaceDialog:"spaceForm",knowledgeDialog:"knowledgeForm"};
  const inline={automations:"taskDialog",spaces:"spaceDialog",resources:"knowledgeDialog"}[view]===dialogId;
  const form=$("#"+forms[dialogId]);
  form.querySelector('.work-form-error').textContent='';
  if(inline){const host=$("#workInlineEditor");host.replaceChildren(form);host.hidden=false;form.querySelector('input:not([type=hidden])')?.focus();}
  else $("#"+dialogId).showModal();
}

function closeWorkEditor(dialogId) {
  const host=$("#workInlineEditor");
  if(!host.hidden){host.hidden=true;$("#newTaskSide").focus();}
  $("#"+dialogId).close();
}

async function submitWorkForm(event, save) {
  event.preventDefault();const form=event.target;
  if(form.dataset.saving==='true')return;
  form.dataset.saving='true';form.querySelector('.work-form-error').textContent='';
  const controls=[...form.querySelectorAll('input,textarea,select,button')].filter(c=>!c.disabled);
  controls.forEach(c=>c.disabled=true);
  try{await save();}catch(error){form.querySelector('.work-form-error').textContent=error.message;}
  finally{controls.forEach(c=>c.disabled=false);form.dataset.saving='';}
}

function openTaskDialog(task, promote = false) {
  if(keepInlineDraft('taskForm')){if($('#taskForm').dataset.saving==='true')return;if(!task){$('#taskTitle').focus();return;}if(!confirm('切换编辑会替换当前未保存的内容，继续吗？'))return;}
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
  $("#taskSchedule").value = task?.schedule?.mode || (view==='automations'?'daily':'manual');
  const selectedKnowledge = new Set(task?.knowledgeIds || []);
  $("#taskKnowledge").innerHTML = state.knowledge.filter((item) => !item.archivedAt).length
    ? state.knowledge.filter((item) => !item.archivedAt).map((item) => `<label><input type="checkbox" value="${escapeHtml(item.id)}" ${selectedKnowledge.has(item.id) ? "checked" : ""}><span>${escapeHtml(item.title)}<small>${escapeHtml(item.excerpt || "")}</small></span></label>`).join("")
    : '<span class="resource-empty">资料库还是空的，可先到“资料”页添加。</span>';
  if (promote) $("#taskSchedule").value = "daily";
  $("#taskId").dataset.promote = promote ? "true" : "";
  $("#taskDialogTitle").textContent = promote ? "设为重复任务" : view==='automations' ? (task?'编辑自动化':'安排一项重复工作') : task ? "编辑任务" : "新建任务";
  updateScheduleField(task?.schedule?.everyTurns || 10, task?.schedule?.time || "09:00");
  showWorkEditor('taskDialog');
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
  const editingId=$("#taskId").value;
  const editingTask=editingId ? state.snapshot?.tasks?.find(task=>task.id===editingId) : undefined;
  if(!existing && editingId && !editingTask)throw new Error('这项任务已不可用，请刷新后重新选择。未保存任何更改。');
  const body = existing || {
    id: $("#taskId").value || undefined,
    title: $("#taskTitle").value.trim(),
    instruction: $("#taskInstruction").value.trim(),
    personaId: "clownfish",
    capabilityId: $("#taskCapability").value,
    format: $("#taskFormat").value,
    enabled: editingTask ? editingTask.enabled : true,
    spaceId: $("#taskSpace").value || null,
    knowledgeIds: $$('#taskKnowledge input:checked').slice(0, 8).map((input) => input.value),
    promote: $("#taskId").dataset.promote === "true",
    schedule: mode === "daily" ? { mode, time: $("#taskTime")?.value || "09:00", timezone: "Asia/Shanghai" } : mode === "turns" ? { mode, everyTurns: Number($("#taskTurns")?.value || 10) } : { mode },
  };
  await api("/api/capabilities/task", { method: "POST", body: JSON.stringify(body) });
  if(!existing)closeWorkEditor('taskDialog');
  toast("任务已保存");
  await load();
}

function openSpaceDialog(space) {
  if(keepInlineDraft('spaceForm')){if($('#spaceForm').dataset.saving==='true')return;if(!space){$('#spaceTitle').focus();return;}if(!confirm('切换编辑会替换当前未保存的内容，继续吗？'))return;}
  $("#spaceId").value = space?.id || "";
  $("#spaceTitle").value = space?.title || "";
  $("#spaceDescription").value = space?.description || "";
  $("#spaceDialogTitle").textContent = space ? "编辑项目" : "新建项目";
  showWorkEditor('spaceDialog');
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
  closeWorkEditor('spaceDialog');
  toast("项目已保存");
  renderSpaces();
}

async function setSpaceStatus(id, status) {
  const result = await api("/api/capabilities/space", { method: "POST", body: JSON.stringify({ id, status }) });
  state.snapshot = result.snapshot;
  toast(status === "archived" ? "项目已归档" : "项目已恢复");
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
  const requestedTask=new URLSearchParams(location.search).get('task');
  const tasks = (state.snapshot?.tasks || []).filter((task) => !task.oneOff && task.schedule?.mode !== "manual" && (!requestedTask||task.id===requestedTask));
  const rows = tasks.map((task) => `<article class="compact-row">
    <div><h3 class="automation-state ${task.enabled ? "" : "is-paused"}">${escapeHtml(task.title)}</h3><p>${escapeHtml(scheduleLabel(task))} · ${escapeHtml(abilityName(task.capabilityId))}${task.lastRunAt ? ` · 上次 ${date(task.lastRunAt)}` : " · 尚未运行"}</p></div>
    <div class="actions"><a href="/bots?task=${encodeURIComponent(task.id)}">执行记录</a><button data-run-automation="${task.id}">立即运行</button><button data-edit-automation="${task.id}">编辑</button><button data-toggle-automation="${task.id}">${task.enabled ? "暂停" : "启用"}</button></div>
  </article>`).join("");
  $("#content").innerHTML = (requestedTask?'<p><a href="/automations">← 全部自动化</a></p>':"") + `<section class="work-primary-list" aria-label="自动化计划"><p class="work-list-summary">${tasks.length} 项计划 · ${tasks.filter(task=>task.enabled).length} 项已启用 · ${tasks.filter(task=>!task.enabled).length} 项已暂停</p><div class="compact-list">${rows || '<div class="resource-empty">还没有自动化。点击“新建自动化”，设置要做的事和执行频率。</div>'}</div><p class="work-list-note">只有明确设置频率的任务会在这里显示；应用后台运行时才会按计划触发。</p></section>` + renderAttentionInbox(false);
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
  const requestedTask=new URLSearchParams(location.search).get('task');
  const tasks = (state.snapshot?.tasks || []).filter((task) => !task.oneOff && storylineOf(task).status !== "completed" && (!requestedTask||task.id===requestedTask));
  const rows = tasks.map((task) => {
    const job = collaborationJob(task.id);
    const working = job && ["queued", "running"].includes(job.status);
    return `<article class="compact-row"><div><h3>${escapeHtml(task.title)}</h3><p>${job ? `最近协作：${escapeHtml(jobStatusLabel(job.status))} · ${date(job.updatedAt || job.createdAt)}` : `${escapeHtml(abilityName(task.capabilityId))} · 尚未组织专家协作`}</p></div><div class="actions">${working ? '<span class="pill warn">小丑鱼正在组织</span>' : `<button class="primary" data-collaborate="${task.id}">组织协作</button>`}<button data-open-collaboration-story="${task.id}">查看脉络</button></div></article>`;
  }).join("");
  $("#content").innerHTML = `<details class="work-secondary-details"><summary>流程协作的使用范围</summary><div><h2>只在任务需要时调用专家</h2><p>你只需要说明目标。小丑鱼会为每次任务重新挑选专家并行检查，再把意见合并为一个可用结果；专家不会取代小丑鱼成为新的操作入口。</p></div><a class="button" href="/tasks">查看全部任务</a></details><section class="platform-panel"><header><div><h2>可组织的任务</h2><p>简单任务直接运行；涉及多专业判断、开发或重要决策时再使用协作。</p></div></header><div class="compact-list">${rows || '<div class="resource-empty">当前没有需要推进的任务。</div>'}</div></section>`;
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
    `<article class="connection-card"><strong>微信资料</strong><small>${wechat.enabled ? `已启用 · 最近 ${wechat.recentFiles || 0} 个文件` : "未启用"}</small></article>`,
    `<article class="connection-card"><strong>X 资料</strong><small>${state.sources?.savedXToken || x.hasBearerToken || x.hasUserAccessToken ? "已连接" : x.enabled ? "已启用，尚未连接账号" : "未启用"}</small></article>`,
  ].join("");
}

function platformCards() {
  const labels = { ready: "已连接", available: "已安装，未启用", "not-installed": "未安装" };
  return (state.platform?.connectors || []).map((item) => `<article class="connection-card"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(labels[item.state] || item.state)} · ${item.provider === "built-in" ? "应用内置" : "扩展连接"}</small><small>${escapeHtml(item.purpose)}</small><small>默认权限：${escapeHtml((item.minimumPermissions || []).join("、"))}</small><small>${escapeHtml(item.fallback || "")}</small>${item.state === "ready" ? `<button data-test-connector="${escapeHtml(item.id)}">测试连接</button>` : `<button data-import-connector="${escapeHtml(item.id)}">添加 ${escapeHtml(item.name)} 连接</button>`}</article>`).join("");
}

function extensionRows() {
  if (!state.extensions.length) return '<div class="resource-empty">还没有安装扩展。连接器安装后会在这里统一管理。</div>';
  return state.extensions.map((item) => `<article class="compact-row"><div><h3>${escapeHtml(item.manifest?.name || item.manifest?.id || "未命名扩展")}</h3><p>${escapeHtml(item.manifest?.version || "")} · ${item.enabled ? "正在使用" : "已停用"}${item.runtimeError ? ` · ${escapeHtml(item.runtimeError)}` : ""}</p></div><div class="actions"><button data-upgrade-extension="${escapeHtml(item.manifest.id)}">更新版本</button>${item.rollbackVersions?.length ? `<button data-rollback-extension="${escapeHtml(item.manifest.id)}" data-rollback-version="${escapeHtml(item.rollbackVersions[0])}">恢复 ${escapeHtml(item.rollbackVersions[0])}</button>` : ""}<button data-toggle-extension="${escapeHtml(item.manifest.id)}" data-enabled="${item.enabled ? "1" : "0"}">${item.enabled ? "停用" : "启用"}</button><button data-uninstall-extension="${escapeHtml(item.manifest.id)}">卸载</button></div></article>`).join("");
}

function capabilityPackRows() {
  const labels = { experimental: "实验", available: "可用", verified: "已验证", "production-ready": "生产就绪" };
  return (state.platform?.capabilityPacks || []).map((pack) => `<article class="compact-row"><div><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.quality.join(" · "))}</p><p>${pack.verifiedAbilities?.length || 0}/${pack.abilities.length} 项已有真实核验产物 · ${pack.qualitySampleCount || 0} 个固定回归样例</p></div><span class="pill">${escapeHtml(labels[pack.state] || pack.state)}</span></article>`).join("");
}

function renderResources() {
  const active = state.knowledge.filter((item) => !item.archivedAt);
  const archived = state.knowledge.filter((item) => item.archivedAt);
  const rows = active.map((item) => `<article class="compact-row"><div><span class="resource-kind">${resourceKindLabel(item.kind)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.excerpt || item.sourceUrl || "无文字摘要")} · ${item.characterCount || 0} 字</p></div><div class="actions"><button data-preview-resource="${item.id}">查看</button><button data-archive-resource="${item.id}">归档</button></div></article>`).join("");
  $("#content").innerHTML = `<section class="work-primary-list" aria-label="参考资料列表"><p class="work-list-summary">${active.length} 份资料 · 仅在任务中明确选择后使用</p><div class="compact-list">${rows || '<div class="resource-empty">还没有资料。点击“添加资料”，保存笔记、文本文件或网页链接。</div>'}</div>${archived.length ? `<details class="work-secondary-details"><summary>${archived.length} 项已归档资料</summary><div class="compact-list">${archived.map((item) => `<article class="compact-row"><div><h3>${escapeHtml(item.title)}</h3></div><button data-restore-resource="${item.id}">恢复</button></article>`).join("")}</div></details>` : ""}</section><details class="work-secondary-details"><summary>相关设置与领域能力包</summary><p>模型与数据连接在 <a href="/settings#connections">设置</a> 中管理。</p><div class="compact-list">${capabilityPackRows()}</div></details>`;
  $("#content").onclick = async (event) => {
    const preview = event.target.closest("[data-preview-resource]");
    const archive = event.target.closest("[data-archive-resource]");
    const restore = event.target.closest("[data-restore-resource]");
    if (preview) {
      const result = await api(`/api/knowledge?id=${encodeURIComponent(preview.dataset.previewResource)}`);
      $("#workResourceTitle").textContent=result.item.title;
      $("#workResourceBody").textContent=result.item.content || result.item.sourceUrl || "";
      $("#workResourcePreview").hidden=false;$("#closeResourcePreview").focus();
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
  if(keepInlineDraft('knowledgeForm')){$('#knowledgeTitle').focus();return;}
  const spaces = (state.snapshot?.spaces || []).filter((space) => space.status === "active");
  $("#knowledgeForm").reset();
  $("#knowledgeSpace").innerHTML = `<option value="">暂不归类</option>${spaces.map((space) => `<option value="${escapeHtml(space.id)}">${escapeHtml(space.title)}</option>`).join("")}`;
  updateKnowledgeFields();
  showWorkEditor('knowledgeDialog');
}

function updateKnowledgeFields() {
  const kind = $("#knowledgeKind").value;
  $("#knowledgeUrlField").hidden = kind !== "link";
  $("#knowledgeFileField").hidden = kind !== "file";
}

function renderArtifactCard(item) {
  const version = Number(item.metadata?.lineage?.version || 1);
  const previousId = String(item.metadata?.lineage?.previousArtifactId || "");
  return `<article class="card"><div><h2>${escapeHtml(artifactDisplayTitle(item))}</h2><p>${escapeHtml(item.summary || "已生成结果")}</p><div class="meta"><span class="pill ok">已完成</span><span class="pill">${escapeHtml(abilityName(item.capabilityId))}</span><span class="pill">${escapeHtml(String(item.format).toUpperCase())}</span>${version > 1 ? `<span class="pill">第 ${version} 版</span>` : ""}<span class="pill">${date(item.createdAt)}</span></div></div><div class="actions">${item.taskId?`<a href="/bots?task=${encodeURIComponent(item.taskId)}">来源任务</a>`:'<span class="hint">未记录来源任务</span>'}<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.id)}" target="_blank">预览</a>${previousId ? `<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(previousId)}" target="_blank">上一版</a>` : ""}<a href="/api/capabilities/artifact?id=${encodeURIComponent(item.id)}" download>下载</a><button data-feedback-useful="${item.id}">有帮助</button><button data-feedback-improve="${item.id}">需改进</button></div></article>`;
}

function renderArtifacts() {
  const artifacts = state.snapshot?.artifacts || [];
  $("#content").innerHTML = '<div id="artifactList"></div>';
  window.ClownfishFileLibrary.mount({root:$("#artifactList"),artifacts,documents:state.documents||[],knowledge:state.knowledge,warnings:state.fileWarnings||[],onPreview:async id=>{
    try{const result=await api('/api/knowledge?id='+encodeURIComponent(id));$("#workResourceTitle").textContent=result.item.title;$("#workResourceBody").textContent=result.item.content||result.item.sourceUrl||'';$("#workResourcePreview").hidden=false;$("#closeResourcePreview").focus();}catch(error){toast(error.message,true);}
  }});
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

function renderAttentionInbox(detailed) {
  if(!detailed){
    const warning=state.relationshipMemory?.state==="unavailable"?'<p role="alert">关系记忆读取异常，相关读写已停止；请到运行记录查看。</p>':"";
    return state.reviewQueue.length || warning ? `<aside class="work-attention-summary" aria-label="跨任务待处理提醒"><p>全局有 ${state.reviewQueue.length} 项待处理，包含确认请求、异常或未送达结果。</p><a href="/runs">查看与处理 →</a>${warning}</aside>` : "";
  }
  const labels = { approval: "等待确认", job: "需要核对", run: "执行中断", delivery: "等待送达" };
  const groups = detailed ? state.reviewGroups : state.reviewGroups.slice(0, 5);
  const rows = groups.map((group) => `<div data-review-group="${escapeHtml(group.id)}">${group.items.map((item) => {
    const approval = state.approvals.find((entry) => entry.id === item.sourceId && item.kind === "approval");
    const action = detailed && approval
      ? `<details><summary>查看具体操作并决定</summary><pre>${escapeHtml(JSON.stringify(approval.call, null, 2))}</pre><button type="button" data-review-approval="${escapeHtml(approval.id)}" data-allowed="true" data-scope="once">允许这次操作</button><button type="button" data-review-approval="${escapeHtml(approval.id)}" data-allowed="true" data-scope="session">本次会话内都允许「${escapeHtml(approval.tool?.name || approval.call?.name || "这个操作")}」</button><button type="button" data-review-approval="${escapeHtml(approval.id)}" data-allowed="false" data-scope="once">拒绝</button></details>`
      : `<a class="button" href="${detailed ? `#record-${encodeURIComponent(item.kind === "delivery" ? "job" : item.kind)}-${encodeURIComponent(item.sourceId)}` : `/runs#review-${encodeURIComponent(item.id)}`}">查看${detailed ? "记录" : "详情"}</a>`;
    return `<article class="compact-row" id="review-${escapeHtml(item.id)}"><div><span class="resource-kind">${labels[item.kind] || "待处理"}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.nextAction)}</p></div><div class="actions">${action}</div></article>`;
  }).join("")}</div>`).join("");
  // 会话级放行是还在生效的授权，不是待办；但它必须和待办一起被看见，
  // 否则就成了看不见也收不回的放行。
  const grants = detailed && state.sessionGrants?.length
    ? `<section class="platform-panel" aria-label="本会话内已放行的操作"><header><div><h2>已放行的操作</h2><p>这些操作在本会话内不再逐次询问，到期或撤销后恢复询问。</p></div></header><div class="compact-list">${(state.sessionGrants || []).map((grant) => `<article class="compact-row"><div><span class="resource-kind">会话内放行</span><h3>${escapeHtml(grant.tool)}</h3><p>${escapeHtml(date(grant.grantedAt))} 起 · ${escapeHtml(date(grant.expiresAt))} 到期</p></div><div class="actions"><button type="button" data-revoke-grant="${escapeHtml(grant.sessionId)}" data-revoke-tool="${escapeHtml(grant.tool)}">撤销</button></div></article>`).join("")}</div></section>`
    : "";
  const warning = state.relationshipMemory?.state === "unavailable" ? '<p role="alert">关系记忆读取异常：已保护原文件并停止相关读写。请恢复 counterparts.json 后重启应用。</p>' : "";
  return `<section class="platform-panel review-queue" aria-label="待你处理"><header><div><h2>待你处理</h2><p>集中查看待确认、异常和未送达的结果；不会自动重试或替你批准。</p></div><a class="button" href="/runs">${state.reviewGroups.length} 件事 · ${state.reviewQueue.length} 项</a></header>${warning}<div class="compact-list">${rows || '<div class="resource-empty">当前没有需要你处理的事项。</div>'}</div>${!detailed && state.reviewGroups.length > 5 ? '<a href="/runs">查看全部待处理事项</a>' : ""}</section>` + grants;
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
  const runCards = runs.map((run) => `<article class="card" id="record-run-${escapeHtml(run.runId)}"><div><h2>${escapeHtml(runDisplayTitle(run))}</h2><p>${escapeHtml(run.output?.slice(0, 180) || run.error || "已保存执行记录，需要时可以恢复或排查。")}</p><div class="meta"><span class="pill ${statusPill(run.status)}">${escapeHtml(jobStatusLabel(run.status))}</span><span class="pill">${date(run.updatedAt || run.createdAt)}</span></div></div><div class="actions">${run.resumable ? `<button data-resume-run="${escapeHtml(run.runId)}">恢复</button>` : ""}</div></article>`).join("");
  const qaSummary = state.productReviewSummary || { total: 0, openIssues: 0, highIssues: 0 };
  const qaCards = state.productReviews.slice(0, 20).map((item) => `<article class="compact-row"><div><span class="resource-kind">第 ${escapeHtml(item.round)} 轮 · ${escapeHtml(item.persona)}</span><h3>${escapeHtml(item.scenario)}</h3><p>${escapeHtml(item.route)} · ${date(item.createdAt)} · ${escapeHtml((item.observations || []).join("；"))}</p></div><span class="pill ${item.status === "passed" ? "ok" : item.status === "blocked" ? "bad" : "warn"}">${item.status === "passed" ? "通过" : item.status === "blocked" ? "受阻" : "发现问题"}</span></article>`).join("");
  $("#content").innerHTML = renderAttentionInbox(true) + `<details class="work-secondary-details"><summary>产品检查记录 · ${qaSummary.total} 轮 · ${qaSummary.openIssues} 个待修</summary><section class="platform-panel"><header><div><h2>产品真实检查</h2><p>保留不同用户从进入、操作到交付的完整检查记录，问题修复后仍可追溯。</p></div><span class="pill ${qaSummary.openIssues ? "warn" : "ok"}">${qaSummary.total} 轮 · ${qaSummary.openIssues} 个待修</span></header><div class="compact-list">${qaCards || '<div class="resource-empty">还没有产品真实检查记录。</div>'}</div></section></details><div class="toolbar"><span></span><button id="refreshRuns">刷新</button></div><div class="list">${jobCards || runCards ? jobCards + runCards : '<div class="empty">还没有运行记录。</div>'}</div>`;
  $("#refreshRuns").onclick = load;
  jobs.forEach((job, index) => { $("#content .list")?.children[index]?.setAttribute("id", `record-job-${job.id}`); });
  $("#content").onclick = async (event) => {
    const decision = event.target.closest("[data-review-approval]");
    const revoke = event.target.closest("[data-revoke-grant]");
    const cancel = event.target.closest("[data-cancel-job]");
    const retry = event.target.closest("[data-retry-job]");
    const reconcile = event.target.closest("[data-reconcile-job]");
    const resume = event.target.closest("[data-resume-run]");
    try {
      if (decision) {
        decision.disabled = true;
        try {
          const scope = decision.dataset.scope === "session" ? "session" : "once";
          const result = await api("/api/agent/approval/decision", { method: "POST", body: JSON.stringify({ id: decision.dataset.reviewApproval, allowed: decision.dataset.allowed === "true", scope }) });
          if (result.resumeReason) toast(result.resumeReason, true);
          else if (decision.dataset.allowed !== "true") toast("已拒绝");
          else toast(scope === "session" ? "已允许；本次会话内同类操作不再询问" : "已允许这次操作");
          await load();
        } finally { decision.disabled = false; }
        return;
      }
      if (revoke) {
        revoke.disabled = true;
        try {
          await api("/api/agent/approval/session-grant/revoke", {
            method: "POST",
            body: JSON.stringify({ sessionId: revoke.dataset.revokeGrant, tool: revoke.dataset.revokeTool }),
          });
          toast("已撤销；该操作恢复逐次询问");
          await load();
        } finally { revoke.disabled = false; }
        return;
      }
      if (cancel) await api("/api/agent/job/cancel", { method: "POST", body: JSON.stringify({ id: cancel.dataset.cancelJob }) });
      if (retry) {
        if (!confirm("重试可能再次生成文件或调用外部服务。确认继续吗？")) return;
        await api("/api/agent/job/retry", { method: "POST", body: JSON.stringify({ id: retry.dataset.retryJob, confirmSideEffect: true }) });
      }
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
  $("#memorySourceMeta").textContent = source.kind === "confirmed-learning"
    ? "用户明确确认的学习 · 以下来源摘录由用户填写或确认，并非自动核验的原始对话 · 提议 " + source.proposalId
    : memorySourceMeta(item);
  $("#memoryCorrectionContent").value = item.content;
  $("#memoryCorrectionField").hidden = !item.correctable;
  $("#memoryCorrectionNote").hidden = !item.correctable;
  $("#submitMemoryCorrection").hidden = !item.correctable;
  $("#memoryDetailDialog").showModal();
}

function renderMemory() {
  if (document.body.dataset.ui === "workbench" && window.ClownfishWorkbenchMemory) {
    return window.ClownfishWorkbenchMemory.render({ items: state.memories, layers: { ...layerNames, archival: "原始对话片段" }, openDetail: openMemoryDetail, api, reload: load });
  }
  const groups = Object.entries(layerNames).map(([layer, name]) => {
    const items = state.memories.filter((item) => item.layer === layer);
    if (!items.length) return "";
    const cards = items.map((item) => {
      const actions = `<div class="memory-actions"><button data-memory-detail="${escapeHtml(item.id)}">${item.correctable ? "查看与修正" : "查看来源"}</button><button class="danger" data-forget="${escapeHtml(item.id)}">忘记</button></div>`;
      return `<article class="memory-item"><div><p>${escapeHtml(item.content)}</p><small>${escapeHtml(item.who)} · ${date(item.created)}${item.source?.kind === "confirmed-learning" ? " · 已确认的学习来源" : item.source?.excerpt ? " · 有原始来源" : ""}</small></div>${actions}</article>`;
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
  await submitWorkForm(event,()=>saveTask());
});
$("#spaceForm").addEventListener("submit", async (event) => {
  await submitWorkForm(event,saveSpace);
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
  await submitWorkForm(event,async()=>{
  const file = $("#knowledgeFile").files?.[0];
    await api("/api/knowledge", { method: "POST", body: JSON.stringify({
      title: $("#knowledgeTitle").value.trim(),
      kind: $("#knowledgeKind").value,
      content: $("#knowledgeContent").value,
      sourceUrl: $("#knowledgeUrl").value.trim(),
      fileName: file?.name,
      mimeType: file?.type,
      spaceId: $("#knowledgeSpace").value || undefined,
    }) });
    closeWorkEditor('knowledgeDialog');
    toast("资料已保存");
    await load();
  });
});
$$('[data-close-dialog]').forEach((button) => button.onclick = () => closeWorkEditor('taskDialog'));
$('[data-close-space]').onclick = () => closeWorkEditor('spaceDialog');
$('[data-close-knowledge]').onclick = () => closeWorkEditor('knowledgeDialog');
$('#closeResourcePreview').onclick=()=>{$('#workResourcePreview').hidden=true;};
$("[data-close-story]").onclick = () => $("#storyDialog").close();
$("#storyDialog").addEventListener("close", () => { activeStoryTaskId = ""; });

const agentEventSource = window.ClownfishAgentEvents?.connect({
  onSync: () => view === "memory" ? undefined : load(),
  onStatus: (status) => {
    const node = $("#eventConnectionStatus");
    node.hidden = status === "connected";
    node.textContent = status === "closed" ? "实时连接已停止，请重新连接。" : status === "reconnecting" ? "连接中断，正在重连；恢复后会补读任务状态。" : "";
    $("#retryEventConnection").hidden = status !== "closed";
  },
});
$("#retryEventConnection").onclick = () => agentEventSource?.retry();
$("#newTaskSide").onclick = () => {
  if(!state.snapshot)return toast("正在读取本机数据，请稍后重试");
  if(view==="spaces")return openSpaceDialog();
  if(view==="resources")return openKnowledgeDialog();
  if(view==="tasks" || view==="automations"){
    openTaskDialog();
  }
};

hydrateIcons();
let workSearchOverlay;
const searchOverlay = () => workSearchOverlay || (workSearchOverlay = window.AppSearchOverlay.bind({
  dialog: "#workSearchDialog",
  trigger: "#workSearchToggle",
  input: "#workSearch",
  close: "#closeWorkSearch",
  render: renderWorkSearchResults,
}));
$("#workSearchResults").onclick = async (event) => {
  const result = event.target.closest("[data-work-search-kind]");
  if (!result) return;
  searchOverlay().close();
  const kind = result.dataset.workSearchKind;
  const id = result.dataset.workSearchId;
  if (kind === "task") {
    const task = (state.snapshot?.tasks || []).find((item) => item.id === id);
    if (task) openStoryline(task);
  } else if (kind === "space") location.href = `/tasks?space=${encodeURIComponent(id)}`;
  else if (kind === "artifact") window.open(`/api/capabilities/artifact/preview?id=${encodeURIComponent(id)}`, "_blank", "noopener");
  else if (kind === "resource") document.querySelector(`[data-preview-resource="${CSS.escape(id)}"]`)?.click();
  else if (kind === "memory") document.querySelector(`[data-memory-detail="${CSS.escape(id)}"]`)?.click();
};
if (window.ClownfishNavigation) {
  view = viewFromLocation();
  setPage();
  showLoading();
  void load();
}
