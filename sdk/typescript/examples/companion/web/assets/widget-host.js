/**
 * 构件宿主：把 HTML 产物嵌进沙箱 iframe，替它读写本机状态、按内容调整高度。
 *
 * 构件页面没有同源身份（服务端 CSP sandbox + 这里的 sandbox 属性），只能 postMessage 过来。
 * 这里只认自己挂载的 iframe 发来的消息，状态当数据原样存取，从不执行、不拼进页面。
 */
(function (root) {
  // 按 iframe 登记，收到消息时再比对 contentWindow：挂载时气泡可能还没插进页面，那时 contentWindow 是空的。
  const hosts = new Set();
  function hostFor(source) {
    for (const host of hosts) {
      if (!host.frame.isConnected) { if (host.seen) hosts.delete(host); continue; }
      host.seen = true;
      if (host.frame.contentWindow === source) return host;
    }
    return null;
  }

  async function api(path, body) {
    const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "构件状态没存上");
    return payload;
  }

  root.addEventListener("message", async (event) => {
    const host = event.source && hostFor(event.source);
    const data = event.data || {};
    if (!host || data.id !== host.id) return;
    if (data.type === "clownfish-widget-load") {
      let state = null;
      try { state = (await api("/api/capabilities/widget/state?id=" + encodeURIComponent(host.id))).state ?? null; } catch { /* 读不到就从空状态开始 */ }
      event.source.postMessage({ type: "clownfish-widget-state", id: host.id, state }, "*");
    } else if (data.type === "clownfish-widget-save") {
      clearTimeout(host.timer);
      host.timer = setTimeout(() => {
        api("/api/capabilities/widget/state", { id: host.id, state: data.state }).then(
          () => host.onSaved && host.onSaved(null),
          (error) => host.onSaved && host.onSaved(error),
        );
      }, 400);
    } else if (data.type === "clownfish-widget-size") {
      const height = Math.max(host.min, Math.min(host.max, Number(data.height) || 0));
      host.frame.style.height = height + "px";
    }
  });

  /** 在 container 里挂一个构件；返回 iframe。 */
  function mount(container, id, options = {}) {
    const frame = document.createElement("iframe");
    frame.className = "widget-frame";
    frame.setAttribute("sandbox", "allow-scripts allow-modals allow-downloads allow-popups");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.title = options.title || "构件";
    frame.src = "/api/capabilities/artifact/preview?id=" + encodeURIComponent(id);
    frame.style.height = (options.height || 320) + "px";
    container.appendChild(frame);
    hosts.add({ id, frame, min: options.minHeight || 120, max: options.maxHeight || 640, timer: 0, onSaved: options.onSaved });
    return frame;
  }

  const api_ = { mount };
  if (typeof module === "object" && module.exports) module.exports = api_;
  else root.ClownfishWidgetHost = api_;
})(typeof window !== "undefined" ? window : globalThis);
