import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CapabilityRuntime, type CapabilityTask } from "../../examples/companion/capabilities.js";
import { ROUTINE_LIMITS } from "../../examples/companion/runtime-limits.js";
import { failureShapeByName } from "../../examples/companion/failure-registry.js";

const PAUSE_CODE = failureShapeByName("routinePausedUnread")!.code;

function runtimeAt(dir: string) {
  return new CapabilityRuntime({
    dataDir: dir,
    personas: () => [{ id: "clownfish", name: "小丑鱼" }],
    notify: async () => ({ reply: "结果", facts: [] }),
  });
}

function scheduled(runtime: CapabilityRuntime, mode: "daily" | "manual" = "daily"): CapabilityTask {
  return runtime.createTask({
    title: "每日简报", personaId: "clownfish", capabilityId: "decision-brief",
    instruction: "准备每日简报", format: "md", enabled: true,
    schedule: mode === "daily"
      ? { mode: "daily", time: "09:00", timezone: "Asia/Shanghai", days: [1, 2, 3, 4, 5, 6, 7] }
      : { mode: "manual" },
  });
}

/** 直接推进未读计数：这里检验的是暂停判定，不是执行链路。 */
function markUnread(task: CapabilityTask, runs: number): void {
  task.unreadRuns = runs;
}

test("连续多次结果无人查看的计划任务自动暂停，并记下失败编号与原因", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-unread-pause-"));
  try {
    const runtime = runtimeAt(dir);
    const task = scheduled(runtime);
    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause - 1);
    assert.deepEqual(runtime.pauseUnreadScheduledTasks(), []);
    assert.equal(task.enabled, true);

    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause);
    const paused = runtime.pauseUnreadScheduledTasks();
    assert.deepEqual(paused.map((item) => item.id), [task.id]);
    assert.equal(task.enabled, false);
    assert.equal(task.autoPausedCode, PAUSE_CODE);
    assert.equal(task.storyline.status, "paused");
    // 脉络事件是最新在前。
    assert.match(task.storyline.events[0]!.text, new RegExp(PAUSE_CODE));
    // 已经停了的任务不该被反复暂停、反复记事件。
    assert.deepEqual(runtime.pauseUnreadScheduledTasks(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("暂停后定时器不再取到它，也不会自行恢复", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-unread-nodue-"));
  try {
    const runtime = runtimeAt(dir);
    const task = scheduled(runtime);
    const at = new Date("2026-09-07T02:00:00Z");
    assert.ok(runtime.dueTaskRuns("time", at).some((item) => item.taskId === task.id));

    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause);
    runtime.pauseUnreadScheduledTasks();
    assert.equal(runtime.dueTaskRuns("time", at).some((item) => item.taskId === task.id), false);
    // 再跑多少轮调度都不会自己回来。
    for (let index = 0; index < 5; index++) runtime.pauseUnreadScheduledTasks();
    assert.equal(task.enabled, false);
    assert.deepEqual(runtime.tasksAwaitingResumeDecision().map((item) => item.id), [task.id]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("手动任务不会因为结果没人看而被暂停：暂停它没有意义", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-unread-manual-"));
  try {
    const runtime = runtimeAt(dir);
    const task = scheduled(runtime, "manual");
    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause * 3);
    assert.deepEqual(runtime.pauseUnreadScheduledTasks(), []);
    assert.equal(task.enabled, true);
    assert.equal(task.autoPausedCode, undefined);
    assert.deepEqual(runtime.tasksAwaitingResumeDecision(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("查看结果归零未读计数，倒计时重新开始", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-unread-reviewed-"));
  try {
    const runtime = runtimeAt(dir);
    const task = scheduled(runtime);
    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause - 1);
    const reviewed = runtime.markTaskReviewed(task.id, new Date("2026-09-08T01:00:00Z"));
    assert.equal(reviewed.unreadRuns, 0);
    assert.equal(reviewed.lastReviewedAt, "2026-09-08T01:00:00.000Z");
    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause - 1);
    assert.deepEqual(runtime.pauseUnreadScheduledTasks(), []);
    assert.throws(() => runtime.markTaskReviewed("不存在"), /未知任务/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("用户显式恢复后清空未读与暂停原因，否则下一次执行会立刻再次暂停", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-unread-resume-"));
  try {
    const runtime = runtimeAt(dir);
    const task = scheduled(runtime);
    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause);
    runtime.pauseUnreadScheduledTasks();

    const resumed = runtime.resumeAutoPausedTask(task.id);
    assert.equal(resumed.enabled, true);
    assert.equal(resumed.unreadRuns, 0);
    assert.equal(resumed.autoPausedCode, undefined);
    assert.equal(resumed.storyline.status, "active");
    assert.deepEqual(runtime.tasksAwaitingResumeDecision(), []);
    assert.deepEqual(runtime.pauseUnreadScheduledTasks(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("重启后未读计数与自动暂停原因仍在磁盘上", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-unread-restart-"));
  try {
    const runtime = runtimeAt(dir);
    const task = scheduled(runtime);
    markUnread(task, ROUTINE_LIMITS.unreadRunsBeforePause);
    runtime.pauseUnreadScheduledTasks();

    const restarted = runtimeAt(dir);
    const restored = restarted.tasksAwaitingResumeDecision();
    assert.deepEqual(restored.map((item) => item.id), [task.id]);
    assert.equal(restored[0]!.autoPausedCode, PAUSE_CODE);
    assert.equal(restored[0]!.unreadRuns, ROUTINE_LIMITS.unreadRunsBeforePause);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
