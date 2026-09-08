"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        data.userMessage || data.error || `请求失败（${response.status}）`,
      );
    return data;
  }
  let modelState = null;
  const sections = [
    "models",
    "connections",
    "storage",
    "privacy",
    "appearance",
    "advanced",
  ];
  const tabs = [...document.querySelectorAll(".settings-nav [data-section]")];
  document.querySelector(".settings-nav").setAttribute("role", "tablist");
  function activate(section, historyMode = "replace") {
    const id = sections.includes(section) ? section : "models";
    const chooser = document.querySelector("#modelCatalogPanel");
    if (id !== "models" && chooser && !chooser.hidden) {
      chooser.hidden = true;
      document.querySelector("#modelChoiceOpen")?.setAttribute("aria-expanded", "false");
    }
    tabs.forEach((item) => {
      const active = item.dataset.section === id;
      item.classList.toggle("is-current", active);
      item.id = "settings-tab-" + item.dataset.section;
      item.setAttribute("role", "tab");
      item.setAttribute(
        "aria-controls",
        "settings-panel-" + item.dataset.section,
      );
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll("[data-panel]").forEach((item) => {
      const active = item.dataset.panel === id;
      item.classList.toggle("is-current", active);
      item.id = "settings-panel-" + item.dataset.panel;
      item.setAttribute("role", "tabpanel");
      item.setAttribute(
        "aria-labelledby",
        "settings-tab-" + item.dataset.panel,
      );
      item.hidden = !active;
    });
    if (historyMode !== "none" && location.hash !== "#" + id)
      history[historyMode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        "#" + id,
      );
    document.title =
      tabs.find((t) => t.dataset.section === id).textContent +
      " · 设置 · 小丑鱼";
    window.dispatchEvent(new Event("clownfish:navigation"));
  }
  document.querySelector(".settings-nav").onclick = (event) => {
    const button = event.target.closest("[data-section]");
    if (button) activate(button.dataset.section, "push");
  };
  document.querySelector(".settings-nav").onkeydown = (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    const target = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    activate(tabs[target].dataset.section, "push");
    tabs[target].focus();
  };
  window.addEventListener("popstate", () =>
    activate(location.hash.slice(1), "none"),
  );
  window.addEventListener("hashchange", () =>
    activate(location.hash.slice(1), "none"),
  );
  function preset(id) {
    return (modelState?.providers || []).find((item) => item.id === id);
  }
  function updateModelHints() {
    const item = preset($("#modelProvider").value);
    $("#modelProtocol").disabled = $("#modelProvider").value !== "custom";
    $("#modelKey").placeholder = item?.keyRequired
      ? `粘贴 ${item.name} API Key`
      : "本机服务通常无需填写";
    $("#modelKeyHint").textContent =
      modelState?.provider === item?.id && modelState?.hasKey
        ? "已保存密钥；留空继续使用原密钥。"
        : "密钥使用当前 Windows 用户加密，仅保存在本机。";
  }
  function modelCheckLabel(check, state = modelState) {
    return window.ClownfishModelShortlist.checkLabel(check, state);
  }
  function renderModelCatalog(state) {
    const shortlist = window.ClownfishModelShortlist;
    const all = shortlist.catalog(state);
    const common = shortlist.shortlist(state);
    const query = $("#modelCatalogSearch").value.trim().toLocaleLowerCase();
    const base = query
      ? [
          ...new Map(
            [...all, ...common].map((item) => [item.id, item]),
          ).values(),
        ]
      : common;
    const models = base.filter(
      (item) =>
        !query ||
        `${item.id} ${item.displayName || ""}`
          .toLocaleLowerCase()
          .includes(query),
    );
    $("#modelCatalogSummary").textContent =
      `常用 ${common.length} · 目录 ${all.length}${state.catalogStale ? " · 目录待刷新" : ""}`;
    $("#modelCatalogHint").textContent =
      `常用 ${common.length} 个 / 目录 ${all.length} 个；目录存在不代表可用。`;
    $("#modelCatalogResults").innerHTML =
      models
        .map((item) => {
          const enriched = common.find((value) => value.id === item.id) || item;
          const check = shortlist.eligibleCheck(state, item.id);
          const favorite = (state.favoriteModels || []).includes(item.id);
      return `<article class="model-catalog-row" role="listitem" data-current="${item.id === state.model}"><div class="model-catalog-copy"><strong>${escapeHtml(item.displayName || item.id)}</strong><small>${escapeHtml(shortlist.label(enriched, state))}</small>${query ? `<small>${escapeHtml(shortlist.recommendation(item))}</small>` : ""}</div><div class="model-catalog-actions"><button type="button" data-model-select="${escapeHtml(item.id)}">设为默认（不检查）</button><button type="button" data-model-favorite="${escapeHtml(item.id)}" data-favorite="${favorite}">${favorite ? "移出常用" : "加入常用"}</button><button type="button" data-model-check="${escapeHtml(item.id)}">检查模型（可能产生费用）${check ? ` · ${escapeHtml(modelCheckLabel(check, state))}` : ""}</button></div></article>`;
        })
        .join("") ||
      '<p class="status">没有匹配的目录型号；可在上方手动登记 ID。</p>';
  }
  function syncModelChoice() {
    const id = $("#modelName").value;
    $("#modelChoiceOpen").querySelector(".cf-model-name").textContent =
      id || "选择模型";
    $("#modelChoiceOpen").querySelector(".cf-model-trigger-tag").textContent =
      modelCheckLabel(modelState?.modelChecks?.[id], modelState);
  }
  function openModelCatalog() {
    if (!modelState) return;
    const panel = $("#modelCatalogPanel");
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    $("#modelCatalogSearch").value = "";
    panel.hidden = false;
    $("#modelChoiceOpen").setAttribute("aria-expanded", "true");
    renderModelCatalog(modelState);
    $("#modelCatalogSearch").focus();
  }
  function closeModelCatalog() {
    $("#modelCatalogPanel").hidden = true;
    $("#modelChoiceOpen").setAttribute("aria-expanded", "false");
    $("#modelChoiceOpen").focus();
  }
  $("#modelCatalogToggle").onclick = openModelCatalog;
  $("#modelChoiceOpen").onclick = openModelCatalog;
  $("#modelCatalogClose").onclick = closeModelCatalog;
  $("#modelCatalogSearch").oninput = () =>
    modelState && renderModelCatalog(modelState);
  $("#modelCatalogPanel").onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModelCatalog();
    } else if (
      event.key === "Enter" &&
      event.target === $("#modelCatalogSearch")
    ) {
      event.preventDefault();
      $("#modelCatalogResults [data-model-select]")?.click();
    }
  };
  function renderModel(state, fill = false) {
    modelState = state;
    $("#modelCurrentTitle").textContent = state.live
      ? `${state.providerName} · 已配置 · ${modelCheckLabel(state.check, state)}`
      : "离线模式";
    $("#modelCurrentDetail").textContent = state.live
      ? `默认模型：${state.model} · ${state.check?.detail || "已配置，尚未进行能力检查。"}`
      : "连接模型后可以使用在线对话";
    $("#modelDot").classList.toggle("live", state.check?.chat === "passed");
    $("#modelOffline").disabled = !state.live;
    $("#modelCatalogToggle").disabled = false;
    renderModelCatalog(state);
    $("#modelCheckList").innerHTML = Object.entries(state.modelChecks || {})
      .map(
        ([id, check]) =>
          `<article class="connection-row"><div><h3>${escapeHtml(id)}<span class="badge ${check.tools === "passed" ? "ready" : ""}">${modelCheckLabel(check, state)}</span></h3><p>${escapeHtml(check.detail)}</p><p>检查时间：${escapeHtml(new Date(check.checkedAt).toLocaleString())} · 仅适用于当前连接版本</p></div></article>`,
      )
      .join("");
    syncModelChoice();
    if (!fill) return;
    $("#modelProvider").innerHTML = (state.providers || [])
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`,
      )
      .join("");
    $("#modelProvider").value = state.provider || "custom";
    const item = preset($("#modelProvider").value) || {};
    $("#modelProtocol").value =
      state.protocol || item.protocol || "openai-compatible";
    $("#modelBaseUrl").value = state.baseUrl || item.baseUrl || "";
    $("#modelName").value = state.model || item.model || "";
    $("#modelSelectionMode").value = state.live
      ? state.selectionMode || "manual"
      : "auto";
    updateModelHints();
    syncModelChoice();
  }
  async function loadModel() {
    try {
      renderModel(await api("/api/llm"), true);
    } catch (error) {
      $("#modelStatus").className = "status error";
      $("#modelStatus").textContent = error.message;
    }
  }
  $("#modelProvider").onchange = () => {
    const item = preset($("#modelProvider").value);
    if (item) {
      $("#modelProtocol").value = item.protocol;
      $("#modelBaseUrl").value = item.baseUrl;
    }
    $("#modelKey").value = "";
    updateModelHints();
  };
  $("#modelCatalogResults").onclick = async (event) => {
    const select = event.target.closest("[data-model-select]"),
      favorite = event.target.closest("[data-model-favorite]"),
      check = event.target.closest("[data-model-check]");
    if (select) {
      $("#modelName").value = select.dataset.modelSelect;
      syncModelChoice();
      closeModelCatalog();
      $("#modelStatus").textContent =
        "已选择新默认型号；尚未保存，也没有发起检查。";
      return;
    }
    if (favorite) {
      favorite.disabled = true;
      try {
        const state = await api("/api/llm-model/favorite", {
          method: "POST",
          body: JSON.stringify({
            model: favorite.dataset.modelFavorite,
            favorite: favorite.dataset.favorite !== "true",
          }),
        });
        renderModel(state);
        $("#modelCatalogStatus").textContent =
          favorite.dataset.favorite === "true"
            ? "已移出常用；历史检查仍保留。"
            : "已加入常用；未发起模型检查。";
      } catch (error) {
        $("#modelCatalogStatus").textContent = error.message;
      }
      return;
    }
    if (check) {
      if (
        !confirm(
          `检查 ${check.dataset.modelCheck} 会发送少量合成请求，可能产生模型费用。继续吗？`,
        )
      )
        return;
      check.disabled = true;
      $("#modelCatalogStatus").textContent =
        "正在检查这一个型号；不会尝试其他型号…";
      try {
        const state = await api("/api/llm-model/check", {
          method: "POST",
          body: JSON.stringify({
            model: check.dataset.modelCheck,
            force: true,
          }),
        });
        renderModel(state);
        $("#modelCatalogStatus").textContent =
          state.checked?.detail || "检查完成。";
      } catch (error) {
        $("#modelCatalogStatus").textContent =
          "检查未通过；默认型号没有改变。" + error.message;
      }
      return;
    }
  };
  $("#modelCustomAdd").onclick = async () => {
    const id = $("#modelCustomId").value.trim();
    if (!id) {
      $("#modelCatalogStatus").textContent = "请输入模型 ID。";
      return;
    }
    try {
      const state = await api("/api/llm-model/favorite", {
        method: "POST",
        body: JSON.stringify({ model: id, favorite: true }),
      });
      $("#modelCustomId").value = "";
      renderModel(state);
      $("#modelCatalogStatus").textContent =
        `已登记 ${id}；目录外不等于不可用，但当前仍未验证。`;
    } catch (error) {
      $("#modelCatalogStatus").textContent = error.message;
    }
  };
  $("#modelCatalogRefresh").onclick = async () => {
    const button = $("#modelCatalogRefresh");
    button.disabled = true;
    $("#modelCatalogStatus").textContent = "只读取服务商目录，不检查任何模型…";
    try {
      const state = await api("/api/llm-model/catalog", {
        method: "POST",
        body: "{}",
      });
      renderModel(state);
      $("#modelCatalogStatus").textContent =
        `目录已刷新，共 ${state.models?.length || 0} 个型号；没有发起能力检查。`;
    } catch (error) {
      $("#modelCatalogStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  $("#modelForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#modelSave");
    button.disabled = true;
    $("#modelStatus").className = "status";
    $("#modelStatus").textContent =
      "正在保存连接；不读取目录、不检查模型，也不会自动换型号…";
    try {
      const state = await api("/api/llm-config", {
        method: "POST",
        body: JSON.stringify({
          provider: $("#modelProvider").value,
          protocol: $("#modelProtocol").value,
          baseUrl: $("#modelBaseUrl").value.trim(),
          model: $("#modelName").value.trim(),
          selectionMode: $("#modelSelectionMode").value,
          key: $("#modelKey").value.trim(),
        }),
      });
      renderModel(state, true);
      $("#modelKey").value = "";
      $("#modelStatus").className = "status success";
      $("#modelStatus").textContent =
        `已保存 ${state.model}；当前状态为${modelCheckLabel(state.check, state)}。${state.catalogWarning || ""}`;
    } catch (error) {
      $("#modelStatus").className = "status error";
      $("#modelStatus").textContent = `未保存：${error.message}`;
    } finally {
      button.disabled = false;
    }
  };
  $("#modelOffline").onclick = async () => {
    try {
      renderModel(
        await api("/api/llm-config", {
          method: "POST",
          body: JSON.stringify({ offline: true }),
        }),
        true,
      );
      $("#modelStatus").className = "status success";
      $("#modelStatus").textContent = "已切换到离线模式。";
    } catch (error) {
      $("#modelStatus").className = "status error";
      $("#modelStatus").textContent = error.message;
    }
  };
  function renderConnections(connectors = []) {
    const labels = {
      ready: "运行时就绪",
      available: "待连接",
      "not-installed": "未安装",
    };
    $("#connectionList").innerHTML = connectors
      .filter(
        (item) =>
          item.provider === "built-in" ||
          item.extensionId ||
          !["not-installed", "available"].includes(item.state),
      )
      .map(
        (item) =>
          `<article class="connection-row"><div><h3>${escapeHtml(item.name)}<span class="badge ${item.state}">${escapeHtml(item.provider === "built-in" && item.state === "ready" ? "可用" : labels[item.state] || item.state)}</span></h3><p>${escapeHtml(item.purpose)} · ${item.provider === "built-in" ? "应用内置" : "扩展提供"}</p><p>${escapeHtml(item.detail || item.fallback || "")}</p></div>${item.state === "ready" ? `<button data-test="${escapeHtml(item.id)}">测试连接</button>` : item.extensionId ? `<button data-manage-extension>管理连接器</button>` : ""}</article>`,
      )
      .join("");
  }
  function renderBundledPlugins(items = []) {
    const runtimeLabels = {
      "dependencies-ready": "依赖已就绪",
      "configured-unverified": "已配置·未验证",
      "needs-configuration": "需要配置",
      "missing-dependency": "缺少依赖",
    };
    $("#bundledPluginList").innerHTML = items
      .map(
        (item) =>
          `<article class="connection-row"><div><h3>${escapeHtml(item.name)}<span class="badge ${item.installed ? "ready" : ""}">${item.installed ? "已安装" : item.installable ? "可登记" : "不可登记"}</span><span class="badge ${item.runtimeState === "dependencies-ready" ? "ready" : ""}">${escapeHtml(runtimeLabels[item.runtimeState] || "状态未知")}</span></h3><p>${escapeHtml(item.description)}</p><p>${escapeHtml(item.dependencySummary || "依赖信息未提供。")}</p><p>${escapeHtml(item.runtimeSummary || "尚未提供运行条件说明。")}</p>${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ""}</div>${item.installed ? "" : `<button data-install-bundled="${escapeHtml(item.id)}" ${item.installable ? "" : "disabled"}>安装</button>`}</article>`,
      )
      .join("");
  }
  function renderCapabilityRuntime(registry = {}, executionState = {}) {
    const counts = registry.counts || {};
    const providers = Array.isArray(registry.providers)
      ? registry.providers
      : [];
    const executions = Array.isArray(executionState.executions)
      ? executionState.executions
      : [];
    const summary = `<article class="connection-row"><div><h3>任务执行<span class="badge ready">已接入</span></h3><p>${Number(counts.readyTools || 0)} 个工具可直接调用 · ${Number(counts.integratedTools || 0)} 项由产品流程承接</p></div></article>`;
    const providerRows = providers
      .map(
        (item) =>
          `<article class="connection-row"><div><h3>${escapeHtml(item.name)}<span class="badge ${item.available ? "ready" : ""}">${item.available ? "可用" : "未配置"}</span></h3><p>${escapeHtml(item.detail || "尚未提供状态说明")}${item.model ? ` · ${escapeHtml(item.model)}` : ""}</p></div></article>`,
      )
      .join("");
    const executionRows = executions.length
      ? `<article class="connection-row"><div><h3>最近执行</h3>${executions
          .slice(0, 10)
          .map(
            (item) =>
              `<p><b>${escapeHtml(item.toolId)}</b> · ${escapeHtml({ succeeded: "成功", failed: "失败", cancelled: "已取消", "timed-out": "超时" }[item.status] || item.status)} · ${Number(item.durationMs || 0)}ms · ${escapeHtml(item.source?.id || "clownfish")}</p>`,
          )
          .join("")}</div></article>`
      : `<article class="connection-row"><div><h3>最近执行</h3><p>还没有直接工具执行记录。</p></div></article>`;
    $("#capabilityRuntimeList").innerHTML =
      summary + providerRows + executionRows;
  }
  function renderExtensions(items = [], updateState = {}) {
    const updates = new Map(
      (updateState.items || []).map((item) => [item.id, item]),
    );
    $("#extensionList").innerHTML = items.length
      ? items
          .map((item) => {
            const update = updates.get(item.manifest?.id);
            const updateButton = update?.updateAvailable
              ? `<button data-upgrade-extension="${escapeHtml(update.id)}" data-version="${escapeHtml(update.latestVersion)}" data-risk="${escapeHtml(update.risk)}">升级到 ${escapeHtml(update.latestVersion)}</button>`
              : "";
            const updateDetail = update?.reasons?.length
              ? ` · ${escapeHtml(update.reasons.join("；"))}`
              : "";
            return `<article class="connection-row"><div><h3>${escapeHtml(item.manifest?.name || item.manifest?.id)}<span class="badge ${item.enabled ? "ready" : ""}">${item.enabled ? "已启用" : "已停用"}</span>${update?.updateAvailable ? `<span class="badge ${update.risk === "compatible" ? "ready" : ""}">${update.risk === "compatible" ? "可升级" : "需确认"}</span>` : ""}</h3><p>${escapeHtml(item.manifest?.version || "")}${item.runtimeError ? ` · ${escapeHtml(item.runtimeError)}` : ""}${updateDetail}</p></div><div>${updateButton}<button data-toggle="${escapeHtml(item.manifest.id)}" data-enabled="${item.enabled ? "1" : "0"}">${item.enabled ? "停用" : "启用"}</button></div></article>`;
          })
          .join("")
      : '<p class="status">还没有安装扩展。</p>';
  }
  async function loadPlatform() {
    try {
      const [platform, extensions, registry, executions, extensionUpdates] =
        await Promise.all([
          api("/api/platform/readiness"),
          api("/api/agent/extensions"),
          api("/api/capabilities/registry"),
          api("/api/capabilities/executions?limit=10"),
          api("/api/agent/extension-updates"),
        ]);
      renderConnections(platform.connectors);
      renderBundledPlugins(platform.bundledPlugins || []);
      renderCapabilityRuntime(registry, executions);
      renderExtensions(extensions.extensions, extensionUpdates);
    } catch (error) {
      $("#connectionStatus").className = "status error";
      $("#connectionStatus").textContent = error.message;
    }
  }
  $("#connectionList").onclick = async (event) => {
    const test = event.target.closest("[data-test]");
    if (event.target.closest("[data-manage-extension]"))
      $("#extensionList").scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    if (!test) return;
    try {
      const result = await api("/api/platform/connector/test", {
        method: "POST",
        body: JSON.stringify({ id: test.dataset.test }),
      });
      $("#connectionStatus").className = "status success";
      $("#connectionStatus").textContent =
        result.note || `连接正常，发现 ${result.toolCount} 个可用工具。`;
    } catch (error) {
      $("#connectionStatus").className = "status error";
      $("#connectionStatus").textContent = error.message;
    }
  };
  $("#bundledPluginList").onclick = async (event) => {
    const button = event.target.closest("[data-install-bundled]");
    if (!button) return;
    const isBrowser = button.dataset.installBundled === "browser.playwright";
    if (
      isBrowser &&
      !confirm(
        "浏览器操作会启动隔离的 Chrome，并可访问你交给任务的网页。确认安装吗？",
      )
    )
      return;
    button.disabled = true;
    try {
      await api("/api/platform/bundled-plugin/install", {
        method: "POST",
        body: JSON.stringify({
          id: button.dataset.installBundled,
          confirmExecutable: isBrowser,
        }),
      });
      $("#connectionStatus").className = "status success";
      $("#connectionStatus").textContent = "能力插件已安装并启用。";
      await loadPlatform();
    } catch (error) {
      button.disabled = false;
      $("#connectionStatus").className = "status error";
      $("#connectionStatus").textContent = error.message;
    }
  };
  $("#extensionList").onclick = async (event) => {
    const upgrade = event.target.closest("[data-upgrade-extension]");
    const button = event.target.closest("[data-toggle]");
    try {
      if (upgrade) {
        const risky = upgrade.dataset.risk !== "compatible";
        if (risky && !confirm("新版本改变了权限或运行结构。确认审查后升级吗？"))
          return;
        upgrade.disabled = true;
        await api("/api/agent/extension-updates/upgrade", {
          method: "POST",
          body: JSON.stringify({
            id: upgrade.dataset.upgradeExtension,
            latestVersion: upgrade.dataset.version,
            acceptRisk: risky,
            confirmPermissionExpansion: risky,
            confirmUnsandboxed: risky,
          }),
        });
        $("#connectionStatus").className = "status success";
        $("#connectionStatus").textContent = "扩展已完成校验并升级。";
        await loadPlatform();
        return;
      }
      if (!button) return;
      await api("/api/agent/extension/enabled", {
        method: "POST",
        body: JSON.stringify({
          id: button.dataset.toggle,
          enabled: button.dataset.enabled !== "1",
        }),
      });
      await loadPlatform();
    } catch (error) {
      if (upgrade) upgrade.disabled = false;
      $("#connectionStatus").className = "status error";
      $("#connectionStatus").textContent = error.message;
    }
  };
  $("#importExtension").onclick = () => $("#extensionFile").click();
  $("#extensionUpdateCheck").onclick = async () => {
    const button = $("#extensionUpdateCheck");
    button.disabled = true;
    $("#connectionStatus").textContent = "正在检查扩展版本和权限变化…";
    try {
      await api("/api/agent/extension-updates/check", {
        method: "POST",
        body: "{}",
      });
      await loadPlatform();
      $("#connectionStatus").className = "status success";
      $("#connectionStatus").textContent = "扩展更新检查完成。";
    } catch (error) {
      $("#connectionStatus").className = "status error";
      $("#connectionStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  $("#extensionFile").onchange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const manifest = JSON.parse(await file.text());
      const validation = await api("/api/agent/extension/validate", {
        method: "POST",
        body: JSON.stringify({ manifest }),
      });
      const review = validation.validation || {};
      const expanded = Array.isArray(review.permissionExpansion)
        ? review.permissionExpansion
        : [];
      const risks = [
        review.requiresExecutableConfirmation ? "会启动本机程序" : "",
        review.requiresUnsandboxedConfirmation ? "无法使用受限沙箱" : "",
        expanded.length ? `新增权限：${expanded.join("、")}` : "",
      ].filter(Boolean);
      if (
        risks.length &&
        !confirm(
          `连接器“${manifest.name || manifest.id}”${risks.join("，")}。确认安装吗？`,
        )
      )
        return;
      await api(
        review.installed
          ? "/api/agent/extension/upgrade"
          : "/api/agent/extension/install",
        {
          method: "POST",
          body: JSON.stringify({
            manifest,
            confirmExecutable: !!review.requiresExecutableConfirmation,
            confirmUnsandboxed: !!review.requiresUnsandboxedConfirmation,
            confirmPermissionExpansion: expanded.length > 0,
          }),
        },
      );
      $("#connectionStatus").className = "status success";
      $("#connectionStatus").textContent = review.installed
        ? "扩展已更新。"
        : "连接器已安装。";
      await loadPlatform();
    } catch (error) {
      $("#connectionStatus").className = "status error";
      $("#connectionStatus").textContent = error.message;
    }
  };
  let storageState = null;
  function renderStorage(state) {
    storageState = state;
    const settings = state.settings || state;
    const server = settings.mode === "server";
    $("#storageMode").value = server ? "server" : "local";
    $("#serverStorageFields").hidden = !server;
    $("#syncEndpoint").value = settings.endpoint || "";
    $("#syncUserId").value = settings.userId || "me";
    $("#syncToken").value = "";
    $("#syncPassphrase").value = "";
    $("#syncTokenHint").textContent = settings.hasToken
      ? "访问令牌已加密保存；留空继续使用。"
      : "令牌只加密保存在本机。";
    $("#syncPassphraseHint").textContent = settings.hasPassphrase
      ? "加密口令已保存；留空继续使用。"
      : "至少 12 个字符；丢失后服务器快照无法恢复。";
    $("#storageCurrentTitle").textContent = server
      ? "自托管服务器同步"
      : "纯本地保存";
    $("#storageCurrentDetail").textContent = server
      ? settings.lastSyncedAt
        ? `最近同步：${new Date(settings.lastSyncedAt).toLocaleString("zh-CN")}`
        : "尚未完成首次同步"
      : "数据不会上传到小丑鱼服务器";
    $("#storageDot").classList.toggle("live", server && !settings.lastError);
    ["#testStorage", "#pushStorage", "#pullStorage"].forEach((id) => {
      $(id).hidden = !server;
    });
    if (settings.lastError) {
      $("#storageStatus").className = "status error";
      $("#storageStatus").textContent = settings.lastError;
    }
  }
  async function loadStorage() {
    try {
      renderStorage(await api("/api/data-sync"));
    } catch (error) {
      $("#storageStatus").className = "status error";
      $("#storageStatus").textContent = error.message;
    }
  }
  $("#storageMode").onchange = () => {
    $("#serverStorageFields").hidden = $("#storageMode").value !== "server";
  };
  $("#storageForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#saveStorage");
    button.disabled = true;
    $("#storageStatus").className = "status";
    $("#storageStatus").textContent = "正在保存…";
    try {
      const result = await api("/api/data-sync/settings", {
        method: "POST",
        body: JSON.stringify({
          mode: $("#storageMode").value,
          endpoint: $("#syncEndpoint").value.trim(),
          userId: $("#syncUserId").value.trim(),
          token: $("#syncToken").value,
          passphrase: $("#syncPassphrase").value,
        }),
      });
      renderStorage(result);
      $("#storageStatus").className = "status success";
      $("#storageStatus").textContent = "数据保存方式已更新。";
    } catch (error) {
      $("#storageStatus").className = "status error";
      $("#storageStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  async function storageOperation(operation) {
    const labels = {
      test: "正在测试连接…",
      push: "正在加密并备份…",
      pull: "正在下载并校验恢复数据…",
    };
    $("#storageStatus").className = "status";
    $("#storageStatus").textContent = labels[operation];
    try {
      const result = await api(`/api/data-sync/${operation}`, {
        method: "POST",
        body: "{}",
      });
      renderStorage(result);
      $("#storageStatus").className = "status success";
      $("#storageStatus").textContent =
        operation === "test"
          ? "服务器连接正常。"
          : operation === "push"
            ? "加密备份已上传。"
            : "恢复数据已安全下载，将在重启小丑鱼后生效。";
    } catch (error) {
      $("#storageStatus").className = "status error";
      $("#storageStatus").textContent = error.message;
    }
  }
  $("#testStorage").onclick = () => storageOperation("test");
  $("#pushStorage").onclick = () => storageOperation("push");
  $("#pullStorage").onclick = () => {
    if (
      confirm(
        "从服务器下载的数据会在重启后替换本机同步数据。当前模型密钥不会被替换。继续吗？",
      )
    )
      storageOperation("pull");
  };
  function ensureRetainedOutputPanel() {
    const storagePanel = document.querySelector('[data-panel="storage"]');
    if (!storagePanel || $("#retainedOutputList")) return;
    storagePanel.insertAdjacentHTML(
      "beforeend",
      `<section class="retained-output-panel" aria-labelledby="retainedOutputTitle"><div class="retained-output-head"><div><h3 id="retainedOutputTitle">保留的产出</h3><p>删除归档记录时选择保留的文件会集中放在这里。</p></div><span id="retainedOutputCount">0</span></div><div class="retained-output-list" id="retainedOutputList"><p class="status">正在读取…</p></div></section>`,
    );
  }
  function renderRetainedOutputs(items = []) {
    $("#retainedOutputCount").textContent = String(items.length);
    $("#retainedOutputList").innerHTML = items.length
      ? items
          .map(
            (item) =>
              `<article class="retained-output-row"><div><h4>${escapeHtml(item.title || item.originalTaskTitle || "保留文件")}</h4><p>${escapeHtml(String(item.format || "file").toUpperCase())} · 保留于 ${escapeHtml(new Date(item.retainedAt || item.createdAt).toLocaleString("zh-CN"))}</p></div><div class="retained-output-actions"><a class="button" target="_blank" rel="noopener" href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.id)}">查看</a><a class="button" href="/api/capabilities/artifact?id=${encodeURIComponent(item.id)}&download=1">下载</a><button type="button" data-delete-retained="${escapeHtml(item.id)}">彻底删除</button></div></article>`,
          )
          .join("")
      : `<p class="status">目前没有单独保留的产出文件。</p>`;
  }
  async function loadRetainedOutputs() {
    ensureRetainedOutputPanel();
    try {
      renderRetainedOutputs(
        (await api("/api/capabilities")).retainedArtifacts || [],
      );
    } catch (error) {
      $("#retainedOutputList").innerHTML =
        `<p class="status error">${escapeHtml(error.message)}</p>`;
    }
  }
  ensureRetainedOutputPanel();
  $("#retainedOutputList").onclick = async (event) => {
    const button = event.target.closest("[data-delete-retained]");
    if (!button || !confirm("彻底删除这个文件？删除后无法恢复。")) return;
    button.disabled = true;
    try {
      await api("/api/capabilities/retained-artifact/delete", {
        method: "POST",
        body: JSON.stringify({
          id: button.dataset.deleteRetained,
          confirm: true,
        }),
      });
      await loadRetainedOutputs();
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  };
  async function loadPrivacy() {
    try {
      const state = await api("/api/runtime");
      const version = escapeHtml(state.manifest?.version || "未知");
      $("#privacyList").innerHTML =
        `<div class="privacy-row"><div><b>隐私协议 · v${version}</b><p>生效日期：2026 年 8 月 17 日。说明本机保存、外部模型、插件、同步、导出和删除边界。</p></div><a class="button" href="https://github.com/mmlong818/nemos/blob/main/PRIVACY.md" target="_blank" rel="noopener">查看协议</a></div><div class="privacy-row"><div><b>本机数据目录</b><p>${escapeHtml(state.dataDir)}</p></div></div><div class="privacy-row"><div><b>数据何时离开本机</b><p>仅在你配置并使用模型、搜索、插件或自托管同步时，必要内容才会发送给对应服务。</p></div></div><div class="privacy-row"><div><b>记忆与偏好</b><p>可查看、修正和删除整理后的记忆，不展示内部原始归档。</p></div><a class="button" href="/memory">查看记忆</a></div><div class="privacy-row"><div><b>运行与审计记录</b><p>能力执行、权限确认和异常都可以追溯。</p></div><a class="button" href="/runs">查看记录</a></div><div class="privacy-row"><div><b>备份</b><p>${state.backups?.latest ? `最近备份：${escapeHtml(state.backups.latest)}` : "暂未读取到备份记录"}</p></div></div>`;
    } catch (error) {
      $("#privacyList").innerHTML =
        `<p class="status error">${escapeHtml(error.message)}</p>`;
    }
  }
  window.ClownfishIcons?.hydrate();
  activate(location.hash.slice(1));
  loadModel();
  loadPlatform();
  loadStorage();
  loadRetainedOutputs();
  loadPrivacy();
})();
