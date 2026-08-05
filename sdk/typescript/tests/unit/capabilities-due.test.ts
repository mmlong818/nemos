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

    const first = runtime.dueTaskRuns("time").find((item) => item.taskId === task.id);
    const second = runtime.dueTaskRuns("time").find((item) => item.taskId === task.id);

    assert.ok(first);
    assert.equal(first?.occurrenceKey, second?.occurrenceKey);
    assert.equal(notifications, 0);

    await runtime.runTask(task.id, "time");
    assert.equal(notifications, 1);
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
