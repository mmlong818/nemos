(() => {
  const artifactId = document.body.dataset.artifactId || "";
  if (!artifactId) return;

  const noteFields = [...document.querySelectorAll("#workNotes,#workbenchNotes")];
  const status = document.getElementById("workbenchStatus");
  const checks = [...document.querySelectorAll("[data-check]")];
  const versions = document.getElementById("workbenchVersions");
  const message = document.getElementById("workbenchDiff");
  let state = { body: "", notes: {}, checks: {}, status: "draft", revision: 0, versions: [] };
  let saveTimer;
  let hydrating = false;
  let bodyField = null;

  function capture() {
    const notes = {};
    const checked = {};
    noteFields.forEach((field) => { notes[field.id] = field.value; });
    checks.forEach((field) => { checked[field.dataset.check] = field.checked; });
    return { body: bodyField?.value || "", notes, checks: checked, status: status?.value || "draft" };
  }

  function apply(next) {
    hydrating = true;
    state = next;
    ensureEvidenceWorkspace(next);
    if (bodyField) bodyField.value = next.body || "";
    noteFields.forEach((field) => { field.value = next.notes?.[field.id] || ""; });
    checks.forEach((field) => { field.checked = next.checks?.[field.dataset.check] === true; });
    if (status) status.value = next.status || "draft";
    drawVersions();
    hydrating = false;
  }

  function ensureEvidenceWorkspace(next) {
    if (!next.evidence || document.getElementById("editableArtifactBody")) return;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "editableArtifactBody";
    panel.innerHTML = `<div class="section-head"><div><p class="kicker">正文与证据分离</p><h2>可编辑正文</h2></div><span>正文可以修改，证据包保持原样</span></div>
      <textarea id="editableBody" aria-label="可编辑正文" placeholder="在这里整理最终正文"></textarea>
      <p class="save-hint">不可变证据包：${Number(next.evidence.sourceCount || 0)} 个来源 · ${Number(next.evidence.anchorCount || 0)} 个锚点 · SHA-256 ${escapeAttribute(String(next.evidence.hash || "").slice(0, 16))}…</p>`;
    document.querySelector("footer")?.before(panel);
    bodyField = panel.querySelector("#editableBody");
    bodyField?.addEventListener("input", queueSave);
  }
  function drawVersions() {
    if (!versions) return;
    versions.innerHTML = state.versions?.length
      ? state.versions.map((item) => `<option value="${escapeAttribute(item.id)}">${new Date(item.createdAt).toLocaleString()} · ${statusLabel(item.status)}</option>`).join("")
      : '<option value="">尚未保存版本</option>';
  }

  async function request(action, data = {}) {
    const endpoint = action === "get" ? `/api/capabilities/artifact/workspace?id=${encodeURIComponent(artifactId)}` : "/api/capabilities/artifact/workspace";
    const response = await fetch(endpoint, {
      method: action === "get" ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "get" ? undefined : JSON.stringify({ id: artifactId, action, expectedRevision: state.revision, ...data }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "工作台状态保存失败");
    return result.state;
  }

  async function saveCurrent() {
    if (hydrating) return;
    try {
      if (message) message.textContent = "正在保存…";
      state = await request("save", { current: capture() });
      if (message) message.textContent = "已保存到本机";
    } catch (error) {
      if (message) message.textContent = error.message || "保存失败";
    }
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 350);
  }

  noteFields.forEach((field) => field.addEventListener("input", queueSave));
  checks.forEach((field) => field.addEventListener("change", queueSave));
  status?.addEventListener("change", queueSave);
  document.getElementById("workbenchSaveVersion")?.addEventListener("click", async () => {
    try {
      state = await request("version", { current: capture() });
      apply(state);
      if (message) message.textContent = "版本已保存到本机";
    } catch (error) {
      if (message) message.textContent = error.message || "版本保存失败";
    }
  });
  document.getElementById("workbenchRestoreVersion")?.addEventListener("click", async () => {
    if (!versions?.value) return;
    try {
      state = await request("restore", { versionId: versions.value });
      apply(state);
      if (message) message.textContent = "已恢复所选版本";
    } catch (error) {
      if (message) message.textContent = error.message || "版本恢复失败";
    }
  });

  request("get").then((saved) => {
    apply(saved);
    if (message) message.textContent = saved.updatedAt ? "已载入本机状态" : "内容会自动保存到本机";
  }).catch((error) => {
    if (message) message.textContent = error.message || "无法载入工作台状态";
  });

  function statusLabel(value) {
    return value === "done" ? "已确认" : value === "review" ? "待复核" : "整理中";
  }

  function escapeAttribute(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  }
})();
