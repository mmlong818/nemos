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
    if (action.type === "navigate") {
      const [path, rest = ""] = action.href.split(/(?=[?#])/);
      assert.ok(existsSync(web + path.slice(1) + ".html"), `${command.name} → ${path}`);
      if (rest === "?view=goals") assert.match(readFileSync(web + "assets/personal-work.js", "utf8"), /\['goals','ongoing','completed'\]/);
      if (rest === "?view=bots") assert.match(readFileSync(web + "bots.html", "utf8"), /id="ideasSection"/);
      if (rest === "#reminders") assert.match(readFileSync(web + "settings.html", "utf8"), /data-panel="reminders"/);
    }
  }
});
