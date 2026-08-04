import { randomUUID } from "node:crypto";

import type { AgentTokenUsage } from "./types.js";

export interface AgentSubtaskBudget {
  maxRounds: number;
  maxToolRounds: number;
  maxTotalTokens: number;
  maxOutputChars: number;
}

export interface AgentSubtask {
  id: string;
  title: string;
  instruction: string;
  dependsOn?: string[];
  metadata?: Record<string, string>;
  budget?: Partial<AgentSubtaskBudget>;
}

export interface AgentOrchestrationPlan {
  sessionId: string;
  objective: string;
  tasks: AgentSubtask[];
  metadata?: Record<string, string>;
}

export interface AgentSubtaskRunInput {
  parentSessionId: string;
  sessionId: string;
  objective: string;
  task: AgentSubtask;
  budget: AgentSubtaskBudget;
  sharedArtifactRefs: string[];
  signal: AbortSignal;
}

export interface AgentCostBreakdown {
  currency: string;
  inputAmount: number;
  outputAmount: number;
  totalAmount: number;
}

export interface AgentCostEstimate {
  breakdowns: AgentCostBreakdown[];
  pricedRuns: number;
  unpricedRuns: number;
  estimated: true;
  pricingDate: string;
}
export interface AgentSubtaskRunOutput {
  summary: string;
  cost?: AgentCostEstimate;
  artifactRefs?: string[];
  output?: string;
  usage?: AgentTokenUsage;
}

export type AgentSubtaskStatus = "succeeded" | "failed" | "skipped" | "cancelled";

export interface AgentSubtaskResult extends AgentSubtaskRunOutput {
  id: string;
  title: string;
  sessionId: string;
  status: AgentSubtaskStatus;
  startedAt?: string;
  completedAt: string;
  error?: string;
}

export interface AgentOrchestrationQualityCheck {
  id: "completion" | "deliverables" | "review";
  status: "passed" | "warning" | "failed" | "not_applicable";
  detail: string;
}

export interface AgentOrchestrationQuality {
  score: number;
  status: "passed" | "needs_review" | "failed";
  checks: AgentOrchestrationQualityCheck[];
}

export interface AgentOrchestrationResult {
  sessionId: string;
  objective: string;
  status: "succeeded" | "partial" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string;
  summary: string;
  artifactRefs: string[];
  tasks: AgentSubtaskResult[];
  usage: AgentTokenUsage;
  quality: AgentOrchestrationQuality;
  cost?: AgentCostEstimate;
}

export type AgentOrchestrationEvent =
  | { type: "orchestration_start"; sessionId: string; taskCount: number }
  | { type: "subtask_start"; taskId: string; sessionId: string }
  | { type: "subtask_end"; taskId: string; status: AgentSubtaskStatus }
  | { type: "orchestration_end"; status: AgentOrchestrationResult["status"] };

export interface AgentOrchestratorOptions {
  maxSubtasks?: number;
  maxParallel?: number;
  defaultBudget?: Partial<AgentSubtaskBudget>;
  summarize?: (
    objective: string,
    results: readonly AgentSubtaskResult[],
    signal: AbortSignal,
  ) => Promise<string>;
}

export type AgentSubtaskRunner = (input: AgentSubtaskRunInput) => Promise<AgentSubtaskRunOutput>;

const DEFAULT_BUDGET: AgentSubtaskBudget = {
  maxRounds: 6,
  maxToolRounds: 4,
  maxTotalTokens: 24_000,
  maxOutputChars: 30_000,
};

/** 受控多 Agent 编排：只调度和汇总，子任务仍使用同一运行时、工具权限与取消边界。 */
export class AgentOrchestrator {
  private readonly maxSubtasks: number;
  private readonly maxParallel: number;
  private readonly defaultBudget: AgentSubtaskBudget;

  constructor(
    private readonly runner: AgentSubtaskRunner,
    private readonly options: AgentOrchestratorOptions = {},
  ) {
    this.maxSubtasks = Math.min(32, Math.max(1, options.maxSubtasks ?? 8));
    this.maxParallel = Math.min(8, Math.max(1, options.maxParallel ?? 3));
    this.defaultBudget = { ...DEFAULT_BUDGET, ...options.defaultBudget };
  }

  async run(
    plan: AgentOrchestrationPlan,
    options: { signal?: AbortSignal; onEvent?: (event: AgentOrchestrationEvent) => void } = {},
  ): Promise<AgentOrchestrationResult> {
    validatePlan(plan, this.maxSubtasks);
    const linked = linkedController(options.signal);
    const startedAt = new Date().toISOString();
    const results = new Map<string, AgentSubtaskResult>();
    const pending = new Map(plan.tasks.map((task) => [task.id, task]));
    options.onEvent?.({ type: "orchestration_start", sessionId: plan.sessionId, taskCount: plan.tasks.length });
    try {
      while (pending.size > 0 && !linked.signal.aborted) {
        const ready = [...pending.values()].filter((task) =>
          (task.dependsOn ?? []).every((id) => results.has(id)));
        if (ready.length === 0) throw new Error("Agent orchestration dependency graph cannot make progress");
        const runnable: AgentSubtask[] = [];
        for (const task of ready) {
          const failedDependency = (task.dependsOn ?? []).some((id) => results.get(id)?.status !== "succeeded");
          if (failedDependency) {
            const result = terminalResult(task, `${plan.sessionId}/${task.id}`, "skipped", "A dependency did not succeed");
            results.set(task.id, result);
            pending.delete(task.id);
            options.onEvent?.({ type: "subtask_end", taskId: task.id, status: result.status });
          } else {
            runnable.push(task);
          }
        }
        for (let offset = 0; offset < runnable.length && !linked.signal.aborted; offset += this.maxParallel) {
          const batch = runnable.slice(offset, offset + this.maxParallel);
          const batchResults = await Promise.all(batch.map((task) => this.runSubtask(
            plan,
            task,
            results,
            linked.signal,
            options.onEvent,
          )));
          for (const result of batchResults) {
            results.set(result.id, result);
            pending.delete(result.id);
          }
        }
      }

      if (linked.signal.aborted) {
        for (const task of pending.values()) {
          results.set(task.id, terminalResult(task, `${plan.sessionId}/${task.id}`, "cancelled", "Orchestration cancelled"));
        }
      }
      const ordered = plan.tasks.map((task) => results.get(task.id)!).filter(Boolean);
      const status = orchestrationStatus(ordered, linked.signal.aborted);
      const summary = this.options.summarize && !linked.signal.aborted
        ? await this.options.summarize(plan.objective, ordered, linked.signal)
        : defaultSummary(ordered);
      const result: AgentOrchestrationResult = {
        sessionId: plan.sessionId,
        objective: plan.objective,
        status,
        startedAt,
        completedAt: new Date().toISOString(),
        summary,
        artifactRefs: unique(ordered.flatMap((item) => item.artifactRefs ?? [])),
        tasks: ordered,
        usage: aggregateUsage(ordered),
        quality: assessQuality(ordered),
        cost: aggregateCost(ordered),
      };
      options.onEvent?.({ type: "orchestration_end", status });
      return result;
    } finally {
      linked.dispose();
    }
  }

  private async runSubtask(
    plan: AgentOrchestrationPlan,
    task: AgentSubtask,
    completed: ReadonlyMap<string, AgentSubtaskResult>,
    signal: AbortSignal,
    onEvent?: (event: AgentOrchestrationEvent) => void,
  ): Promise<AgentSubtaskResult> {
    const sessionId = `${plan.sessionId}/${task.id}/${randomUUID()}`;
    const startedAt = new Date().toISOString();
    onEvent?.({ type: "subtask_start", taskId: task.id, sessionId });
    try {
      if (signal.aborted) throw signal.reason ?? new Error("cancelled");
      const sharedArtifactRefs = unique((task.dependsOn ?? []).flatMap((id) => completed.get(id)?.artifactRefs ?? []));
      const output = await this.runner({
        parentSessionId: plan.sessionId,
        sessionId,
        objective: plan.objective,
        task: { ...task, dependsOn: [...(task.dependsOn ?? [])], metadata: task.metadata ? { ...task.metadata } : undefined },
        budget: normalizeBudget(this.defaultBudget, task.budget),
        sharedArtifactRefs,
        signal,
      });
      const result: AgentSubtaskResult = {
        id: task.id,
        title: task.title,
        sessionId,
        status: "succeeded",
        startedAt,
        completedAt: new Date().toISOString(),
        summary: bounded(output.summary, task.budget?.maxOutputChars ?? this.defaultBudget.maxOutputChars),
        output: output.output ? bounded(output.output, task.budget?.maxOutputChars ?? this.defaultBudget.maxOutputChars) : undefined,
        artifactRefs: unique(output.artifactRefs ?? []),
        usage: output.usage ? normalizeUsage(output.usage) : undefined,
        cost: output.cost ? structuredClone(output.cost) : undefined,
      };
      onEvent?.({ type: "subtask_end", taskId: task.id, status: result.status });
      return result;
    } catch (error) {
      const cancelled = signal.aborted;
      const result = terminalResult(
        task,
        sessionId,
        cancelled ? "cancelled" : "failed",
        error instanceof Error ? error.message : String(error),
        startedAt,
      );
      onEvent?.({ type: "subtask_end", taskId: task.id, status: result.status });
      return result;
    }
  }
}

function validatePlan(plan: AgentOrchestrationPlan, maximum: number): void {
  if (!plan.sessionId?.trim()) throw new Error("Orchestration sessionId is required");
  if (!plan.objective?.trim()) throw new Error("Orchestration objective is required");
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error("Orchestration requires at least one subtask");
  if (plan.tasks.length > maximum) throw new Error(`Orchestration exceeds the ${maximum} subtask limit`);
  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(task.id)) throw new Error(`Invalid subtask id: ${task.id}`);
    if (ids.has(task.id)) throw new Error(`Duplicate subtask id: ${task.id}`);
    ids.add(task.id);
    if (!task.title?.trim() || !task.instruction?.trim()) throw new Error(`Subtask ${task.id} is missing title or instruction`);
  }
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new Error(`Subtask ${task.id} has unknown dependency: ${dependency}`);
      if (dependency === task.id) throw new Error(`Subtask ${task.id} cannot depend on itself`);
    }
  }
}

function normalizeBudget(base: AgentSubtaskBudget, patch?: Partial<AgentSubtaskBudget>): AgentSubtaskBudget {
  return {
    maxRounds: boundedInteger(patch?.maxRounds, base.maxRounds, 1, 20),
    maxToolRounds: boundedInteger(patch?.maxToolRounds, base.maxToolRounds, 0, 20),
    maxTotalTokens: boundedInteger(patch?.maxTotalTokens, base.maxTotalTokens, 100, 2_000_000),
    maxOutputChars: boundedInteger(patch?.maxOutputChars, base.maxOutputChars, 100, 200_000),
  };
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.floor(value!) : fallback));
}

function terminalResult(
  task: AgentSubtask,
  sessionId: string,
  status: Exclude<AgentSubtaskStatus, "succeeded">,
  error: string,
  startedAt?: string,
): AgentSubtaskResult {
  return {
    id: task.id,
    title: task.title,
    sessionId,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    summary: "",
    artifactRefs: [],
    error,
  };
}

function orchestrationStatus(
  results: readonly AgentSubtaskResult[],
  cancelled: boolean,
): AgentOrchestrationResult["status"] {
  if (cancelled) return "cancelled";
  const succeeded = results.filter((item) => item.status === "succeeded").length;
  if (succeeded === results.length) return "succeeded";
  return succeeded > 0 ? "partial" : "failed";
}

function aggregateUsage(results: readonly AgentSubtaskResult[]): AgentTokenUsage {
  return results.reduce<AgentTokenUsage>((total, result) => ({
    inputTokens: total.inputTokens + (result.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (result.usage?.outputTokens ?? 0),
    totalTokens: total.totalTokens + (result.usage?.totalTokens ?? 0),
    modelCalls: total.modelCalls + (result.usage?.modelCalls ?? 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0 });
}

function normalizeUsage(usage: AgentTokenUsage): AgentTokenUsage {
  const inputTokens = boundedUsage(usage.inputTokens);
  const outputTokens = boundedUsage(usage.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    modelCalls: boundedUsage(usage.modelCalls),
  };
}

function boundedUsage(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function aggregateCost(results: readonly AgentSubtaskResult[]): AgentCostEstimate | undefined {
  const estimates = results.flatMap((result) => result.cost ? [result.cost] : []);
  if (estimates.length === 0) return undefined;
  const byCurrency = new Map<string, AgentCostBreakdown>();
  for (const estimate of estimates) {
    for (const item of estimate.breakdowns) {
      const current = byCurrency.get(item.currency) ?? {
        currency: item.currency,
        inputAmount: 0,
        outputAmount: 0,
        totalAmount: 0,
      };
      current.inputAmount += item.inputAmount;
      current.outputAmount += item.outputAmount;
      current.totalAmount += item.totalAmount;
      byCurrency.set(item.currency, current);
    }
  }
  return {
    breakdowns: [...byCurrency.values()].map((item) => ({
      ...item,
      inputAmount: roundCost(item.inputAmount),
      outputAmount: roundCost(item.outputAmount),
      totalAmount: roundCost(item.totalAmount),
    })),
    pricedRuns: estimates.reduce((total, item) => total + item.pricedRuns, 0),
    unpricedRuns: estimates.reduce((total, item) => total + item.unpricedRuns, 0),
    estimated: true,
    pricingDate: estimates.map((item) => item.pricingDate).sort().at(-1) ?? "",
  };
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
function assessQuality(results: readonly AgentSubtaskResult[]): AgentOrchestrationQuality {
  const succeeded = results.filter((result) => result.status === "succeeded");
  const completionRatio = results.length ? succeeded.length / results.length : 0;
  const deliverables = succeeded.filter((result) =>
    Boolean(result.summary.trim() || result.output?.trim() || result.artifactRefs?.length));
  const deliverableRatio = succeeded.length ? deliverables.length / succeeded.length : 0;
  const reviewer = results.find((result) => result.id === "synthesis" || result.title.includes("复核"));
  const checks: AgentOrchestrationQualityCheck[] = [
    {
      id: "completion",
      status: completionRatio === 1 ? "passed" : completionRatio > 0 ? "warning" : "failed",
      detail: succeeded.length + "/" + results.length + " 个子任务成功",
    },
    {
      id: "deliverables",
      status: deliverableRatio === 1 ? "passed" : deliverableRatio > 0 ? "warning" : "failed",
      detail: deliverables.length + "/" + succeeded.length + " 个成功子任务产生可用交付",
    },
    reviewer
      ? {
          id: "review",
          status: reviewer.status === "succeeded" ? "passed" : "failed",
          detail: reviewer.status === "succeeded" ? "最终复核已完成" : "最终复核状态：" + reviewer.status,
        }
      : {
          id: "review",
          status: "not_applicable",
          detail: "该计划未声明最终复核节点",
        },
  ];
  const reviewScore = !reviewer || reviewer.status === "succeeded" ? 20 : 0;
  const score = Math.round(completionRatio * 60 + deliverableRatio * 20 + reviewScore);
  return {
    score,
    status: score >= 80 && checks.every((check) => check.status !== "failed")
      ? "passed"
      : score > 0
        ? "needs_review"
        : "failed",
    checks,
  };
}

function defaultSummary(results: readonly AgentSubtaskResult[]): string {
  return results.map((result) =>
    result.status === "succeeded"
      ? `- ${result.title}: ${result.summary}`
      : `- ${result.title}: ${result.status}${result.error ? ` (${result.error})` : ""}`)
    .join("\n");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function bounded(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}\n...[subtask output truncated]`;
}

function linkedController(signal?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (!signal) return { signal: new AbortController().signal, dispose: () => undefined };
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, dispose: () => signal.removeEventListener("abort", abort) };
}
