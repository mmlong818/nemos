import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const read = (name: string) => readFileSync(`examples/companion/web/${name}`, "utf8");
const window: any = {};
runInNewContext(read("assets/bot-library.js"), { window });
runInNewContext(read("assets/workflow-catalog.js"), { window });
const library = window.ClownfishBotLibrary;
const bots = [
  { id: "one", name: "资料整理", enabled: true, role: "worker", instructions: "仅处理本次资料。\n职责：整理会议记录。完整规则保留在详情。" },
  { id: "two", name: "Review Bot", enabled: false, role: "reviewer", instructions: "Verify source S1" },
];
const workflows = window.ClownfishWorkflowCatalog.workflows;

test("task workspace groups active and attention items before ended jobs without mutating history", () => {
  const jobs = [
    { id: "done", status: "succeeded", updatedAt: "2026-09-07" },
    { id: "older", status: "running", updatedAt: "2026-09-01" },
    { id: "newer", status: "queued", updatedAt: "2026-09-06" },
    { id: "failed", status: "failed", updatedAt: "2026-09-03" },
    { id: "unknown", status: "new-state", updatedAt: "2026-09-02" },
    { id: "cancelled", status: "cancelled", updatedAt: "2026-09-05" },
  ];
  const before = JSON.stringify(jobs);
  const groups = library.taskGroups(jobs);
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map((g: any)=>g.jobs.map((j: any)=>j.id)))), [["newer","older"],["failed","unknown"],["done","cancelled"]]);
  assert.equal(JSON.stringify(jobs), before);
  assert.equal(library.taskGroups([]).length, 0);
});

test("filters preserve all Bots and separate text, workflows and disabled items without mutations", () => {
  const before = JSON.stringify(bots);
  assert.equal(library.filter(bots, workflows, "all", "").workflows.length, 13);
  assert.equal(library.filter(bots, workflows, "text", "").bots.length, 2);
  assert.equal(library.filter(bots, workflows, "text", "").workflows.length, 0);
  assert.equal(library.filter(bots, workflows, "workflow", "").bots.length, 0);
  assert.equal(library.filter(bots, workflows, "disabled", "").bots[0].id, "two");
  assert.equal(library.filter(bots, workflows, "disabled", "").workflows.length, 0);
  assert.equal(JSON.stringify(bots), before);
});

test("search supports names, rules, deliverables, whitespace and case, including no results", () => {
  assert.equal(library.filter(bots, workflows, "all", "会议").bots.length, 1);
  assert.equal(library.filter(bots, workflows, "all", "  REVIEW  s1 ").bots[0].id, "two");
  assert.equal(library.filter(bots, workflows, "all", "PPTX").workflows[0].id, "presentation");
  assert.equal(library.filter(bots, workflows, "all", "no-such-bot").bots.length, 0);
});

test("summaries come from actual saved rules, never overwrite them or imply extra capabilities", () => {
  assert.equal(library.summary(bots[0]), "整理会议记录。");
  assert.equal(library.summary({ instructions: "我修改了规则。" }), "我修改了规则。");
  assert.equal(library.summary({ instructions: "x".repeat(200) }).length, 113);
  assert.equal(library.summary({ instructions: "" }), "尚未填写工作规则");
});

test("library skips identical poll renders so focus and search survive background refresh", () => {
  const source = read("assets/assistant-team.js");
  const fn = source.slice(source.indexOf("function renderLibrary()"), source.indexOf("function inspectBot("));
  let writes = 0;
  const nodes: any = new Proxy({} as Record<PropertyKey, any>, { get: (target, key) => target[key] ||= { value: "", textContent: "", setAttribute() {}, set innerHTML(_value: string) { writes++; } } });
  const context = { $: (id: string) => nodes[id], library, libraryKey: "", data: { bots }, workflows, botFilter: "all", textBotCard: () => "text", workflowCard: () => "workflow", document: { querySelectorAll: () => [] }, window: { ClownfishIcons: { hydrate() {} } } };
  runInNewContext(fn + "\nrenderLibrary();renderLibrary();", context);
  assert.equal(writes, 3);
});

test("market-only Bots stay out of team search and disabled counts", () => {
  const marketBot = { ...bots[0], placement: "market", marketListed: true };
  assert.equal(library.filter([marketBot, bots[1]], workflows, "text", "").bots.length, 1);
  assert.equal(library.filter([marketBot], workflows, "all", "会议").bots.length, 0);
  assert.equal(library.filter([{ ...marketBot, placement: "team" }], workflows, "text", "").bots.length, 1);
});

test("both card types escape user content and retain separate start/edit routes", () => {
  const source = read("assets/assistant-team.js");
  const fn = source.slice(source.indexOf("function textBotCard("), source.indexOf("function renderLibrary("));
  const html = runInNewContext(fn + '\ntextBotCard(bot);', { library, bot: { ...bots[0], name: '<img src=x onerror=alert(1)>', enabled: false }, esc: (s: unknown) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;") });
  assert.ok(!html.includes("<img"));
  assert.match(html, /data-edit-bot="one"/);
  assert.match(html, /data-use-bot="one"[^>]*disabled/);
  assert.match(read("bots.html"), /id="botInfoDialog"[^>]*aria-labelledby="botInfoTitle"/);
});

test("派生模板详情明确显示来源、独立规则版本与本机私有边界", () => {
  const source = read("assets/assistant-team.js");
  assert.match(source, /查看完整规则 · 本地规则 v/);
  assert.match(source, /来源：模板 v/);
  assert.match(source, /本机派生规则 v/);
  assert.match(source, /仅本机私有。模板更新不会自动覆盖你的规则/);
});

// 收据在导入时写入并长期保存；界面必须能回答「这个 Bot 往我这里装了什么」。
test("配方收据：装上的给出状态，失败的说原因，未采纳的单独计数", () => {
  assert.equal(library.recipeReceipt(bots[0]), null, "没有收据时不显示这一块");
  assert.equal(library.recipeReceipt({ ...bots[0], recipeReceipt: { items: [], declined: { skills: ["a"], routines: [] } } }), null,
    "一项都没装上时也不显示，避免让用户以为发生过什么");

  const view = library.recipeReceipt({
    ...bots[0],
    recipeReceipt: {
      trust: "untrusted",
      items: [
        { kind: "skill", key: "a", localId: "skill-1", name: "阻塞升级判断" },
        { kind: "routine", key: "b", localId: "task-1", name: "待决事项汇总", enabled: false },
        { kind: "skill", key: "c", localId: "", name: "装不上的", error: "安装能力未通过准入检查" },
      ],
      declined: { skills: ["d"], routines: ["e"] },
    },
  });
  assert.equal(view.items.length, 3);
  assert.deepEqual(view.items.map((item: any) => item.state), ["已添加", "已添加 · 暂停中", "未装上"]);
  assert.deepEqual(view.items.map((item: any) => item.kind), ["可复用流程", "定时任务", "可复用流程"]);
  assert.match(view.items[2].detail, /准入检查/);
  assert.equal(view.declinedCount, 2);
  assert.match(view.pausedNote, /先建成暂停/);
  assert.match(view.trustNote, /未经核实/);
});

test("配方收据渲染：转义用户内容，没装过东西时不产生区块", () => {
  const source = read("assets/assistant-team.js");
  const fn = source.slice(source.indexOf("function recipeReceiptHtml("), source.indexOf("function inspectBot("));
  const esc = (s: unknown) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const render = (bot: unknown) => runInNewContext(fn + "\nrecipeReceiptHtml(bot);", { library, esc, bot });

  assert.equal(render(bots[0]), "");
  const html = render({
    ...bots[0],
    recipeReceipt: {
      trust: "untrusted",
      items: [{ kind: "skill", key: "a", localId: "s1", name: '<img src=x onerror=alert(1)>' }],
      declined: { skills: [], routines: [] },
    },
  }) as string;
  assert.ok(!html.includes("<img"), "模板作者提供的名称必须转义");
  assert.match(html, /装了什么（1 项）/);
  assert.match(html, /未经核实/);
});
