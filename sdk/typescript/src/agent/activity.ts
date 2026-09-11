// 展示层的活动分类。
//
// 这个代码库里语义相近却互不相通的事件体系有四套：
//   AgentRunEvent（单次运行内部，13 个取值；持久化了，但前端从不消费单条）
//   AgentOrchestrationEvent（多 Agent 编排，4 个取值；生产里只消费了 1 个）
//   AgentJobQueueEvent.action（后台队列生命周期，12 个取值）
//   CapabilityTaskStorylineEvent.type（人读时间线，6 个取值；唯一按类型分 UI 的）
//
// 它们描述的是不同层次，硬合成一套会丢信息。所以这里不替换任何一套，
// 只给出一个公共的展示分类让各体系映射进来：界面按 kind 分流，
// 不必认识 13+4+12+6 个取值，新增事件也不会让界面漏渲染。
//
// 约束：每个 kind 都必须有真实发射点。没有事件能产生的分类不加进来——
// "可安装不等于已经可用"，分类同理。
import type { AgentJobQueueEvent } from "./job-queue.js";
import type { AgentOrchestrationEvent } from "./orchestrator.js";
import type { AgentRunEvent, AgentStopReason, AgentToolEffect, AgentToolRisk } from "./types.js";

export type AgentActivityKind =
  /** 运行开始、一轮开始、运行结束；后台任务的排队与领取也归这里。 */
  | "phase"
  /** 一次模型往返。 */
  | "model"
  /** 预算耗尽。 */
  | "budget"
  /** 工具调用。 */
  | "tool"
  /** 写操作的授权判定。 */
  | "approval"
  /** 子任务与委派。 */
  | "delegation"
  /** 上下文交接（压缩）。 */
  | "handoff"
  /** 回合的显式完成语义。 */
  | "completion"
  /** 失败。 */
  | "failure";

/** 与 AgentJobStatus / AgentSubtaskStatus 共用同一套词，不另造。 */
export type AgentActivityStatus = "running" | "succeeded" | "failed" | "blocked" | "cancelled";

export interface AgentActivity {
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  /** 原事件类型，保留可追溯性：分类只是叠加，不覆盖事实。 */
  event: string;
  /** 工具类活动才有。 */
  tool?: {
    name: string;
    effect?: AgentToolEffect;
    risk?: AgentToolRisk;
    /** 扩展 id；不填表示宿主内置。 */
    source?: string;
  };
  /** 委派类活动才有。 */
  subtaskId?: string;
}

function stopReasonStatus(reason: AgentStopReason): AgentActivityStatus {
  if (reason === "completed") return "succeeded";
  if (reason === "cancelled") return "cancelled";
  if (reason === "waiting_input" || reason === "blocked") return "blocked";
  return "failed";
}

export function describeAgentRunActivity(event: AgentRunEvent): AgentActivity {
  switch (event.type) {
    case "run_start":
    case "run_resume":
    case "round_start":
      return { kind: "phase", status: "running", event: event.type };
    case "run_end":
      return { kind: "phase", status: stopReasonStatus(event.reason), event: event.type };
    case "model_end":
      return { kind: "model", status: "succeeded", event: event.type };
    case "token_budget_exhausted":
      return { kind: "budget", status: "blocked", event: event.type };
    case "tool_start":
      return { kind: "tool", status: "running", event: event.type, tool: toolOf(event) };
    case "tool_end":
      return {
        kind: "tool",
        status: event.result.isError ? "failed" : "succeeded",
        event: event.type,
        tool: toolOf(event),
      };
    case "tool_authorization":
      return {
        kind: "approval",
        status: event.allowed ? "succeeded" : "blocked",
        event: event.type,
        tool: toolOf(event),
      };
    case "handoff":
      return { kind: "handoff", status: "succeeded", event: event.type };
    case "turn_disposition":
      return { kind: "completion", status: "succeeded", event: event.type };
    case "completion_rejected":
      return { kind: "completion", status: "blocked", event: event.type };
    case "run_error":
      return { kind: "failure", status: "failed", event: event.type };
  }
}

function toolOf(event: Extract<AgentRunEvent, { call: unknown }>): AgentActivity["tool"] {
  return {
    name: event.call.name,
    ...(event.effect ? { effect: event.effect } : {}),
    ...(event.risk ? { risk: event.risk } : {}),
    ...(event.source ? { source: event.source } : {}),
  };
}

export function describeAgentOrchestrationActivity(event: AgentOrchestrationEvent): AgentActivity {
  switch (event.type) {
    case "orchestration_start":
      return { kind: "delegation", status: "running", event: event.type };
    case "subtask_start":
      return { kind: "delegation", status: "running", event: event.type, subtaskId: event.taskId };
    case "subtask_end":
      return {
        kind: "delegation",
        status: event.status === "succeeded" ? "succeeded"
          : event.status === "cancelled" ? "cancelled"
            : event.status === "skipped" ? "blocked" : "failed",
        event: event.type,
        subtaskId: event.taskId,
      };
    case "orchestration_end":
      return {
        kind: "delegation",
        status: event.status === "succeeded" ? "succeeded"
          : event.status === "cancelled" ? "cancelled" : "failed",
        event: event.type,
      };
  }
}

export function describeAgentJobActivity(action: AgentJobQueueEvent["action"]): AgentActivity {
  switch (action) {
    case "failed":
      return { kind: "failure", status: "failed", event: action };
    // 结果无法自动确认：需要人核对，不是失败也不是成功。
    case "uncertain":
      return { kind: "failure", status: "blocked", event: action };
    case "cancelled":
    case "deleted":
      return { kind: "phase", status: "cancelled", event: action };
    case "completed":
    case "delivered":
    case "reconciled":
      return { kind: "phase", status: "succeeded", event: action };
    default:
      return { kind: "phase", status: "running", event: action };
  }
}
