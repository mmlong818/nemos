"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const labels = {
    chat: "文字与推理",
    vision: "看图理解",
    speech_to_text: "语音识别",
    text_to_speech: "语音合成",
    image_generation: "图像生成",
    video_generation: "视频生成",
  };
  const stageOrder = ["saving", "discovering", "verifying", "assigning"];
  let activeRequestId = "";
  let pollTimer = 0;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.userMessage || data.error || `请求失败（${response.status}）`);
      error.response = data;
      throw error;
    }
    return data;
  }

  function setProviderState(state) {
    for (const provider of state.providers || []) {
      const node = provider.provider === "openai" ? $("#modelQuickOpenAIState") : $("#modelQuickZhipuState");
      const detail = provider.provider === "openai" ? $("#modelQuickOpenAIDetail") : $("#modelQuickZhipuDetail");
      const card = document.querySelector(`[data-quick-provider="${provider.provider}"]`);
      if (!node || !card) continue;
      const result = state.snapshot?.providerResults?.find((item) => item.provider === provider.provider);
      node.textContent = result?.status === "failed"
        ? "验证未通过"
        : result?.status === "running"
          ? "正在配置"
          : result?.status === "ready"
            ? (provider.active ? "已验证 · 当前使用" : "已验证")
            : provider.configured ? (provider.active ? "已连接 · 当前使用" : "已保存") : "未配置";
      if (detail) detail.textContent = result?.detail || (provider.configured ? "留空会继续使用已保存的 Key。" : "填写后将加密保存在本机。");
      card.dataset.configured = String(Boolean(provider.configured));
      card.dataset.status = result?.status || (provider.configured ? "saved" : "empty");
    }
  }

  function renderProgress(snapshot) {
    const stage = snapshot?.stage || "";
    const activeIndex = stageOrder.indexOf(stage);
    const finished = ["complete", "partial", "failed"].includes(stage);
    document.querySelectorAll("#modelQuickProgress li").forEach((item, index) => {
      item.classList.toggle("is-active", index === activeIndex);
      item.classList.toggle("is-complete", finished || (activeIndex >= 0 && index < activeIndex));
    });
  }

  function renderResults(snapshot) {
    const root = $("#modelQuickResults");
    if (!root) return;
    if (!snapshot?.capabilityResults?.length) {
      root.innerHTML = '<p class="model-quick-empty">配置完成后，这里会显示每项能力是否可以直接使用。</p>';
      return;
    }
    root.innerHTML = snapshot.capabilityResults.map((item) => {
      const status = item.status === "ready" ? "可用" : item.status === "preserved" ? "已保留" : item.status === "unsupported" ? "尚未接入" : item.status === "running" ? "验证中" : item.status === "failed" ? "未通过" : "未配置";
      const model = item.modelId ? `<small>${escapeHtml(item.modelId)}${item.provider ? ` · ${item.provider === "openai" ? "OpenAI" : "智谱"}` : ""}</small>` : "";
      return `<article class="model-quick-result" data-status="${escapeHtml(item.status)}"><span class="model-quick-result-mark" aria-hidden="true"></span><div><b>${escapeHtml(labels[item.capability] || item.capability)}</b>${model}<p>${escapeHtml(item.detail || "")}</p></div><em>${status}</em></article>`;
    }).join("");
  }

  function render(state) {
    setProviderState(state);
    const snapshot = state.snapshot;
    renderProgress(snapshot);
    renderResults(snapshot);
    const status = $("#modelQuickStatus");
    if (status) status.textContent = snapshot?.message || "填写一个或两个 Key 后即可自动完成。";
    const running = snapshot && ["saving", "discovering", "verifying", "assigning"].includes(snapshot.stage);
    for (const id of ["modelQuickSubmit", "modelQuickRetry", "modelQuickReset"]) {
      const button = $("#" + id);
      if (button) button.disabled = Boolean(running || activeRequestId);
    }
    if (running) schedulePoll();
  }

  function schedulePoll() {
    if (pollTimer) return;
    pollTimer = window.setTimeout(async () => {
      pollTimer = 0;
      try {
        const state = await request("/api/model-quick-setup");
        render(state);
        if (["saving", "discovering", "verifying", "assigning"].includes(state.snapshot?.stage)) schedulePoll();
      } catch { /* the main action keeps the actionable error */ }
    }, 900);
  }

  async function run({ resetRecommendations = false, includeKeys = false } = {}) {
    if (activeRequestId) return;
    activeRequestId = globalThis.crypto?.randomUUID?.() || `setup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const keys = includeKeys ? {
      openai: $("#modelQuickOpenAIKey")?.value.trim() || "",
      zhipu: $("#modelQuickZhipuKey")?.value.trim() || "",
    } : {};
    if ($("#modelQuickOpenAIKey")) $("#modelQuickOpenAIKey").value = "";
    if ($("#modelQuickZhipuKey")) $("#modelQuickZhipuKey").value = "";
    const status = $("#modelQuickStatus");
    if (status) status.textContent = "正在开始自动配置…";
    for (const id of ["modelQuickSubmit", "modelQuickRetry", "modelQuickReset"]) {
      const button = $("#" + id); if (button) button.disabled = true;
    }
    try {
      const state = await request("/api/model-quick-setup", {
        method: "POST",
        body: JSON.stringify({ requestId: activeRequestId, keys, resetRecommendations }),
      });
      render(state);
      window.dispatchEvent(new CustomEvent("clownfish:model-setup-complete", { detail: state }));
    } catch (error) {
      if (error.response) render(error.response);
      if (status) status.textContent = error.message;
    } finally {
      activeRequestId = "";
      for (const id of ["modelQuickSubmit", "modelQuickRetry", "modelQuickReset"]) {
        const button = $("#" + id); if (button) button.disabled = false;
      }
    }
  }

  $("#modelQuickSubmit")?.addEventListener("click", () => run({ includeKeys: true }));
  $("#modelQuickRetry")?.addEventListener("click", () => run());
  $("#modelQuickReset")?.addEventListener("click", () => run({ resetRecommendations: true }));
  request("/api/model-quick-setup").then(render).catch((error) => {
    const status = $("#modelQuickStatus"); if (status) status.textContent = error.message;
  });
})();
