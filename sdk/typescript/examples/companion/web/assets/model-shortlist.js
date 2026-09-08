"use strict";
(() => {
  const specialized = /(?:audio|realtime|transcrib|tts|whisper|image|dall-e|sora|embedding|moderation|codex|deep-research|search-preview)/i;
  const snapshot = /(?:\d{4}-\d{2}-\d{2}|-(?:preview|\d{4})$)/i;
  function catalog(state) {
    return [...new Map((Array.isArray(state?.models) ? state.models : [])
      .filter(item => item && typeof item.id === "string" && item.id)
      .map(item => [item.id, item])).values()];
  }
  function catalogState(state) {
    return state?.connectionRevision && state?.catalogConnectionRevision && state.connectionRevision !== state.catalogConnectionRevision ? "stale" : "current";
  }
  function eligibleCheck(state, id) {
    const check = state?.modelChecks?.[id];
    if (!check) return undefined;
    if (state?.connectionRevision && check.connectionRevision !== state.connectionRevision) return undefined;
    const checkedAt = Date.parse(check.checkedAt || "");
    if (!Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 7 * 24 * 60 * 60 * 1000) return undefined;
    return check;
  }
  function checkLabel(check, state) {
    if (!check) return "未验证";
    if (state?.connectionRevision && check.connectionRevision !== state.connectionRevision) return "检查已过期";
    const checkedAt = Date.parse(check.checkedAt || "");
    if (!Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 7 * 24 * 60 * 60 * 1000) return "检查已过期";
    return check.chat !== "passed" ? "当前任务用途未通过" : check.tools === "passed" ? "文字与工具已验证" : "仅文字已验证";
  }
  function recommendation(item) {
    const id = String(item?.id || "");
    if (specialized.test(id)) return "名称显示可能是专用模型；以实际能力检查为准";
    if (snapshot.test(id)) return "名称显示可能是固定版本；可用于需要版本锁定的任务";
    return "通用候选；目录名称不代表能力已验证";
  }
  function decorate(state, id, extra = {}) {
    const found = catalog(state).find(item => item.id === id);
    const favorites = new Set(Array.isArray(state?.favoriteModels) ? state.favoriteModels : []);
    return { ...(found || { id }), ...extra, current: id === state?.model, favorite: favorites.has(id), directory: !!found,
      catalogStale: catalogState(state) === "stale", check: eligibleCheck(state, id) };
  }
  function shortlist(state) {
    const result = [], seen = new Set();
    const add = (id, extra) => { if (typeof id !== "string" || !id || seen.has(id)) return; seen.add(id); result.push(decorate(state, id, extra)); };
    add(state?.model);
    for (const id of Array.isArray(state?.favoriteModels) ? state.favoriteModels : []) add(id);
    for (const id of Object.keys(state?.modelChecks || {})) if (eligibleCheck(state, id)?.chat === "passed") add(id);
    return result;
  }
  function taskModels(state, selected = "default") {
    const items = shortlist(state).filter(item => item.id !== state?.model || item.id === selected);
    if (selected !== "default" && !items.some(item => item.id === selected)) items.push(decorate(state, selected, { pinned: true, missing: !catalog(state).some(item => item.id === selected) }));
    return items;
  }
  function label(item, state) {
    const sources = [item.current ? "当前默认" : "", item.favorite ? "用户添加" : "", item.check?.chat === "passed" ? "已验证" : ""].filter(Boolean);
    return [item.displayName || item.id, sources.join(" + "), item.missing ? "已不在目录" : item.catalogStale ? "目录已过期" : "", checkLabel(state?.modelChecks?.[item.id], state)].filter(Boolean).join(" · ");
  }
  window.ClownfishModelShortlist = Object.freeze({ catalog, catalogState, eligibleCheck, shortlist, taskModels, label, checkLabel, recommendation });
})();
