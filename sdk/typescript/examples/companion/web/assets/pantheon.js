(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const stage = $("#debateStage");
  const main = $(".pantheon-main");
  const errorBox = $("#pantheonError");
  const phaseStatus = $("#phaseStatus");
  const seatRationale = $("#seatRationale");
  const libraryStatus = $("#libraryStatus");
  const SESSION_KEY = "clownfish:pantheon:session-id";
  const state = { session: null, catalog: [], units: [], busy: false };
  const phaseNames = { planned: "等待开场", positions: "独立立论", questions: "定向质询", responses: "回应质询", summary: "主持总结", paused: "等待你的选择", complete: "讨论完成" };
  const kindNames = { position: "独立立论", question: "定向质询", response: "回应", moderator: "主持人", user: "用户插话" };
  const statusNames = { draft: "草案", review: "待确认", approved: "已确认", published: "已发布" };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || "请求没有成功");
    return body;
  }

  function setBusy(busy, message) {
    state.busy = busy;
    main.setAttribute("aria-busy", String(busy));
    if (message) phaseStatus.querySelector("small").textContent = message;
    // Seat inputs also depend on the busy flag. Re-render here so the controls
    // become editable immediately after create/advance settles.
    if (state.session && state.catalog.length) renderSeats();
    renderControls();
  }

  function showError(error) {
    errorBox.hidden = false;
    errorBox.setAttribute("role", "alert");
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }

  function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }

  function renderStatus() {
    const session = state.session;
    if (!session) {
      phaseStatus.querySelector("span").textContent = "尚未开议";
      phaseStatus.querySelector("small").textContent = "写下议题即可自动配席";
      return;
    }
    const remaining = session.limits.maxReservedTokens - session.usage.reservedTokens;
    phaseStatus.querySelector("span").textContent = phaseNames[session.phase] || session.phase;
    phaseStatus.querySelector("small").textContent = state.busy ? "席位正在组织本阶段内容…" : `第 ${session.round} 轮 · 剩余模型预算 ${remaining} tokens`;
    $("#roundMeter").textContent = `第 ${session.round} / ${session.limits.maxRounds} 轮`;
  }

  function renderSeats() {
    seatRationale.replaceChildren();
    const session = state.session;
    if (!session) {
      seatRationale.setAttribute("data-empty", "true");
      seatRationale.append(node("p", "empty-copy", "系统会选择 1–3 个互补方法，并公开命中线索和边界。"));
      $("#intentReason").textContent = "等待议题";
      return;
    }
    seatRationale.setAttribute("data-empty", "false");
    $("#intentReason").textContent = `${session.plan.issueScope} · ${session.plan.intentReason}`;
    const selected = new Map(session.plan.seats.map((seat) => [seat.modelId, seat]));
    for (const model of state.catalog) {
      const seat = selected.get(model.id);
      const wrap = node("div", "seat-choice");
      const label = node("label");
      const input = document.createElement("input");
      input.type = "checkbox"; input.name = "pantheonSeat"; input.value = model.id; input.checked = Boolean(seat);
      input.disabled = !(session.phase === "planned" || session.phase === "paused") || state.busy;
      label.append(input, node("span", "", model.displayName));
      wrap.append(label, node("p", "", seat?.selectionReason || model.lens));
      wrap.append(node("small", "", `${model.source === "private" ? "私有已确认" : "内置公开方法"} · ${seat ? `命中 ${seat.matchedSignals.join("、")}` : "可手动入席"}`));
      seatRationale.append(wrap);
    }
    $("#saveSeats").hidden = !(session.phase === "planned" || session.phase === "paused");
  }

  function renderTranscript() {
    stage.replaceChildren();
    const transcript = state.session?.transcript || [];
    if (!transcript.length) {
      stage.setAttribute("data-empty", "true");
      const empty = node("li", "stage-empty");
      empty.append(node("strong", "", "大殿已经配席"), node("span", "", "核对左侧选择理由后开始。每个席位会先独立立论，不会看到其他席位的未发表内容。"));
      stage.append(empty);
      return;
    }
    stage.setAttribute("data-empty", "false");
    for (const entry of transcript) {
      const item = node("li", "stage-entry");
      item.dataset.kind = entry.kind;
      const speaker = node("div", "speaker", entry.seatName || (entry.kind === "moderator" ? "主持人" : "你"));
      const meta = node("small", "", `${kindNames[entry.kind] || entry.kind} · 第 ${entry.round} 轮${entry.targetSeatName ? ` → ${entry.targetSeatName}` : ""}`);
      speaker.append(meta);
      item.append(speaker, node("p", "", entry.text));
      stage.append(item);
    }
    stage.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderAudit() {
    const box = $("#auditTrail"); box.replaceChildren();
    const session = state.session;
    if (!session) { box.append(node("p", "", "暂无审计记录。")); return; }
    box.append(node("p", "", `硬限制：${session.limits.maxSeats} 席 / ${session.limits.maxRounds} 轮 / 并发 ${session.limits.maxConcurrentCalls} / ${session.limits.maxReservedTokens} tokens`));
    for (const entry of session.audit) box.append(node("p", "", `${new Date(entry.at).toLocaleTimeString()} · ${entry.reason}`));
  }

  function renderControls() {
    const session = state.session;
    const advance = $("#advancePhase"); const more = $("#continueRound"); const converge = $("#convergeDebate");
    const input = $("#interjectionText"); const send = $("#interjectionForm button");
    const labels = { planned: "开始独立立论", positions: "开始独立立论", questions: "进入定向质询", responses: "回应质询", summary: "请主持人总结" };
    advance.textContent = session ? labels[session.phase] || "等待你的选择" : "开始立论";
    advance.disabled = !session || state.busy || !labels[session.phase];
    more.hidden = session?.phase !== "paused"; more.disabled = state.busy || !session || session.round >= session.limits.maxRounds;
    converge.disabled = !session || state.busy || session.phase === "planned" || session.phase === "complete";
    input.disabled = !session || session.phase === "complete" || state.busy; send.disabled = input.disabled;
    renderStatus();
  }

  function renderSession() { renderStatus(); renderSeats(); renderTranscript(); renderAudit(); renderControls(); }

  async function loadCatalog() {
    const body = await api("/api/pantheon/catalog"); state.catalog = body.models; renderSeats();
  }

  async function advance(action = "next") {
    if (!state.session) return;
    clearError(); setBusy(true, "正在推进下一阶段…");
    try {
      const body = await api("/api/pantheon/session/advance", { method: "POST", body: JSON.stringify({ sessionId: state.session.id, action }) });
      state.session = body.session; renderSession();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  $("#issueForm").addEventListener("submit", async (event) => {
    event.preventDefault(); clearError(); setBusy(true, "正在识别意图与议题范围…");
    stage.innerHTML = '<li class="loading-line" aria-label="正在安排思维席位"></li>';
    try {
      const intent = $("#intentMode").value;
      const body = await api("/api/pantheon/session", { method: "POST", body: JSON.stringify({ issue: $("#pantheonIssue").value, ...(intent === "auto" ? {} : { intent }) }) });
      state.session = body.session;
      localStorage.setItem(SESSION_KEY, state.session.id);
      await loadCatalog(); renderSession();
    } catch (error) { showError(error); renderTranscript(); }
    finally { setBusy(false); }
  });

  $("#saveSeats").addEventListener("click", async () => {
    const modelIds = [...document.querySelectorAll('input[name="pantheonSeat"]:checked')].map((input) => input.value);
    clearError(); setBusy(true, "正在应用席位调整…");
    try {
      const body = await api("/api/pantheon/session/models", { method: "POST", body: JSON.stringify({ sessionId: state.session.id, modelIds }) });
      state.session = body.session; renderSession();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  });
  $("#advancePhase").addEventListener("click", () => advance("next"));
  $("#continueRound").addEventListener("click", () => advance("continue"));
  $("#convergeDebate").addEventListener("click", () => advance("converge"));

  $("#interjectionForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const input = $("#interjectionText");
    if (!state.session || !input.value.trim()) return;
    clearError();
    try {
      const body = await api("/api/pantheon/session/interject", { method: "POST", body: JSON.stringify({ sessionId: state.session.id, text: input.value }) });
      input.value = ""; state.session = body.session; renderSession();
    } catch (error) { showError(error); }
  });

  const thoughtFields = ["applicableProblems", "corePrinciples", "judgmentSteps", "counterexamplesAndLimits", "questioningStyle", "uncertaintyStatements"];
  const thoughtLabels = { applicableProblems: "适用问题", corePrinciples: "核心原则", judgmentSteps: "判断步骤", counterexamplesAndLimits: "反例 / 边界", questioningStyle: "质询方式", uncertaintyStatements: "禁用 / 不确定声明" };
  function splitLines(value) { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8); }

  function thoughtButton(label, action, id) {
    const button = node("button", "", label); button.type = "button";
    button.addEventListener("click", () => updateThoughtStatus(id, action)); return button;
  }

  function renderThoughts() {
    const box = $("#thoughtUnits"); box.replaceChildren();
    libraryStatus.textContent = state.units.length ? `${state.units.length} 个本地私有思维单元` : "还没有私有思维单元。你可以先创建一份草案。";
    for (const unit of state.units) {
      const article = node("article", "thought-unit"); article.dataset.id = unit.id;
      const header = node("header"); header.append(node("h3", "", unit.displayName), node("span", "", `${statusNames[unit.status]} · v${unit.version}${unit.enabled ? "" : " · 已停用"}`));
      article.append(header, node("p", "disclaimer", `${unit.identityDisclaimer} 来源：${unit.provenance.map((item) => item.label).join("；")}`));
      const grid = node("div", "thought-unit-grid");
      if (unit.status === "draft" || unit.status === "review") {
        const nameLabel = node("label", "thought-name-field", "显示名称");
        const nameInput = document.createElement("input"); nameInput.dataset.displayName = "true"; nameInput.value = unit.displayName; nameInput.maxLength = 80;
        nameLabel.append(nameInput); grid.append(nameLabel);
      }
      for (const field of thoughtFields) {
        const label = node("label", "", thoughtLabels[field]); const textarea = document.createElement("textarea");
        textarea.dataset.field = field; textarea.value = unit[field].join("\n"); textarea.disabled = unit.status === "approved" || unit.status === "published";
        label.append(textarea); grid.append(label);
      }
      article.append(grid);
      const actions = node("div", "thought-actions");
      if (unit.status === "draft" || unit.status === "review") {
        const save = node("button", "", "保存编辑"); save.type = "button"; save.addEventListener("click", () => saveThought(unit.id)); actions.append(save);
      }
      if (unit.status === "draft") actions.append(thoughtButton("提交审阅", "submit_review", unit.id));
      if (unit.status === "review") actions.append(thoughtButton("确认并加入私有库", "approve", unit.id));
      if (unit.status === "approved") actions.append(thoughtButton("标记为已发布版本", "publish", unit.id));
      if (unit.status === "approved" || unit.status === "published") actions.append(thoughtButton(unit.enabled ? "停用" : "重新启用", unit.enabled ? "disable" : "enable", unit.id));
      const remove = node("button", "", "删除私有单元"); remove.type = "button"; remove.addEventListener("click", () => deleteThought(unit.id)); actions.append(remove);
      article.append(actions); box.append(article);
    }
  }

  async function loadThoughts() {
    try { const body = await api("/api/pantheon/thoughts"); state.units = body.units; renderThoughts(); }
    catch (error) { libraryStatus.textContent = error instanceof Error ? error.message : String(error); }
  }

  async function restoreSession() {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) return;
    try {
      const body = await api(`/api/pantheon/session?id=${encodeURIComponent(sessionId)}`);
      state.session = body.session;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      showError(new Error("上次讨论已随服务重启结束，请重新提出议题。"));
    }
  }

  async function saveThought(id) {
    const article = document.querySelector(`.thought-unit[data-id="${CSS.escape(id)}"]`); if (!article) return;
    const patch = { id };
    const displayName = article.querySelector("input[data-display-name]"); if (displayName) patch.displayName = displayName.value;
    for (const textarea of article.querySelectorAll("textarea[data-field]")) patch[textarea.dataset.field] = splitLines(textarea.value);
    try { await api("/api/pantheon/thought", { method: "POST", body: JSON.stringify(patch) }); await loadThoughts(); }
    catch (error) { libraryStatus.textContent = error instanceof Error ? error.message : String(error); }
  }

  async function updateThoughtStatus(id, action) {
    try {
      await api("/api/pantheon/thought/status", { method: "POST", body: JSON.stringify({ id, action }) });
      await Promise.all([loadThoughts(), loadCatalog()]);
    } catch (error) { libraryStatus.textContent = error instanceof Error ? error.message : String(error); }
  }

  async function deleteThought(id) {
    if (!window.confirm("删除这份本地私有思维单元？此操作不会影响其他数据。")) return;
    try { await api("/api/pantheon/thought/delete", { method: "POST", body: JSON.stringify({ id }) }); await Promise.all([loadThoughts(), loadCatalog()]); }
    catch (error) { libraryStatus.textContent = error instanceof Error ? error.message : String(error); }
  }

  $("#distillForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    libraryStatus.textContent = "正在生成结构化草案…";
    try {
      const material = $("#thoughtMaterial").value;
      await api("/api/pantheon/distill", { method: "POST", body: JSON.stringify({
        displayName: $("#thoughtName").value, kind: $("#thoughtKind").value,
        sourceLabel: $("#sourceLabel").value, ...(material.trim() ? { material, sourceKind: "user_material" } : {}),
      }) });
      form.reset();
      await loadThoughts();
    } catch (error) { libraryStatus.textContent = error instanceof Error ? error.message : String(error); }
  });

  Promise.all([loadCatalog(), loadThoughts()]).then(restoreSession).catch(showError).finally(() => renderSession());
})();
