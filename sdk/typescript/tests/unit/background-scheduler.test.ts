import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileAgentJobQueue } from "../../src/index.js";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { BackgroundScheduler, enqueueScheduledCapabilities } from "../../examples/companion/background-scheduler.js";

function runtimeAt(dir: string) {
  return new CapabilityRuntime({ dataDir: dir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => ({ reply: "结果", facts: [] }) });
}

function daily(runtime: CapabilityRuntime, time = "09:00") {
  return runtime.createTask({ title: "可靠提醒", personaId: "clownfish", capabilityId: "decision-brief", instruction: "准备每日简报", format: "md", enabled: true,
    schedule: { mode: "daily", time, timezone: "Asia/Shanghai", days: [1, 2, 3, 4, 5, 6, 7] } });
}

test("没有页面请求，后端计时器仍在到期后入队；重复启动和轮询不重复", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: new Date("2026-09-07T00:59:59Z") });
  const dir = mkdtempSync(join(tmpdir(), "clownfish-scheduler-timer-"));
  const runtime = runtimeAt(dir);
  const queue = new FileAgentJobQueue(join(dir, "jobs.json"));
  const task = daily(runtime);
  const scheduler = new BackgroundScheduler([{ name: "capabilities", run: () => { enqueueScheduledCapabilities(runtime, queue, "me", "time"); } }]);
  try {
    scheduler.start();
    scheduler.start();
    assert.equal(queue.list().filter((job) => job.payload.taskId === task.id).length, 0);
    t.mock.timers.tick(15_000);
    assert.equal(queue.list().filter((job) => job.payload.taskId === task.id).length, 1);
    t.mock.timers.tick(60_000);
    assert.equal(queue.list().filter((job) => job.payload.taskId === task.id).length, 1);
    assert.equal(scheduler.status().running, true);
    assert.deepEqual(scheduler.status().failedTasks, []);
    scheduler.stop();
    const lastTick = scheduler.status().lastTickAt;
    t.mock.timers.tick(60_000);
    assert.equal(scheduler.status().lastTickAt, lastTick);
    assert.equal(scheduler.status().running, false);
  } finally { scheduler.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("重启补当日到期任务，重建队列及清理历史后仍不自动重跑该次任务", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-scheduler-restart-"));
  try {
    const runtime = runtimeAt(dir);
    const task = daily(runtime, "00:00");
    const file = join(dir, "jobs.json");
    const queue = new FileAgentJobQueue(file);
    const first = enqueueScheduledCapabilities(runtime, queue, "me", "time").find((job) => job.payload.taskId === task.id)!;
    assert.ok(first);
    queue.cancel(first.id);
    const restarted = runtimeAt(dir);
    const recoveredQueue = new FileAgentJobQueue(file);
    assert.equal(enqueueScheduledCapabilities(restarted, recoveredQueue, "me", "time").some((job) => job.payload.taskId === task.id), false);
    const emptyHistory = new FileAgentJobQueue(join(dir, "empty-jobs.json"));
    assert.equal(enqueueScheduledCapabilities(restarted, emptyHistory, "me", "time").some((job) => job.payload.taskId === task.id), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("入队失败不消耗当次计划；入队成功但记录中断时恢复相同任务", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-scheduler-atomic-"));
  try {
    const runtime = runtimeAt(dir);
    const task = daily(runtime, "00:00");
    const queue = new FileAgentJobQueue(join(dir, "jobs.json"));
    const brokenEnqueue = t.mock.method(queue, "enqueue", () => { throw new Error("disk unavailable"); });
    assert.throws(() => enqueueScheduledCapabilities(runtime, queue, "me", "time"), /disk unavailable/);
    assert.equal(runtime.dueTaskRuns("time").some((item) => item.taskId === task.id), true);
    brokenEnqueue.mock.restore();
    const brokenAck = t.mock.method(runtime, "recordScheduledOccurrence", () => { throw new Error("interrupted"); });
    assert.throws(() => enqueueScheduledCapabilities(runtime, queue, "me", "time"), /interrupted/);
    const queuedId = queue.list().find((job) => job.payload.taskId === task.id)!.id;
    brokenAck.mock.restore();
    const recovered = enqueueScheduledCapabilities(runtime, queue, "me", "time").find((job) => job.payload.taskId === task.id)!;
    assert.equal(recovered.id, queuedId);
    assert.equal(queue.list().filter((job) => job.payload.taskId === task.id).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("跨时区、休眠后检查和停用计划保持正确边界，不补跑历史每一天", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-scheduler-calendar-"));
  try {
    const runtime = runtimeAt(dir);
    const task = daily(runtime);
    const due = (date: string) => runtime.dueTaskRuns("time", new Date(date)).find((item) => item.taskId === task.id);
    assert.equal(due("2026-09-07T00:59:59Z"), undefined);
    const monday = due("2026-09-07T01:00:00Z")!;
    assert.ok(monday);
    runtime.recordScheduledOccurrence(task.id, monday.occurrenceKey);
    assert.equal(due("2026-09-07T15:59:59Z"), undefined);
    assert.equal(due("2026-09-08T00:59:59Z"), undefined);
    assert.ok(due("2026-09-08T01:00:00Z"));
    assert.match(due("2026-09-12T08:00:00Z")!.occurrenceKey, /2026-09-12$/);
    // Public task objects are live state in CapabilityRuntime, including enabled/schedule.
    task.enabled = false;
    assert.equal(due("2026-09-12T08:00:00Z"), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("每日任务入队时固定下一次检查时间，轮次任务不伪造时间", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-07T01:00:00Z") });
  const dir = mkdtempSync(join(tmpdir(), "clownfish-scheduler-next-check-"));
  try {
    const runtime = runtimeAt(dir);
    const task = daily(runtime, "09:00");
    const queue = new FileAgentJobQueue(join(dir, "jobs.json"));
    const job = enqueueScheduledCapabilities(runtime, queue, "me", "time").find((item) => item.payload.taskId === task.id)!;
    assert.equal(job.payload.nextCheckAt, "2026-09-08T01:00:00.000Z");

    const turns = runtime.createTask({ title: "turns", personaId: "clownfish", capabilityId: "decision-brief", instruction: "check",
      enabled: true, schedule: { mode: "turns", everyTurns: 1 } });
    runtime.recordPersonaTurn("clownfish");
    const turnJob = enqueueScheduledCapabilities(runtime, queue, "me", "turn").find((item) => item.payload.taskId === turns.id)!;
    assert.equal(turnJob.payload.nextCheckAt, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("真实队列落盘失败回滚内存，不留下可误认成功的幂等记录", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-scheduler-disk-failure-"));
  try {
    const runtime = runtimeAt(dir);
    const task = daily(runtime, "00:00");
    const file = join(dir, "blocked-jobs.json");
    const queue = new FileAgentJobQueue(file);
    mkdirSync(file); // An empty directory cannot be replaced by the queue's file rename.
    assert.throws(() => enqueueScheduledCapabilities(runtime, queue, "me", "time"));
    assert.equal(queue.list().length, 0);
    assert.ok(runtime.dueTaskRuns("time").some((item) => item.taskId === task.id));
    rmdirSync(file);
    const recovered = enqueueScheduledCapabilities(runtime, queue, "me", "time").find((job) => job.payload.taskId === task.id)!;
    assert.ok(recovered);
    assert.ok(new FileAgentJobQueue(file).list().some((job) => job.id === recovered.id));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("单个调度源失败不阻断其它源，状态记录错误并在恢复后清除", () => {
  let broken = true;
  let healthy = 0;
  const scheduler = new BackgroundScheduler([
    { name: "first", run: () => { if (broken) throw new Error("private details"); } },
    { name: "second", run: () => { healthy++; } },
  ]);
  scheduler.runOnce();
  assert.equal(healthy, 1);
  assert.deepEqual(scheduler.status().failedTasks, ["first"]);
  broken = false;
  scheduler.runOnce();
  assert.equal(healthy, 2);
  assert.deepEqual(scheduler.status().failedTasks, []);
});
