/**
 * 总览页的「动态」：可编辑的话题、生成按钮、按每次生成分组的帖子。
 * 只有点「生成」才会联网和调用模型；看这个页面本身不会。纯逻辑导出给测试。
 */
(function (root) {
  const KIND = { news: "新消息", goal: "目标", tip: "建议" };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /** 批次标题：今天 09:12 / 昨天 21:40 / 9月22日 08:05。 */
  function batchLabel(at, now = new Date()) {
    const d = new Date(at);
    const day = (x) => x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (day(d) === day(now)) return "今天 " + hm;
    if (day(d) === day(yesterday)) return "昨天 " + hm;
    return (d.getFullYear() === now.getFullYear() ? "" : d.getFullYear() + "年") + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
  }
  /** 按批次分组，新的在前；只放有帖子或有说明的批次。 */
  function groupByBatch(batches, posts) {
    return (batches || []).map((batch) => ({ batch, posts: (posts || []).filter((p) => p.batchId === batch.id) }));
  }
  /** 只放 http(s) 链接，别的一律不渲染成可点的。 */
  function safeUrl(url) { return /^https?:\/\//i.test(String(url || "")) ? String(url) : ""; }
  function discussHref(post) { return "/?discuss=" + encodeURIComponent(post.id); }

  function postHtml(post) {
    const sources = (post.sources || []).map((s) => safeUrl(s.url) ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>` : "").filter(Boolean);
    return `<article class="feed-post" data-kind="${esc(post.kind)}"><header><span class="feed-kind">${esc(KIND[post.kind] || "动态")}</span><h3>${esc(post.title)}</h3></header>`
      + `<p>${esc(post.body)}</p>`
      + (sources.length ? `<p class="feed-sources">来源：${sources.join("、")}</p>` : "")
      + `<footer><button type="button" class="feed-like" data-feed-like="${esc(post.id)}" aria-pressed="${post.liked ? "true" : "false"}" aria-label="${post.liked ? "取消喜欢" : "喜欢"}">${post.liked ? "♥" : "♡"}</button><a class="feed-discuss" href="${esc(discussHref(post))}">讨论</a></footer></article>`;
  }

  function render(container, data, state = {}) {
    const all = groupByBatch(data.batches, data.posts);
    // 默认只放最近 3 次，免得把总览下面的事项和成果挤得太远。
    const groups = state.showAll ? all : all.slice(0, 3);
    const prompt = state.editing
      ? `<textarea id="feedPromptInput" maxlength="500" rows="3" aria-label="动态话题">${esc(data.prompt)}</textarea><div class="feed-actions"><button type="button" data-feed-cancel>取消</button><button type="button" class="primary" data-feed-save>保存</button></div>`
      : `<p class="feed-prompt-text">${esc(data.prompt)}</p><div class="feed-actions"><button type="button" data-feed-edit>编辑</button><button type="button" class="primary" data-feed-generate ${state.generating || data.generating || !data.modelReady ? "disabled" : ""}>${state.generating || data.generating ? "正在找内容…" : "生成"}</button></div>`;
    const hint = !data.modelReady ? "还没有连接模型，生成不了。" : data.searchAvailable ? "点「生成」时会联网搜索，再结合你的目标和事项写几条；没有新东西就不硬凑。" : "联网搜索没有配置：生成时只会根据你的目标和事项写提醒和建议，不会有新消息。";
    container.innerHTML = `<div class="feed-card"><p class="feed-label">你的动态话题</p>${prompt}<p class="hint">${esc(hint)}</p></div>`
      + (groups.length ? groups.map(({ batch, posts }) => `<section class="feed-batch" data-status="${esc(batch.status)}"><h3 class="feed-batch-title">${esc(batchLabel(batch.at))}</h3>`
        + (batch.status !== "posted" || !posts.length ? `<p class="feed-note">${esc(batch.note)}</p>` : `<p class="feed-note feed-note-quiet">${esc(batch.note)}</p>`)
        + posts.map(postHtml).join("") + `</section>`).join("") : `<p class="feed-empty">还没有动态。写好话题后点「生成」。</p>`)
      + (all.length > groups.length ? `<button type="button" class="feed-more" data-feed-more>显示更早的 ${all.length - groups.length} 次</button>` : "");
  }

  const api = { batchLabel, groupByBatch, safeUrl, discussHref, render };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClownfishFeed = api;
})(typeof window !== "undefined" ? window : globalThis);
