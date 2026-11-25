(function (root) {
  "use strict";

  const taskLabels = {
    waiting: "等待中", active: "推进中", paused: "已暂停", completed: "已完成", archived: "已归档",
  };
  const id = (value) => typeof value === "string" && value.length <= 120 && value === value.trim() &&
    value.isWellFormed() && !/[\x00-\x1f\x7f]/u.test(value) ? value : "";
  const text = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
  const timestamp = (value) => typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value));
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const countKeys = [["tasks", "任务"], ["materials", "资料"], ["artifacts", "成果"]];

  function parseProgressQuery(value) {
    if (typeof value !== "string" || value.length > 140 || /[\r\n\u2028\u2029]/u.test(value)) return null;
    const query = value.trim().replace(/[。？！?.!]$/u, "").trimEnd();
    if (/^(?:(?:请|帮我)\s*)?(?:看看?|查看|显示|打开)\s*项目进展(?:卡)?$/u.test(query) ||
        /^(?:这个)?项目(?:现在|目前)?进展(?:如何|怎么样)$/u.test(query)) {
      return { projectTitle: null };
    }

    const named = /^(?:(?:请|帮我)\s*)?(?:看看?|查看|显示|打开)\s*([『「“"'《])([^『』「」“”"'《》]{1,60})([』」”"'》])\s*项目(?:的)?进展(?:卡)?$/u.exec(query);
    const closingQuote = { "『": "』", "「": "」", "“": "”", '"': '"', "'": "'", "《": "》" };
    if (!named || closingQuote[named[1]] !== named[3]) return null;
    const projectTitle = named[2].trim();
    return projectTitle && !/[\x00-\x1f\x7f]/u.test(projectTitle) ? { projectTitle } : null;
  }

  function snapshot(value) {
    if (!object(value) || value.version !== 1 || !timestamp(value.capturedAt)) return null;
    const { space, counts, tasks, artifacts, nextAction } = value;
    if (!object(space) || !id(space.id) || !text(space.title, 160) || !["active", "archived"].includes(space.status)) return null;
    if (!object(counts) || !countKeys.every(([key]) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) return null;
    if (!Array.isArray(tasks) || tasks.length > 3 || tasks.length > counts.tasks ||
        !Array.isArray(artifacts) || artifacts.length > 2 || artifacts.length > counts.artifacts) return null;
    if (!tasks.every((task) => object(task) && id(task.id) && text(task.title, 160) &&
        ["waiting", "active", "paused", "completed"].includes(task.status) && timestamp(task.updatedAt) &&
        (task.archivedAt === undefined || timestamp(task.archivedAt)))) return null;
    if (!artifacts.every((artifact) => object(artifact) && id(artifact.id) && text(artifact.title, 160) &&
        timestamp(artifact.createdAt))) return null;
    if (nextAction !== null && (!object(nextAction) || space.status !== "active" ||
        !id(nextAction.taskId) || !text(nextAction.text, 320))) return null;
    return {
      version: 1,
      capturedAt: value.capturedAt,
      space: { id: space.id, title: text(space.title, 160), status: space.status },
      counts: { tasks: counts.tasks, materials: counts.materials, artifacts: counts.artifacts },
      tasks: tasks.map((task) => ({
        id: task.id, title: text(task.title, 160), status: task.status, updatedAt: task.updatedAt,
        ...(task.archivedAt ? { archivedAt: task.archivedAt } : {}),
      })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id, title: text(artifact.title, 160), format: text(artifact.format, 16), createdAt: artifact.createdAt,
      })),
      nextAction: nextAction ? { taskId: nextAction.taskId, text: text(nextAction.text, 320) } : null,
    };
  }

  function summary(card) {
    const { space, counts, tasks, artifacts, nextAction } = card;
    const date = new Date(card.capturedAt).toLocaleString("zh-CN", { hour12: false });
    const totals = countKeys.map(([key, label]) => counts[key] + " " + label).join(" · ");
    return [
      "项目进展 · " + space.title + " · " + date,
      totals,
      space.status === "archived" ? "项目已归档" : "",
      nextAction ? "下一步：" + nextAction.text : "",
      tasks.length ? "任务：" + tasks.map((task) => task.title).join("、") : "",
      artifacts.length ? "最近成果：" + artifacts.map((artifact) => artifact.title).join("、") : "",
    ].filter(Boolean).join("\n");
  }

  function element(tag, value, className) {
    const node = root.document.createElement(tag);
    if (value) node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function link(value, path, params) {
    const node = element("a", value);
    node.href = path + "?" + new URLSearchParams(params).toString();
    return node;
  }

  function render(container, value, fallback) {
    container.classList.add("chat-project-progress-bubble");
    const card = snapshot(value);
    if (!card) {
      container.append(element("p", text(fallback, 2200) || "项目进展暂时无法显示。", "chat-project-progress-fallback"));
      return;
    }

    const { space, counts, tasks, artifacts, nextAction } = card;
    const article = element("section", "", "chat-project-progress");
    article.setAttribute("aria-label", "项目进展");
    const header = element("header", "", "chat-project-progress-head");
    const title = element("div");
    title.append(element("h3", space.title));
    const capturedDate = new Date(card.capturedAt);
    const time = element("time", "截至 " + capturedDate.toLocaleString("zh-CN", { hour12: false }));
    time.dateTime = capturedDate.toISOString();
    title.append(time);
    header.append(title, link("查看项目", "/spaces", { space: space.id }));
    article.append(header);

    const totals = element("dl", "", "chat-project-progress-totals");
    for (const [key, label] of countKeys) {
      const metric = element("div");
      metric.append(element("dt", label), element("dd", String(counts[key])));
      totals.append(metric);
    }
    article.append(totals);
    if (nextAction) {
      const next = element("div", "", "chat-project-progress-next");
      next.append(element("h4", "下一步"), link(nextAction.text, "/tasks", { space: space.id, task: nextAction.taskId }));
      article.append(next);
    } else if (space.status === "archived") {
      article.append(element("p", "项目已归档", "chat-project-progress-note"));
    } else {
      article.append(element("p", "暂无下一步", "chat-project-progress-note"));
    }

    const taskHeader = element("div", "", "chat-project-progress-section-head");
    taskHeader.append(element("h4", "任务"));
    const taskRows = element("ul", "", "chat-project-progress-rows");
    const taskStatus = (task) => task.archivedAt ? "archived" : task.status;
    const taskList = (filter = "") => {
      const visible = tasks.filter((task) => !filter || taskStatus(task) === filter);
      taskRows.replaceChildren();
      for (const task of visible) {
        const row = element("li");
        row.append(link(task.title, "/tasks", { space: space.id, task: task.id }),
          element("span", taskLabels[taskStatus(task)]));
        taskRows.append(row);
      }
    };
    if (tasks.length) taskList();
    if (new Set(tasks.map(taskStatus)).size > 1) {
      const filter = element("select");
      filter.setAttribute("aria-label", "筛选卡片内的任务");
      filter.append(element("option", "全部"));
      filter.options[0].value = "";
      for (const status of new Set(tasks.map(taskStatus))) {
        const option = element("option", taskLabels[status]);
        option.value = status;
        filter.append(option);
      }
      filter.addEventListener("change", () => taskList(filter.value));
      taskHeader.append(filter);
    }
    article.append(taskHeader, tasks.length ? taskRows : element("p", "暂无任务", "chat-project-progress-note"));

    article.append(element("h4", "最近成果"));
    if (!artifacts.length) {
      article.append(element("p", "暂无成果", "chat-project-progress-note"));
    } else {
      const results = element("ul", "", "chat-project-progress-rows");
      for (const artifact of artifacts) {
        const row = element("li");
        const preview = link(artifact.title, "/api/capabilities/artifact/preview", { id: artifact.id });
        preview.target = "_blank";
        preview.rel = "noopener";
        row.append(preview, element("span", artifact.format.toUpperCase()));
        results.append(row);
      }
      article.append(results);
    }
    container.append(article);
  }

  function createPicker(dialog, { read, current, insert, restoreFocus, notify = () => {} }) {
    const form = dialog.querySelector("form");
    const select = dialog.querySelector("select");
    const status = dialog.querySelector('[role="status"]');
    const submit = dialog.querySelector('[type="submit"]');
    const retry = dialog.querySelector("[data-retry-projects]");
    const cancel = dialog.querySelector("[data-close-projects]");
    let session = null;
    const valid = (request) => request === session && (!request.usesDialog || dialog.open) && current(request.scope);
    const refreshSubmit = () => { submit.disabled = !session || session.pending || !select.value; };

    function resetOptions() {
      select.replaceChildren(element("option", "请选择项目"));
      select.options[0].value = "";
    }

    function showDialog(request) {
      request.usesDialog = true;
      if (dialog.open) return;
      notify("");
      dialog.showModal();
      cancel.focus();
    }

    function showOptions(listed, titles, message) {
      resetOptions();
      const counts = new Map();
      for (const title of titles) counts.set(title, (counts.get(title) || 0) + 1);
      for (const [index, space] of listed.entries()) {
        const title = titles[index];
        const duplicate = counts.get(title) > 1 ? " · " + space.id : "";
        const archived = space.status === "archived" ? "（已归档）" : "";
        const option = element("option", title + archived + duplicate);
        option.value = space.id;
        select.append(option);
      }
      status.textContent = listed.length ? message : "还没有可选择的项目。";
      select.disabled = !listed.length;
      if (listed.length && root.document.activeElement === cancel) select.focus();
    }

    function finishReading(request) {
      if (session !== request) return;
      request.pending = false;
      refreshSubmit();
    }

    async function load(request, message = "") {
      request.pending = true;
      if (request.usesDialog) {
        select.disabled = true;
        resetOptions();
        retry.hidden = true;
        status.textContent = "正在读取项目…";
        refreshSubmit();
      }
      try {
        const result = await read("/api/capabilities");
        if (!valid(request)) return;
        if (!Array.isArray(result?.spaces)) throw new Error("Invalid projects");
        const listed = result.spaces.filter((space) => id(space?.id) && text(space.title, 160));
        if (!request.usesDialog) {
          const matches = listed.filter((space) => space.title.trim() === request.projectTitle);
          if (matches.length === 1) {
            await readProgress(request, matches[0].id);
            return;
          }
          message = matches.length ? "有多个同名项目，请选择。" : "未找到同名项目，请从列表中选择。";
          showDialog(request);
          retry.hidden = true;
        }
        showOptions(listed, listed.map((space) => text(space.title, 160)), message);
      } catch {
        if (!valid(request)) return;
        if (request.usesDialog) {
          status.textContent = "项目列表暂时无法读取。";
          retry.hidden = false;
        } else {
          session = null;
          notify("项目列表暂时无法读取，请重试。");
        }
      } finally {
        finishReading(request);
      }
    }

    async function readProgress(request, selected) {
      request.pending = true;
      if (request.usesDialog) {
        select.disabled = true;
        status.textContent = "正在读取项目进展…";
        retry.hidden = true;
        refreshSubmit();
      }
      try {
        const response = await read("/api/capabilities/space?" + new URLSearchParams({ id: selected, view: "chat-progress" }));
        if (!valid(request)) return;
        const card = snapshot(response);
        if (!card || card.space.id !== selected) throw new Error("Invalid project progress");
        if (!request.usesDialog && card.space.title !== request.projectTitle) {
          await reopenAfterMissingProject(request);
          return;
        }
        const previousInput = insert(request.scope, card, summary(card));
        request.onInserted?.(previousInput);
        session = null;
        if (request.usesDialog) dialog.close("inserted");
        else { notify(""); restoreFocus(); }
      } catch (error) {
        if (!valid(request)) return;
        if (!request.usesDialog) {
          if (error?.status === 404) await reopenAfterMissingProject(request);
          else {
            session = null;
            notify("项目进展暂时无法读取，请重试。");
          }
          return;
        }
        status.textContent = error?.status === 404 ? "项目已不可用，请重新选择或重新读取列表。" : "项目进展暂时无法读取，请重试。";
        retry.hidden = error?.status !== 404;
        select.disabled = false;
      } finally {
        finishReading(request);
      }
    }

    function reopenAfterMissingProject(request) {
      showDialog(request);
      return load(request, "项目已不可用，请重新选择。");
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const request = session;
      if (!request || !dialog.open || !valid(request) || request.pending || !id(select.value)) return;
      return readProgress(request, select.value);
    });
    select.addEventListener("change", () => {
      status.textContent = "";
      retry.hidden = true;
      refreshSubmit();
    });
    retry.addEventListener("click", () => {
      if (session && !session.pending && valid(session)) load(session);
    });
    cancel.addEventListener("click", () => dialog.close("cancel"));
    dialog.addEventListener("close", () => {
      if (dialog.open || (session && !session.usesDialog)) return;
      session = null;
      restoreFocus();
    });

    function discard() {
      session = null;
      notify("");
      if (dialog.open) dialog.close("cancel");
    }

    return {
      open(scope, { projectTitle, onInserted } = {}) {
        if (session || dialog.open || !current(scope)) return;
        session = { scope, projectTitle, onInserted, pending: false, usesDialog: false };
        if (projectTitle) notify("正在读取项目进展…");
        else showDialog(session);
        void load(session);
      },
      closeIfStale() {
        if (session && !current(session.scope)) discard();
      },
      cancelBackground() {
        if (session && !session.usesDialog) discard();
      },
    };
  }

  const api = { snapshot, render, createPicker, parseProgressQuery };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ClownfishChatProjectProgress = api;
})(typeof window !== "undefined" ? window : globalThis);
