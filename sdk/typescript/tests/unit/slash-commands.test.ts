import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const slash = require("../../examples/companion/web/assets/slash-commands.js");
const web = "examples/companion/web/";

test("斜杠命令匹配：只敲 / 列全部；中文名、英文别名都按前缀认；路径和普通话不当命令", () => {
  assert.equal(slash.matchSlashCommands("/").length, slash.SLASH_COMMANDS.length);
  assert.deepEqual(slash.matchSlashCommands("/新").map((c: { name: string }) => c.name), ["新对话"]);
  assert.deepEqual(slash.matchSlashCommands("/n").map((c: { name: string }) => c.name), ["新对话"]);
  assert.deepEqual(slash.matchSlashCommands("/ST").map((c: { name: string }) => c.name), ["状态"]);
  for (const text of ["/usr/bin/node", "你好", "/新对话 顺便问一句", "看看 /status", ""]) {
    assert.deepEqual(slash.matchSlashCommands(text), [], text);
  }
  assert.equal(slash.exactSlashCommand("/new").name, "新对话");
  assert.equal(slash.exactSlashCommand(" /盯着 ").name, "盯着");
  assert.equal(slash.exactSlashCommand("/usr"), null);
  assert.equal(slash.exactSlashCommand("/"), null);
});

test("斜杠命令名字和别名不重复；帮助里每条都有", () => {
  const names = slash.SLASH_COMMANDS.flatMap((c: { name: string; aliases: string[] }) => [c.name, ...c.aliases].map((n) => n.toLowerCase()));
  assert.equal(new Set(names).size, names.length);
  const help = slash.helpText();
  for (const command of slash.SLASH_COMMANDS) {
    assert.ok(command.hint, command.name);
    assert.match(help, new RegExp(`/${command.name}（`));
  }
});

test("/状态 讲今天调了几次模型、用在哪；没返回用量的不算成 0；账本被挤掉过要说；一次没调过也照说", () => {
  const text = slash.statusText({ calls: 9, complete: true, byPurpose: { chat: 2, task_turn: 3, completion_verify: 1, feed: 2, watch: 1 }, knownUsage: { totalTokens: 12345 }, unknownUsageCalls: 2 }, "glm-5.3");
  assert.match(text, /今天（从 0 点起）调用了 9 次模型：聊天 2 次、任务 4 次、动态 2 次、盯着 1 次。/);
  assert.match(text, /服务商返回的用量合计 12,345 tokens，另有 2 次没返回用量，没算进去。/);
  assert.match(text, /当前模型：glm-5\.3/);
  assert.doesNotMatch(text, /点子|协作|元|￥/, "为 0 的不列，也不估算金额");
  assert.match(slash.statusText({ calls: 500, complete: false, byPurpose: { other: 500 }, knownUsage: { totalTokens: 0 }, unknownUsageCalls: 500 }, ""), /今天更早的已经不在账本里，实际次数可能更多/);
  assert.match(slash.statusText({ calls: 0, complete: true, byPurpose: {}, knownUsage: { totalTokens: 0 }, unknownUsageCalls: 0 }, "glm-5.3"), /今天还没调用过模型/);
});

// 命令只是现有入口的快捷方式：入口改名或挪走时命令会静默失效，这里逐条钉住。
test("斜杠命令指向的入口都真的存在", () => {
  const index = readFileSync(web + "index.html", "utf8");
  assert.ok(index.includes('<script src="/assets/slash-commands.js"'), "聊天页要加载命令脚本");
  assert.ok(index.includes('id="slashMenu"'), "聊天页要有命令菜单");
  const workbench = readFileSync(web + "assets/workbench-ui.js", "utf8");
  const rail = readFileSync(web + "assets/activity-rail.js", "utf8");
  for (const command of slash.SLASH_COMMANDS) {
    const action = command.action;
    if (action.type === "click" && action.selector) assert.match(index, new RegExp(`id="${action.selector.slice(1)}"`), command.name);
    if (action.type === "click" && action.text) assert.ok(workbench.includes(`,'${action.text}');`), `${command.name}：workbench-ui.js 里要有 panel(…,'${action.text}')`);
    if (action.type === "open-rail") assert.match(rail, /toggle\.className = "ar-toggle"/, command.name);
    if (action.type === "status") assert.ok(readFileSync("examples/companion/routes/system.ts", "utf8").includes('route("GET", "/api/llm-usage"'), command.name);
    if (action.type === "navigate") {
      const [path, rest = ""] = action.href.split(/(?=[?#])/);
      assert.ok(existsSync(web + path.slice(1) + ".html"), `${command.name} → ${path}`);
      if (rest === "?view=goals") assert.match(readFileSync(web + "assets/personal-work.js", "utf8"), /\['goals','ongoing','completed'\]/);
      if (rest === "?view=bots") assert.match(readFileSync(web + "bots.html", "utf8"), /id="ideasSection"/);
      if (rest === "#reminders") assert.match(readFileSync(web + "settings.html", "utf8"), /data-panel="reminders"/);
    }
  }
});
