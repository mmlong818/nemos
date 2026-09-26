"use strict";
// 侧栏底部：版本号、反馈入口与新版本提醒。只有用户点过“提醒我”，服务端才会去 GitHub 读版本号。
(() => {
  const FEEDBACK_URL = "https://github.com/mmlong818/nemos/issues/new/choose";
  const bottom = document.querySelector("#wbNavigation .wb-bottom");
  if (!bottom) return;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const host = document.createElement("div");
  host.className = "app-update";
  host.setAttribute("aria-live", "polite");
  const meta = document.createElement("div");
  meta.className = "app-meta";
  bottom.querySelector("small")?.before(host);
  bottom.append(meta);

  async function request(method, body) {
    const response = await fetch("/api/app-update", {
      method, cache: "no-store",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function render(state) {
    meta.innerHTML = `<span>小丑鱼 ${escapeHtml(state.current)}</span><a href="${FEEDBACK_URL}" target="_blank" rel="noopener noreferrer">反馈问题</a>`;
    if (state.enabled === null) {
      host.innerHTML = '<div class="app-update-ask"><p>有新版本时提醒你？</p><small>会访问 GitHub 读取最新版本号，不发送任何个人数据。</small><div><button type="button" data-update-enable="true">提醒我</button><button type="button" data-update-enable="false">不用</button></div></div>';
    } else if (state.available && state.latest) {
      host.innerHTML = `<a class="app-update-available" href="${escapeHtml(state.latest.url)}" target="_blank" rel="noopener noreferrer">新版本 ${escapeHtml(state.latest.version)} 可以更新 ↗</a>`;
    } else {
      host.innerHTML = "";
    }
  }

  host.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-update-enable]");
    if (!button) return;
    host.querySelectorAll("button").forEach((item) => { item.disabled = true; });
    try { render(await request("POST", { enabled: button.dataset.updateEnable === "true" })); }
    catch { host.querySelectorAll("button").forEach((item) => { item.disabled = false; }); }
  });
  // 设置页里改了开关时同步侧栏。
  window.addEventListener("clownfish:app-update", (event) => { if (event.detail) render(event.detail); });
  request("GET").then(render).catch(() => { /* 检查更新不影响任何页面 */ });
})();
