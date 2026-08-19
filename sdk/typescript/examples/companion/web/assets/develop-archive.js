"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  let projects = [];
  let pendingDelete = null;

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.userMessage || data.error || `请求失败（${response.status}）`);
    return data;
  }

  function formatTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function projectName(path) {
    return String(path || "").split(/[\\/]/).filter(Boolean).pop() || "目录未记录";
  }

  function render() {
    $("#archiveCount").textContent = `${projects.length} 个项目`;
    $("#archiveProjectList").innerHTML = projects.length ? projects.map((project) => `
      <article class="archive-project-card">
        <div class="archive-project-icon"><span data-app-icon="code" aria-hidden="true"><span></span></span></div>
        <div class="archive-project-copy">
          <h2>${escapeHtml(project.title)}</h2>
          <p title="${escapeHtml(project.workspacePath)}">${escapeHtml(projectName(project.workspacePath))}</p>
          <small>归档于 ${escapeHtml(formatTime(project.archivedAt))} · ${Number(project.turnCount || 0)} 次开发记录</small>
        </div>
        <div class="archive-project-actions">
          <button type="button" data-restore="${escapeHtml(project.rootJobId)}">恢复项目</button>
          <button class="danger" type="button" data-delete="${escapeHtml(project.rootJobId)}">彻底删除</button>
        </div>
      </article>`).join("") : `
      <section class="archive-empty">
        <span class="archive-empty-icon"><span data-app-icon="boxes" aria-hidden="true"><span></span></span></span>
        <h2>还没有归档项目</h2>
        <p>在开发页归档的项目会安全地保存在这里。</p>
        <a class="archive-empty-back" href="/develop">返回开发</a>
      </section>`;
    window.ClownfishIcons?.hydrate({ root: $("#archiveProjectList") });
  }

  async function load() {
    try {
      const result = await api("/api/development/project-archive");
      projects = result.projects || [];
      render();
    } catch (error) {
      $("#archiveStatus").className = "archive-status error";
      $("#archiveStatus").textContent = error.message;
    }
  }

  async function restore(rootJobId) {
    const button = document.querySelector(`[data-restore="${CSS.escape(rootJobId)}"]`);
    if (button) button.disabled = true;
    try {
      await api("/api/development/project/restore", { method: "POST", body: JSON.stringify({ rootJobId }) });
      projects = projects.filter((project) => project.rootJobId !== rootJobId);
      render();
    } catch (error) {
      $("#archiveStatus").className = "archive-status error";
      $("#archiveStatus").textContent = error.message;
      if (button) button.disabled = false;
    }
  }

  function confirmDelete(project) {
    pendingDelete = project;
    const dialog = $("#archiveDeleteDialog");
    $("#archiveDeleteTitle").textContent = `彻底删除「${project.title}」？`;
    $("#deleteWorkspace").checked = false;
    $("#deleteWorkspace").disabled = !project.managedWorkspace;
    $("#archiveDirectoryChoice").hidden = !project.managedWorkspace;
    $("#deleteWorkspacePath").textContent = project.workspacePath || "";
    $("#archiveDeleteNote").textContent = project.managedWorkspace
      ? "不勾选时，本地目录和其中的文件不会改变。"
      : "这是外部关联目录，小丑鱼只会删除项目记录，不会删除本地文件。";
    $("#confirmArchiveDelete").textContent = "只删除记录";
    dialog.showModal();
  }

  $("#deleteWorkspace").addEventListener("change", () => {
    $("#confirmArchiveDelete").textContent = $("#deleteWorkspace").checked ? "删除记录和目录" : "只删除记录";
  });

  $("#archiveDeleteDialog").addEventListener("close", async () => {
    const project = pendingDelete;
    pendingDelete = null;
    if (!project || $("#archiveDeleteDialog").returnValue !== "confirm") return;
    const deleteWorkspace = $("#deleteWorkspace").checked && project.managedWorkspace;
    $("#archiveStatus").className = "archive-status";
    $("#archiveStatus").textContent = deleteWorkspace ? "正在删除项目记录和开发目录…" : "正在删除项目记录…";
    try {
      await api("/api/development/project/delete", {
        method: "POST",
        body: JSON.stringify({
          rootJobId: project.rootJobId,
          deleteWorkspace,
          confirmation: "delete-archived-development-project",
        }),
      });
      projects = projects.filter((item) => item.rootJobId !== project.rootJobId);
      $("#archiveStatus").textContent = deleteWorkspace ? "项目记录和开发目录已删除。" : "项目记录已删除，本地目录保持不变。";
      render();
    } catch (error) {
      $("#archiveStatus").className = "archive-status error";
      $("#archiveStatus").textContent = error.message;
    }
  });

  $("#archiveProjectList").addEventListener("click", (event) => {
    const restoreButton = event.target.closest("[data-restore]");
    if (restoreButton) return restore(restoreButton.dataset.restore);
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      const project = projects.find((item) => item.rootJobId === deleteButton.dataset.delete);
      if (project) confirmDelete(project);
    }
  });

  window.ClownfishIcons?.hydrate();
  load();
})();
