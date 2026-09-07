import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { renderAppPage } from "../../examples/companion/app-navigation.js";

const source = (file: string) => readFileSync(`examples/companion/web/${file}`, "utf8");

test("任务优先默认路由仍尊重 Bot、市场和具体任务深链接", () => {
  const page = source("bots.html");
  const script = source("assets/assistant-team.js");
  assert.doesNotMatch(page, /taskLaunch|team-task-launch/);
  assert.ok(page.indexOf('id="showTasks"') < page.indexOf('id="showBots"'));
  assert.match(page, /id="newTask"[^>]*aria-label="新建任务或继续草稿"/);
  const taskPane = page.slice(page.indexOf('id="tasksPane"'), page.indexOf('id="botsPane"'));
  assert.match(taskPane, /class="team-workspace"[\s\S]*id="newTask"[\s\S]*id="taskComposer"[\s\S]*id="taskForm"[\s\S]*id="jobDetail"/);
  assert.doesNotMatch(page, /id="taskDialog"|从一件具体的事开始/);
  assert.doesNotMatch(script, /selected=groups\[0\]/);
  assert.doesNotMatch(page.slice(0,page.indexOf('id="tasksPane"')), /id="newTask"/);
  assert.doesNotMatch(script, /#taskLaunch/);
  assert.match(source("assets/workbench-ui.js"), /botNav\.href='\/bots\?view=tasks'/);
  const fn = script.slice(script.indexOf("function restoreLocation("), script.indexOf("window.addEventListener('popstate'"));
  for (const [search, expected] of [["","tasks"],["?view=invalid","tasks"],["?view=bots","bots"],["?view=market","market"],["?job=existing&view=bots","tasks"]]) {
    const views: string[] = [];
    runInNewContext(fn + "\nrestoreLocation();", { URLSearchParams, location:{search}, selected:"", detailKey:"", currentJob:undefined, emptyDetail:"", $:()=>({innerHTML:""}), tabs:(view:string)=>views.push(view), load:()=>{} });
    assert.deepEqual(views,[expected]);
  }
});

test("移除重复快捷栏后，三个页签正常切换且侧栏入口保留", () => {
  const page = source("bots.html");
  const script = source("assets/assistant-team.js");
  assert.doesNotMatch(page, /Bot 相关工作|class="section-links"/);
  assert.doesNotMatch(script, /\.section-links/);
  const rendered = renderAppPage(page, "/bots");
  for (const route of ["/capabilities", "/tasks", "/artifacts", "/collaboration", "/runs"])
    assert.ok(rendered.includes(`href="${route}"`), route);
  const nodes = new Map<string, { hidden: boolean; setAttribute(): void }>();
  const tabs = script.slice(script.indexOf("function tabs("), script.indexOf("async function loadTemplates("));
  const context = {
    $: (selector: string) => {
      const exists = selector.startsWith("#") ? page.includes(`id="${selector.slice(1)}"`) : page.includes(selector.slice(1));
      assert.ok(exists, `切换逻辑引用了不存在的元素 ${selector}`);
      if (!nodes.has(selector)) nodes.set(selector, { hidden: false, setAttribute() {} });
      return nodes.get(selector);
    }, selected: "", historySpace: "", location: { pathname: "/bots", search: "" },
    showTaskContent() {}, window: {},
    history: { pushState() {}, replaceState() {} },
  };
  for (const view of ["tasks", "bots", "market"]) {
    runInNewContext(tabs + `\ntabs('${view}');`, context);
    for (const pane of ["tasks", "bots", "market"])
      assert.equal(nodes.get(`#${pane}Pane`)?.hidden, pane !== view);
  }
});

test("Bot 页明确职责、模型与资料边界，并保留所有工作入口", () => {
  const html = renderAppPage(source("bots.html"), "/bots");
  for (const copy of ["交办一件事", "两者都不是独立模型", "本次模型", "模型支持工具调用且你批准后才会启动", "只共享你当前这一条请求", "不读取私人对话或长期记忆", "保存规则不调用模型"])
    assert.ok(html.includes(copy), copy);
  for (const id of ["teamRoleBoundary", "newTask", "showTasks", "showBots", "showMarket", "taskComposer", "botDialog"])
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, id);
  assert.match(html, /href="\/">进入助理工作区/);
  assert.doesNotMatch(source("assets/workbench-ui.js"), /主助理负责交付，专职 Bot 做擅长的事/);
});

test("助理与总览使用同一产品区分，不承诺自动加入专业能力", () => {
  const assistant = source("index.html");
  assert.match(assistant, /class="wb-assistant-role-hint"/);
  assert.match(assistant, /href="\/bots\?view=bots">查看技能库/);
  assert.doesNotMatch(assistant, /专业判断与能力会在后台按需加入/);
  const overview = source("overview.html");
  assert.match(overview, /<h2>工作技能<\/h2>/);
  assert.match(overview, /技能保存可重复使用的工作方法/);
  assert.match(overview, /添加后需发起任务才会运行/);
});
