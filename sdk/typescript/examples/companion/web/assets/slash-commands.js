/*
 * 聊天输入框里的斜杠命令：敲 / 弹出菜单，选中后直接在本机执行，不发给模型。
 *
 * 命令只是现有入口的快捷方式（新对话、对话记录、本机状态、活动栏、目标、动态、点子、帮我盯着），
 * 不新增能力。匹配不到任何命令时照常当普通消息发出去，免得 /usr/bin 这类文字被吞掉。
 */
(function (root) {
  "use strict";

  // action.type：click 点页面上已有的按钮（按选择器或按钮文字找）；navigate 跳到别的页面；help 在对话里列出命令。
  const SLASH_COMMANDS = [
    { name: "新对话", aliases: ["new", "clear"], hint: "开一段新对话", action: { type: "click", selector: "#quickGroup" } },
    { name: "记录", aliases: ["history", "对话记录"], hint: "打开对话记录", action: { type: "click", text: "对话记录" } },
    { name: "状态", aliases: ["status", "用量"], hint: "今天调了几次模型、用在哪、用了多少", action: { type: "status" } },
    { name: "活动", aliases: ["activity"], hint: "打开右侧活动栏：在做什么、等你批准什么、接下来排了什么", action: { type: "open-rail", selector: ".ar-toggle" } },
    { name: "目标", aliases: ["goal", "goals"], hint: "去目标页", action: { type: "navigate", href: "/matters?view=goals" } },
    { name: "动态", aliases: ["feed"], hint: "去总览看动态", action: { type: "navigate", href: "/overview" } },
    { name: "点子", aliases: ["ideas", "idea"], hint: "去技能库看小丑鱼想到能帮你做的事", action: { type: "navigate", href: "/bots?view=bots" } },
    { name: "盯着", aliases: ["watch"], hint: "设置要帮你盯着的事", action: { type: "navigate", href: "/settings#reminders" } },
    { name: "帮助", aliases: ["help", "?"], hint: "列出全部命令", action: { type: "help" } },
  ];

  /** 输入框里的命令词："/新" → "新"；不是以 / 开头、或 / 后面带了空格以外的第二段就返回 null。 */
  function commandWord(text) {
    const match = /^\/(\S*)$/.exec(String(text || "").trim());
    return match ? match[1].toLowerCase() : null;
  }

  /** 菜单里要列的命令：名字或别名以输入的词开头；只敲了 / 就全列。 */
  function matchSlashCommands(text) {
    const word = commandWord(text);
    if (word === null) return [];
    return SLASH_COMMANDS.filter((command) => [command.name, ...command.aliases].some((name) => name.toLowerCase().startsWith(word)));
  }

  /** 输入正好是某条命令（名字或别名）时返回它，否则 null。 */
  function exactSlashCommand(text) {
    const word = commandWord(text);
    if (!word) return null;
    return SLASH_COMMANDS.find((command) => [command.name, ...command.aliases].some((name) => name.toLowerCase() === word)) || null;
  }

  function helpText() {
    return "可以用的命令：\n" + SLASH_COMMANDS.map((command) => `/${command.name}（/${command.aliases[0]}）：${command.hint}`).join("\n");
  }

  // 账本的用途归成用户看得懂的几类。
  const USAGE_GROUPS = [
    ["聊天", ["chat"]], ["任务", ["task_turn", "completion_verify"]],
    ["专职协作", ["team_plan", "team_worker", "team_review", "team_final"]],
    ["动态", ["feed"]], ["盯着", ["watch"]], ["点子", ["ideas"]],
    ["记忆整理", ["memory_extract"]], ["其他", ["other"]],
  ];

  /** /状态 的回复：只讲账本里记下的，不估算金额；服务商没返回用量的照实说没算进去。 */
  function statusText(today, modelLabel) {
    const lines = [];
    if (!today || !today.calls) lines.push("今天还没调用过模型。");
    else {
      const by = today.byPurpose || {};
      const parts = USAGE_GROUPS.map(([label, keys]) => [label, keys.reduce((sum, key) => sum + (by[key] || 0), 0)]).filter(([, count]) => count > 0);
      lines.push(`今天（从 0 点起）调用了 ${today.calls} 次模型：${parts.map(([label, count]) => `${label} ${count} 次`).join("、")}。`);
      const tokens = (today.knownUsage && today.knownUsage.totalTokens) || 0;
      const unknown = today.unknownUsageCalls || 0;
      if (tokens || unknown < today.calls) lines.push(`服务商返回的用量合计 ${tokens.toLocaleString("en-US")} tokens${unknown ? `，另有 ${unknown} 次没返回用量，没算进去` : ""}。`);
      else lines.push("服务商都没有返回用量，没法统计 tokens。");
      if (today.complete === false) lines.push("账本只保留最近 500 次，今天更早的已经不在账本里，实际次数可能更多。");
    }
    if (modelLabel) lines.push(`当前模型：${modelLabel}`);
    return lines.join("\n");
  }

  const api = { SLASH_COMMANDS, matchSlashCommands, exactSlashCommand, helpText, statusText };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.ClownfishSlashCommands = api;
})(typeof window !== "undefined" ? window : globalThis);
