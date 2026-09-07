import { createHash } from 'node:crypto';

/** Model proposals are data, never executable instructions or permission grants. */
export interface ExecutionStep {
  id: string;
  executorId: string;
  objective: string;
  output: string;
  dependsOn: string[];
}
export interface ExecutionPlan {
  version: 1;
  taskId: string;
  revision: number;
  finalStepId: string;
  steps: ExecutionStep[];
}
export interface ExecutionProgress {
  planHash: string;
  stepId: string;
  state: 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';
}
const fail = (message: string): never => { throw new Error(`执行计划无效：${message}`); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('需要对象');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) fail('包含未允许的字段');
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail('文字为空或超限');
  return value.trim();
}

/** The allowlist must come from the server, not from the model proposal. */
export function validateExecutionPlan(raw: unknown, allowedExecutors: ReadonlySet<string>): ExecutionPlan {
  const plan = record(raw);
  exact(plan, ['version', 'taskId', 'revision', 'finalStepId', 'steps']);
  if (plan.version !== 1 || !Number.isSafeInteger(plan.revision) || (plan.revision as number) < 1) fail('版本不支持');
  if (!Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > 8) return fail('步骤须为 1 到 8 个');
  const steps = plan.steps.map(value => {
    const step = record(value);
    exact(step, ['id', 'executorId', 'objective', 'output', 'dependsOn']);
    const executorId = text(step.executorId, 120);
    if (!allowedExecutors.has(executorId)) fail('执行角色不存在、已停用或未授权');
    if (!Array.isArray(step.dependsOn) || step.dependsOn.length > 7) return fail('依赖数量超限');
    const dependsOn = step.dependsOn.map(id => text(id, 120));
    if (new Set(dependsOn).size !== dependsOn.length) fail('依赖重复');
    return { id: text(step.id, 120), executorId, objective: text(step.objective, 4000), output: text(step.output, 1000), dependsOn };
  });
  const byId = new Map(steps.map(step => [step.id, step]));
  if (byId.size !== steps.length) fail('步骤编号重复');
  const finalStepId = text(plan.finalStepId, 120);
  if (!byId.has(finalStepId)) fail('缺少最终交付步骤');
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) fail('存在循环依赖');
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) return fail('依赖步骤不存在');
    visiting.add(id);
    step.dependsOn.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  // Every step must contribute to the final result; disconnected work is rejected.
  visit(finalStepId);
  if (visited.size !== steps.length) fail('存在未纳入最终交付的步骤');
  return { version: 1, taskId: text(plan.taskId, 120), revision: plan.revision as number, finalStepId, steps };
}

export function executionPlanHash(plan: ExecutionPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

/** Select only, do not claim work. The queue must claim atomically before execution.
 * Progress is a latest-state projection from persisted receipts, not arbitrary events.
 * Failed/blocked/cancelled steps require an explicit retry decision, never auto-loop.
 */
export function readyExecutionSteps(plan: ExecutionPlan, progress: ExecutionProgress[], concurrency = 1): ExecutionStep[] {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) fail('并发须为 1 到 2');
  const hash = executionPlanHash(plan), states = new Map<string, ExecutionProgress['state']>();
  const ids = new Set(plan.steps.map(step => step.id));
  for (const receipt of progress) {
    if (receipt.planHash !== hash || !ids.has(receipt.stepId)) fail('回执不属于当前计划');
    if (states.has(receipt.stepId)) fail('需要每个步骤的最新唯一状态');
    if (!['running', 'succeeded', 'failed', 'blocked', 'cancelled'].includes(receipt.state)) fail('回执状态不支持');
    states.set(receipt.stepId, receipt.state);
  }
  const running = [...states.values()].filter(state => state === 'running').length;
  return plan.steps.filter(step => !states.has(step.id) && step.dependsOn.every(id => states.get(id) === 'succeeded'))
    .slice(0, Math.max(0, concurrency - running));
}
