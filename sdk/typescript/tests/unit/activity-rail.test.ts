import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rail = require("../../examples/companion/web/assets/activity-rail.js");
const toolLabel = (name: string) => ({ web_search: "联网搜索", capability_task_create: "创建任务" } as Record<string, string>)[name] || name;

test("实时状态：由运行事件的展示分类映射成一句中文，工具名走统一翻译", () => {
  assert.equal(rail.liveStatusLabel({ kind: "tool", status: "running", tool: { name: "web_search" } }, toolLabel), "正在联网搜索");
  assert.equal(rail.liveStatusLabel({ kind: "model", status: "succeeded" }, toolLabel), "思考中");
  assert.equal(rail.liveStatusLabel({ kind: "phase", status: "running" }, toolLabel), "思考中");
  assert.equal(rail.liveStatusLabel({ kind: "approval", status: "blocked", tool: { name: "capability_task_create" } }, toolLabel), "等你批准：创建任务");
  assert.equal(rail.liveStatusLabel({ kind: "delegation", status: "running" }, toolLabel), "交给子任务处理");
  assert.equal(rail.liveStatusLabel({ kind: "completion", status: "succeeded" }, toolLabel), "整理交付");
  assert.equal(rail.liveStatusLabel({ kind: "failure", status: "failed" }, toolLabel), "遇到问题");
  // 真实运行里出现过"正在capability_web_search"：没有中文名的内部标识不露给用户。
  assert.equal(rail.liveStatusLabel({ kind: "tool", status: "running", tool: { name: "capability_web_search" } }, (n: string) => n), "正在调用工具");
  // 运行结束不再显示"正在做什么"，交回空闲。
  assert.equal(rail.liveStatusLabel({ kind: "phase", status: "succeeded" }, toolLabel), "");
});

test("动态：标题取可读字段，结论只看记录的状态与送达，不用模型写的摘要", () => {
  const tasks = [{ id: "task-1", title: "每日资料简报" }];
  assert.equal(rail.jobTitle({ type: "assistant-team", payload: { title: "整理记忆快照" } }, tasks), "整理记忆快照");
  assert.equal(rail.jobTitle({ type: "capability-task", payload: { taskId: "task-1" } }, tasks), "每日资料简报");
  assert.equal(rail.jobTitle({ type: "capability-task", payload: { taskId: "gone" } }, tasks), "例行任务");
  assert.equal(rail.jobTitle({ type: "hk-reminder", payload: {} }, tasks), "港股提醒");

  assert.equal(rail.jobOutcome({ status: "queued" }), "排队中");
  assert.equal(rail.jobOutcome({ status: "running", checkpoints: [{ status: "正在分析目标并生成结构" }] }), "正在分析目标并生成结构");
  assert.equal(rail.jobOutcome({ status: "succeeded", delivery: { status: "delivered" } }), "已完成，已送到你面前");
  assert.equal(rail.jobOutcome({ status: "succeeded", delivery: { status: "leased" } }), "已完成，还没送到你面前");
  assert.equal(rail.jobOutcome({ status: "succeeded" }), "已完成");
  assert.equal(rail.jobOutcome({ status: "failed", error: "The run stopped before a verified completion (max_rounds)." }), "没完成：达到轮次上限");
  assert.equal(rail.jobOutcome({ status: "failed", error: "网络连接失败，请稍后重试" }), "没完成：网络连接失败，请稍后重试");
  assert.equal(rail.jobOutcome({ status: "cancelled" }), "已取消");
  // uncertain 是"可能做了也可能没做"，要人核对：既不是失败也不是完成。
  assert.equal(rail.jobOutcome({ status: "uncertain", error: "fetch failed" }), "结果待核对：网络请求失败");
  assert.equal(rail.jobOutcome({ status: "failed", error: "fetch failed" }), "没完成：网络请求失败");
  // 模型写的 result.summary 即使说"已完成"，也不影响结论。
  assert.equal(rail.jobOutcome({ status: "failed", error: "x", result: { summary: "已经全部完成" } }), "没完成：x");
});

test("动态按本地日期分组：今天、昨天、更早写具体日期", () => {
  const now = new Date(2026, 8, 24, 10, 0);
  assert.equal(rail.dayLabel(new Date(2026, 8, 24, 8, 0).toISOString(), now), "今天");
  assert.equal(rail.dayLabel(new Date(2026, 8, 23, 23, 0).toISOString(), now), "昨天");
  assert.equal(rail.dayLabel(new Date(2026, 8, 22, 12, 0).toISOString(), now), "9月22日");
  assert.equal(rail.dayLabel(new Date(2025, 11, 31, 12, 0).toISOString(), now), "2025年12月31日");
  assert.equal(rail.dayLabel("not a date", now), "更早");
});

test("即将到来：只列启用的定时任务，按下次运行时间排序，写清运行条件", () => {
  // 2026-09-24 周四 10:00（Asia/Shanghai），用 UTC 表示为 02:00。
  const now = new Date("2026-09-24T02:00:00Z");
  const items = rail.upcomingTasks([
    { id: "a", title: "晚间复盘", enabled: true, schedule: { mode: "daily", time: "21:00", timezone: "Asia/Shanghai", days: [1, 2, 3, 4, 5, 6, 7] } },
    { id: "b", title: "晨间简报", enabled: true, schedule: { mode: "daily", time: "08:00", timezone: "Asia/Shanghai", days: [1, 2, 3, 4, 5, 6, 7] } },
    { id: "c", title: "周末整理", enabled: true, schedule: { mode: "daily", time: "09:00", timezone: "Asia/Shanghai", days: [6, 7] } },
    { id: "d", title: "每 20 轮汇总", enabled: true, schedule: { mode: "turns", everyTurns: 20 } },
    { id: "e", title: "已暂停的", enabled: false, schedule: { mode: "daily", time: "11:00" } },
    { id: "f", title: "手动的", enabled: true, schedule: { mode: "manual" } },
  ], now);
  assert.deepEqual(items.map((i: any) => i.id), ["a", "b", "c", "d"]);
  assert.equal(items[0].when, "今天 21:00");
  assert.equal(items[1].when, "明天 08:00");
  assert.equal(items[2].when, "周六 09:00");
  assert.equal(items[3].when, "每聊 20 轮");
  for (const item of items.slice(0, 3)) assert.match(item.note, /应用开着时运行/);
  assert.match(items[3].note, /和时间无关/);
  assert.equal(rail.pausedTaskCount([{ enabled: false, schedule: { mode: "daily" } }, { enabled: true, schedule: { mode: "daily" } }]), 1);
});

test("批准：只列待处理的，写清是哪个工具、还剩多久失效", () => {
  const now = new Date("2026-09-24T02:00:00Z");
  const rows = rail.approvalRows([
    { id: "p1", status: "pending", call: { name: "capability_task_create" }, createdAt: "2026-09-24T01:59:00Z", expiresAt: "2026-09-24T02:09:30Z", active: true },
    { id: "p2", status: "approved", call: { name: "web_search" }, createdAt: "2026-09-24T01:00:00Z" },
    { id: "p3", status: "pending", call: { name: "web_search" }, createdAt: "2026-09-24T01:58:00Z", active: false },
  ], toolLabel, now);
  assert.deepEqual(rows.map((r: any) => r.id), ["p1", "p3"]);
  assert.equal(rows[0].title, "创建任务");
  assert.equal(rows[0].expires, "9 分钟后失效");
  assert.match(rows[1].detail, /服务重启后保留/);
});

test("聊天页接上右栏：刷新链、事件流、连接状态都转给右栏，脚本在工作台之后挂载", () => {
  const html = readFileSync("examples/companion/web/index.html", "utf8");
  assert.match(html, /<script src="\/assets\/activity-rail\.js"><\/script>/);
  assert.match(html, /ClownfishActivityRail\?\.update\(agentOpsState/);
  assert.match(html, /ClownfishActivityRail\?\.onRunEvent\(payload\)/);
  assert.match(html, /onStatus: \(status\) => window\.ClownfishActivityRail\?\.setConnection\(status\)/);
  assert.match(html, /sessionGrants: approvals\.sessionGrants \|\| \[\]/);
  const script = readFileSync("examples/companion/web/assets/activity-rail.js", "utf8");
  // 真实运行里一次对话以 token_budget_exhausted 结束，右栏却显示回"空闲"：结束原因不是 completed 就是没做成。
  assert.match(script, /payload\.action === "completed" && payload\.reason && payload\.reason !== "completed"/);
  assert.match(script, /DOMContentLoaded/);
  // 只在助理页出现，其他页面不挂载。
  assert.match(script, /wbRoute !== "\/"/);
  // 本机偏好（收起状态）只存在浏览器里，读写都要兜底。
  assert.match(script, /try \{[^}]*localStorage/);
});
