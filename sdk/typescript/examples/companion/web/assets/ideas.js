/**
 * 技能库顶部的「为你想的点子」：小丑鱼根据目标、事项和偏好想的"我能帮你做的事"。
 * 看页面只读已有的；点「想几个」才调用模型；「马上开始」带着开场白进聊天，由小丑鱼动手。
 */
(function (root) {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const DELIVERABLE = { widget: "小工具", routine: "定时任务", goal: "目标", report: "报告", skill: "规则" };
  const REASONS = ["不相关", "太重复", "太具体", "不喜欢"];
  function startHref(idea) { return "/?idea=" + encodeURIComponent(idea.id); }
  function daysLeft(idea, now = new Date()) { return Math.max(0, Math.ceil((Date.parse(idea.expiresAt) - now.getTime()) / 86400000)); }

  function cardHtml(idea, state) {
    const more = idea.feedback && idea.feedback.kind === "more";
    return `<article class="idea-card" data-idea="${esc(idea.id)}"><header><span class="idea-kind">${esc(DELIVERABLE[idea.deliverable] || "点子")}</span>${idea.state === "started" ? '<span class="idea-state">已开始</span>' : ""}</header>`
      + `<h3>${esc(idea.title)}</h3><p>${esc(idea.summary)}</p><p class="idea-why">为什么想到你：${esc(idea.rationale)}</p>`
      + `<footer><a class="idea-start" href="${esc(startHref(idea))}" data-idea-start="${esc(idea.id)}">${idea.state === "started" ? "再聊聊" : "马上开始"}</a>`
      + `<button type="button" class="idea-link" data-idea-more="${esc(idea.id)}" aria-pressed="${more ? "true" : "false"}">${more ? "已标记更多类似" : "更多类似"}</button>`
      + `<button type="button" class="idea-link" data-idea-less-open="${esc(idea.id)}">不感兴趣</button><small>${daysLeft(idea)} 天后下架</small></footer>`
      + (state.lessOpen === idea.id ? `<div class="idea-less" role="group" aria-label="为什么不感兴趣">${REASONS.map((r) => `<button type="button" data-idea-less="${esc(idea.id)}" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}<input id="ideaLessNote" maxlength="200" placeholder="想多说一句（可不填）"></div>` : "")
      + `</article>`;
  }

  function render(container, data, state = {}) {
    const busy = state.generating || data.generating;
    container.innerHTML = `<header class="bot-section-heading"><div><h2>为你想的点子</h2><p>小丑鱼根据你的目标、事项和偏好，想的几件"我能帮你做的事"。只提现在真能做到的；两周后自动下架。</p></div>`
      + `<button type="button" class="bot-use-action" data-ideas-generate ${busy || !data.modelReady ? "disabled" : ""}>${busy ? "正在想…" : (data.ideas || []).length ? "再想几个" : "想几个"}</button></header>`
      + (state.note ? `<p class="idea-note">${esc(state.note)}</p>` : "")
      + ((data.ideas || []).length ? `<div class="idea-grid">${data.ideas.map((idea) => cardHtml(idea, state)).join("")}</div>`
        : `<p class="idea-empty">${data.modelReady ? "还没有点子。点「想几个」，小丑鱼会根据你已有的目标和事项想；它知道得越多，点子越贴切。" : "还没有连接模型，想不了点子。"}</p>`);
  }

  const api = { render, startHref, daysLeft, DELIVERABLE, REASONS };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.ClownfishIdeas = api;

  // ———— 以下只在浏览器里运行 ————
  const container = root.document && root.document.getElementById("ideasSection");
  if (!container) return;
  let data = { ideas: [], modelReady: true }, state = { note: "" };
  const post = async (path, body) => {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p.error || "操作没完成");
    return p;
  };
  const load = async () => { try { const r = await fetch("/api/ideas"); if (r.ok) data = await r.json(); } catch { /* 读不到就保持原样 */ } render(container, data, state); };
  container.addEventListener("click", async (event) => {
    const start = event.target.closest("[data-idea-start]");
    if (start) { event.preventDefault(); const href = start.getAttribute("href"); post("/api/ideas/started", { id: start.dataset.ideaStart }).catch(() => {}).finally(() => { location.href = href; }); return; }
    const b = event.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-ideas-generate")) {
      state.generating = true; state.note = ""; render(container, data, state);
      try { const r = await post("/api/ideas/generate"); state.note = r.note || ""; } catch (error) { state.note = error.message; }
      state.generating = false; await load(); return;
    }
    if (b.dataset.ideaMore) { b.disabled = true; try { await post("/api/ideas/feedback", { id: b.dataset.ideaMore, kind: "more" }); } catch (error) { alert(error.message); } await load(); return; }
    if (b.dataset.ideaLessOpen) { state.lessOpen = state.lessOpen === b.dataset.ideaLessOpen ? "" : b.dataset.ideaLessOpen; render(container, data, state); return; }
    if (b.dataset.ideaLess) {
      b.disabled = true;
      const note = (root.document.getElementById("ideaLessNote") || {}).value || "";
      try { await post("/api/ideas/feedback", { id: b.dataset.ideaLess, kind: "less", reason: b.dataset.reason, note }); state.lessOpen = ""; } catch (error) { alert(error.message); }
      await load();
    }
  });
  load();
})(typeof window !== "undefined" ? window : globalThis);
