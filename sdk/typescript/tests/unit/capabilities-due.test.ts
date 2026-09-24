import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

test("due task discovery is read-only and produces a stable occurrence key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-capability-due-"));
  let notifications = 0;
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => {
        notifications++;
        return { reply: "测试交付\n\n交付完成。", facts: [] };
      },
    });
    const task = runtime.createTask({
      title: "每日测试",
      personaId: "clownfish",
      capabilityId: "decision-brief",
      instruction: "生成测试简报",
      format: "md",
      enabled: true,
      schedule: {
        mode: "daily",
        time: "00:00",
        timezone: "Asia/Shanghai",
        days: [1, 2, 3, 4, 5, 6, 7],
      },
    });

    // 新建的任务不会补跑"今天已经过去的那次"（见下一条测试）；这里模拟一个昨天就存在的任务。
    delete (task as { lastScheduledOccurrenceKey?: string }).lastScheduledOccurrenceKey;
    const first = runtime.dueTaskRuns("time").find((item) => item.taskId === task.id);
    const second = runtime.dueTaskRuns("time").find((item) => item.taskId === task.id);

    assert.ok(first);
    assert.equal(first?.occurrenceKey, second?.occurrenceKey);
    assert.equal(notifications, 0);

    await runtime.runTask(task.id, "time");
    // 一次交付物 + 一次「待确认判断」追问。数字本身不是本条测试的重点，
    // 但它仍然钉住"到期发现没有自己触发运行"——那会让计数变成 4。
    assert.equal(notifications, 2);
    assert.equal(runtime.dueTaskRuns("time").some((item) => item.taskId === task.id), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turn-based due discovery uses the persisted turn counter", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-capability-turn-due-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: "交付完成。", facts: [] }),
    });
    const task = runtime.createTask({
      title: "轮次测试",
      personaId: "clownfish",
      capabilityId: "decision-brief",
      instruction: "每两轮总结一次",
      format: "md",
      enabled: true,
      schedule: { mode: "turns", everyTurns: 2 },
    });

    runtime.recordPersonaTurn("clownfish");
    assert.equal(runtime.dueTaskRuns("turn").some((item) => item.taskId === task.id), false);
    runtime.recordPersonaTurn("clownfish");
    const due = runtime.dueTaskRuns("turn").find((item) => item.taskId === task.id);
    assert.ok(due);
    assert.match(due?.occurrenceKey ?? "", /:turn:2$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 真实运行发现：17:00 建一个"每天早上 8 点"的任务，调度器把今天 8 点当成"错过了"，马上补跑一次。
// 今天那次根本不存在，任务是刚建的；首次运行应当是下一个运行日。
test("new or rescheduled daily task does not back-fill today's already-passed time", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-capability-new-task-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: "交付完成。", facts: [] }),
    });
    const daily = (time: string) => ({ mode: "daily" as const, time, timezone: "Asia/Shanghai", days: [1, 2, 3, 4, 5, 6, 7] });
    const passed = runtime.createTask({ title: "早上简报", personaId: "clownfish", capabilityId: "decision-brief", instruction: "x", enabled: true, schedule: daily("00:00") });
    assert.equal(runtime.dueTaskRuns("time").some((item) => item.taskId === passed.id), false, "今天 00:00 已过，新任务不应马上跑");
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    assert.equal(runtime.dueTaskRuns("time", tomorrow).some((item) => item.taskId === passed.id), true, "明天到点照常运行");

    // 今天的点还没到的新任务，今天照常运行。
    const later = runtime.createTask({ title: "深夜复盘", personaId: "clownfish", capabilityId: "decision-brief", instruction: "x", enabled: true, schedule: daily("23:59") });
    assert.equal(later.lastScheduledOccurrenceKey, undefined);

    // 改排期等同于新排期：改到今天已经过去的时间，也不马上补跑。
    const moved = runtime.updateTask({ id: later.id, schedule: daily("00:00") });
    assert.equal(runtime.dueTaskRuns("time").some((item) => item.taskId === moved.id), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
