"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  async function api(url, options = {}) { const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.userMessage || data.error || `请求失败（${response.status}）`); return data; }
  let modelState = null;
  function activate(section) { const id = ["models", "development", "connections", "storage", "privacy", "appearance"].includes(section) ? section : "models"; document.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("is-current", item.dataset.section === id)); document.querySelectorAll("[data-panel]").forEach((item) => item.classList.toggle("is-current", item.dataset.panel === id)); history.replaceState(null, "", `#${id}`); }
  document.querySelector(".settings-nav").onclick = (event) => { const button = event.target.closest("[data-section]"); if (button) activate(button.dataset.section); };
  function preset(id) { return (modelState?.providers || []).find((item) => item.id === id); }
  function updateModelHints() { const item = preset($("#modelProvider").value); $("#modelProtocol").disabled = $("#modelProvider").value !== "custom"; $("#modelKey").placeholder = item?.keyRequired ? `粘贴 ${item.name} API Key` : "本机服务通常无需填写"; $("#modelKeyHint").textContent = modelState?.provider === item?.id && modelState?.hasKey ? "已保存密钥；留空继续使用原密钥。" : "密钥使用当前 Windows 用户加密，仅保存在本机。"; }
  function renderModel(state, fill = false) { modelState = state; $("#modelCurrentTitle").textContent = state.live ? `${state.providerName} · 已连接` : "离线模式"; $("#modelCurrentDetail").textContent = state.live ? `日常对话：${state.dailyChatModel || state.model} · 任务：${state.model}` : "连接模型后可以使用完整任务能力"; $("#modelDot").classList.toggle("live", !!state.live); $("#modelOffline").disabled = !state.live; if (!fill) return; $("#modelProvider").innerHTML = (state.providers || []).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join(""); $("#modelProvider").value = state.provider || "custom"; const item = preset($("#modelProvider").value) || {}; $("#modelProtocol").value = state.protocol || item.protocol || "openai-compatible"; $("#modelBaseUrl").value = state.baseUrl || item.baseUrl || ""; $("#modelName").value = state.model || item.model || ""; updateModelHints(); }
  async function loadModel() { try { renderModel(await api("/api/llm"), true); } catch (error) { $("#modelStatus").className = "status error"; $("#modelStatus").textContent = error.message; } }
  $("#modelProvider").onchange = () => { const item = preset($("#modelProvider").value); if (item) { $("#modelProtocol").value = item.protocol; $("#modelBaseUrl").value = item.baseUrl; $("#modelName").value = item.model; } $("#modelKey").value = ""; updateModelHints(); };
  $("#modelForm").onsubmit = async (event) => { event.preventDefault(); const button = $("#modelSave"); button.disabled = true; $("#modelStatus").className = "status"; $("#modelStatus").textContent = "正在测试地址、密钥和模型…"; try { const state = await api("/api/llm-config", { method: "POST", body: JSON.stringify({ provider: $("#modelProvider").value, protocol: $("#modelProtocol").value, baseUrl: $("#modelBaseUrl").value.trim(), model: $("#modelName").value.trim(), key: $("#modelKey").value.trim() }) }); renderModel(state, true); $("#modelStatus").className = "status success"; $("#modelStatus").textContent = "连接成功，配置已保存在本机。"; } catch (error) { $("#modelStatus").className = "status error"; $("#modelStatus").textContent = `连接失败：${error.message}`; } finally { button.disabled = false; } };
  $("#modelOffline").onclick = async () => { try { renderModel(await api("/api/llm-config", { method: "POST", body: JSON.stringify({ offline: true }) }), true); $("#modelStatus").className = "status success"; $("#modelStatus").textContent = "已切换到离线模式。"; } catch (error) { $("#modelStatus").className = "status error"; $("#modelStatus").textContent = error.message; } };
  const developmentEngineNames = { pi: "Pi Agent", dsh: "DeepSeek Harness", kilo: "Kilo Code", opencode: "OpenCode", codex: "Codex" };
  function normalizedDevelopmentEngine(value) { return Object.prototype.hasOwnProperty.call(developmentEngineNames, value) ? value : "pi"; }
  function loadDevelopmentPreference() { const state = JSON.parse(localStorage.getItem("clownfish-development-settings") || "{}"); $("#defaultDevelopmentEngine").value = normalizedDevelopmentEngine(state.defaultDevelopmentEngine); $("#defaultAccessMode").value = state.defaultAccessMode === "inspect" ? "inspect" : "develop"; $("#defaultDependencyMode").value = state.installDependencies === false ? "skip" : "install"; }
  $("#saveDevelopment").onclick = () => { localStorage.setItem("clownfish-development-settings", JSON.stringify({ defaultDevelopmentEngine: normalizedDevelopmentEngine($("#defaultDevelopmentEngine").value), defaultAccessMode: $("#defaultAccessMode").value, installDependencies: $("#defaultDependencyMode").value === "install" })); $("#developmentStatus").className = "status success"; $("#developmentStatus").textContent = "开发设置已保存。"; };
  let developmentModelState = null;
  let editingDevelopmentEngine = "pi";
  function ensureDevelopmentModelPanel() {
    if ($("#developmentModelConnections")) return;
    $("#developmentTools").insertAdjacentHTML("beforebegin", `<section class="development-model-panel" aria-labelledby="developmentModelTitle"><header><div><h3 id="developmentModelTitle">引擎模型</h3><p>默认继承上方模型。只有需要不同供应商、账号或模型时才单独设置。</p></div></header><div class="development-model-list" id="developmentModelConnections"><p class="status">正在读取…</p></div><form class="development-model-editor" id="developmentModelConnectionForm" hidden><div class="development-model-editor-head"><div><strong id="developmentModelEditorTitle">配置引擎模型</strong><small id="developmentModelEditorSummary"></small></div><button type="button" class="development-model-close" id="cancelDevelopmentModel" aria-label="关闭模型设置">×</button></div><div class="form-grid"><label class="field"><span>使用方式</span><select id="developmentModelMode"><option value="inherit">继承默认模型</option><option value="independent">使用独立模型</option></select><small>继承时会自动跟随“模型”页的修改。</small></label><label class="field development-independent-field"><span>模型服务</span><select id="developmentModelProvider"></select><small id="developmentModelKeyHint">独立密钥只加密保存在本机。</small></label><label class="field development-independent-field"><span>接口协议</span><select id="developmentModelProtocol"><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select><small>Codex 必须使用 OpenAI Responses 兼容服务。</small></label><label class="field development-independent-field"><span>API 地址</span><input id="developmentModelBaseUrl" type="url" inputmode="url" spellcheck="false" autocomplete="off"><small>远程地址必须使用 HTTPS。</small></label><label class="field development-independent-field"><span>模型名称</span><input id="developmentModelName" spellcheck="false" autocomplete="off"><small>填写服务商提供的真实模型 ID。</small></label><label class="field development-independent-field"><span>API Key</span><input id="developmentModelKey" type="password" spellcheck="false" autocomplete="new-password"><small>留空会沿用该引擎已保存的密钥。</small></label></div><div class="development-model-warning" id="developmentModelWarning" hidden></div><div class="form-actions"><button class="primary" id="saveDevelopmentModel" type="submit">测试并保存</button><button class="button" id="cancelDevelopmentModelSecondary" type="button">取消</button></div><p class="status" id="developmentModelStatus" role="status" aria-live="polite"></p></form></section>`);
  }
  function developmentModelPreset(id) { return (developmentModelState?.providers || []).find((item) => item.id === id); }
  function updateDevelopmentModelFields() {
    const independent = $("#developmentModelMode").value === "independent";
    document.querySelectorAll(".development-independent-field").forEach((field) => { field.hidden = !independent; });
    const provider = $("#developmentModelProvider").value;
    const preset = developmentModelPreset(provider);
    $("#developmentModelProtocol").disabled = provider !== "custom" || editingDevelopmentEngine === "codex";
    if (editingDevelopmentEngine === "codex") $("#developmentModelProtocol").value = "openai-compatible";
    $("#developmentModelKeyHint").textContent = developmentModelState?.engines?.[editingDevelopmentEngine]?.hasKey
      ? "已保存密钥；留空继续使用。"
      : (preset?.keyRequired ? `需要 ${preset.name} API Key。` : "本机服务通常无需填写密钥。");
    const warning = $("#developmentModelWarning");
    warning.hidden = editingDevelopmentEngine !== "codex" || !independent;
    warning.textContent = warning.hidden ? "" : "Codex 使用 Responses API；所填服务必须兼容该接口。";
  }
  function renderDevelopmentModelConnections(state) {
    developmentModelState = state;
    $("#developmentModelConnections").innerHTML = Object.entries(developmentEngineNames).map(([id, name]) => {
      const item = state.engines?.[id] || {};
      const detail = item.effective ? `${item.providerName || "模型服务"} · ${item.model || "未命名模型"}` : "尚未连接可用模型";
      const mode = item.mode === "independent" ? "独立" : "继承";
      return `<article class="development-model-row"><div class="development-model-identity"><strong>${escapeHtml(name)}</strong><span class="development-model-mode ${item.mode === "independent" ? "is-independent" : ""}">${mode}</span><small>${escapeHtml(detail)}</small></div><button type="button" data-development-model-engine="${escapeHtml(id)}">设置</button></article>`;
    }).join("");
  }
  function openDevelopmentModelEditor(engine) {
    editingDevelopmentEngine = normalizedDevelopmentEngine(engine);
    const item = developmentModelState?.engines?.[editingDevelopmentEngine] || {};
    $("#developmentModelEditorTitle").textContent = `${developmentEngineNames[editingDevelopmentEngine]} · 模型`;
    $("#developmentModelEditorSummary").textContent = item.mode === "independent" ? "当前使用独立连接" : "当前继承默认模型";
    $("#developmentModelMode").value = item.mode === "independent" ? "independent" : "inherit";
    $("#developmentModelProvider").innerHTML = (developmentModelState?.providers || []).map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join("");
    $("#developmentModelProvider").value = item.provider || "zhipu";
    $("#developmentModelProtocol").value = item.protocol || "openai-compatible";
    $("#developmentModelBaseUrl").value = item.baseUrl || "";
    $("#developmentModelName").value = item.model || "";
    $("#developmentModelKey").value = "";
    $("#developmentModelStatus").textContent = "";
    $("#developmentModelConnectionForm").hidden = false;
    updateDevelopmentModelFields();
    $("#developmentModelMode").focus();
  }
  function closeDevelopmentModelEditor() { $("#developmentModelConnectionForm").hidden = true; }
  async function loadDevelopmentModelConnections() {
    ensureDevelopmentModelPanel();
    try { renderDevelopmentModelConnections(await api("/api/development/model-connections")); }
    catch (error) { $("#developmentModelConnections").innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`; }
  }
  ensureDevelopmentModelPanel();
  $("#developmentModelConnections").onclick = (event) => { const button = event.target.closest("[data-development-model-engine]"); if (button) openDevelopmentModelEditor(button.dataset.developmentModelEngine); };
  $("#developmentModelProvider").onchange = () => { const item = developmentModelPreset($("#developmentModelProvider").value); if (item) { $("#developmentModelProtocol").value = item.protocol; $("#developmentModelBaseUrl").value = item.baseUrl; $("#developmentModelName").value = item.model; } $("#developmentModelKey").value = ""; updateDevelopmentModelFields(); };
  $("#developmentModelMode").onchange = updateDevelopmentModelFields;
  $("#cancelDevelopmentModel").onclick = closeDevelopmentModelEditor;
  $("#cancelDevelopmentModelSecondary").onclick = closeDevelopmentModelEditor;
  $("#developmentModelConnectionForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#saveDevelopmentModel");
    button.disabled = true;
    $("#developmentModelStatus").className = "status";
    $("#developmentModelStatus").textContent = $("#developmentModelMode").value === "inherit" ? "正在保存…" : "正在验证模型连接…";
    try {
      const state = await api("/api/development/model-connections", { method: "POST", body: JSON.stringify({ engine: editingDevelopmentEngine, mode: $("#developmentModelMode").value, provider: $("#developmentModelProvider").value, protocol: $("#developmentModelProtocol").value, baseUrl: $("#developmentModelBaseUrl").value.trim(), model: $("#developmentModelName").value.trim(), key: $("#developmentModelKey").value.trim() }) });
      renderDevelopmentModelConnections(state);
      closeDevelopmentModelEditor();
      $("#developmentStatus").className = "status success";
      $("#developmentStatus").textContent = `${developmentEngineNames[editingDevelopmentEngine]} 的模型设置已保存。`;
    } catch (error) {
      $("#developmentModelStatus").className = "status error";
      $("#developmentModelStatus").textContent = `保存失败：${error.message}`;
    } finally { button.disabled = false; }
  };
  function renderTools(development = {}) {
    for (const [id, name] of Object.entries(developmentEngineNames)) {
      if (id === "pi") continue;
      const option = $("#defaultDevelopmentEngine").querySelector(`option[value="${id}"]`);
      if (!option) continue;
      option.disabled = development[id]?.available !== true;
      option.textContent = option.disabled ? `${name}（不可用）` : name;
    }
    const selected = $("#defaultDevelopmentEngine").selectedOptions[0];
    if (selected?.disabled) $("#defaultDevelopmentEngine").value = "pi";
    $("#defaultDevelopmentEngineHint").textContent = "Pi Agent 是默认引擎；其余引擎会按本机安装和当前模型连接状态启用。";
    const names = { node: "Node.js", git: "Git", python: "Python", ...developmentEngineNames };
    $("#developmentTools").innerHTML = Object.entries(development).map(([id, item]) => `<div class="tool-row"><div><h3>${escapeHtml(names[id] || id)}<span class="badge ${item.available ? "ready" : ""}">${item.available ? "可用" : "未安装"}</span></h3><p>${escapeHtml(item.version || "相关检查会明确跳过，不会伪装成已验证")}</p></div></div>`).join("");
  }
  function renderConnections(connectors = []) { const labels = { ready: "已连接", available: "可安装", "not-installed": "未安装" }; $("#connectionList").innerHTML = connectors.map((item) => `<article class="connection-row"><div><h3>${escapeHtml(item.name)}<span class="badge ${item.state}">${escapeHtml(labels[item.state] || item.state)}</span></h3><p>${escapeHtml(item.purpose)} · ${item.provider === "built-in" ? "应用内置" : "扩展提供"}</p><p>${escapeHtml(item.fallback || "")}</p></div>${item.state === "ready" ? `<button data-test="${escapeHtml(item.id)}">测试连接</button>` : `<button data-install>导入连接器</button>`}</article>`).join(""); }
  function renderCapabilityRuntime(registry = {}) {
    const counts = registry.counts || {};
    const providers = Array.isArray(registry.providers) ? registry.providers : [];
    const summary = `<article class="connection-row"><div><h3>任务执行<span class="badge ready">已接入</span></h3><p>${Number(counts.readyTools || 0)} 个工具可直接调用 · ${Number(counts.integratedTools || 0)} 项由产品流程承接 · ${Number(counts.readyEngines || 0)}/${Number(counts.engines || 0)} 个开发引擎可用</p></div></article>`;
    const providerRows = providers.map((item) => `<article class="connection-row"><div><h3>${escapeHtml(item.name)}<span class="badge ${item.available ? "ready" : ""}">${item.available ? "可用" : "未配置"}</span></h3><p>${escapeHtml(item.detail || "尚未提供状态说明")}${item.model ? ` · ${escapeHtml(item.model)}` : ""}</p></div></article>`).join("");
    $("#capabilityRuntimeList").innerHTML = summary + providerRows;
  }
  function renderExtensions(items = []) { $("#extensionList").innerHTML = items.length ? items.map((item) => `<article class="connection-row"><div><h3>${escapeHtml(item.manifest?.name || item.manifest?.id)}<span class="badge ${item.enabled ? "ready" : ""}">${item.enabled ? "已启用" : "已停用"}</span></h3><p>${escapeHtml(item.manifest?.version || "")}${item.runtimeError ? ` · ${escapeHtml(item.runtimeError)}` : ""}</p></div><button data-toggle="${escapeHtml(item.manifest.id)}" data-enabled="${item.enabled ? "1" : "0"}">${item.enabled ? "停用" : "启用"}</button></article>`).join("") : "<p class=\"status\">还没有安装扩展。</p>"; }
  async function loadPlatform() { try { const [platform, extensions, registry] = await Promise.all([api("/api/platform/readiness"), api("/api/agent/extensions"), api("/api/capabilities/registry")]); renderTools(platform.development); renderConnections(platform.connectors); renderCapabilityRuntime(registry); renderExtensions(extensions.extensions); } catch (error) { $("#connectionStatus").className = "status error"; $("#connectionStatus").textContent = error.message; } }
  $("#connectionList").onclick = async (event) => { const test = event.target.closest("[data-test]"); if (event.target.closest("[data-install]")) $("#extensionFile").click(); if (!test) return; try { const result = await api("/api/platform/connector/test", { method: "POST", body: JSON.stringify({ id: test.dataset.test }) }); $("#connectionStatus").className = "status success"; $("#connectionStatus").textContent = `连接正常，发现 ${result.toolCount} 个可用工具。`; } catch (error) { $("#connectionStatus").className = "status error"; $("#connectionStatus").textContent = error.message; } };
  $("#extensionList").onclick = async (event) => { const button = event.target.closest("[data-toggle]"); if (!button) return; try { await api("/api/agent/extension/enabled", { method: "POST", body: JSON.stringify({ id: button.dataset.toggle, enabled: button.dataset.enabled !== "1" }) }); await loadPlatform(); } catch (error) { $("#connectionStatus").className = "status error"; $("#connectionStatus").textContent = error.message; } };
  $("#importExtension").onclick = () => $("#extensionFile").click();
  $("#extensionFile").onchange = async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { const manifest = JSON.parse(await file.text()); const validation = await api("/api/agent/extension/validate", { method: "POST", body: JSON.stringify({ manifest }) }); const review = validation.validation || {}; const expanded = Array.isArray(review.permissionExpansion) ? review.permissionExpansion : []; const risks = [review.requiresExecutableConfirmation ? "会启动本机程序" : "", review.requiresUnsandboxedConfirmation ? "无法使用受限沙箱" : "", expanded.length ? `新增权限：${expanded.join("、")}` : ""].filter(Boolean); if (risks.length && !confirm(`连接器“${manifest.name || manifest.id}”${risks.join("，")}。确认安装吗？`)) return; await api(review.installed ? "/api/agent/extension/upgrade" : "/api/agent/extension/install", { method: "POST", body: JSON.stringify({ manifest, confirmExecutable: !!review.requiresExecutableConfirmation, confirmUnsandboxed: !!review.requiresUnsandboxedConfirmation, confirmPermissionExpansion: expanded.length > 0 }) }); $("#connectionStatus").className = "status success"; $("#connectionStatus").textContent = review.installed ? "扩展已更新。" : "连接器已安装。"; await loadPlatform(); } catch (error) { $("#connectionStatus").className = "status error"; $("#connectionStatus").textContent = error.message; } };
  let storageState = null;
  function renderStorage(state) { storageState = state; const settings = state.settings || state; const server = settings.mode === "server"; $("#storageMode").value = server ? "server" : "local"; $("#serverStorageFields").hidden = !server; $("#syncEndpoint").value = settings.endpoint || ""; $("#syncUserId").value = settings.userId || "me"; $("#syncToken").value = ""; $("#syncPassphrase").value = ""; $("#syncTokenHint").textContent = settings.hasToken ? "访问令牌已加密保存；留空继续使用。" : "令牌只加密保存在本机。"; $("#syncPassphraseHint").textContent = settings.hasPassphrase ? "加密口令已保存；留空继续使用。" : "至少 12 个字符；丢失后服务器快照无法恢复。"; $("#storageCurrentTitle").textContent = server ? "自托管服务器同步" : "纯本地保存"; $("#storageCurrentDetail").textContent = server ? (settings.lastSyncedAt ? `最近同步：${new Date(settings.lastSyncedAt).toLocaleString("zh-CN")}` : "尚未完成首次同步") : "数据不会上传到小丑鱼服务器"; $("#storageDot").classList.toggle("live", server && !settings.lastError); ["#testStorage", "#pushStorage", "#pullStorage"].forEach((id) => { $(id).hidden = !server; }); if (settings.lastError) { $("#storageStatus").className = "status error"; $("#storageStatus").textContent = settings.lastError; } }
  async function loadStorage() { try { renderStorage(await api("/api/data-sync")); } catch (error) { $("#storageStatus").className = "status error"; $("#storageStatus").textContent = error.message; } }
  $("#storageMode").onchange = () => { $("#serverStorageFields").hidden = $("#storageMode").value !== "server"; };
  $("#storageForm").onsubmit = async (event) => { event.preventDefault(); const button = $("#saveStorage"); button.disabled = true; $("#storageStatus").className = "status"; $("#storageStatus").textContent = "正在保存…"; try { const result = await api("/api/data-sync/settings", { method: "POST", body: JSON.stringify({ mode: $("#storageMode").value, endpoint: $("#syncEndpoint").value.trim(), userId: $("#syncUserId").value.trim(), token: $("#syncToken").value, passphrase: $("#syncPassphrase").value }) }); renderStorage(result); $("#storageStatus").className = "status success"; $("#storageStatus").textContent = "数据保存方式已更新。"; } catch (error) { $("#storageStatus").className = "status error"; $("#storageStatus").textContent = error.message; } finally { button.disabled = false; } };
  async function storageOperation(operation) { const labels = { test: "正在测试连接…", push: "正在加密并备份…", pull: "正在下载并校验恢复数据…" }; $("#storageStatus").className = "status"; $("#storageStatus").textContent = labels[operation]; try { const result = await api(`/api/data-sync/${operation}`, { method: "POST", body: "{}" }); renderStorage(result); $("#storageStatus").className = "status success"; $("#storageStatus").textContent = operation === "test" ? "服务器连接正常。" : operation === "push" ? "加密备份已上传。" : "恢复数据已安全下载，将在重启小丑鱼后生效。"; } catch (error) { $("#storageStatus").className = "status error"; $("#storageStatus").textContent = error.message; } }
  $("#testStorage").onclick = () => storageOperation("test");
  $("#pushStorage").onclick = () => storageOperation("push");
  $("#pullStorage").onclick = () => { if (confirm("从服务器下载的数据会在重启后替换本机同步数据。当前模型密钥不会被替换。继续吗？")) storageOperation("pull"); };
  function ensureRetainedOutputPanel() {
    const storagePanel = document.querySelector('[data-panel="storage"]');
    if (!storagePanel || $("#retainedOutputList")) return;
    storagePanel.insertAdjacentHTML("beforeend", `<section class="retained-output-panel" aria-labelledby="retainedOutputTitle"><div class="retained-output-head"><div><h3 id="retainedOutputTitle">保留的产出</h3><p>删除归档记录时选择保留的文件会集中放在这里。</p></div><span id="retainedOutputCount">0</span></div><div class="retained-output-list" id="retainedOutputList"><p class="status">正在读取…</p></div></section>`);
  }
  function renderRetainedOutputs(items = []) {
    $("#retainedOutputCount").textContent = String(items.length);
    $("#retainedOutputList").innerHTML = items.length ? items.map((item) => `<article class="retained-output-row"><div><h4>${escapeHtml(item.title || item.originalTaskTitle || "保留文件")}</h4><p>${escapeHtml(String(item.format || "file").toUpperCase())} · 保留于 ${escapeHtml(new Date(item.retainedAt || item.createdAt).toLocaleString("zh-CN"))}</p></div><div class="retained-output-actions"><a class="button" target="_blank" rel="noopener" href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.id)}">查看</a><a class="button" href="/api/capabilities/artifact?id=${encodeURIComponent(item.id)}&download=1">下载</a><button type="button" data-delete-retained="${escapeHtml(item.id)}">彻底删除</button></div></article>`).join("") : `<p class="status">目前没有单独保留的产出文件。</p>`;
  }
  async function loadRetainedOutputs() {
    ensureRetainedOutputPanel();
    try { renderRetainedOutputs((await api("/api/capabilities")).retainedArtifacts || []); }
    catch (error) { $("#retainedOutputList").innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`; }
  }
  ensureRetainedOutputPanel();
  $("#retainedOutputList").onclick = async (event) => {
    const button = event.target.closest("[data-delete-retained]");
    if (!button || !confirm("彻底删除这个文件？删除后无法恢复。")) return;
    button.disabled = true;
    try {
      await api("/api/capabilities/retained-artifact/delete", { method: "POST", body: JSON.stringify({ id: button.dataset.deleteRetained, confirm: true }) });
      await loadRetainedOutputs();
    } catch (error) { button.disabled = false; alert(error.message); }
  };
  async function loadPrivacy() { try { const state = await api("/api/runtime"); $("#privacyList").innerHTML = `<div class="privacy-row"><div><b>本机数据目录</b><p>${escapeHtml(state.dataDir)}</p></div></div><div class="privacy-row"><div><b>记忆与偏好</b><p>可查看整理后的记忆，不展示内部原始归档。</p></div><a class="button" href="/memory">查看记忆</a></div><div class="privacy-row"><div><b>运行与审计记录</b><p>能力执行、确认和异常都可以追溯。</p></div><a class="button" href="/runs">查看记录</a></div><div class="privacy-row"><div><b>备份</b><p>${state.backups?.latest ? `最近备份：${escapeHtml(state.backups.latest)}` : "暂未读取到备份记录"}</p></div></div>`; } catch (error) { $("#privacyList").innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`; } }
  window.ClownfishIcons?.hydrate(); activate(location.hash.slice(1)); loadDevelopmentPreference(); loadModel(); loadDevelopmentModelConnections(); loadPlatform(); loadStorage(); loadRetainedOutputs(); loadPrivacy();
})();
