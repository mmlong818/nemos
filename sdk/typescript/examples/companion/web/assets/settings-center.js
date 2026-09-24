"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  document.querySelector('[data-panel="models"] .section-head p').textContent =
    "填写 OpenAI 或智谱 Key 后，系统会自动筛选、验证并配置推荐模型。";
  $("#modelSave").textContent = "保存并读取模型";
  $("#modelSave").insertAdjacentHTML("afterend", '<button id="modelSaveOnly" type="button">仅保存</button><button id="modelTest" type="button">重新测试所选型号</button><button id="modelConnectCancel" type="button" hidden>取消</button>');
  document.querySelector("#modelForm > small.field.full").textContent =
    "保存后只读取厂商允许的账号目录或官方候选，不产生生成费用。模型与媒体能力由你随后显式验证；已有默认模型不会被替换。";
  document.querySelector("#modelCatalogPanel header strong").textContent = "模型库与批量管理";
  const connectedServicesSection = $("#modelProviderConnections")?.closest?.(".model-resource-section");
  connectedServicesSection?.insertAdjacentHTML("afterend", '<section class="model-resource-section model-library-primary" id="modelLibraryPrimary"><div class="section-head"><h3>模型库</h3><p>一个连接可以同时启用多个模型；系统默认和各应用仍分别选择一个模型或自动选择。</p></div><ol class="model-library-steps"><li><b>1　复选并启用</b><small>只保存本地配置，零模型调用</small></li><li><b>2　测试所选</b><small>发送合成请求，可能产生少量费用，并发上限 2</small></li><li><b>3　分配用途</b><small>在下方为系统和 4 个应用分别单选或自动</small></li></ol><div class="model-library-stats" id="modelLibraryStats" aria-live="polite"></div><div class="model-library-toolbar"><div><strong>已启用与官方推荐</strong><small>默认显示已启用模型，以及可以启用的官方推荐。</small></div><div class="form-actions"><span id="modelBatchCount" class="status">未选择</span><button type="button" id="modelBatchEnable">启用所选</button><button type="button" id="modelBatchDisable">停用所选</button><button type="button" id="modelBatchCheck">测试所选（可能产生费用）</button></div></div><div id="modelPrimaryResults" class="model-catalog-results model-primary-results" role="list"></div></section>');
  $("#modelLibraryPrimary")?.appendChild?.($("#modelCatalogStatus"));
  $("#modelCustomAdd").textContent = "添加并启用";
  document.querySelector(".model-advanced-fields .form-grid")?.insertAdjacentHTML(
    "beforeend",
    '<label class="field full"><span>模型网络</span><select id="modelNetworkMode"><option value="auto">自动（Windows 默认）</option><option value="system">系统代理</option><option value="direct">直连</option></select><small id="modelNetworkStatus">自动检测当前 Windows 用户的固定代理；不会下载或执行 PAC 脚本。</small></label>',
  );
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
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        data.userMessage || data.error || `请求失败（${response.status}）`,
      );
      error.modelDiagnostic = safeModelDiagnostic(data.diagnostic);
      error.steps = Array.isArray(data.steps) ? data.steps : [];
      error.response = data;
      throw error;
    }
    return data;
  }
  let modelState = null;
  let selectedConnectionId = null;
  let activeOnboardingController = null;
  let policyConfirmedState = null;
  let policyUiSnapshot = null;
  const selectedLibraryModels = new Set();
  const sections = [
    "models",
    "connections",
    "storage",
    "privacy",
    "reminders",
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
  function providerDefinition(id = $("#modelProvider")?.value) {
    return modelState?.resourceCenter?.providerCatalog?.providers?.find((item) => item.providerId === id) || null;
  }
  function currentConnectionId() {
    return selectedConnectionId || $("#modelConnectionId")?.value || undefined;
  }
  function selectedConnection(state) {
    return state?.resourceCenter?.connections?.find((item) => item.id === selectedConnectionId) || null;
  }
  function restoreSelectedConnectionContext(state, { hydrate = false } = {}) {
    const item = selectedConnection(state);
    if (!item) return;
    modelState = { ...state, ...item, models: item.models || [], rawModels: item.rawModels || [], catalogConnectionRevision: item.connectionRevision };
    $("#modelConnectionId").value = item.id;
    if (hydrate) {
      $("#modelProvider").value = item.provider;
      $("#modelProtocol").value = item.protocol;
      $("#modelBaseUrl").value = item.baseUrl;
      $("#modelName").value = item.model;
      $("#modelKey").value = "";
      updateModelHints();
      syncModelChoice();
    }
    renderModelCatalog(modelState);
  }
  function updateModelHints() {
    const item = preset($("#modelProvider").value);
    const definition = providerDefinition();
    $("#modelProtocol").disabled = $("#modelProvider").value !== "custom";
    const custom = definition?.providerId === "custom";
    $("#modelBaseUrlField").hidden = !custom;
    $("#modelProviderNote").textContent = definition
      ? definition.verificationPolicy?.note || definition.note
      : item?.note || "选择服务商。";
    const connection = selectedConnection(modelState) || modelState?.resourceCenter?.connections?.find((candidate) => candidate.provider === definition?.providerId && candidate.active);
    const credentialStatus = connection?.credentialStatus || {};
    const settings = connection?.providerSettings || {};
    $("#modelProviderFields").innerHTML = [
      ...(definition?.credentialFields || []).map((field) => `<label class="field"><span>${escapeHtml(field.label)}</span><input type="password" autocomplete="new-password" data-provider-credential="${escapeHtml(field.id)}" placeholder="${credentialStatus[field.id] ? "已加密保存；留空保持不变" : "请输入"}"><small>${credentialStatus[field.id] ? "已保存" : field.required ? "必填" : "可选"} · 仅由当前 Windows 用户加密保存在本机</small></label>`),
      ...(definition?.settingFields || []).filter((field) => !["baseUrl", "protocol"].includes(field.id)).map((field) => {
        const value = settings[field.id] || "";
        const control = field.kind === "select"
          ? `<select data-provider-setting="${escapeHtml(field.id)}">${(field.options || []).map((option) => `<option value="${escapeHtml(option.value)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`
          : `<input data-provider-setting="${escapeHtml(field.id)}" value="${escapeHtml(value)}" autocomplete="off">`;
        return `<label class="field"><span>${escapeHtml(field.label)}</span>${control}<small>${escapeHtml(field.note || (field.required ? "必填" : "可选"))}</small></label>`;
      }),
    ].join("");
    $("#modelLegacyKeyField").hidden = true;
  }
  function modelCheckLabel(check, state = modelState) {
    return window.ClownfishModelShortlist.checkLabel(check, state);
  }
  const capabilityLabels = { chat: "对话与任务", vision: "看图理解", speech_to_text: "语音输入", text_to_speech: "朗读回复", image_generation: "生成图片", video_generation: "生成视频" };
  const ttsPreviewPlayer = window.ClownfishTtsPreviewPlayer.create();
  const mediaWorkbench = window.ClownfishTtsPreviewPlayer.createWorkbench({ player: ttsPreviewPlayer, query: $, fetchFn: fetch, api, escapeHtml });
  function resourceOption(resource, connections) {
    const connection = connections.find((item) => item.id === resource.connectionId);
    const pending = resource.executionState?.[resource._capability] === "integration_pending";
    const unverified = resource.evidence?.verified !== true;
    return `${connection?.label || connection?.providerName || "连接"} · ${resource.modelId}${resource.runtimeSnapshot ? " · 当前仍在运行（配置已变更，待测试）" : resource.lifecycle === "retired" ? ` · 已停止推荐${resource.replacement ? `，改用 ${resource.replacement}` : ""}` : unverified ? " · 尚未验证" : pending ? " · 功能接入中" : ""}`;
  }
  function assignmentValue(assignment) {
    return assignment?.mode === "fixed" ? JSON.stringify([assignment.ref.connectionId, assignment.ref.modelId]) : "auto";
  }
  function policyControlKey(element) {
    if (!element) return "";
    if (element.matches("select[data-routing-scope]")) {
      return `routing:${element.dataset.routingScope || ""}:${element.dataset.scene || ""}:${element.dataset.capability || ""}`;
    }
    if (element.matches("select[data-reasoning-scope]")) {
      return `reasoning:${element.dataset.reasoningScope || ""}:${element.dataset.scene || ""}`;
    }
    return "";
  }
  function findPolicyControl(key) {
    if (!key) return null;
    return [...document.querySelectorAll("#modelCapabilityAssignments select")]
      .find((item) => policyControlKey(item) === key) || null;
  }
  function captureModelUiState(focusElement = document.activeElement) {
    const applicationDetails = document.querySelector("#modelCapabilityAssignments .model-application-overrides");
    return {
      applicationOverridesOpen: Boolean(applicationDetails?.open),
      focusKey: policyControlKey(focusElement),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }
  function restoreModelUiState(snapshot) {
    if (!snapshot) return;
    const applicationDetails = document.querySelector("#modelCapabilityAssignments .model-application-overrides");
    if (applicationDetails) applicationDetails.open = snapshot.applicationOverridesOpen;
    const nextFocus = findPolicyControl(snapshot.focusKey);
    if (nextFocus) nextFocus.focus({ preventScroll: true });
    window.scrollTo(snapshot.scrollX, snapshot.scrollY);
  }
  function setPolicyControlsDisabled(disabled) {
    document.querySelectorAll("#modelCapabilityAssignments select").forEach((item) => { item.disabled = disabled; });
  }
  function policyStatus(scope, scene, kind = "routing") {
    const selector = `[data-policy-status-kind="${kind}"][data-policy-status-scope="${scope}"][data-policy-status-scene="${scene || ""}"]`;
    return document.querySelector(selector);
  }
  function showPolicyStatus(scope, scene, kind, message, state = "") {
    const target = policyStatus(scope, scene, kind);
    if (!target) return;
    target.className = `model-policy-save-status status${state ? ` ${state}` : ""}`;
    target.textContent = message;
  }
  function syncPolicyControlsFromServer(state) {
    const center = state?.resourceCenter;
    if (!center) return;
    document.querySelectorAll("#modelCapabilityAssignments select[data-routing-scope]").forEach((select) => {
      const capability = select.dataset.capability;
      const assignment = select.dataset.routingScope === "scene"
        ? center.assignments?.scenes?.[select.dataset.scene]?.[capability]
        : center.assignments?.system?.[capability];
      const value = select.dataset.routingScope === "scene"
        ? assignment?.mode === "fixed" ? assignmentValue(assignment) : "inherit"
        : assignmentValue(assignment || { mode: "auto" });
      if ([...select.options].some((option) => option.value === value)) select.value = value;
    });
    document.querySelectorAll("#modelCapabilityAssignments select[data-reasoning-scope]").forEach((select) => {
      const value = select.dataset.reasoningScope === "scene"
        ? center.chatPreferences?.scenes?.[select.dataset.scene]?.reasoningEffort || "inherit"
        : center.chatPreferences?.system?.reasoningEffort || "auto";
      if ([...select.options].some((option) => option.value === value)) select.value = value;
    });
  }
  function operationStatus(operation, message, state = "") {
    showPolicyStatus(operation.scope, operation.scene, operation.kind, message, state);
  }
  const policySaveQueue = window.ClownfishPolicySaveQueue.createLatestPolicyQueue({
    execute: (operation) => api(operation.url, {
      method: "POST",
      body: JSON.stringify(operation.body),
    }),
    onQueued: (operation) => {
      if (!policySaveQueue.isRunning()) policyConfirmedState = modelState;
      policyUiSnapshot = captureModelUiState(operation.element);
      setPolicyControlsDisabled(true);
      operationStatus(operation, "正在保存最新选择…");
    },
    onCommitted: (state) => {
      policyConfirmedState = state;
      modelState = state;
    },
    onSettled: (outcomes) => {
      renderModel(policyConfirmedState || modelState, false, policyUiSnapshot);
      let lastMessage = "";
      let hasError = false;
      for (const outcome of outcomes.values()) {
        if (outcome.ok) {
          operationStatus(outcome.operation, "已保存", "success");
          lastMessage = outcome.operation.kind === "reasoning" ? "思考强度已保存。" : "能力分配已保存。";
        } else {
          const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
          operationStatus(outcome.operation, `未保存：${message}`, "error");
          lastMessage = message;
          hasError = true;
        }
      }
      setPolicyControlsDisabled(false);
      $("#modelStatus").className = `status ${hasError ? "error" : "success"}`;
      $("#modelStatus").textContent = lastMessage;
    },
  });
  function assignmentOptions(center, capability, selected, allowFixed, { activeOnly = false, includeAuto = true } = {}) {
    const activeConnectionId = (center.connections || []).find((item) => item.active)?.id;
    const resources = (center.resources || []).filter((item) => item.enabled !== false && (item.capabilities || []).includes(capability)
      && item.evidence?.verified === true && item.evidence?.health !== "unhealthy"
      && item.executionState?.[capability] === "available"
      && (!activeOnly || item.connectionId === activeConnectionId));
    const values = new Set(resources.map((item) => JSON.stringify([item.connectionId, item.modelId])));
    let unavailable = "";
    if (selected && selected !== "auto" && !values.has(selected)) {
      try {
        const [, modelId] = JSON.parse(selected);
        unavailable = `<option value="${escapeHtml(selected)}" selected disabled>${escapeHtml(modelId)} · 已保存固定引用，当前未连接或不可用</option>`;
      } catch { /* invalid historical values remain hidden */ }
    }
    return `${includeAuto ? `<option value="auto"${selected === "auto" ? " selected" : ""}>自动选择</option>` : ""}${unavailable}` + resources.map((item) => {
      const value = JSON.stringify([item.connectionId, item.modelId]);
      const enabled = allowFixed && item.readOnly !== true && item.lifecycle !== "retired" && item.evidence?.verified === true && item.evidence?.health !== "unhealthy" && item.executionState?.[capability] === "available";
      return `<option value="${escapeHtml(value)}"${selected === value ? " selected" : ""}${enabled ? "" : " disabled"}>${escapeHtml(resourceOption({ ...item, _capability: capability }, center.connections || []))}</option>`;
    }).join("");
  }
  const effortLabels = { auto: "模型默认", none: "关闭", low: "低", medium: "中等", high: "高", xhigh: "更高", max: "最高" };
  function reasoningOptions(state, modelId, current, inherit = false) {
    const supported = state.reasoningEfforts?.[modelId] || [];
    const choices = ["auto", ...supported];
    return `${inherit ? `<option value="inherit"${current === "inherit" ? " selected" : ""}>跟随系统默认</option>` : ""}${choices.map((value) => `<option value="${value}"${current === value ? " selected" : ""}>${escapeHtml(effortLabels[value] || value)}</option>`).join("")}`;
  }
  function renderResourceCenter(state) {
    const center = state.resourceCenter || { connections: [], resources: [], assignments: { system: {}, scenes: {} }, automaticRoutes: {} };
    const purposeSection = $("#modelCapabilityAssignments")?.closest(".model-resource-section");
    if (purposeSection) {
      purposeSection.querySelector("h3").textContent = "用途设置";
      purposeSection.querySelector(".section-head p").textContent = "为日常用途设置默认模型。只有经过连接验证并已接通实际执行流程的用途才可以选择。";
    }
    $("#modelProviderConnections").innerHTML = `<div class="form-actions"><button type="button" data-new-model-connection>添加另一连接</button></div>` + ((center.connections || []).map((item) => `<article class="connection-row"><div><h3>${escapeHtml(item.label)}${item.active ? '<span class="badge ready">当前连接</span>' : ""}</h3><p>${escapeHtml(item.providerName)} · ${escapeHtml(item.baseUrl)} · 已启用 ${item.enabledModels?.length || 0} 个 / 已验证 ${item.modelStates?.filter((model) => model.verified).length || 0} 个</p><p>${item.hasKey ? "密钥已加密保存" : "无需密钥或尚未填写"} · ${item.endpointWarning ? escapeHtml(item.endpointWarning) : item.catalogSource === "maintained" ? "官方维护目录" : item.catalogSource === "provider" ? `账号目录 ${item.rawModels?.length || 0} 个` : "目录未读取"}</p></div><button type="button" data-edit-model-connection="${escapeHtml(item.id)}">编辑模型库</button></article>`).join("") || '<p class="status">尚未连接模型服务。</p>');
    const activeConnection = (center.connections || []).find((item) => item.id === selectedConnectionId) || (center.connections || []).find((item) => item.active);
    const enabledCount = activeConnection?.enabledModels?.length || 0;
    const verifiedCount = activeConnection?.modelStates?.filter((model) => model.enabled && model.verified).length || 0;
    const poolHint = verifiedCount
      ? `已启用 ${enabledCount}，已验证 ${verifiedCount}${enabledCount > verifiedCount ? `；另 ${enabledCount - verifiedCount} 个测试后可选` : ""}`
      : "没有已验证模型，先到模型库选择并测试。";
    const visiblePurposes = ["chat", "vision", "speech_to_text", "text_to_speech", "image_generation", "video_generation"];
    $("#modelCapabilityAssignments").innerHTML = visiblePurposes.map((capability) => {
      const system = center.assignments?.system?.[capability] || { mode: "auto" };
      const route = center.automaticRoutes?.[capability];
      const relevantScenes = (center.scenes || []).filter((scene) => scene.executionState === "wired" && scene.capabilities?.includes(capability));
      const support = activeConnection?.capabilitySupport?.[capability] || center.capabilitySupport?.[capability] || { state: "integration_pending", reason: "执行适配尚未完成。" };
      const wired = support.state === "available";
      const status = wired ? (route?.selected ? `当前可用 · ${route.reason || "已通过连接验证"}` : `尚无已验证的${capabilityLabels[capability] || capability}模型，请先显式测试一个候选`) : support.reason;
      const selector = wired ? `<label><span class="sr-only">${escapeHtml(capabilityLabels[capability])}系统默认</span><select data-routing-scope="system" data-capability="${capability}">${assignmentOptions(center, capability, assignmentValue(system), true)}</select><small class="model-policy-save-status status" aria-live="polite" data-policy-status-kind="routing" data-policy-status-scope="system" data-policy-status-scene=""></small></label>` : '<span class="badge">待接入</span>';
      const systemModel = selectedResourceId(center, system, route);
      const systemEffort = center.chatPreferences?.system?.reasoningEffort || "auto";
      const systemReasoning = capability === "chat" ? `<label><span>默认思考强度</span><select data-reasoning-scope="system">${reasoningOptions(state, systemModel, systemEffort)}</select><small class="model-policy-save-status status" aria-live="polite" data-policy-status-kind="reasoning" data-policy-status-scope="system" data-policy-status-scene=""></small></label>` : "";
      const candidates = (center.resources || []).filter((item) => item.curated && (item.capabilities || []).includes(capability));
      const capabilityChecks = activeConnection?.capabilityChecks || {};
      const probeControls = wired && capability !== "chat" ? `<div class="model-capability-probes">${candidates.map((item) => {
        const check = capabilityChecks[`${capability}:${item.modelId}`];
        const stateLabel = check?.status === "passed" ? "已验证" : check?.status === "failed" ? "检查失败" : "待验证";
        return `<button type="button" data-capability-probe="${escapeHtml(capability)}" data-capability-model="${escapeHtml(item.modelId)}" data-capability-connection="${escapeHtml(item.connectionId)}">${escapeHtml(item.modelId)} · ${stateLabel}</button>`;
      }).join("") || '<small>官方候选尚未载入。</small>'}<small>显式测试会发送一次最小请求，可能产生少量费用；启用型号本身不调用模型。</small>${capability === "text_to_speech" ? '<small>朗读支持 voice、format、speed；默认 alloy / mp3 / 1×。</small>' : capability === "speech_to_text" ? '<small>语言默认自动识别。</small>' : capability === "image_generation" ? '<small>默认 1024×1024、中等质量。</small>' : ""}</div>` : "";
      const mediaWorkbench = wired && capability === "text_to_speech" ? '<div class="model-media-workbench"><label><span>试听文字</span><input data-tts-preview-text maxlength="4000" value="你好，我是小丑鱼。"></label><button type="button" data-tts-preview>朗读</button><button type="button" data-tts-stop disabled>停止</button><small data-tts-status aria-live="polite"></small></div>'
        : wired && capability === "image_generation" ? '<div class="model-media-workbench"><label><span>图片描述</span><input data-image-prompt maxlength="4000" placeholder="例如：海边书桌上的橙色小丑鱼图标"></label><button type="button" data-image-generate>生成并保存到成果</button><small data-image-status aria-live="polite"></small><div data-image-result></div></div>' : "";
      const overrides = wired && relevantScenes.length ? `<details class="model-application-overrides"><summary>按应用单独选择 <small>${relevantScenes.length} 个应用</small></summary><div class="model-application-list">${relevantScenes.map((scene) => { const current = center.assignments?.scenes?.[scene.id]?.[capability]; const modelId = selectedResourceId(center, current || system, current ? null : route); const effort = center.chatPreferences?.scenes?.[scene.id]?.reasoningEffort || "inherit"; const selected = current?.mode === "fixed" ? assignmentValue(current) : "inherit"; return `<section class="model-scene-policy" data-model-scene="${escapeHtml(scene.id)}"><header><strong>${escapeHtml(scene.name)}</strong><small>${escapeHtml(scene.description)}</small></header>${scene.modelOverride ? `<label><span>模型</span><select data-routing-scope="scene" data-scene="${escapeHtml(scene.id)}" data-capability="${capability}"><option value="inherit"${!current ? " selected" : ""}>跟随系统默认</option>${assignmentOptions(center, capability, selected, true, { activeOnly: true, includeAuto: false })}</select><small class="model-policy-save-status status" aria-live="polite" data-policy-status-kind="routing" data-policy-status-scope="scene" data-policy-status-scene="${escapeHtml(scene.id)}"></small></label>` : `<p class="status">${escapeHtml(scene.unavailableReason || "此应用暂不支持单独选择模型。")}</p>`}${capability === "chat" && scene.reasoningOverride ? `<label><span>思考强度</span><select data-reasoning-scope="scene" data-scene="${escapeHtml(scene.id)}">${reasoningOptions(state, modelId, effort, true)}</select><small class="model-policy-save-status status" aria-live="polite" data-policy-status-kind="reasoning" data-policy-status-scope="scene" data-policy-status-scene="${escapeHtml(scene.id)}"></small></label>` : ""}</section>`; }).join("")}</div></details>` : "";
      return `<article class="model-capability-row"><div><strong>${escapeHtml(capabilityLabels[capability])}</strong><small>${escapeHtml(status)}</small>${capability === "chat" ? `<small class="model-pool-hint">${escapeHtml(poolHint)}</small>` : ""}${probeControls}${mediaWorkbench}</div>${selector}${systemReasoning}${overrides}</article>`;
    }).join("");
    const chatRoute = center.automaticRoutes?.chat || {};
    const recommendations = [chatRoute.selected, ...(chatRoute.fallbacks || [])].filter(Boolean).slice(0, 4);
    $("#modelRecommendations").innerHTML = recommendations.map((item, index) => `<button type="button" class="model-recommendation" data-recommend-connection="${escapeHtml(item.connectionId)}" data-recommend-model="${escapeHtml(item.modelId)}"><strong>${escapeHtml(item.modelId)}</strong><span>${index === 0 ? '<b class="badge ready">官方推荐</b>' : '<b class="badge">官方回退</b>'}${typeof item.evidence?.latencyMs === "number" && item.evidence.latencyMs <= 500 ? '<b class="badge">快速</b>' : ""}${item.capabilities?.includes("reasoning") ? '<b class="badge">深度思考</b>' : ""}</span><small>${escapeHtml(item.reason || chatRoute.reason || "已验证文字能力")}</small></button>`).join("") || '<p class="status">连接并验证官方短名单型号后显示推荐。</p>';
    $("#modelRecommendationHint").textContent = recommendations.length ? "标签只来自实际检查或应用内已有运行时能力，不依据名称猜测成本和上下文。" : "连接后显示少量有依据的推荐。";
  }
  function selectedResourceId(center, assignment, route) {
    if (assignment?.mode === "fixed") return assignment.ref.modelId;
    return route?.selected?.modelId || "";
  }
  function safeModelDiagnostic(value) {
    const categories = {
      auth: "认证或权限", quota: "额度或限流", model: "模型不可用",
      parameter: "请求参数", network: "网络", protocol: "接口兼容",
    };
    if (!value || typeof value !== "object" || !categories[value.category]) return null;
    const status = Number(value.httpStatus);
    const requestId = typeof value.requestId === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value.requestId)
      ? value.requestId : "";
    const providerCode = typeof value.providerCode === "string" && /^\d{3,5}$/.test(value.providerCode)
      ? value.providerCode : "";
    const networkKinds = { dns: "DNS", refused: "连接拒绝", timeout: "连接超时", tls: "TLS", proxy_unavailable: "系统代理不可用" };
    const networkKind = typeof value.networkKind === "string" ? networkKinds[value.networkKind] || "" : "";
    return `${categories[value.category]}${networkKind ? ` · ${networkKind}` : ""}${Number.isInteger(status) && status >= 100 && status <= 599 ? `（HTTP ${status}）` : ""}${providerCode ? ` · 错误代码 ${providerCode}` : ""}${requestId ? ` · 请求 ID ${requestId}` : ""}`;
  }
  function safeDirectorySummary(item) {
    const directory = item?.directory;
    if (!directory || typeof directory !== "object") return "";
    const safeList = (value) => Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string" && /^[A-Za-z0-9._:/+ -]{1,48}$/.test(entry)).slice(0, 6)
      : [];
    const parts = [];
    const actions = safeList(directory.supportedActions);
    const capabilities = safeList(directory.capabilities);
    const modalities = safeList(directory.modalities);
    if (actions.length) parts.push(`操作 ${actions.join("、")}`);
    if (capabilities.length) parts.push(`能力 ${capabilities.join("、")}`);
    if (modalities.length) parts.push(`模态 ${modalities.join("、")}`);
    if (Number.isSafeInteger(directory.contextTokens) && directory.contextTokens > 0) parts.push(`上下文 ${directory.contextTokens.toLocaleString()} tokens`);
    if (Number.isSafeInteger(directory.outputTokens) && directory.outputTokens > 0) parts.push(`输出 ${directory.outputTokens.toLocaleString()} tokens`);
    return parts.length ? `${parts.join(" · ")} · 目录声明，尚未验证` : "目录可见，尚未验证";
  }
  function renderModelCatalog(state) {
    const shortlist = window.ClownfishModelShortlist;
    const definition = state?.resourceCenter?.providerCatalog?.providers?.find((item) => item.providerId === state.provider);
    const librarySelection = typeof selectedLibraryModels === "undefined" ? new Set() : selectedLibraryModels;
    const recommended = shortlist.catalog(state);
    const all = shortlist.rawCatalog(state);
    const common = shortlist.shortlist(state);
    const enabledIds = new Set(state.enabledModels || []);
    const currentChecks = new Map(Object.keys(state.modelChecks || {}).map((id) => [id, shortlist.eligibleCheck(state, id)]));
    const verifiedIds = new Set([...currentChecks].filter(([, check]) => check?.chat === "passed").map(([id]) => id));
    const failedIds = new Set([...currentChecks].filter(([, check]) => check?.chat === "failed").map(([id]) => id));
    const query = $("#modelCatalogSearch").value.trim().toLocaleLowerCase();
    const known = [...new Map([...recommended, ...all, ...common,
      ...[...enabledIds].map((id) => ({ id })), ...[...verifiedIds].map((id) => ({ id }))]
      .map((item) => [item.id, item])).values()];
    const models = known.filter(
      (item) =>
        !query ||
        `${item.id} ${item.displayName || ""}`
          .toLocaleLowerCase()
          .includes(query),
    );
    $("#modelCatalogSummary").textContent =
      `已启用 ${enabledIds.size} · 已验证 ${verifiedIds.size} · 官方推荐 ${recommended.length} · 账号目录 ${all.length}${state.catalogStale ? " · 目录待刷新" : ""}`;
    $("#modelCatalogHint").textContent =
      "这里是完整账号原始目录与手工型号搜索；目录不会影响推荐、默认型号或自动路由，启用和测试由你明确操作。";
    const row = (item) => {
      const enriched = common.find((value) => value.id === item.id) || item;
      const officiallyEligible = recommended.some((value) => value.id === item.id);
      const check = shortlist.eligibleCheck(state, item.id);
      const enabled = enabledIds.has(item.id);
      const selected = librarySelection.has(item.id);
      const retired = enriched.lifecycle === "retired";
      const providerModel = definition?.models?.find((value) => value.id === item.id || item.id.startsWith(`${value.id}-`));
      const declaredCapabilities = providerModel?.capabilities || enriched.capabilities || [];
      const mediaOnly = declaredCapabilities.length > 0 && !declaredCapabilities.includes("chat");
      const chatWired = definition?.adapterStatus?.chat === "wired" || state.provider === "custom";
      const testControl = mediaOnly
        ? '<button type="button" disabled>在对应用途中测试</button>'
        : chatWired
          ? `<button type="button" data-model-check="${escapeHtml(item.id)}">测试${check ? ` · ${escapeHtml(modelCheckLabel(check, state))}` : ""}</button>`
          : '<button type="button" disabled>文字执行尚未接入</button>';
      return `<article class="model-catalog-row" role="listitem" data-current="${item.id === state.model}" data-enabled="${enabled}"><label class="model-library-check"><input type="checkbox" data-model-library-select="${escapeHtml(item.id)}"${selected ? " checked" : ""}${retired ? " disabled" : ""}><span class="sr-only">选择 ${escapeHtml(item.id)}</span></label><div class="model-catalog-copy"><strong>${escapeHtml(item.displayName || item.id)}</strong><small>${retired ? "已停止使用" : enabled ? `已启用 · ${check?.chat === "passed" ? "已验证" : check?.chat === "failed" ? "验证失败" : "未验证"}` : officiallyEligible ? "官方推荐 · 未启用" : check?.chat === "passed" ? "已验证 · 未启用" : "账号目录 · 未启用"}</small>${item.directory ? `<small>${escapeHtml(safeDirectorySummary(item))}</small>` : ""}${query ? `<small>${escapeHtml(shortlist.recommendation(item))}</small>` : ""}</div><div class="model-catalog-actions">${retired ? "" : `<button type="button" data-model-enabled="${escapeHtml(item.id)}" data-enabled="${enabled}">${enabled ? "停用" : "启用"}</button>${testControl}`}</div></article>`;
    };
    $("#modelCatalogResults").innerHTML = models.map(row).join("") ||
      '<p class="status">没有匹配的型号；可在上方添加模型 ID。</p>';
    const primary = [...new Map([...known.filter((item) => enabledIds.has(item.id)), ...recommended.filter((item) => !enabledIds.has(item.id))]
      .map((item) => [item.id, item])).values()];
    if ($("#modelPrimaryResults")) $("#modelPrimaryResults").innerHTML = primary.map(row).join("") || '<p class="status">保存连接后，这里会显示已启用模型和官方推荐。</p>';
    const pending = [...enabledIds].filter((id) => !currentChecks.get(id)).length;
    const failed = [...enabledIds].filter((id) => failedIds.has(id)).length;
    if ($("#modelLibraryStats")) $("#modelLibraryStats").innerHTML = [
      ["目录", all.length], ["已启用", enabledIds.size], ["已验证", [...enabledIds].filter((id) => verifiedIds.has(id)).length], ["待测试", pending], ["失败", failed],
    ].map(([label, value]) => `<span><b>${value}</b><small>${label}</small></span>`).join("");
    if (typeof updateBatchSelection === "function") updateBatchSelection();
  }
  function updateBatchSelection() {
    if ($("#modelBatchCount")) $("#modelBatchCount").textContent = selectedLibraryModels.size ? `已选择 ${selectedLibraryModels.size} 个` : "未选择";
  }
  function selectedCatalogModel(state) {
    const catalog = window.ClownfishModelShortlist.catalog(state);
    if (catalog.some((item) => item.id === state?.model)) return state.model;
    return state?.model || "";
  }
  function savedModelMissingFromCatalog(state) {
    const catalog = window.ClownfishModelShortlist.catalog(state);
    return Boolean(state?.live && state?.model && catalog.length
      && !catalog.some((item) => item.id === state.model));
  }
  function syncModelChoice() {
    const id = $("#modelName").value;
    const trigger = $("#modelChoiceOpen");
    const name = trigger.querySelector(".cf-model-name");
    const tag = trigger.querySelector(".cf-model-trigger-tag");
    if (name) name.textContent = id || "选择模型";
    if (tag) tag.textContent = modelCheckLabel(modelState?.modelChecks?.[id], modelState);
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
  function renderModel(state, fill = false, uiSnapshot = captureModelUiState()) {
    modelState = state;
    const savedModelMissing = savedModelMissingFromCatalog(state);
    const suggestedModel = selectedCatalogModel(state);
    $("#modelCurrentTitle").textContent = state.live
      ? `${state.providerName} · 已配置 · ${modelCheckLabel(state.check, state)}`
      : "离线模式";
    $("#modelCurrentDetail").textContent = state.live
      ? savedModelMissing
        ? `已保存模型 ${state.model} 不在当前服务商目录中；这不表示 API Key 失败。表单已暂选 ${suggestedModel}，需你保存后才会替换。`
        : `默认模型：${state.model} · ${state.check?.detail || "已配置，尚未进行能力检查。"}`
      : "连接模型后可以使用在线对话";
    $("#modelDot").classList.toggle("live", state.check?.chat === "passed");
    $("#modelOffline").disabled = !state.live;
    if ($("#modelNetworkMode")) {
      const mode = ["auto", "system", "direct"].includes(state.network?.settings?.mode)
        ? state.network.settings.mode : "auto";
      if (fill) $("#modelNetworkMode").value = mode;
      const status = state.network?.status || {};
      $("#modelNetworkStatus").textContent = status.error
        ? status.error
        : status.effective
          ? `实际通过 ${status.host}；模型目录、验证和实际请求使用同一出口。`
          : "当前实际直连；模型目录、验证和实际请求使用同一出口。";
    }
    if ($("#modelCatalogToggle")) $("#modelCatalogToggle").disabled = false;
    renderModelCatalog(state);
    renderResourceCenter(state);
    syncPolicyControlsFromServer(state);
    restoreModelUiState(uiSnapshot);
    $("#modelCheckList").innerHTML = Object.entries(state.modelChecks || {})
      .map(
        ([id, check]) =>
          `<article class="connection-row"><div><h3>${escapeHtml(id)}<span class="badge ${check.tools === "passed" ? "ready" : ""}">${modelCheckLabel(check, state)}</span></h3><p>${escapeHtml(check.detail)}</p><p>检查时间：${escapeHtml(new Date(check.checkedAt).toLocaleString())} · 仅适用于当前连接版本</p></div></article>`,
      )
      .join("");
    syncModelChoice();
    if (!fill) return;
    $("#modelProvider").innerHTML = (state.resourceCenter?.providerCatalog?.providers || [])
      .map(
        (item) =>
          `<option value="${escapeHtml(item.providerId)}">${escapeHtml(item.brand)}</option>`,
      )
      .join("");
    $("#modelProvider").value = state.provider || "custom";
    $("#modelConnectionId").value = state.resourceCenter?.connections?.find((item) => item.active)?.id || "";
    const item = preset($("#modelProvider").value) || {};
    $("#modelProtocol").value =
      state.protocol || item.protocol || "openai-compatible";
    $("#modelBaseUrl").value = state.baseUrl || item.baseUrl || "";
    $("#modelName").value = suggestedModel || item.model || "";
    $("#modelSelectionMode").value = state.live
      ? state.selectionMode || "manual"
      : "auto";
    updateModelHints();
    syncModelChoice();
  }
  async function loadModel() {
    try {
      const [state, proxy] = await Promise.all([api("/api/llm"), api("/api/outbound-proxy")]);
      renderModel({ ...state, network: { settings: proxy.settings, status: proxy.status } }, true);
    } catch (error) {
      $("#modelStatus").className = "status error";
      $("#modelStatus").textContent = error.message;
    }
  }
  $("#modelProvider").onchange = () => {
    const item = preset($("#modelProvider").value);
    const definition = modelState?.resourceCenter?.providerCatalog?.providers?.find((candidate) => candidate.providerId === $("#modelProvider").value);
    if (item) {
      $("#modelProtocol").value = item.protocol;
      $("#modelBaseUrl").value = item.baseUrl;
      // A model ID belongs to a provider.  Keeping (for example) an OpenAI
      // model when the user selects Zhipu makes a successfully refreshed GLM
      // catalog appear broken, and leaves an unusable default selected.
      if (modelState?.provider !== item.id) {
        $("#modelName").value = "";
        $("#modelSelectionMode").value = "auto";
        syncModelChoice();
      }
    }
    $("#modelKey").value = "";
    if (definition && definition.providerId !== "custom") {
      $("#modelProtocol").value = definition.protocol;
      $("#modelBaseUrl").value = definition.defaultEndpoint || "";
    }
    updateModelHints();
  };
  async function handleModelLibraryClick(event) {
    const select = event.target.closest("[data-model-select]"),
      check = event.target.closest("[data-model-check]"),
      enabled = event.target.closest("[data-model-enabled]"),
      librarySelect = event.target.closest("[data-model-library-select]");
    if (librarySelect) {
      librarySelect.checked ? selectedLibraryModels.add(librarySelect.dataset.modelLibrarySelect) : selectedLibraryModels.delete(librarySelect.dataset.modelLibrarySelect);
      updateBatchSelection();
      return;
    }
    if (enabled) {
      enabled.disabled = true;
      try {
        const state = await api("/api/llm-model/enabled", { method: "POST", body: JSON.stringify({ connectionId: currentConnectionId(), models: [enabled.dataset.modelEnabled], enabled: enabled.dataset.enabled !== "true" }) });
        renderModel(state); restoreSelectedConnectionContext(state);
        $("#modelCatalogStatus").textContent = enabled.dataset.enabled === "true" ? "模型已停用；历史验证记录仍保留。" : "模型已启用；需要执行前请显式测试。";
      } catch (error) { $("#modelCatalogStatus").textContent = error.message; }
      return;
    }
    if (select) {
      $("#modelName").value = select.dataset.modelSelect;
      $("#modelSelectionMode").value = "manual";
      syncModelChoice();
      closeModelCatalog();
      $("#modelStatus").textContent =
        "已填入待测试型号；尚未检查，也没有改变默认模型。";
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
      const candidateModel = String(check.dataset.modelCheck || "").trim();
      const catalog = window.ClownfishModelShortlist.catalog(modelState);
      const inCatalog = catalog.some((item) => item.id === candidateModel);
      if (!inCatalog) $("#modelCatalogStatus").textContent =
        "账号目录没有返回这个型号；系统会先加入当前连接，再按你的确认执行一次测试。";
      try {
        const state = await api("/api/llm-model/check", {
          method: "POST",
          body: JSON.stringify({
            connectionId: currentConnectionId(),
            candidateModel,
            force: true,
          }),
        });
        renderModel(state);
        restoreSelectedConnectionContext(state);
        $("#modelCatalogStatus").textContent =
          [state.checked?.detail || "检查完成。", safeModelDiagnostic(state.checked?.diagnostic)]
            .filter(Boolean).join(" ");
      } catch (error) {
        $("#modelCatalogStatus").textContent =
          ["检查未通过；默认型号没有改变。" + error.message, error.modelDiagnostic]
            .filter(Boolean).join(" ");
      }
      return;
    }
  }
  $("#modelCatalogResults").onclick = handleModelLibraryClick;
  if ($("#modelPrimaryResults")) $("#modelPrimaryResults").onclick = handleModelLibraryClick;
  $("#modelCustomAdd").onclick = async () => {
    const id = $("#modelCustomId").value.trim();
    if (!id) {
      $("#modelCatalogStatus").textContent = "请输入模型 ID。";
      return;
    }
    try {
      const state = await api("/api/llm-model/register-enable", {
        method: "POST",
        body: JSON.stringify({ connectionId: currentConnectionId(), model: id }),
      });
      $("#modelCustomId").value = "";
      renderModel(state);
      restoreSelectedConnectionContext(state);
      $("#modelCatalogStatus").textContent =
        `已添加并启用 ${id}；执行前请测试。`;
    } catch (error) {
      $("#modelCatalogStatus").textContent = [error.message, error.modelDiagnostic]
        .filter(Boolean).join(" ");
    }
  };
  async function changeSelectedModels(enabled) {
    const models = [...selectedLibraryModels];
    if (!models.length) { $("#modelCatalogStatus").textContent = "请先勾选模型。"; return; }
    try {
      const state = await api("/api/llm-model/enabled", { method: "POST", body: JSON.stringify({ connectionId: currentConnectionId(), models, enabled }) });
      selectedLibraryModels.clear();
      renderModel(state); restoreSelectedConnectionContext(state); updateBatchSelection();
      $("#modelCatalogStatus").textContent = enabled ? `已启用 ${models.length} 个模型；尚未产生模型调用。` : `已停用 ${models.length} 个模型；历史验证记录仍保留。`;
    } catch (error) { $("#modelCatalogStatus").textContent = error.message; }
  }
  if ($("#modelBatchEnable")) $("#modelBatchEnable").onclick = () => changeSelectedModels(true);
  if ($("#modelBatchDisable")) $("#modelBatchDisable").onclick = () => changeSelectedModels(false);
  if ($("#modelBatchCheck")) $("#modelBatchCheck").onclick = async () => {
    const models = [...selectedLibraryModels];
    if (!models.length) { $("#modelCatalogStatus").textContent = "请先勾选模型。"; return; }
    const notEnabled = models.filter((id) => !(modelState?.enabledModels || []).includes(id));
    if (notEnabled.length) { $("#modelCatalogStatus").textContent = `请先启用：${notEnabled.join("、")}。`; return; }
    if (!confirm(`将测试 ${models.length} 个模型，最多同时测试 2 个。每个模型会发送合成请求，可能产生少量费用。继续吗？`)) return;
    $("#modelBatchCheck").disabled = true;
    $("#modelCatalogStatus").textContent = `正在测试 ${models.length} 个模型；单个失败不会中断其他模型…`;
    try {
      const state = await api("/api/llm-model/check-batch", { method: "POST", body: JSON.stringify({ connectionId: currentConnectionId(), models }) });
      renderModel(state); restoreSelectedConnectionContext(state);
      const passed = (state.results || []).filter((item) => item.ok).length;
      $("#modelCatalogStatus").textContent = `批量测试完成：${passed} 个通过，${models.length - passed} 个未通过。`;
    } catch (error) { $("#modelCatalogStatus").textContent = `批量测试未完成：${error.message}`; }
    finally { $("#modelBatchCheck").disabled = false; }
  };
  $("#modelCatalogRefresh").onclick = async () => {
    const button = $("#modelCatalogRefresh");
    button.disabled = true;
    $("#modelCatalogStatus").textContent = "只读取服务商目录，不检查任何模型…";
    try {
      const state = await api("/api/llm-model/catalog", {
        method: "POST",
        body: JSON.stringify({ connectionId: currentConnectionId() }),
      });
      renderModel(state);
      restoreSelectedConnectionContext(state);
      $("#modelCatalogStatus").textContent =
        `目录已刷新，共 ${state.models?.length || 0} 个型号；没有发起能力检查。`;
    } catch (error) {
      $("#modelCatalogStatus").textContent = [error.message, error.modelDiagnostic]
        .filter(Boolean).join(" ");
    } finally { button.disabled = false; }
  };
  function showConnectSteps(steps = [], active = "") {
    const byId = new Map(steps.map((item) => [item.id, item]));
    document.querySelectorAll("#modelConnectProgress [data-step]").forEach((item) => {
      const step = byId.get(item.dataset.step);
      item.className = step ? `is-${step.state}` : item.dataset.step === active ? "is-active" : "";
      item.title = step?.detail || "";
    });
  }
  $("#modelCapabilityAssignments").onchange = (event) => {
    const reasoningSelect = event.target.closest("select[data-reasoning-scope]");
    if (reasoningSelect && modelState) {
      const scope = reasoningSelect.dataset.reasoningScope;
      const scene = reasoningSelect.dataset.scene || "";
      const requestedValue = reasoningSelect.value;
      policySaveQueue.enqueue({
        key: `reasoning:${scope}:${scene}`,
        kind: "reasoning",
        scope,
        scene,
        element: reasoningSelect,
        url: "/api/llm-chat-policy",
        body: { scope, scene: scene || undefined, reasoningEffort: requestedValue },
      });
      return;
    }
    const select = event.target.closest("select[data-capability]");
    if (!select || !modelState) return;
    const scope = select.dataset.routingScope;
    const scene = select.dataset.scene || "";
    const capability = select.dataset.capability;
    const requestedValue = select.value;
    const [connectionId, modelId] = ["auto", "inherit"].includes(requestedValue) ? [] : JSON.parse(requestedValue);
    const assignment = requestedValue === "inherit" ? { mode: "inherit" } : requestedValue === "auto" ? { mode: "auto" } : { mode: "fixed", ref: { connectionId, modelId, capability } };
    policySaveQueue.enqueue({
      key: `routing:${scope}:${scene}:${capability}`,
      kind: "routing",
      scope,
      scene,
      element: select,
      url: "/api/llm-routing",
      body: { scope, scene: scene || undefined, capability, assignment },
    });
  };
  $("#modelCapabilityAssignments").onclick = async (event) => {
    if (await mediaWorkbench.handleClick(event.target)) return;
    const button = event.target.closest("[data-capability-probe]");
    if (!button) return;
    const capability = button.dataset.capabilityProbe;
    const model = button.dataset.capabilityModel;
    const connectionId = button.dataset.capabilityConnection;
    if (!confirm(`将对 ${model} 的${capabilityLabels[capability] || capability}发送一次最小检查，可能产生少量费用。继续吗？`)) return;
    button.disabled = true;
    try {
      const connection = modelState?.resourceCenter?.connections?.find((item) => item.id === connectionId);
      if (!connection?.enabledModels?.includes(model)) await api("/api/llm-model/enabled", { method: "POST", body: JSON.stringify({ connectionId, models: [model], enabled: true }) });
      const state = await api("/api/llm-capability/check", { method: "POST", body: JSON.stringify({ connectionId, model, capability }) });
      renderModel(state);
      $("#modelStatus").className = "status success";
      $("#modelStatus").textContent = `${model} 的${capabilityLabels[capability] || capability}已验证，可以在用途设置中选择。`;
    } catch (error) {
      $("#modelStatus").className = "status error";
      $("#modelStatus").textContent = error.message;
    } finally { button.disabled = false; }
  };
  $("#modelRecommendations").onclick = async (event) => {
    const choice = event.target.closest("[data-recommend-model]");
    if (!choice) return;
    const state = await api("/api/llm-routing", { method: "POST", body: JSON.stringify({ scope: "system", capability: "chat", assignment: { mode: "fixed", ref: { connectionId: choice.dataset.recommendConnection, modelId: choice.dataset.recommendModel, capability: "chat" } } }) });
    renderModel(state);
    $("#modelStatus").className = "status success";
    $("#modelStatus").textContent = `默认文字模型已设为 ${choice.dataset.recommendModel}。`;
  };
  $("#modelProviderConnections").onclick = (event) => {
    const add = event.target.closest("[data-new-model-connection]");
    const edit = event.target.closest("[data-edit-model-connection]");
    if (add) {
      selectedLibraryModels.clear();
      selectedConnectionId = null;
      $("#modelConnectionId").value = "";
      $("#modelKey").value = "";
      $("#modelName").value = "";
      $("#modelSelectionMode").value = "auto";
      $("#modelStatus").className = "status";
      $("#modelStatus").textContent = "正在添加新连接；不会覆盖列表中的现有连接。";
      $("#modelBaseUrl").focus();
      return;
    }
    if (edit) {
      const item = modelState?.resourceCenter?.connections?.find((connection) => connection.id === edit.dataset.editModelConnection);
      if (!item) return;
      selectedLibraryModels.clear();
      selectedConnectionId = item.id;
      $("#modelConnectionId").value = item.id;
      $("#modelProvider").value = item.provider;
      $("#modelProtocol").value = item.protocol;
      $("#modelBaseUrl").value = item.baseUrl;
      $("#modelName").value = item.model;
      $("#modelKey").value = "";
      updateModelHints();
      modelState = { ...modelState, ...item, models: item.models || [], rawModels: item.rawModels || [], catalogConnectionRevision: item.connectionRevision };
      renderModelCatalog(modelState);
      renderResourceCenter(modelState);
      $("#modelStatus").textContent = `正在编辑 ${item.label}；密钥仍不会回显。`;
      $("#modelBaseUrl").focus();
    }
  };
  function modelConnectionPayload() {
    const credentials = Object.fromEntries([...document.querySelectorAll("[data-provider-credential]")]
      .map((input) => [input.dataset.providerCredential, input.value.trim()]).filter(([, value]) => value));
    const providerSettings = Object.fromEntries([...document.querySelectorAll("[data-provider-setting]")]
      .map((input) => [input.dataset.providerSetting, input.value.trim()]).filter(([, value]) => value));
    return {
      connectionId: currentConnectionId(),
      provider: $("#modelProvider").value,
      protocol: $("#modelProtocol").value,
      baseUrl: $("#modelBaseUrl").value.trim(),
      model: $("#modelName").value.trim(),
      selectionMode: $("#modelSelectionMode").value,
      key: $("#modelKey").value.trim(),
      credentials,
      providerSettings,
      networkMode: $("#modelNetworkMode")?.value || "auto",
    };
  }
  function setOnboardingBusy(busy) {
    [$("#modelSave"), $("#modelSaveOnly"), $("#modelTest"), $("#modelCatalogRefresh")]
      .filter(Boolean).forEach((button) => { button.disabled = busy; });
    $("#modelConnectCancel").hidden = !busy;
  }
  async function saveConnectionOnly() {
    const state = await api("/api/llm-connection/save", {
      method: "POST",
      body: JSON.stringify(modelConnectionPayload()),
    });
    selectedConnectionId = state.savedConnectionId || selectedConnectionId;
    renderModel(state);
    restoreSelectedConnectionContext(state, { hydrate: true });
    $("#modelKey").value = "";
    return state;
  }
  $("#modelForm").onsubmit = async (event) => {
    event.preventDefault();
    if (activeOnboardingController) return;
    const controller = new AbortController();
    activeOnboardingController = controller;
    const timeout = setTimeout(() => controller.abort("timeout"), 75_000);
    const steps = [];
    let saved = false;
    setOnboardingBusy(true);
    $("#modelStatus").className = "status";
    showConnectSteps([], "saved");
    $("#modelStatus").textContent = "第 1/4 步：正在加密保存连接…";
    try {
      let state = await api("/api/llm-connection/save", {
        method: "POST", signal: controller.signal,
        body: JSON.stringify(modelConnectionPayload()),
      });
      saved = true;
      selectedConnectionId = state.savedConnectionId || selectedConnectionId;
      steps.push({ id: "saved", state: "complete", detail: "连接已加密保存；后续失败也不会丢失" });
      showConnectSteps(steps, "catalog");
      renderModel(state);
      restoreSelectedConnectionContext(state, { hydrate: true });
      $("#modelKey").value = "";
      const savedConnection = state.resourceCenter?.connections?.find((item) => item.id === selectedConnectionId);
      steps.push({ id: "provider", state: "complete", detail: `已识别 ${savedConnection?.providerName || savedConnection?.provider || "自定义服务"}` });
      $("#modelStatus").textContent = "第 2/4 步：连接已保存，正在读取账号模型目录…";
      try {
        state = await api("/api/llm-model/catalog", {
          method: "POST", signal: controller.signal,
          body: JSON.stringify({ connectionId: selectedConnectionId }),
        });
        steps.push({ id: "catalog", state: "complete", detail: `已读取账号模型目录` });
      } catch (catalogError) {
        const status = Number(catalogError.response?.diagnostic?.httpStatus);
        if (![404, 405].includes(status)) throw catalogError;
        steps.push({ id: "catalog", state: "warning", detail: "服务商未提供模型目录，继续使用已填写型号或官方维护目录" });
      }
      renderModel(state);
      restoreSelectedConnectionContext(state);
      const connection = state.resourceCenter?.connections?.find((item) => item.id === selectedConnectionId);
      const onboardingDefinition = state.resourceCenter?.providerCatalog?.providers?.find((item) => item.providerId === connection?.provider);
      steps.push({ id: "recommend", state: "complete", detail: onboardingDefinition?.discoveryMode === "asyncMediaNoFreeProbe"
        ? "凭据已保存；此服务没有安全的免费校验，未创建媒体任务"
        : "已整理官方候选；目录可见不代表能力已验证" });
      steps.push({ id: "ready", state: "warning", detail: onboardingDefinition?.verificationPolicy?.note || "请选择模型并显式验证" });
      showConnectSteps(steps);
      $("#modelStatus").className = "status success";
      $("#modelStatus").textContent = onboardingDefinition?.discoveryMode === "asyncMediaNoFreeProbe"
        ? "连接已保存。该媒体服务没有免费的 Key 校验；系统没有创建任务或产生模型费用。需要时请显式验证。"
        : "连接和账号目录已保存。请选择需要的模型并点击测试；目录读取本身不等于模型能力已验证。";
    } catch (error) {
      showConnectSteps(steps);
      $("#modelStatus").className = "status error";
      const cancelled = error.name === "AbortError";
      const prefix = cancelled ? (controller.signal.reason === "timeout" ? "自动配置超时。" : "已取消自动配置。") : error.message;
      $("#modelStatus").textContent = saved
        ? `${prefix} 连接已经保存；已完成的步骤不会丢失。请修改后点击“保存并自动配置”重试。`
        : `${prefix} 表单内容已保留，请修改后重试。`;
    } finally {
      clearTimeout(timeout);
      activeOnboardingController = null;
      setOnboardingBusy(false);
    }
  };
  $("#modelSaveOnly").onclick = async () => {
    if (activeOnboardingController) return;
    setOnboardingBusy(true);
    $("#modelStatus").className = "status";
    $("#modelStatus").textContent = "正在加密保存连接；不会联网或改变默认模型…";
    try {
      await saveConnectionOnly();
      showConnectSteps([{ id: "saved", state: "complete", detail: "连接已加密保存" }]);
      $("#modelStatus").className = "status success";
      $("#modelStatus").textContent = "连接已保存，没有联网或改变默认模型。";
    } catch (error) {
      $("#modelStatus").className = "status error";
      $("#modelStatus").textContent = `${error.message} 表单内容已保留，可修改后重试。`;
    } finally { setOnboardingBusy(false); }
  };
  $("#modelConnectCancel").onclick = () => activeOnboardingController?.abort("user");
  $("#modelTest").onclick = async () => {
    const connectionId = currentConnectionId();
    const model = $("#modelName").value.trim();
    if (!connectionId) { $("#modelStatus").textContent = "请先保存连接。"; return; }
    if (!model) { $("#modelStatus").textContent = "请先选择或填写一个模型 ID。"; return; }
    if (!confirm(`测试 ${model} 会发送一个合成请求，可能产生少量费用。继续吗？`)) return;
    $("#modelTest").disabled = true;
    $("#modelStatus").textContent = `正在测试 ${model}；不会改变默认模型…`;
    try {
      const state = await api("/api/llm-model/check", { method: "POST", body: JSON.stringify({ connectionId, model, force: true }) });
      renderModel(state);
      restoreSelectedConnectionContext(state);
      $("#modelStatus").className = "status success";
      $("#modelStatus").textContent = `${model} 测试通过；需要时可在“推荐型号/能力分配”中单独设为默认。`;
    } catch (error) {
      $("#modelStatus").className = "status error";
      $("#modelStatus").textContent = `测试失败：${error.message}；已保存连接和当前默认模型都没有改变。`;
    } finally { $("#modelTest").disabled = false; }
  };
  $("#modelOffline").onclick = async () => {
    try {
      renderModel(
        await api("/api/llm-disconnect", {
          method: "POST",
          body: "{}",
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
  window.addEventListener("clownfish:model-setup-complete", () => loadModel());
  activate(location.hash.slice(1));
  loadModel();
  loadPlatform();
  loadStorage();
  loadRetainedOutputs();
  loadPrivacy();
})();
