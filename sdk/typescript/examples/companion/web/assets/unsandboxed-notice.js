/* 无沙箱扩展的启动提示。
   安装时确认过一次，但那一次可能是几个月前，也可能是别人替这台机器做的（便携包转给他人）。
   所以每次启动再提示一次：哪个扩展在扩展沙箱之外运行、这意味着什么。
   确认按「扩展 id + 版本」记，升版会重新提示。

   自带样式：这个横幅要出现在全部页面上，而各页加载的样式表并不相同；把样式放进脚本，
   接入一个新页面就只是一行 script 标签。 */
(() => {
  const ENDPOINT = "/api/unsandboxed-notice";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  /** 没有这类扩展、或本版本已确认过，就完全不渲染——不留空容器。 */
  function shouldShow(payload) {
    return Boolean(payload && Array.isArray(payload.items) && payload.items.length && payload.acknowledged !== true);
  }

  /**
   * 横幅内容。名称来自扩展清单，仍然转义：清单可能来自用户后来自己安装的扩展。
   * 文案必须说清后果（不受读写路径与网络策略限制），而不只是"它不在沙箱里"。
   */
  function noticeHtml(items) {
    const names = items.map((item) => `${escapeHtml(item.name)}（${escapeHtml(item.version)}）`).join("、");
    return `<div class="cf-unsandboxed-inner" role="alert">
      <p><strong>${names}</strong> 在扩展沙箱之外运行：它会启动本机进程，对文件和网络的访问不受读写路径与网络策略限制。</p>
      <p class="cf-unsandboxed-hint">你在安装时确认过这一点。不再需要它时可以在「工具与连接」里停用。</p>
      <button type="button" data-cf-unsandboxed-ack>我知道了</button>
    </div>`;
  }

  const STYLE = `.cf-unsandboxed{position:sticky;top:0;z-index:60;background:#fff6ed;border-bottom:1px solid #f0c9a4;color:#5a3a1c;font-size:13px;line-height:1.7}
.cf-unsandboxed-inner{max-width:1080px;margin:0 auto;padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.cf-unsandboxed-inner p{margin:0;flex:1 1 320px}
.cf-unsandboxed-hint{color:#8a6647}
.cf-unsandboxed-inner button{border:1px solid #d9a97c;background:#fff;color:#5a3a1c;border-radius:8px;padding:6px 14px;cursor:pointer;font:inherit}
.cf-unsandboxed-inner button:focus-visible{outline:2px solid #c2410c;outline-offset:3px}`;

  async function mount() {
    let payload;
    try {
      const response = await fetch(ENDPOINT);
      if (!response.ok) return;
      payload = await response.json();
    } catch {
      // 读不到就不提示。这条提示是附加保障，不该因为一次请求失败而挡住页面。
      return;
    }
    if (!shouldShow(payload)) return;

    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.append(style);
    const banner = document.createElement("div");
    banner.className = "cf-unsandboxed";
    banner.innerHTML = noticeHtml(payload.items);
    document.body.prepend(banner);
    banner.querySelector("[data-cf-unsandboxed-ack]")?.addEventListener("click", async () => {
      // 先移除再上报：确认失败也不该把横幅一直留在那里，下次启动会再问。
      banner.remove();
      try { await fetch(`${ENDPOINT}/acknowledge`, { method: "POST" }); } catch { /* 下次启动会再提示 */ }
    });
  }

  window.ClownfishUnsandboxedNotice = Object.freeze({ shouldShow, noticeHtml, escapeHtml });
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", mount);
})();
