(() => {
  const $ = (q) => document.querySelector(q);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = (value) => value ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未设时间";
  let data = { matters: [], goals: [], reminders: [], tasks: [], artifacts: [] }, filter = "ongoing", openGoalId = "", sequence = 0, toastTimer;
  const stateName = { active: "推进中", waiting: "等待中", paused: "已暂停", completed: "已完成" };
  async function api(path = "", body) {
    const response = await fetch(`/api/personal-work${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "操作未完成，请重试");
    return payload;
  }
  function toast(message) { $("#toast").textContent = message; $("#toast").hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4000); }
  async function load() {
    const id = ++sequence;
    try {
      const result = await api(); if (id !== sequence) return;
      // 目标详情里的"相关点子"：读已有的点子，不生成。
      try { const r = await fetch("/api/ideas"); result.ideas = r.ok ? (await r.json()).ideas || [] : []; } catch { result.ideas = []; }
      data = result; render();
    }
    catch (error) { if (id === sequence) { $("#connection").textContent = error.message; if (!data.matters.length) $("#records").innerHTML = '<p>记录暂时无法读取。<button id="retryLoad">重新读取</button></p>'; } }
  }
  function render() {
    const goalsView = filter === "goals";
    $("#records").hidden = goalsView; $("#goals").hidden = !goalsView; $("#reminders").hidden = goalsView;
    $("#newMatter").hidden = goalsView; $(".personal-search").hidden = goalsView;
    if (goalsView) { window.ClownfishGoals.render($("#goals"), data.goals || []); if (openGoalId && $("#goalDialog").open) showGoal(openGoalId); return; }
    const query = $("#search").value.trim().toLowerCase();
    $("#reminders").innerHTML = data.reminders.map((r) => `<div class="personal-reminder"><p><strong>${esc(r.matter.title)}</strong><br>${esc(r.matter.waitingFor || r.matter.nextAction)} · ${date(r.fireAt)}</p><button data-ack="${esc(r.id)}">知道了</button></div>`).join("");
    const entries = data.matters.filter((m) => (filter === "completed" ? m.status === "completed" : m.status !== "completed") && `${m.title} ${m.goal} ${m.nextAction} ${m.waitingFor}`.toLowerCase().includes(query));
    $("#records").innerHTML = entries.map((m) => `<article class="personal-item"><header><h2>${esc(m.title)}</h2><span class="personal-state">${stateName[m.status]}</span></header><p class="goal">${esc(m.goal)}</p><div class="next-action ${m.status === "waiting" ? "waiting" : ""}"><small>${m.status === "completed" ? "完成结果" : m.status === "waiting" ? "正在等待" : "下一步"}</small><p>${esc(m.status === "completed" ? m.result : m.status === "waiting" ? m.waitingFor : m.nextAction || "暂未安排")}</p></div><div class="personal-meta">${m.dueAt ? `<span>截止 <time>${date(m.dueAt)}</time></span>` : ""}${m.remindAt ? `<span>跟进 <time>${date(m.remindAt)}</time></span>` : ""}${m.taskId ? `<span>关联任务：${esc(data.tasks.find((t) => t.id === m.taskId)?.title || "已不可用")}</span>` : ""}${m.artifactId ? `<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(m.artifactId)}" target="_blank" rel="noopener">查看交付结果</a>` : ""}</div><div class="personal-actions"><button data-edit="${m.id}">更新进展</button><button data-learn="${m.id}">从这件事提议记住</button></div></article>`).join("") || `<div class="personal-empty"><h2>${query ? "没有找到匹配内容" : filter === "completed" ? "完成的事会留在这里" : "从一件你在意的事开始"}</h2><p>${query ? "试试目标或下一步中的关键词。" : "写下目标和下一步，小丑鱼会在你设定的时间提醒跟进。"}</p></div>`;
  }
  function localDate(value) { if (!value) return ""; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function openMatter(id) {
    const m = data.matters.find((item) => item.id === id) || {};
    const form = $("#matterForm"); form.reset(); form.querySelector(".form-error").textContent = "";
    form.elements.taskId.innerHTML = '<option value="">不关联</option>' + data.tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
    form.elements.artifactId.innerHTML = '<option value="">不关联</option>' + data.artifacts.map((a) => `<option value="${esc(a.id)}">${esc(a.title)}</option>`).join("");
    for (const key of ["id", "revision", "title", "goal", "nextAction", "waitingFor", "result", "taskId", "artifactId"]) form.elements[key].value = m[key] || "";
    form.elements.status.value = m.status || "active";
    for (const key of ["dueAt", "remindAt"]) form.elements[key].value = localDate(m[key]);
    $("#matterTitle").textContent = id ? "更新进展" : "新建事项";
    $("#matterDialog").showModal();
  }
  function openLearning(id) {
    const m = data.matters.find((item) => item.id === id);
    const form = $("#learningForm"); form.reset(); form.querySelector(".form-error").textContent = "";
    form.elements.matterId.value = m?.id || "";
    form.elements.content.value = "";
    form.elements.excerpt.value = m ? `${m.title}：${m.result || m.nextAction || m.goal}`.slice(0, 1500) : "";
    $("#learningDialog").showModal();
  }
  $("#newMatter").onclick = () => openMatter();
  function selectFilter(value,updateUrl=true){
    filter=['goals','ongoing','completed'].includes(value)?value:'ongoing';
    document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===filter)));
    if(updateUrl){const next=new URL(location.href);next.searchParams.set('view',filter);history.replaceState(null,'',next.pathname+next.search+next.hash);window.ClownfishNavigation?.sync();}
    render();
  }
  $("#filters").onclick = (event) => { const button=event.target.closest('[data-filter]');if(button)selectFilter(button.dataset.filter); };
  const initialParams=new URLSearchParams(location.search);
  // Learning proposals now live under 记忆; keep old bookmarks working.
  if(initialParams.get('view')==='learning'){location.replace('/memory?view=learning');return;}
  selectFilter(initialParams.get('view'),false);
  // /matters?new=1 (from 总览 empty state) opens the create dialog directly.
  if(initialParams.has('new')){const next=new URL(location.href);next.searchParams.delete('new');history.replaceState(null,'',next.pathname+next.search+next.hash);openMatter();}
  $("#search").oninput = render;
  document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => document.getElementById(b.dataset.close).close(); });
  async function submit(event, path, body, dialog, message) {
    event.preventDefault(); const form = event.target, button = form.querySelector('[type="submit"]'); button.disabled = true;
    try { await api(path, body); $(dialog).close(); toast(message); await load(); }
    catch (error) { form.querySelector(".form-error").textContent = error.message; }
    finally { button.disabled = false; }
  }
  function showGoal(id) {
    const goal = (data.goals || []).find((item) => item.id === id);
    if (!goal) { if ($("#goalDialog").open) $("#goalDialog").close(); return; }
    openGoalId = id;
    const note = $("#goalNote")?.value || "";
    window.ClownfishGoals.detail($("#goalDialog"), goal, data.ideas || []);
    if (note) $("#goalNote").value = note;
    if (!$("#goalDialog").open) $("#goalDialog").showModal();
  }
  async function goalAction(button, run, message) {
    button.disabled = true;
    try { await run(); if (message) toast(message); await load(); }
    catch (error) { const box = $("#goalDialog .form-error"); if (box) box.textContent = error.message; else toast(error.message); }
    finally { button.disabled = false; }
  }
  function currentGoal() { return (data.goals || []).find((item) => item.id === openGoalId); }
  $("#goalDialog").addEventListener("close", () => { openGoalId = ""; });
  $("#goalDialog").addEventListener("change", (event) => {
    const box = event.target.closest("[data-milestone]"); const goal = currentGoal(); if (!box || !goal) return;
    const milestones = goal.milestones.map((m) => ({ id: m.id, done: m.id === box.dataset.milestone ? box.checked : m.done }));
    void goalAction(box, () => api("/goals", { goal: { id: goal.id, revision: goal.revision, milestones } }), box.checked ? "子目标已完成" : "");
  });
  $("#goalDialog").addEventListener("click", (event) => {
    const b = event.target.closest("button"); const goal = currentGoal(); if (!b || !goal) return;
    if (b.hasAttribute("data-goal-close")) return $("#goalDialog").close();
    if (b.hasAttribute("data-goal-log")) {
      const note = $("#goalNote").value.trim(); if (!note) return $("#goalNote").focus();
      return goalAction(b, async () => { await api("/goals/progress", { id: goal.id, note }); $("#goalNote").value = ""; }, "进展已记下");
    }
    if (b.dataset.goalStatus) {
      const completing = b.dataset.goalStatus === "completed";
      const result = completing ? prompt("做到了什么？（可以不填）", "") : "";
      if (result === null) return;
      return goalAction(b, () => api("/goals", { goal: { id: goal.id, revision: goal.revision, status: b.dataset.goalStatus, ...(result ? { result } : {}) } }), completing ? "目标已完成" : "已重新开始追踪");
    }
    if (b.hasAttribute("data-goal-checkin")) {
      const cadence = $("#goalCheckIn").value, time = $("#goalCheckInTime").value || "20:00";
      const checkIn = cadence === "off" ? null : { cadence, time };
      return goalAction(b, () => api("/goals", { goal: { id: goal.id, revision: goal.revision, checkIn } }), cadence === "off" ? "已取消定期对进度" : "已设好定期对进度");
    }
    if (b.hasAttribute("data-goal-rename")) {
      const title = prompt("新的目标名称", goal.title); if (!title || title.trim() === goal.title) return;
      return goalAction(b, () => api("/goals", { goal: { id: goal.id, revision: goal.revision, title: title.trim() } }), "已改名");
    }
    if (b.hasAttribute("data-goal-delete")) {
      if (!confirm("删除目标「" + goal.title + "」？时间线会一起删除，不能恢复。")) return;
      return goalAction(b, async () => { await api("/goals/delete", { id: goal.id, confirmed: true }); $("#goalDialog").close(); }, "目标已删除");
    }
  });
  $("#matterForm").onsubmit = (event) => {
    const body = Object.fromEntries(new FormData(event.target)); body.revision = Number(body.revision);
    for (const key of ["dueAt", "remindAt"]) body[key] = body[key] ? new Date(body[key]).toISOString() : "";
    return submit(event, "/matters", body, "#matterDialog", "事项已保存");
  };
  $("#learningForm").onsubmit = (event) => { const form = event.target.elements; return submit(event, "/learning", { kind: form.kind.value, content: form.content.value, source: { matterId: form.matterId.value, excerpt: form.excerpt.value } }, "#learningDialog", "已加入「记忆 · 待确认」，尚未写入长期记忆"); };
  document.addEventListener("click", async (event) => {
    const b = event.target.closest("button"); if (!b) return;
    if (b.id === "retryLoad") return load();
    if (b.dataset.goalOpen) return showGoal(b.dataset.goalOpen);
    if (b.dataset.edit) return openMatter(b.dataset.edit);
    if (b.dataset.learn) return openLearning(b.dataset.learn);
    if (!b.dataset.ack) return;
    b.disabled = true;
    try { await api("/acknowledge", { id: b.dataset.ack }); toast("已确认提醒"); await load(); }
    catch (error) { toast(error.message); b.disabled = false; }
  });
  window.ClownfishAgentEvents?.connect({ onSync: load, onStatus: (status) => { $("#connection").textContent = status === "connected" ? "" : "连接恢复后会补读事项。"; } });
  setInterval(() => { if (!document.hidden) void load(); }, 30000);
  window.ClownfishIcons.hydrate(); void load();
})();
