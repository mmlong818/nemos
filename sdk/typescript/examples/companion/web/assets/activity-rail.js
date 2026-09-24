/*
 * 助理页右侧活动栏：头像与实时状态，四个页签（动态 / 批准 / 即将到来 / 身份）。
 *
 * 数据全部复用聊天页已有的刷新链（refreshAgentOps 的 agentOpsState）与 Agent 事件流，
 * 不新增接口。一条硬规则：动态里每件事的结论只取记录的状态和送达情况，
 * 不用模型写的摘要——摘要可能说"已完成"而运行记录是失败，那种不一致最伤信任。
 */
(function (root) {
  "use strict";

  const TYPE_TITLE = {
    "hk-reminder": "港股提醒",
    "capability-task": "例行任务",
    "capability-adhoc": "临时任务",
    "assistant-team": "专职 Bot 协作",
    "development-proposal": "开发提案",
  };
  const WEEKDAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

  /** 运行事件的展示分类 → 一句中文。返回空串表示回到空闲。 */
  function liveStatusLabel(activity, toolLabel) {
    if (!activity || typeof activity !== "object") return "";
    const raw = activity.tool && activity.tool.name ? String(activity.tool.name) : "";
    const translated = raw && toolLabel ? String(toolLabel(raw) || "") : raw;
    // 没有中文名的内部标识（capability_web_search 这类）不露给用户。
    const tool = /^[a-z0-9_.:-]+$/i.test(translated) ? "" : translated;
    switch (activity.kind) {
      case "phase": return activity.status === "running" ? "思考中" : "";
      case "model": return "思考中";
      case "tool": return activity.status === "running" ? (tool ? "正在" + tool : "正在调用工具") : "思考中";
      case "approval": return activity.status === "blocked" ? (tool ? "等你批准：" + tool : "等你批准") : "思考中";
      case "delegation": return activity.status === "running" ? "交给子任务处理" : "思考中";
      case "handoff": return "整理上下文";
      case "completion": return activity.status === "blocked" ? "重新核对交付" : "整理交付";
      case "budget": return "预算快用完了";
      case "failure": return "遇到问题";
      default: return "";
    }
  }

  function jobTitle(job, tasks) {
    const payload = (job && job.payload) || {};
    const explicit = String(payload.title || (payload.teamPlan && payload.teamPlan.objective) || "").trim();
    if (explicit) return explicit.slice(0, 60);
    if (job && job.type === "capability-task" && payload.taskId) {
      const task = (tasks || []).find((item) => item.id === payload.taskId);
      if (task && task.title) return String(task.title).slice(0, 60);
    }
    return TYPE_TITLE[job && job.type] || "后台任务";
  }

  function failureText(error) {
    const text = String(error || "").trim();
    if (/max_rounds/.test(text)) return "达到轮次上限";
    if (/token_budget_exhausted/.test(text)) return "预算用完";
    if (/repeated_tool_call/.test(text)) return "反复调用同一个工具，已停下";
    if (/^fetch failed$/i.test(text)) return "网络请求失败";
    const first = text.split(/\r?\n/)[0] || "原因未记录";
    return first.length > 60 ? first.slice(0, 60) + "…" : first;
  }

  /** 结论只看 status 与 delivery；result.summary 是模型写的，不参与判断。 */
  function jobOutcome(job) {
    const status = job && job.status;
    if (status === "queued") return "排队中";
    if (status === "running") {
      const checkpoints = (job && job.checkpoints) || [];
      const last = checkpoints[checkpoints.length - 1];
      return last && last.status ? String(last.status).slice(0, 60) : "正在进行";
    }
    if (status === "succeeded") {
      const delivery = job.delivery && job.delivery.status;
      if (delivery === "delivered") return "已完成，已送到你面前";
      if (delivery === "pending" || delivery === "leased") return "已完成，还没送到你面前";
      if (delivery === "failed") return "已完成，但没能送到你面前";
      return "已完成";
    }
    if (status === "failed") return "没完成：" + failureText(job.error);
    // uncertain：可能做了、可能没做，要人核对，不能说成失败也不能说成完成。
    if (status === "uncertain") return "结果待核对：" + failureText(job.error);
    if (status === "cancelled") return "已取消";
    return "状态未知";
  }

  function zonedParts(at, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
      const get = (type) => (parts.find((p) => p.type === type) || {}).value;
      const weekday = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
      return { weekday, minute: Number(get("hour")) * 60 + Number(get("minute")) };
    } catch {
      const day = at.getDay() || 7;
      return { weekday: day, minute: at.getHours() * 60 + at.getMinutes() };
    }
  }

  function minuteOf(time) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ""));
    return match ? Number(match[1]) * 60 + Number(match[2]) : 9 * 60;
  }

  /** 启用的定时任务，按下次运行排序。手动任务与已暂停任务不列（暂停的只计数）。 */
  function upcomingTasks(tasks, now) {
    const at = now instanceof Date ? now : new Date();
    const out = [];
    for (const task of tasks || []) {
      const schedule = task && task.schedule;
      if (!task || task.enabled === false || !schedule) continue;
      if (schedule.mode === "daily") {
        const here = zonedParts(at, schedule.timezone);
        const target = minuteOf(schedule.time);
        const days = schedule.days && schedule.days.length ? schedule.days : EVERY_DAY;
        let offset = -1;
        for (let i = 0; i < 8; i++) {
          const weekday = ((here.weekday - 1 + i) % 7) + 1;
          if (!days.includes(weekday)) continue;
          if (i === 0 && target <= here.minute) continue;
          offset = i; break;
        }
        if (offset < 0) continue;
        const weekday = ((here.weekday - 1 + offset) % 7) + 1;
        const hhmm = String(Math.floor(target / 60)).padStart(2, "0") + ":" + String(target % 60).padStart(2, "0");
        const day = offset === 0 ? "今天" : offset === 1 ? "明天" : WEEKDAY[weekday];
        out.push({ id: task.id, title: task.title || "定时任务", when: day + " " + hhmm, sort: offset * 1440 + target,
          note: "应用开着时运行；到点没开，当天打开会补跑一次" });
      } else if (schedule.mode === "turns") {
        const every = Math.max(1, Number(schedule.everyTurns) || 5);
        out.push({ id: task.id, title: task.title || "按轮次任务", when: "每聊 " + every + " 轮", sort: 1e7 + every,
          note: "和时间无关，不聊天就不会运行" });
      }
    }
    return out.sort((a, b) => a.sort - b.sort);
  }

  /** 目标的定期对进度：和定时任务混排，排序口径相同（从今天零点起算的分钟数）。 */
  function upcomingGoalCheckIns(goals, now) {
    const at = now instanceof Date ? now : new Date();
    const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const out = [];
    for (const goal of goals || []) {
      const next = goal && goal.status === "active" && goal.checkIn ? new Date(goal.checkIn.nextAt) : null;
      if (!next || !Number.isFinite(next.getTime())) continue;
      const days = Math.floor((new Date(next.getFullYear(), next.getMonth(), next.getDate()) - midnight) / 86400000);
      const hhmm = String(next.getHours()).padStart(2, "0") + ":" + String(next.getMinutes()).padStart(2, "0");
      const day = days <= 0 ? "今天" : days === 1 ? "明天" : days < 7 ? WEEKDAY[next.getDay() === 0 ? 7 : next.getDay()] : (next.getMonth() + 1) + "月" + next.getDate() + "日";
      out.push({ id: "goal:" + goal.id, title: "对进度：" + (goal.title || "目标"), when: day + " " + hhmm, sort: Math.round((next - midnight) / 60000),
        note: "应用开着时在聊天里提醒；错过的不补发" });
    }
    return out;
  }

  /** 按本地日期分组的标题：今天 / 昨天 / 9月22日。 */
  function dayLabel(value, now) {
    const at = new Date(value), ref = now instanceof Date ? now : new Date();
    if (!Number.isFinite(at.getTime())) return "更早";
    const key = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const yesterday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1);
    if (key(at) === key(ref)) return "今天";
    if (key(at) === key(yesterday)) return "昨天";
    return (at.getFullYear() === ref.getFullYear() ? "" : at.getFullYear() + "年") + (at.getMonth() + 1) + "月" + at.getDate() + "日";
  }

  function pausedTaskCount(tasks) {
    return (tasks || []).filter((task) => task && task.enabled === false && task.schedule && task.schedule.mode !== "manual").length;
  }

  function approvalRows(approvals, toolLabel, now) {
    const at = now instanceof Date ? now : new Date();
    return (approvals || []).filter((item) => item && item.status === "pending").map((item) => {
      const name = item.call && item.call.name ? item.call.name : "";
      let expires = "";
      if (item.expiresAt) {
        const left = Date.parse(item.expiresAt) - at.getTime();
        expires = !Number.isFinite(left) ? "" : left <= 0 ? "已过期" : left < 60_000 ? "即将失效" : Math.floor(left / 60_000) + " 分钟后失效";
      }
      return { id: item.id, title: toolLabel ? toolLabel(name) : name, expires,
        detail: item.active ? "当前运行正在等你" : "服务重启后保留，确认后从检查点继续" };
    });
  }

  const api = { liveStatusLabel, jobTitle, jobOutcome, upcomingTasks, upcomingGoalCheckIns, pausedTaskCount, approvalRows, dayLabel };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }

  // ———————————————— 以下只在浏览器里运行 ————————————————
  const COLLAPSE_KEY = "clownfish.activityRail.collapsed";
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const state = { deps: null, ops: { jobs: [], runs: [], approvals: [], sessionGrants: [] }, tasks: [], goals: [], guidelines: null,
    tab: "activity", live: "", liveAt: 0, connection: "connected", tasksAt: 0, mounted: false };
  let el = null, toggle = null;

  function readCollapsed() { try { return root.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } }
  function writeCollapsed(value) { try { root.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0"); } catch { /* 隐私模式下只影响本次 */ } }
  const toolLabel = (name) => (state.deps && state.deps.toolLabel ? state.deps.toolLabel(name) : name);
  const timeLabel = (value) => (state.deps && state.deps.time ? state.deps.time(value) : new Date(value).toLocaleString("zh-CN"));

  function statusLine() {
    if (state.connection !== "connected") return { text: "连接中断，恢复后会补读", tone: "warn" };
    if (state.live && Date.now() - state.liveAt < 90_000) return { text: state.live, tone: state.liveTone || "busy" };
    const pending = approvalRows(state.ops.approvals, toolLabel).length;
    if (pending) return { text: "有 " + pending + " 件事等你批准", tone: "warn" };
    const running = state.ops.jobs.filter((job) => job.status === "running" || job.status === "queued").length;
    if (running) return { text: "后台有 " + running + " 件事在进行", tone: "busy" };
    return { text: "空闲", tone: "idle" };
  }

  function jobIcon(job) {
    if (job.status === "succeeded") return "✓";
    if (job.status === "uncertain") return "?";
    if (job.status === "failed") return "!";
    if (job.status === "cancelled") return "–";
    return "…";
  }

  function renderActivity() {
    const jobs = state.ops.jobs.slice(0, 20);
    if (!jobs.length) return '<p class="ar-empty">还没有后台任务。让小丑鱼去做一件要花点时间的事，进度会出现在这里。</p>';
    const now = new Date();
    let html = "", day = "";
    for (const job of jobs) {
      const at = job.updatedAt || job.createdAt;
      const label = dayLabel(at, now);
      if (label !== day) { html += (day ? '</ol>' : '') + '<h3 class="ar-subhead">' + esc(label) + '</h3><ol class="ar-list">'; day = label; }
      const clock = new Date(at);
      const hhmm = Number.isFinite(clock.getTime()) ? String(clock.getHours()).padStart(2, "0") + ":" + String(clock.getMinutes()).padStart(2, "0") : "";
      html += '<li class="ar-item" data-status="' + esc(job.status) + '"><span class="ar-icon" aria-hidden="true">' + jobIcon(job) + '</span>'
        + '<a class="ar-body" href="/bots?job=' + encodeURIComponent(job.id) + '" title="' + esc(jobTitle(job, state.tasks)) + '"><strong>' + esc(jobTitle(job, state.tasks)) + '</strong>'
        + '<span>' + esc(jobOutcome(job)) + '</span><small>' + esc(hhmm) + '</small></a></li>';
    }
    return html + '</ol>';
  }

  function renderApprovals() {
    const rows = approvalRows(state.ops.approvals, toolLabel);
    const grants = state.ops.sessionGrants || [];
    let html = rows.length
      ? '<ol class="ar-list">' + rows.map((row) => '<li class="ar-item ar-approval" data-id="' + esc(row.id) + '"><span class="ar-icon" aria-hidden="true">?</span><div class="ar-body"><strong>' + esc(row.title) + '</strong><span>' + esc(row.detail) + '</span>'
        + (row.expires ? '<small>' + esc(row.expires) + '</small>' : '') + '<div class="ar-actions"><button type="button" data-approval-deny>拒绝</button><button type="button" class="primary" data-approval-allow>允许一次</button></div></div></li>').join("") + '</ol>'
      : '<p class="ar-empty">没有等你批准的事。小丑鱼要保存、发送或修改东西之前，会先在这里问你。</p>';
    if (grants.length) {
      html += '<h3 class="ar-subhead">本次对话内已放行</h3><ol class="ar-list">' + grants.map((grant) => '<li class="ar-item"><span class="ar-icon" aria-hidden="true">↺</span><div class="ar-body"><strong>' + esc(toolLabel(grant.tool)) + '</strong><span>在这次对话里不再逐次询问</span><div class="ar-actions"><button type="button" data-grant-revoke data-session="' + esc(grant.sessionId) + '" data-tool="' + esc(grant.tool) + '">收回放行</button></div></div></li>').join("") + '</ol>';
    }
    return html;
  }

  function renderUpcoming() {
    const items = [...upcomingTasks(state.tasks, new Date()), ...upcomingGoalCheckIns(state.goals, new Date())].sort((a, b) => a.sort - b.sort);
    const paused = pausedTaskCount(state.tasks);
    let html = items.length
      ? '<ol class="ar-list">' + items.map((item) => '<li class="ar-item"><span class="ar-icon" aria-hidden="true">◷</span><div class="ar-body"><strong>' + esc(item.title) + '</strong><span>' + esc(item.when) + '</span><small>' + esc(item.note) + '</small></div></li>').join("") + '</ol>'
      : '<p class="ar-empty">没有排好的定时任务或目标对进度。跟小丑鱼说"每天早上 8 点帮我……"就能建一个。</p>';
    if (paused) html += '<p class="ar-note">另有 ' + paused + ' 个定时任务已暂停，<a href="/automations">去自动化查看</a>。</p>';
    return html;
  }

  function renderIdentity() {
    const guidelines = state.guidelines;
    const list = guidelines === null ? '<p class="ar-note">正在读取工作准则…</p>'
      : guidelines.length ? '<ol class="ar-list ar-compact">' + guidelines.slice(0, 6).map((g) => '<li><span>' + esc(g.text) + '</span><small>' + esc(g.behavior === "never" ? "从不做" : g.behavior === "ask-first" ? "先问你" : "自动放行") + '</small></li>').join("") + '</ol>'
        : '<p class="ar-note">还没有工作准则。准则决定小丑鱼的哪些动作从不做、先问你、或自动放行。</p>';
    const persona = state.deps && state.deps.editPersona
      ? '<button type="button" class="ar-card" data-edit-persona><strong>助手设定</strong><span>名字和说话方式，聊天和办事共用同一份</span></button>'
      : "";
    return '<div class="ar-identity">' + persona + '<a class="ar-card" href="/memory"><strong>记忆</strong><span>小丑鱼长期记住的内容，可查来源、修正或忘记</span></a>'
      + '<a class="ar-card" href="/memory?view=learning"><strong>待确认的记忆</strong><span>小丑鱼提议记住、等你点头的内容</span></a></div>'
      + '<h3 class="ar-subhead">工作准则</h3>' + list;
  }

  const TABS = [["activity", "动态"], ["approvals", "批准"], ["upcoming", "即将到来"], ["identity", "身份"]];

  function render() {
    if (!el) return;
    const status = statusLine();
    const pending = approvalRows(state.ops.approvals, toolLabel).length;
    const running = state.ops.jobs.filter((job) => job.status === "running" || job.status === "queued").length;
    const counts = { activity: running, approvals: pending };
    const name = state.deps && state.deps.personaName && state.deps.personaName();
    el.querySelector(".ar-head h2").textContent = name || "小丑鱼";
    el.querySelector(".ar-status").textContent = status.text;
    el.querySelector(".ar-status").dataset.tone = status.tone;
    el.querySelector(".ar-tabs").innerHTML = TABS.map(([key, label]) => '<button type="button" role="tab" id="arTab-' + key + '" aria-controls="arPanel" aria-selected="' + (state.tab === key) + '" data-tab="' + key + '">' + label + (counts[key] ? '<b>' + counts[key] + '</b>' : '') + '</button>').join("");
    const panel = el.querySelector(".ar-panel");
    panel.setAttribute("aria-labelledby", "arTab-" + state.tab);
    panel.innerHTML = state.tab === "approvals" ? renderApprovals() : state.tab === "upcoming" ? renderUpcoming() : state.tab === "identity" ? renderIdentity() : renderActivity();
    if (toggle) toggle.querySelector("b").textContent = pending ? String(pending) : "";
  }

  async function loadTasks(force) {
    if (!state.deps || !state.deps.api) return;
    if (!force && Date.now() - state.tasksAt < 30_000) return;
    state.tasksAt = Date.now();
    try { state.tasks = (await state.deps.api("/api/capabilities")).tasks || []; render(); } catch { /* 下次刷新再读 */ }
    try { state.goals = (await state.deps.api("/api/personal-work")).goals || []; render(); } catch { /* 目标读不到不影响定时任务 */ }
  }
  async function loadGuidelines() {
    if (!state.deps || !state.deps.api) return;
    try { state.guidelines = (await state.deps.api("/api/agent/guidelines")).guidelines || []; } catch { state.guidelines = []; }
    render();
  }

  function setOpen(open) {
    const wide = root.matchMedia && root.matchMedia("(min-width: 1280px)").matches;
    if (wide) { root.document.body.classList.toggle("activity-rail-on", open); writeCollapsed(!open); root.document.body.classList.remove("activity-rail-open"); }
    else root.document.body.classList.toggle("activity-rail-open", open);
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
  }

  function mount() {
    const doc = root.document, body = doc.body;
    if (state.mounted || body.dataset.wbRoute !== "/") return;
    const shell = doc.querySelector(".app-shell");
    if (!shell) return;
    state.mounted = true;
    el = doc.createElement("aside");
    el.id = "activityRail"; el.className = "activity-rail"; el.setAttribute("aria-label", "小丑鱼的活动");
    el.innerHTML = '<header class="ar-head"><img class="ar-avatar" src="/assets/brand/clownfish-mark.png" alt="" width="56" height="56"><div><h2>小丑鱼</h2><p class="ar-status" role="status" aria-live="polite">空闲</p></div><button type="button" class="ar-close" aria-label="收起活动栏">×</button></header>'
      + '<div class="ar-tabs" role="tablist" aria-label="活动栏页签"></div><section class="ar-panel" id="arPanel" role="tabpanel"></section>';
    shell.append(el);
    toggle = doc.createElement("button");
    toggle.type = "button"; toggle.className = "ar-toggle"; toggle.setAttribute("aria-controls", "activityRail");
    toggle.innerHTML = '活动<b></b>';
    (doc.querySelector(".home-utility-strip") || doc.getElementById("wbPageActions") || body).append(toggle);
    toggle.onclick = () => setOpen(!(body.classList.contains("activity-rail-on") || body.classList.contains("activity-rail-open")));
    el.querySelector(".ar-close").onclick = () => setOpen(false);
    el.addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.tab) { state.tab = target.dataset.tab; if (state.tab === "upcoming") loadTasks(true); if (state.tab === "identity" && state.guidelines === null) loadGuidelines(); render(); return; }
      if (target.hasAttribute("data-edit-persona")) { state.deps.editPersona(); return; }
      const row = target.closest("[data-id]");
      if (target.hasAttribute("data-approval-allow") || target.hasAttribute("data-approval-deny")) {
        target.disabled = true;
        await state.deps.decide(row.dataset.id, target.hasAttribute("data-approval-allow"));
        return;
      }
      if (target.hasAttribute("data-grant-revoke")) {
        target.disabled = true;
        try { await state.deps.api("/api/agent/approval/session-grant/revoke", { sessionId: target.dataset.session, tool: target.dataset.tool }); } catch { target.disabled = false; }
        state.deps.refresh && state.deps.refresh();
      }
    });
    el.addEventListener("keydown", (event) => {
      if (!event.target.closest || !event.target.closest('[role="tab"]')) return;
      const index = TABS.findIndex(([key]) => key === state.tab);
      const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : -1;
      if (next < 0) return;
      state.tab = TABS[next][0]; render(); el.querySelector('[data-tab="' + state.tab + '"]').focus();
    });
    doc.addEventListener("keydown", (event) => { if (event.key === "Escape" && body.classList.contains("activity-rail-open")) setOpen(false); });
    setOpen(!readCollapsed() && !!(root.matchMedia && root.matchMedia("(min-width: 1280px)").matches));
    render();
    loadTasks(true);
    setInterval(() => { if (state.live && Date.now() - state.liveAt >= 90_000) { state.live = ""; render(); } }, 15_000);
  }

  root.ClownfishActivityRail = {
    ...api,
    /** 聊天页注入依赖：api 请求、审批决定、刷新、工具名翻译、时间格式。 */
    configure(deps) { state.deps = deps; if (state.mounted) { render(); loadTasks(true); } },
    /** 助手改名后重画头部与身份页。 */
    refresh() { render(); },
    update(ops) {
      state.ops = { jobs: ops.jobs || [], runs: ops.runs || [], approvals: ops.approvals || [], sessionGrants: ops.sessionGrants || [] };
      loadTasks(false); render();
    },
    onRunEvent(payload) {
      if (!payload) return;
      // 失败不能悄悄回到"空闲"：留一段时间，让人知道刚才那次没做成。
      // 运行"结束"不等于"完成"：token_budget_exhausted、max_rounds 这类结束原因也是没做成。
      const unfinished = payload.action === "failed" || (payload.action === "completed" && payload.reason && payload.reason !== "completed");
      if (unfinished) { state.live = "刚才那次没完成"; state.liveTone = "warn"; state.liveAt = Date.now(); render(); return; }
      if (payload.action === "completed") { state.live = ""; state.liveTone = ""; render(); return; }
      if (payload.action !== "event" || !payload.activity) return;
      const label = liveStatusLabel(payload.activity, toolLabel);
      state.live = label; state.liveTone = payload.activity.kind === "failure" || payload.activity.kind === "approval" ? "warn" : "busy";
      state.liveAt = Date.now(); render();
    },
    setConnection(status) { state.connection = status === "connected" ? "connected" : status; render(); },
  };
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", mount);
  else mount();
})(typeof window !== "undefined" ? window : globalThis);
