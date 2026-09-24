/**
 * 事项页的「目标」页签：选类别开一段目标对话、目标卡片、详情里的子目标与时间线。
 * 纯逻辑（分组、进度、链接）导出给测试；界面由 personal-work.js 在切到目标页签时调用 render。
 */
(function (root) {
  const CATEGORIES = [
    ["health", "健康", "role-companion"], ["relationships", "人际关系", "users"], ["finance", "财务", "role-pricing"], ["career", "职业", "work"],
    ["interests", "兴趣", "spark"], ["productivity", "效率提升", "matters"], ["other", "其他", "square"],
  ];
  const label = (id) => (CATEGORIES.find(([key]) => key === id) || [, "其他"])[1];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { created: "定下目标", revised: "调整了", milestone: "完成子目标", progress: "进展", completed: "目标完成", reopened: "重新开始追踪" };
  /** 条目正文不带类型前缀；这里拼成一句，正文为空时只显示类型。 */
  const line = (e) => (KIND[e.kind] || "记录") + (e.text ? "：" + e.text : "");

  /** 按本地日期分组，最新的在前；每组里按时间倒序。 */
  function groupTimeline(entries, now = new Date()) {
    const day = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const today = day(now), yesterday = day(new Date(now.getTime() - 86400000));
    const groups = [];
    for (const entry of [...(entries || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
      const d = new Date(entry.at);
      const key = day(d);
      const title = key === today ? "今天" : key === yesterday ? "昨天" : `${d.getMonth() + 1}月${d.getDate()}日${d.getFullYear() !== now.getFullYear() ? `（${d.getFullYear()}）` : ""}`;
      let group = groups.find((g) => g.key === key);
      if (!group) groups.push(group = { key, title, items: [] });
      group.items.push(entry);
    }
    return groups;
  }
  function progress(goal) {
    const total = (goal.milestones || []).length;
    const done = (goal.milestones || []).filter((m) => m.done).length;
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }
  /** 目标对话的入口：新目标只带类别；已有目标带编号和名字，开场白用得上。 */
  function chatHref(category, goal) {
    const params = new URLSearchParams({ goal: category });
    if (goal) { params.set("goalId", goal.id); params.set("title", goal.title); }
    return "/?" + params.toString();
  }
  const time = (value) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const dateOnly = (value) => value ? new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }) : "";

  function card(goal) {
    const p = progress(goal);
    const last = [...(goal.timeline || [])].pop();
    return `<article class="goal-card" data-goal="${esc(goal.id)}"><header><span class="goal-cat">${esc(label(goal.category))}</span><h2><button class="goal-open" data-goal-open="${esc(goal.id)}">${esc(goal.title)}</button></h2></header>`
      + `<p class="goal-measure"><small>怎么算做到</small>${esc(goal.measure)}</p>`
      + (p.total ? `<div class="goal-progress" aria-label="子目标完成 ${p.done} / ${p.total}"><span style="width:${p.percent}%"></span></div><p class="goal-progress-text">子目标 ${p.done} / ${p.total}</p>` : "")
      + (last ? `<p class="goal-last">${esc(dateOnly(last.at))} · ${esc(line(last))}</p>` : "")
      + `<div class="personal-actions"><button data-goal-open="${esc(goal.id)}">查看详情</button>${goal.status === "active" ? `<a class="goal-chat" href="${esc(chatHref(goal.category, goal))}">聊聊进展</a>` : ""}</div></article>`;
  }

  function render(container, goals) {
    const active = goals.filter((g) => g.status === "active");
    const done = goals.filter((g) => g.status !== "active");
    container.innerHTML = `<section class="goal-start" aria-labelledby="goalStartTitle"><h2 id="goalStartTitle">定一个新目标</h2><p>选一个类别，和小丑鱼聊几句。它会先问清楚怎么算做到、打算怎么做，再帮你记成能追踪的目标。</p>`
      + `<ul class="goal-categories">${CATEGORIES.map(([id, name, icon]) => `<li><a href="${esc(chatHref(id))}"><span data-app-icon="${icon}" aria-hidden="true"></span>${esc(name)}<span class="goal-chevron" aria-hidden="true">›</span></a></li>`).join("")}</ul></section>`
      + (active.length ? `<section aria-label="进行中的目标"><h2 class="goal-section-title">进行中（${active.length}）</h2>${active.map(card).join("")}</section>` : "")
      + (done.length ? `<details class="goal-done"><summary>已完成或已归档（${done.length}）</summary>${done.map(card).join("")}</details>` : "");
    root.ClownfishIcons?.hydrate?.();
  }

  function detail(dialog, goal) {
    const groups = groupTimeline(goal.timeline);
    const by = (entry) => entry.by === "assistant" ? "小丑鱼记下" : "你";
    dialog.innerHTML = `<form method="dialog" class="goal-detail"><header><div><span class="goal-cat">${esc(label(goal.category))}${goal.status === "completed" ? " · 已完成" : goal.status === "archived" ? " · 已归档" : ""}</span><h2>${esc(goal.title)}</h2></div><button type="button" data-goal-close aria-label="关闭目标详情">×</button></header>`
      + `<dl class="goal-facts"><dt>怎么算做到</dt><dd>${esc(goal.measure)}</dd>${goal.plan ? `<dt>计划</dt><dd>${esc(goal.plan)}</dd>` : ""}${goal.why ? `<dt>为什么</dt><dd>${esc(goal.why)}</dd>` : ""}${goal.dueAt ? `<dt>期限</dt><dd>${esc(dateOnly(goal.dueAt))}</dd>` : ""}</dl>`
      + (goal.milestones.length ? `<fieldset class="goal-milestones"><legend>子目标</legend>${goal.milestones.map((m) => `<label><input type="checkbox" data-milestone="${esc(m.id)}" ${m.done ? "checked" : ""}> ${esc(m.title)}</label>`).join("")}</fieldset>` : "")
      + `<div class="goal-log"><label for="goalNote">记一条进展</label><div><input id="goalNote" maxlength="500" placeholder="例如：这周读完了第三章"><button type="button" data-goal-log>记下</button></div></div>`
      + `<section class="goal-timeline" aria-label="时间线"><h3>时间线</h3>${groups.map((g) => `<h4>${esc(g.title)}</h4><ol>${g.items.map((e) => `<li data-kind="${esc(e.kind)}"><time>${esc(time(e.at))}</time><span class="goal-who">${esc(by(e))}</span><p><strong>${esc(KIND[e.kind] || "记录")}</strong>${e.text ? " " + esc(e.text) : ""}</p></li>`).join("")}</ol>`).join("")}</section>`
      + `<p class="hint">时间线只记实际发生的事：你在页面上的操作，和小丑鱼在聊天里按你说的记下的进展，不会替你推断进度。</p>`
      + `<div class="personal-actions">${goal.status === "active" ? `<a class="goal-chat" href="${esc(chatHref(goal.category, goal))}">聊聊进展</a><button type="button" data-goal-status="completed">标记完成</button>` : `<button type="button" data-goal-status="active">重新开始追踪</button>`}<button type="button" data-goal-rename>改名</button><button type="button" data-goal-delete class="danger">删除</button></div>`
      + `<p class="form-error" role="alert"></p></form>`;
  }

  const api = { CATEGORIES, label, line, groupTimeline, progress, chatHref, render, detail };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClownfishGoals = api;
})(typeof window !== "undefined" ? window : globalThis);
