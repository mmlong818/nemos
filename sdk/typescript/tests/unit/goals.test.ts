import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersonalWorkStore, PersonalWorkError } from "../../examples/companion/personal-work.js";
import { GOAL_CATEGORIES, GOAL_LIMITS, goalCoachingAddendum } from "../../examples/companion/goals.js";
import type { Nemos } from "../../src/index.js";
import type { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import { filterCompanionRuntimeToolsForSurface } from "../../examples/companion/capability-system-registry.js";
import type { ChatAgentContext } from "../../examples/companion/engine.js";
import { measurePromptBudget, promptBudgetFailure } from "../../examples/companion/prompt-budget.js";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "goals-"));
  const path = join(dir, "personal.db");
  const state = { store: new PersonalWorkStore(path), restart() { this.store.close(); this.store = new PersonalWorkStore(path); } };
  t.after(() => { state.store.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return state;
}
const reading = { title: "今年读完 12 本书", category: "interests", why: "想把刷手机的时间换回来", measure: "读完 12 本，每本写三句话笔记", plan: "每晚睡前读 20 分钟",
  milestones: [{ title: "选好第一季度的 3 本" }, { title: "读完第一本" }] };

test("目标类别与界面一致：七类，顺序固定", () => {
  assert.deepEqual(GOAL_CATEGORIES.map((c) => c.label), ["健康", "人际关系", "财务", "职业", "兴趣", "效率提升", "其他"]);
});

test("建立目标写下起点；跨重启保留；只能按当前版本更新；不能读别的用户", (t) => {
  const f = fixture(t);
  const goal = f.store.saveGoal("me", reading, "assistant");
  assert.equal(goal.revision, 1);
  assert.equal(goal.milestones.length, 2);
  assert.deepEqual(goal.timeline.map((e) => [e.kind, e.by, e.text]), [["created", "assistant", "今年读完 12 本书"]]);
  f.restart();
  assert.equal(f.store.listGoals("me")[0].title, "今年读完 12 本书");
  assert.throws(() => f.store.saveGoal("me", { id: goal.id, revision: 99, title: "改名" }, "user"), (e: unknown) => e instanceof PersonalWorkError && e.status === 409);
  assert.throws(() => f.store.getGoal("someone-else", goal.id), (e: unknown) => e instanceof PersonalWorkError && e.status === 404);
  assert.throws(() => f.store.saveGoal("me", { ...reading, category: "hobby" }, "user"), /无效的目标类别/);
  assert.throws(() => f.store.saveGoal("me", { title: "没有口径" }, "user"), /请填写怎么算做到/);
});

test("时间线只记真实发生的变化：调整、完成子目标、完成与重开各一条，谁记的写清楚", (t) => {
  const f = fixture(t);
  let goal = f.store.saveGoal("me", reading, "assistant");
  const [first, second] = goal.milestones;
  // 原样保存不产生时间线条目。
  goal = f.store.saveGoal("me", { id: goal.id, revision: goal.revision }, "user");
  assert.equal(goal.timeline.length, 1);
  goal = f.store.saveGoal("me", { id: goal.id, revision: goal.revision, plan: "每晚读 30 分钟", milestones: [{ id: first.id, done: true }, { id: second.id }, { title: "写第一篇笔记" }] }, "user");
  assert.deepEqual(goal.timeline.slice(1).map((e) => [e.kind, e.by, e.text]), [
    ["revised", "user", "计划、子目标（新增 写第一篇笔记）"],
    ["milestone", "user", "选好第一季度的 3 本"],
  ]);
  assert.ok(goal.milestones[0].doneAt);
  goal = f.store.logGoalProgress("me", goal.id, "《原子习惯》读到第 5 章", "assistant");
  assert.deepEqual(goal.timeline.at(-1)!.kind, "progress");
  assert.throws(() => f.store.logGoalProgress("me", goal.id, "  ", "user"), /请填写进展/);
  goal = f.store.saveGoal("me", { id: goal.id, revision: goal.revision, status: "completed", result: "12 本读完" }, "assistant");
  assert.deepEqual([goal.timeline.at(-1)!.kind, goal.timeline.at(-1)!.text], ["completed", "12 本读完"]);
  goal = f.store.saveGoal("me", { id: goal.id, revision: goal.revision, status: "active" }, "user");
  assert.equal(goal.timeline.at(-1)!.kind, "reopened");
  f.store.deleteGoal("me", goal.id);
  assert.equal(f.store.listGoals("me").length, 0);
});

test("只给日期的期限按北京时间当天结束；时间线超长时保留起点", (t) => {
  const f = fixture(t);
  let goal = f.store.saveGoal("me", { ...reading, dueAt: "2026-12-31" }, "user");
  assert.equal(goal.dueAt, "2026-12-31T15:59:59.000Z");
  assert.throws(() => f.store.saveGoal("me", { ...reading, dueAt: "年底" }, "user"), /期限需要有效日期/);
  for (let i = 0; i < GOAL_LIMITS.timeline + 5; i++) goal = f.store.logGoalProgress("me", goal.id, `第 ${i} 次`, "user");
  assert.equal(goal.timeline.length, GOAL_LIMITS.timeline);
  assert.equal(goal.timeline[0].kind, "created");
  assert.equal(goal.timeline.at(-1)!.text, `第 ${GOAL_LIMITS.timeline + 4} 次`);
});

const chat: ChatAgentContext = { sessionId: "conversation-goal", userId: "me", personaId: "clownfish", instruction: "", scope: "conv:me:clownfish", memoryScopes: ["conv:me:clownfish"], mode: "chat", surface: "task" };
const names = (tools: ReadonlyArray<{ definition: { name: string } }>) => tools.map((tool) => tool.definition.name);

test("目标对话里说'好'也能拿到目标工具；普通闲聊拿不到；工具都能通过界面过滤", async (t) => {
  const f = fixture(t);
  const sessions = new Map([["conversation-goal", { category: "interests" }]]);
  const provider = createCompanionAgentToolProvider({ memory: () => ({} as Nemos), capabilities: () => ({} as CapabilityRuntime), personalWork: () => f.store, goalSession: (id) => sessions.get(id) });
  const inGoalChat = await provider("好，就这样", chat);
  assert.deepEqual(names(inGoalChat), ["goal_list", "goal_save", "goal_log_progress"]);
  assert.deepEqual(names(await provider("好，就这样", { ...chat, sessionId: "conversation-other" })), []);
  assert.ok(names(await provider("我的读书目标这周读了两章", { ...chat, sessionId: "conversation-other" })).includes("goal_log_progress"));
  assert.deepEqual(names(await provider("好，就这样", { ...chat, surface: "capability" })), []);
  assert.deepEqual(names(await provider("好，就这样", { ...chat, personaId: "teacher_lin" })), []);
  assert.deepEqual(names(filterCompanionRuntimeToolsForSurface("task", inGoalChat)), ["goal_list", "goal_save", "goal_log_progress"]);

  const save = inGoalChat.find((tool) => tool.definition.name === "goal_save")!;
  assert.equal(save.definition.effect, "write", "写入要走审批");
  const signal = new AbortController().signal;
  const saved = JSON.parse((await save.execute({ ...reading }, { signal, runId: "r1", sessionId: "conversation-goal" })).content);
  assert.equal(saved.category, "兴趣");
  assert.equal(f.store.getGoal("me", saved.id).timeline[0].by, "assistant");
  const log = inGoalChat.find((tool) => tool.definition.name === "goal_log_progress")!;
  await log.execute({ id: saved.id, note: "这周读了两章" }, { signal, runId: "r2", sessionId: "conversation-goal" });
  const listed = JSON.parse((await inGoalChat[0].execute({}, { signal, runId: "r3", sessionId: "conversation-goal" })).content);
  assert.equal(listed.goals[0].recent.at(-1).text, "这周读了两章");
});

test("目标引导：新目标先谈清楚再记，已有目标只记 ta 说的进展；都在指令预算内", () => {
  const draft = goalCoachingAddendum("interests");
  assert.match(draft, /ta 从目标页选了「兴趣」类/);
  assert.match(draft, /每次最多问两个问题/);
  assert.match(draft, /没谈妥之前不要调用 goal_save/);
  const goal = { id: "g1", title: "今年读完 12 本书", measure: "读完 12 本", plan: "每晚 20 分钟", milestones: [], timeline: [] } as unknown as Parameters<typeof goalCoachingAddendum>[1];
  const ongoing = goalCoachingAddendum("interests", goal);
  assert.match(ongoing, /关于目标「今年读完 12 本书」/);
  assert.match(ongoing, /没说的不要替 ta 估/);
  for (const text of [draft, ongoing]) assert.equal(promptBudgetFailure(measurePromptBudget(text)), undefined);
});

const page = require("../../examples/companion/web/assets/goals.js");

test("目标页：类别与服务端一致；时间线按日分组、新的在前；对话链接带上类别与目标", () => {
  assert.deepEqual(page.CATEGORIES.map((c: string[]) => c[0]), GOAL_CATEGORIES.map((c) => c.id));
  assert.deepEqual(page.CATEGORIES.map((c: string[]) => c[1]), GOAL_CATEGORIES.map((c) => c.label));
  const now = new Date(2026, 8, 24, 20, 0);
  const at = (d: number, h: number) => new Date(2026, 8, d, h).toISOString();
  const groups = page.groupTimeline([
    { at: at(22, 9), kind: "created", text: "a" }, { at: at(24, 8), kind: "progress", text: "b" },
    { at: at(23, 21), kind: "milestone", text: "c" }, { at: at(24, 19), kind: "progress", text: "d" },
  ], now);
  assert.deepEqual(groups.map((g: { title: string }) => g.title), ["今天", "昨天", "9月22日"]);
  assert.deepEqual(groups[0].items.map((e: { text: string }) => e.text), ["d", "b"]);
  assert.deepEqual(page.progress({ milestones: [{ done: true }, { done: false }, { done: true }] }), { done: 2, total: 3, percent: 67 });
  assert.deepEqual(page.progress({ milestones: [] }), { done: 0, total: 0, percent: 0 });
  assert.equal(page.chatHref("interests"), "/?goal=interests");
  const href = new URL("http://x" + page.chatHref("interests", { id: "g1", title: "读完 12 本书" }));
  assert.deepEqual([href.searchParams.get("goal"), href.searchParams.get("goalId"), href.searchParams.get("title")], ["interests", "g1", "读完 12 本书"]);
});

test("聊已有目标：一轮就能记进展并勾子目标——编号缺省用会话的目标，版本号可省，只传一项子目标不删别的", async (t) => {
  const f = fixture(t);
  const goal = f.store.saveGoal("me", reading, "user");
  const sessions = new Map([["conversation-goal", { category: "interests", goalId: goal.id }]]);
  const provider = createCompanionAgentToolProvider({ memory: () => ({} as Nemos), capabilities: () => ({} as CapabilityRuntime), personalWork: () => f.store, goalSession: (id) => sessions.get(id) });
  const tools = await provider("这周读完了第一本", chat);
  const run = (name: string, input: Record<string, unknown>) => tools.find((tool) => tool.definition.name === name)!.execute(input, { signal: new AbortController().signal, runId: "r", sessionId: "conversation-goal" });
  await run("goal_log_progress", { note: "这周读完了第一本" });
  await run("goal_save", { id: goal.id, milestones: [{ id: goal.milestones[1].id, done: true }] });
  const after = f.store.getGoal("me", goal.id);
  assert.deepEqual(after.milestones.map((m) => [m.title, m.done]), [["选好第一季度的 3 本", false], ["读完第一本", true]]);
  assert.deepEqual(after.timeline.slice(1).map((e) => [e.kind, e.by, e.text]), [["progress", "assistant", "这周读完了第一本"], ["milestone", "assistant", "读完第一本"]]);
  // 页面上的编辑仍然校验版本号。
  assert.throws(() => f.store.saveGoal("me", { id: goal.id, revision: goal.revision, title: "旧版本" }, "user"), /已被更新/);
  // 引导里带上目标与子目标编号、最近进展，不必先花一次工具调用去查。
  const addendum = goalCoachingAddendum("interests", after);
  assert.ok(addendum.includes(`目标 id ${goal.id}`));
  assert.ok(addendum.includes(`读完第一本（已完成，id ${goal.milestones[1].id}）`));
  assert.match(addendum, /最近记过的进展：\d{4}-\d\d-\d\d 这周读完了第一本/);
});
