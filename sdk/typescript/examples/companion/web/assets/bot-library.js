"use strict";
(() => {
  function summary(bot) {
    const rules = String(bot.instructions || "").trim();
    const purpose = rules.match(/(?:适用场景|职责)[：:]\s*([^\n]+)/)?.[1] || rules.split(/\r?\n/).find(line => line.trim()) || "尚未填写工作规则";
    const sentence = purpose.match(/^[\s\S]*?[。；]/)?.[0] || purpose;
    return sentence.length > 112 ? sentence.slice(0, 112) + "…" : sentence;
  }
  function icon(bot) {
    const icons = { "plant-journal":"role-startup", "call-follow-ups":"phone", "project-guide":"work", "idea-stress-test":"role-decision", "bot-designer":"role-architecture", "copy-humanizer":"document", "pitch-deck-coach":"panel", "meeting-prep":"users" };
    return icons[bot.template?.id] || (bot.role === "reviewer" ? "role-test" : "message-circle");
  }
  function matches(item, query) {
    const text = [item.name, item.summary, item.instructions, item.category, item.use, item.deliverable].filter(Boolean).join(" ").toLocaleLowerCase();
    return String(query || "").trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word));
  }
  function filter(bots, workflows, kind, query) {
    return {
      bots: kind === "workflow" ? [] : bots.filter(bot => bot.placement !== "market" && (kind !== "disabled" || !bot.enabled) && matches(bot, query)),
      workflows: kind === "text" || kind === "disabled" ? [] : workflows.filter(bot => matches(bot, query)),
    };
  }
  function taskGroups(jobs) {
    const groups = [{ title:"进行中", jobs:[] }, { title:"需要处理", jobs:[] }, { title:"已结束", jobs:[] }];
    for (const job of [...jobs].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))) {
      const group = ['queued','running'].includes(job.status) ? 0 : ['succeeded','cancelled'].includes(job.status) ? 2 : 1;
      groups[group].jobs.push(job);
    }
    return groups.filter(group=>group.jobs.length);
  }
  /**
   * 把配方落地收据折算成界面要显示的行。
   *
   * 收据在导入时写入并长期保存，界面必须能回答「这个 Bot 往我这里装了什么」——
   * 只在添加时弹一次对话框的话，第二天就没人记得了。
   *
   * 三条呈现规则：装成功的要给出本机位置；失败的要说原因而不是悄悄消失；
   * 用户当时没勾的要单独列出来，否则用户无法确认自己的选择生效了。
   */
  function recipeReceipt(bot) {
    const receipt = bot && bot.recipeReceipt;
    if (!receipt || !Array.isArray(receipt.items) || !receipt.items.length) return null;
    const kindLabel = { skill: "可复用流程", routine: "定时任务" };
    const items = receipt.items.map(item => ({
      kind: kindLabel[item.kind] || item.kind,
      name: item.name,
      state: item.error ? "未装上" : item.kind === "routine" ? "已添加 · 暂停中" : "已添加",
      detail: item.error || "",
    }));
    const declined = [...(receipt.declined && receipt.declined.skills || []), ...(receipt.declined && receipt.declined.routines || [])];
    return {
      items,
      declinedCount: declined.length,
      // 收据内容来自模板作者，落地后仍按未经核实处理；这句必须出现在界面上。
      trustNote: receipt.trust === "untrusted" ? "以上内容来自模板作者，仍按未经核实处理。" : "",
      pausedNote: items.some(item => item.state === "已添加 · 暂停中")
        ? "定时任务一律先建成暂停，需要时在自动化页面显式打开。"
        : "",
    };
  }
  window.ClownfishBotLibrary = Object.freeze({ summary, matches, filter, icon, taskGroups, recipeReceipt });
})();
