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
  assert.equal(library.filter(bots, workflows, "all", "").workflows.length, 11);
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
