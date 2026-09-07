import test from 'node:test';
import assert from 'node:assert/strict';
import type {AgentJobRecord, AgentJobHandlerContext} from '../../src/agent/job-queue.js';
import type {ChatFn} from '../../examples/companion/engine.js';
import {AssistantBotStore, runAssistantTeam} from '../../examples/companion/assistant-team.js';
import {planTeamExecution} from '../../examples/companion/team-planner.js';
function fixture() {
  const store = new AssistantBotStore(':memory:'); store.seed('qa');
  const teamPlan = store.plan('qa', {requestId:'test', objective:'整理并核验合成资料', materials:'[S1] 仅测试', requiredFields:[], workerIds:['bot-organizer'],reviewerId:'bot-reviewer',model:'test'});
  store.close();
  teamPlan.executionMode='planned-text-v1';
  const job = {id:'test-job',payload:{teamPlan},metadata:{userId:'qa'},checkpoints:[]} as unknown as AgentJobRecord;
  const controller = new AbortController();
  const context: AgentJobHandlerContext = {signal:controller.signal,checkpoint(status,progress,data){job.checkpoints.push({at:new Date().toISOString(),status,progress,data});}};
  const input = {objective:teamPlan.objective,model:'test',executors:[...teamPlan.workers,teamPlan.reviewer!].map(b=>({id:b.id,name:b.name,instructions:b.instructions}))};
  return {job,context,controller,input};
}
function proposal() { return {version:1,taskId:'test-job',revision:1,finalStepId:'final',steps:[
  {id:'organize',executorId:'bot-organizer',objective:'整理',output:'来源清单',dependsOn:[]},
  {id:'check',executorId:'bot-reviewer',objective:'核对',output:'差异',dependsOn:['organize']},
  {id:'final',executorId:'clownfish',objective:'不可覆盖原始目标',output:'JSON',dependsOn:['organize','check']},
]}; }

test('失败重试和恢复共享调用预算，耗尽后不再调用模型',async()=>{
  const f=fixture();const plan=f.job.payload.teamPlan as any;
  plan.planningBudget=5;plan.planningConsent=true;plan.assignmentMode='auto';let calls=0;
  const chat:ChatFn=async()=>{calls++;throw Error('模拟失败');};
  for(let i=0;i<5;i++)await assert.rejects(runAssistantTeam(f.job,f.context,chat),/模拟失败/);
  assert.equal(calls,5);
  const restored=JSON.parse(JSON.stringify(f.job));
  await assert.rejects(runAssistantTeam(restored,f.context,chat),/预算已用完/);
  assert.equal(calls,5);
  assert.equal(f.job.checkpoints.filter(c=>(c.data as any)?.teamBudgetReservation).length,5);
});

test('自主协作预算需要有效范围和明确同意',()=>{
  const store=new AssistantBotStore(':memory:');store.seed('qa');
  try{
    for(const extra of [{planningBudget:5},{planningConsent:true},{planningBudget:4,planningConsent:true},{planningBudget:9,planningConsent:true},{planningBudget:5,planningConsent:true,assignmentMode:'manual'}]){
      assert.throws(()=>store.plan('qa',{objective:'合成测试',assignmentMode:'auto',...extra},{planning:true}),/预算/);
    }
    const plan=store.plan('qa',{requestId:'budget-test',objective:'合成测试',assignmentMode:'auto',planningBudget:5,planningConsent:true},{planning:true});
    assert.equal(plan.executionMode,'planned-text-v1');assert.equal(plan.planningBudget,5);
  }finally{store.close();}
});
test('队列内规划、依赖交接、失败后复用计划和成功步骤',async()=>{
  const f=fixture();let planned=0,worked=0,finalCalls=0,failFinal=true;
  const chat:ChatFn=async(system,data,_model,_tokens,options)=>{
    assert.equal(options?.toolMode,'off');assert.deepEqual(options?.memoryScopes,[]);
    if(system.includes('你是有界文字协作规划器')) {planned++;assert.doesNotMatch(data,/\[S1\]/);return JSON.stringify(proposal());}
    const request=JSON.parse(data);
    if(system.includes('最终交付协议')) {finalCalls++;if(failFinal)throw Error('模拟断线');return JSON.stringify({summary:'合成结果',fields:[]});}
    worked++;if(request.stepObjective==='核对')assert.equal(request.receipts.length,1);
    return '合成阶段成果';
  };
  await assert.rejects(runAssistantTeam(f.job,f.context,chat),/模拟断线/);
  failFinal=false;
  const result=await runAssistantTeam(f.job,f.context,chat);
  assert.equal(result.data.receipts.length,3);assert.equal(planned,1);assert.equal(worked,2);assert.equal(finalCalls,2);
  assert.equal(f.job.checkpoints.filter(c=>(c.data as any)?.teamExecutionPlan).length,1);
});
test('非法计划不会保存或执行；不静默回退',async()=>{
  for(const mutate of [
    (p:any)=>p.steps[0].executorId='shell',
    (p:any)=>p.taskId='other-user-task',
    (p:any)=>p.steps[2].executorId='bot-reviewer',
    (p:any)=>p.steps[0].dependsOn=['final'],
    (p:any)=>p.steps[2].dependsOn=['check'],
  ]) {
    const f=fixture(),p=proposal();mutate(p);let calls=0;
    await assert.rejects(runAssistantTeam(f.job,f.context,async()=>{calls++;return JSON.stringify(p);}));
    assert.equal(calls,1);assert.equal(f.job.checkpoints.length,0);
  }
});
test('保存计划绑定模型、目标和角色规则，恢复时重新校验',async()=>{
  const f=fixture();await planTeamExecution(f.job,f.context,async()=>JSON.stringify(proposal()),f.input);
  await assert.rejects(planTeamExecution(f.job,f.context,async()=>{throw Error('不应调用');},{...f.input,model:'changed'}),/不一致/);
  const saved=(f.job.checkpoints[0].data as any).teamExecutionPlan;
  saved.plan.steps[0].executorId='unknown';
  await assert.rejects(planTeamExecution(f.job,f.context,async()=>'',f.input),/执行角色/);
});
test('简单目标可仅汇总，仍保持用户原始目标',async()=>{
  const f=fixture(),p=proposal();p.steps=[{...p.steps[2],dependsOn:[]}];
  const plan=await planTeamExecution(f.job,f.context,async()=>JSON.stringify(p),f.input);
  assert.equal(plan.steps.length,1);assert.equal(plan.steps[0].objective,f.input.objective);
});
test('取消、超时、不合法 JSON 均不保存计划',async()=>{
  const f=fixture();f.controller.abort();let calls=0;
  await assert.rejects(planTeamExecution(f.job,f.context,async()=>{calls++;return '';},f.input));assert.equal(calls,0);
  const second=fixture();await assert.rejects(planTeamExecution(second.job,second.context,async()=>new Promise(()=>{}),second.input,10),/超时/);
  assert.equal(second.job.checkpoints.length,0);
  await assert.rejects(planTeamExecution(second.job,second.context,async()=>'```json invalid```',second.input));
  assert.equal(second.job.checkpoints.length,0);
});
