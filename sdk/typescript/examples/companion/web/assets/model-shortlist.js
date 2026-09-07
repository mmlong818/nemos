"use strict";
(() => {
  // Reviewed against official model documentation on 2026-09-07. This is a
  // presentation shortlist, not a claim of availability or a retirement list.
  const roles = Object.freeze({
    "gpt-6-astra": "主力 · 复杂任务",
    "gpt-5.6-terra": "均衡 · 日常工作",
    "gpt-5.6-luna": "轻量 · 简单整理",
  });
  const specialized = /(?:audio|realtime|transcrib|tts|whisper|image|dall-e|sora|embedding|moderation|codex|deep-research|search-preview)/i;
  const snapshot = /(?:\d{4}-\d{2}-\d{2}|-(?:preview|\d{4})$)/i;
  function catalog(state) {
    return [...new Map((Array.isArray(state?.models) ? state.models : [])
      .filter(item => item && typeof item.id === "string" && item.id)
      .map(item => [item.id, item])).values()];
  }
  function checkLabel(check) {
    return !check ? "未检查" : check.chat !== "passed" ? "连接检查未通过" :
      check.tools === "passed" ? "工具已验证" : "仅文字已验证";
  }
  function shortlist(state) {
    const all = catalog(state);
    const result = [];
    const add = item => { if (item && !result.some(value => value.id === item.id)) result.push(item); };
    // Never silently replace an explicitly configured default, even if its last
    // check failed or a provider no longer includes it in its directory.
    if (state?.model) add(all.find(item => item.id === state.model) || { id: state.model });
    for (const id of Object.keys(roles)) {
      if (result.length >= 3) break;
      const check = state?.modelChecks?.[id];
      if (!check || check.chat === "passed") add(all.find(item => item.id === id));
    }
    // Unknown providers: prefer locally checked general models, not guesses
    // about release dates, prices, or vendor-specific names.
    for (const item of all) {
      if (result.length >= 3) break;
      if (!specialized.test(item.id) && !snapshot.test(item.id) && state?.modelChecks?.[item.id]?.chat === "passed") add(item);
    }
    return result;
  }
  function taskModels(state, selected = "default") {
    const items = shortlist(state).filter(item => item.id !== state?.model || item.id === selected);
    if (selected !== "default" && !items.some(item => item.id === selected)) {
      const existing = catalog(state).find(item => item.id === selected);
      items.push({ ...(existing || { id: selected }), pinned: true, missing: !existing });
    }
    return items;
  }
  function label(item, state) {
    return [item.displayName || item.id, item.pinned ? "当前会话固定" : roles[item.id],
      item.missing ? "已不在目录" : checkLabel(state?.modelChecks?.[item.id])].filter(Boolean).join(" · ");
  }
  window.ClownfishModelShortlist = Object.freeze({ catalog, shortlist, taskModels, label, checkLabel });
})();
