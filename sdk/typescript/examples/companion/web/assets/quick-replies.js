/*
 * 快捷回复的浏览器端解析，规则与 examples/companion/quick-replies.ts 完全一致：
 * 只认回复最后单独一行的「【选项】A｜B」，2 到 4 个选项，每个 1 到 24 个字；不满足就原样返回。
 */
(function (root) {
  "use strict";
  const LINE = /^【选项】(.+)$/;
  function extractQuickReplies(input) {
    const raw = String(input == null ? "" : input);
    const trimmed = raw.replace(/\s+$/, "");
    const at = trimmed.lastIndexOf("\n");
    const last = (at >= 0 ? trimmed.slice(at + 1) : trimmed).trim();
    const match = LINE.exec(last);
    if (!match) return { text: raw, options: [] };
    const options = match[1].split(/[｜|]/).map((item) => item.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 4 || options.some((item) => item.length > 24)) return { text: raw, options: [] };
    return { text: (at >= 0 ? trimmed.slice(0, at) : "").replace(/\s+$/, ""), options };
  }
  const api = { extractQuickReplies };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClownfishQuickReplies = api;
})(typeof window !== "undefined" ? window : globalThis);
