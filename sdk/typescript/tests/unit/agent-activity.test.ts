import assert from "node:assert/strict";
import test from "node:test";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";

import {
  describeAgentJobActivity,
  describeAgentOrchestrationActivity,
  describeAgentRunActivity,
  type AgentActivityKind,
} from "../../src/agent/index.js";
import type { AgentRunEvent } from "../../src/agent/types.js";
import type { AgentJobQueueEvent } from "../../src/agent/job-queue.js";
import type { AgentOrchestrationEvent } from "../../src/agent/orchestrator.js";

const call = { id: "c1", name: "save_file", arguments: { path: "a.md" } };

const RUN_EVENTS: AgentRunEvent[] = [
  { type: "run_start", runId: "r1", sessionId: "s1" },
  { type: "run_resume", runId: "r1", sessionId: "s1", round: 2 },
  { type: "round_start", round: 1 },
  { type: "model_end", round: 1, toolCallCount: 1, inputTokens: 10, outputTokens: 20 },
  { type: "token_budget_exhausted", limit: 100, used: 101 },
  { type: "tool_start", call, effect: "write", risk: "normal", source: "ext.demo" },
  { type: "tool_authorization", call, allowed: true, effect: "write" },
  { type: "tool_end", call, result: { content: "ok" }, effect: "write" },
  { type: "completion_rejected", reason: "no evidence" },
  { type: "turn_disposition", disposition: { kind: "completed" } as never },
  { type: "handoff", count: 3, beforeChars: 900, afterChars: 300 },
  { type: "run_error", message: "boom" },
  { type: "run_end", reason: "completed", rounds: 2 },
];

const JOB_ACTIONS: AgentJobQueueEvent["action"][] = [
  "enqueued", "claimed", "checkpoint", "completed", "failed", "cancelled",
  "retried", "recovered", "uncertain", "reconciled", "delivered", "deleted",
];

const ORCHESTRATION_EVENTS: AgentOrchestrationEvent[] = [
  { type: "orchestration_start", sessionId: "s1", taskCount: 2 },
  { type: "subtask_start", taskId: "t1", sessionId: "s1" },
  { type: "subtask_end", taskId: "t1", status: "succeeded" },
  { type: "subtask_end", taskId: "t2", status: "failed" },
  { type: "subtask_end", taskId: "t3", status: "skipped" },
  { type: "subtask_end", taskId: "t4", status: "cancelled" },
  { type: "orchestration_end", status: "succeeded" },
];

test("13 个运行事件全都能映射，且原事件类型保留可追溯", () => {
  assert.equal(RUN_EVENTS.length, 13, "样本要覆盖 AgentRunEvent 的全部取值");
  const seen = new Set<string>();
  for (const event of RUN_EVENTS) {
    const activity = describeAgentRunActivity(event);
    assert.ok(activity.kind, `${event.type} 没有分类`);
    assert.equal(activity.event, event.type, "分类只是叠加，不能覆盖原事件类型");
    seen.add(event.type);
  }
  assert.equal(seen.size, 13);
});

test("每个声明的 kind 都至少有一个真实事件能产生——不留无发射点的空分类", () => {
  const produced = new Set<AgentActivityKind>();
  for (const event of RUN_EVENTS) produced.add(describeAgentRunActivity(event).kind);
  for (const event of ORCHESTRATION_EVENTS) produced.add(describeAgentOrchestrationActivity(event).kind);
  for (const action of JOB_ACTIONS) produced.add(describeAgentJobActivity(action).kind);
  const declared: AgentActivityKind[] = [
    "phase", "model", "budget", "tool", "approval", "delegation", "handoff", "completion", "failure",
  ];
  assert.deepEqual([...produced].sort(), [...declared].sort());
});

test("工具活动带上出处：读写、风险、来自哪个扩展", () => {
  const started = describeAgentRunActivity(
    { type: "tool_start", call, effect: "write", risk: "destructive", source: "ext.demo" },
  );
  assert.equal(started.kind, "tool");
  assert.equal(started.status, "running");
  assert.deepEqual(started.tool, { name: "save_file", effect: "write", risk: "destructive", source: "ext.demo" });

  // 未注册的工具查不到出处，这三项就该空着，而不是编一个默认值。
  const unknown = describeAgentRunActivity({ type: "tool_start", call: { ...call, name: "nope" } });
  assert.deepEqual(unknown.tool, { name: "nope" });
});

test("工具失败与授权被拒各自有区分，不都塞成 failure", () => {
  const failed = describeAgentRunActivity({ type: "tool_end", call, result: { content: "x", isError: true } });
  assert.deepEqual([failed.kind, failed.status], ["tool", "failed"]);
  const denied = describeAgentRunActivity({ type: "tool_authorization", call, allowed: false, reason: "denied" });
  assert.deepEqual([denied.kind, denied.status], ["approval", "blocked"]);
});

test("运行结束按停止原因分状态：完成、取消、待补充/受阻、其余算失败", () => {
  const of = (reason: AgentRunEvent extends never ? never : "completed" | "cancelled" | "blocked" | "waiting_input" | "max_rounds") =>
    describeAgentRunActivity({ type: "run_end", reason, rounds: 1 }).status;
  assert.equal(of("completed"), "succeeded");
  assert.equal(of("cancelled"), "cancelled");
  assert.equal(of("blocked"), "blocked");
  assert.equal(of("waiting_input"), "blocked");
  assert.equal(of("max_rounds"), "failed");
});

test("队列 12 个动作全覆盖；uncertain 是待核对而不是失败", () => {
  for (const action of JOB_ACTIONS) {
    const activity = describeAgentJobActivity(action);
    assert.ok(activity.kind, `${action} 没有分类`);
    assert.equal(activity.event, action);
  }
  assert.deepEqual(
    [describeAgentJobActivity("uncertain").kind, describeAgentJobActivity("uncertain").status],
    ["failure", "blocked"],
    "结果无法自动确认要人核对，既不是成功也不是失败",
  );
  assert.equal(describeAgentJobActivity("failed").status, "failed");
  assert.equal(describeAgentJobActivity("enqueued").status, "running");
});

test("编排事件全部归为 delegation，子任务编号保留", () => {
  for (const event of ORCHESTRATION_EVENTS) {
    const activity = describeAgentOrchestrationActivity(event);
    assert.equal(activity.kind, "delegation");
  }
  assert.equal(describeAgentOrchestrationActivity({ type: "subtask_start", taskId: "t9", sessionId: "s" }).subtaskId, "t9");
  assert.equal(describeAgentOrchestrationActivity({ type: "subtask_end", taskId: "t9", status: "skipped" }).status, "blocked");
});

// —— 接线守卫 ——
// 分类的价值全在"每个事件出口都带上它"。加了模块但没接，等于这个分类不存在。

test("三个事件出口都带上展示分类，编排的四个事件不再被丢掉", () => {
  const server = readServerRouteSurface();
  assert.match(server, /activity: describeAgentRunActivity\(event\)/, "运行事件出口");
  assert.match(server, /activity: describeAgentJobActivity\(event\.action\)/, "队列事件出口");
  assert.match(server, /describeAgentOrchestrationActivity\(event\)/, "编排事件出口");
  // 原来这里是 `if (event.type === "subtask_start")`，另外三个事件直接丢弃。
  assert.doesNotMatch(server, /if \(event\.type === "subtask_start"\) context\.checkpoint/);
});

test("失败注册表接到了运行失败与任务失败两个边界", () => {
  const server = readServerRouteSurface();
  assert.match(server, /failure: classifyFailure\(error\)/, "运行失败边界");
  assert.match(server, /classifyFailure\(new Error\(failedText\)\)/, "任务失败边界");
  assert.match(server, /import \{ classifyFailure, failureShapeByName \}/);
});
