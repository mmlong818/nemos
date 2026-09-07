import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExecutionPlan, executionPlanHash, readyExecutionSteps } from '../../examples/companion/execution-plan.js';
const allowed = new Set(['research', 'compare', 'presentation']);
const step = (id: string, executorId: string, dependsOn: string[] = []) => ({ id, executorId, objective: '使用合成资料', output: '带来源的结果', dependsOn });
const proposal = () => ({ version: 1, taskId: 'task-synthetic', revision: 1, finalStepId: 'final', steps: [
  step('a', 'research'), step('b', 'compare'), step('final', 'presentation', ['a', 'b']),
] });
test('验证并复制计划，不修改模型原始提案', () => {
  const raw = proposal(), before = JSON.stringify(raw), plan = validateExecutionPlan(raw, allowed);
  assert.equal(JSON.stringify(raw), before);
  raw.steps[0].objective = 'changed'; assert.notEqual(plan.steps[0].objective, raw.steps[0].objective);
  assert.equal(executionPlanHash(plan).length, 64);
});
test('拒绝虚构执行者、权限字段、重复编号及缺失依赖', () => {
  const changes: Array<(p: ReturnType<typeof proposal>) => void> = [
    p => { p.steps[0].executorId = 'shell'; },
    p => { Object.assign(p.steps[0], { tools: ['shell'] }); },
    p => { p.steps[1].id = 'a'; },
    p => { p.steps[0].dependsOn = ['unknown']; },
    p => { p.steps[2].dependsOn = ['a', 'a']; },
    p => { p.finalStepId = 'unknown'; },
    p => { p.steps[0].objective = ''; },
    p => { p.revision = 0; },
    p => { p.steps = []; },
  ];
  for (const change of changes) { const raw = proposal(); change(raw); assert.throws(() => validateExecutionPlan(raw, allowed), /执行计划无效/); }
});
test('拒绝循环、自依赖、孤立步骤及超量步骤', () => {
  const raw = proposal(); raw.steps[0].dependsOn = ['final'];
  assert.throws(() => validateExecutionPlan(raw, allowed), /循环/);
  raw.steps[0].dependsOn = ['a']; assert.throws(() => validateExecutionPlan(raw, allowed), /循环/);
  raw.steps[0].dependsOn = []; raw.steps.push(step('orphan', 'research'));
  assert.throws(() => validateExecutionPlan(raw, allowed), /未纳入/);
  while (raw.steps.length < 9) raw.steps.push(step('extra' + raw.steps.length, 'research'));
  assert.throws(() => validateExecutionPlan(raw, allowed), /1 到 8/);
});
test('只调度依赖成功的步骤，运行中占用并发名额', () => {
  const plan = validateExecutionPlan(proposal(), allowed), planHash = executionPlanHash(plan);
  assert.deepEqual(readyExecutionSteps(plan, [], 2).map(s => s.id), ['a', 'b']);
  assert.deepEqual(readyExecutionSteps(plan, [{planHash, stepId:'a', state:'running'}], 2).map(s => s.id), ['b']);
  assert.deepEqual(readyExecutionSteps(plan, [{planHash, stepId:'a', state:'running'}], 1), []);
  assert.deepEqual(readyExecutionSteps(plan, [
    {planHash, stepId:'a', state:'succeeded'}, {planHash, stepId:'b', state:'succeeded'},
  ]).map(s => s.id), ['final']);
});
test('失败、阻塞、取消不自动重试，也不放行下游', () => {
  const plan = validateExecutionPlan(proposal(), allowed), planHash = executionPlanHash(plan);
  for (const state of ['failed','blocked','cancelled'] as const) {
    assert.deepEqual(readyExecutionSteps(plan, [{planHash, stepId:'a', state}, {planHash, stepId:'b', state:'succeeded'}]), []);
  }
});
test('拒绝旧计划回执、重复回执和非法并发', () => {
  const plan = validateExecutionPlan(proposal(), allowed), planHash = executionPlanHash(plan);
  const receipt = {planHash, stepId:'a', state:'succeeded' as const};
  assert.throws(() => readyExecutionSteps(plan, [{...receipt,planHash:'old'}]), /不属于/);
  assert.throws(() => readyExecutionSteps(plan, [receipt,receipt]), /唯一状态/);
  assert.throws(() => readyExecutionSteps(plan, [], 3), /并发/);
  plan.revision++; assert.throws(() => readyExecutionSteps(plan, [receipt]), /不属于/);
});
