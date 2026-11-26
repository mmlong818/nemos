(function (root) {
  "use strict";

  const parameter = "projectTransfer";
  const keyPrefix = "clownfish-project-chat-transfer-v1:";
  const otherActions = ["goal", "goalId", "title", "session", "discuss", "idea"];
  const timeoutMs = 2 * 60_000;
  const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const validSpaceId = (value) => typeof value === "string" && value.length > 0 && value.length <= 120 &&
    value === value.trim() && value.isWellFormed() && !/[\x00-\x1f\x7f]/u.test(value);

  function start(storage, spaceId, { now = Date.now(), token = root.crypto.randomUUID() } = {}) {
    if (!validSpaceId(spaceId) || typeof token !== "string" || !tokenPattern.test(token) || !Number.isSafeInteger(now)) {
      throw new Error("无法转交项目");
    }
    storage.setItem(keyPrefix + token, JSON.stringify({ version: 1, spaceId, createdAt: now }));
    return "/?" + new URLSearchParams({ [parameter]: token });
  }

  function consume(location, history, storage, { now = Date.now() } = {}) {
    const params = new URLSearchParams(location.search);
    if (!params.has(parameter)) return null;
    const tokens = params.getAll(parameter);
    const mixed = tokens.length !== 1 || otherActions.some((name) => params.has(name));
    let raw = null;
    try {
      for (const token of new Set(tokens)) {
        if (!tokenPattern.test(token)) continue;
        const key = keyPrefix + token;
        if (!mixed) raw = storage.getItem(key);
        storage.removeItem(key);
      }
    } catch { raw = null; }

    params.delete(parameter);
    for (const name of otherActions) params.delete(name);
    const search = params.toString();
    try {
      history.replaceState(history.state, "", "/" + (search ? "?" + search : "") + location.hash);
    } catch { return { spaceId: "" }; }

    if (!raw || raw.length > 512) return { spaceId: "" };
    try {
      const value = JSON.parse(raw);
      if (value?.version === 1 && validSpaceId(value.spaceId) && Number.isSafeInteger(value.createdAt) &&
        Number.isSafeInteger(now) && value.createdAt <= now && now - value.createdAt <= timeoutMs) {
        return { spaceId: value.spaceId };
      }
    } catch {}
    return { spaceId: "" };
  }

  const api = Object.freeze({ start, consume });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ClownfishProjectChatHandoff = api;
})(typeof window !== "undefined" ? window : globalThis);
