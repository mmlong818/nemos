(() => {
  const $ = (q) => document.querySelector(q);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = (value) => value ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未设时间";
  let data = { matters: [], proposals: [], reminders: [], tasks: [], artifacts: [] }, filter = "ongoing", sequence = 0, toastTimer;
  const stateName = { active: "推进中", waiting: "等待中", paused: "已暂停", completed: "已完成", pending: "待你确认", accepting: "确认待恢复", confirmed: "已记住", rejected: "不学习", revoking: "撤回待恢复", revoked: "已撤回" };
  async function api(path = "", body) {
    const response = await fetch(`/api/personal-work${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "操作未完成，请重试");
    return payload;
  }
  function toast(message) { $("#toast").textContent = message; $("#toast").hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4000); }
  async function load() {
    const id = ++sequence;
    try { const result = await api(); if (id !== sequence) return; data = result; render(); }
    catch (error) { if (id === sequence) { $("#connection").textContent = error.message; if (!data.matters.length) $("#records").innerHTML = '<p>记录暂时无法读取。<button id="retryLoad">重新读取</button></p>'; } }
  }
  function render() {
    const query = $("#search").value.trim().toLowerCase();
    $("#reminders").innerHTML = data.reminders.map((r) => `<div class="personal-reminder"><p><strong>${esc(r.matter.title)}</strong><br>${esc(r.matter.waitingFor || r.matter.nextAction)} · ${date(r.fireAt)}</p><button data-ack="${esc(r.id)}">知道了</button></div>`).join("");
    if (filter === "learning") {
      const entries = data.proposals.filter((p) => `${p.content} ${p.source.excerpt}`.toLowerCase().includes(query));
      $("#records").innerHTML = '<div class="learning-head"><p>只有你确认的内容，才会进入长期记忆。</p><button id="newLearning">提议记住</button></div>' + (entries.map((p) => `<article class="personal-item"><header><span>${esc({ preference: "稳定偏好", decision: "已确认决定", constraint: "长期约束" }[p.kind])}</span><span class="personal-state">${stateName[p.state]}</span></header><p class="learning-content">${esc(p.content)}</p><p class="learning-source">来源：${esc(p.source.excerpt || "手动提议")}</p><div class="personal-actions">${["pending", "accepting"].includes(p.state) ? `<button class="primary" data-decision="confirm" data-id="${p.id}">确认记住</button>${p.state === "pending" ? `<button data-decision="reject" data-id="${p.id}">不学习这条</button>` : ""}` : ["confirmed", "revoking"].includes(p.state) ? `<button data-decision="revoke" data-id="${p.id}">撤回学习</button><a href="/memory">查看记忆</a>` : ""}</div></article>`).join("") || '<div class="personal-empty"><h2>让它逐渐更懂你</h2><p>从已完成事项提议记住一个决定，或手动添加稳定偏好。</p></div>');
      return;
    }
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
    filter=['ongoing','completed','learning'].includes(value)?value:'ongoing';
    document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===filter)));
    if(updateUrl){const next=new URL(location.href);next.searchParams.set('view',filter);history.replaceState(null,'',next.pathname+next.search+next.hash);window.ClownfishNavigation?.sync();}
    render();
  }
  $("#filters").onclick = (event) => { const button=event.target.closest('[data-filter]');if(button)selectFilter(button.dataset.filter); };
  selectFilter(new URLSearchParams(location.search).get('view'),false);
  $("#search").oninput = render;
  document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => document.getElementById(b.dataset.close).close(); });
  async function submit(event, path, body, dialog, message) {
    event.preventDefault(); const form = event.target, button = form.querySelector('[type="submit"]'); button.disabled = true;
    try { await api(path, body); $(dialog).close(); toast(message); await load(); }
    catch (error) { form.querySelector(".form-error").textContent = error.message; }
    finally { button.disabled = false; }
  }
  $("#matterForm").onsubmit = (event) => {
    const body = Object.fromEntries(new FormData(event.target)); body.revision = Number(body.revision);
    for (const key of ["dueAt", "remindAt"]) body[key] = body[key] ? new Date(body[key]).toISOString() : "";
    return submit(event, "/matters", body, "#matterDialog", "事项已保存");
  };
  $("#learningForm").onsubmit = (event) => { const form = event.target.elements; return submit(event, "/learning", { kind: form.kind.value, content: form.content.value, source: { matterId: form.matterId.value, excerpt: form.excerpt.value } }, "#learningDialog", "已加入待确认，尚未写入长期记忆"); };
  document.addEventListener("click", async (event) => {
    const b = event.target.closest("button"); if (!b) return;
    if (b.id === "newLearning") return openLearning();
    if (b.id === "retryLoad") return load();
    if (b.dataset.edit) return openMatter(b.dataset.edit);
    if (b.dataset.learn) return openLearning(b.dataset.learn);
    if (!b.dataset.ack && !b.dataset.decision) return;
    if (b.dataset.decision && !confirm(b.dataset.decision === "confirm" ? "确认这条内容真实属于你，并同意作为长期记忆使用？" : b.dataset.decision === "revoke" ? "撤回后这条记忆将不再作为当前事实使用，处理记录仍会保留。" : "不将这条提议写入长期记忆？")) return;
    b.disabled = true;
    try {
      if (b.dataset.ack) await api("/acknowledge", { id: b.dataset.ack });
      else { const p = data.proposals.find((item) => item.id === b.dataset.id); await api("/decision", { id: p.id, revision: p.revision, action: b.dataset.decision, confirmed: true }); }
      toast(b.dataset.ack ? "已确认提醒" : "学习记录已更新"); await load();
    } catch (error) { toast(error.message); b.disabled = false; }
  });
  window.ClownfishAgentEvents?.connect({ onSync: load, onStatus: (status) => { $("#connection").textContent = status === "connected" ? "" : "连接恢复后会补读事项。"; } });
  setInterval(() => { if (!document.hidden) void load(); }, 30000);
  window.ClownfishIcons.hydrate(); void load();
})();
