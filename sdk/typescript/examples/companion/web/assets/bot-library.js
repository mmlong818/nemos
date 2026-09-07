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
  window.ClownfishBotLibrary = Object.freeze({ summary, matches, filter, icon, taskGroups });
})();
