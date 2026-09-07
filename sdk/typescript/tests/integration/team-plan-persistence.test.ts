import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileAgentJobQueue,AgentJobWorker} from '../../src/agent/job-queue.js';
import {AssistantBotStore,runAssistantTeam} from '../../examples/companion/assistant-team.js';
import type {ChatFn} from '../../examples/companion/engine.js';

test('规划模式随磁盘任务恢复，重新创建队列和 Worker 不重做规划或已完成步骤',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'clownfish-plan-persist-'));
  const store=new AssistantBotStore(':memory:');store.seed('qa');
  try {
    const plan=store.plan('qa',{requestId:'persist',objective:'合成整理',workerIds:['bot-organizer'],reviewerId:''});
    plan.executionMode='planned-text-v1';
    const file=join(dir,'jobs.json');const queue=new FileAgentJobQueue(file);
    const saved=queue.enqueue({type:'assistant-team',payload:{teamPlan:plan},maxAttempts:1,sideEffectRisk:false});
    let planned=0,worked=0,finished=0,fail=true;
    const chat:ChatFn=async(system,user)=>{
      if(system.includes('你是有界文字协作规划器')){
        planned++;return JSON.stringify({version:1,taskId:JSON.parse(user).taskId,revision:1,finalStepId:'final',steps:[
          {id:'work',executorId:'bot-organizer',objective:'整理材料',output:'摘要',dependsOn:[]},
          {id:'final',executorId:'clownfish',objective:'交付',output:'最终结果',dependsOn:['work']},
        ]});
      }
      if(system.includes('最终交付协议')){finished++;if(fail)throw Error('模拟中断');return '{"summary":"完成","fields":[]}';}
      worked++;return '已完成的合成摘要';
    };
    const worker=new AgentJobWorker(queue,{'assistant-team':(job,ctx)=>runAssistantTeam(job,ctx,chat)});
    assert.equal((await worker.runOnce())?.status,'failed');
    const restarted=new FileAgentJobQueue(file);
    assert.equal((restarted.get(saved.id)!.payload.teamPlan as any).executionMode,'planned-text-v1');
    restarted.retry(saved.id);fail=false;
    const next=new AgentJobWorker(restarted,{'assistant-team':(job,ctx)=>runAssistantTeam(job,ctx,chat)});
    assert.equal((await next.runOnce())?.status,'succeeded');
    assert.deepEqual({planned,worked,finished},{planned:1,worked:1,finished:2});
    assert.equal(restarted.get(saved.id)!.checkpoints.filter(c=>(c.data as any)?.teamExecutionPlan).length,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('普通客户端参数无法开启规划，新旧固定任务兼容，未知模式先拒绝',async()=>{
  const store=new AssistantBotStore(':memory:');store.seed('qa');
  try{
    const plan=store.plan('qa',{requestId:'mode-test',objective:'合成',workerIds:[],reviewerId:'',executionMode:'planned-text-v1',planning:true});
    assert.equal(plan.executionMode,'fixed-v1');
    let calls=0;const chat:ChatFn=async()=>{calls++;return '{"summary":"完成","fields":[]}';};
    const context={signal:new AbortController().signal,checkpoint(){}};
    for(const mode of ['fixed-v1',undefined]){
      await runAssistantTeam({id:'mode',payload:{teamPlan:{...plan,executionMode:mode}},checkpoints:[]} as any,context,chat);
    }
    assert.equal(calls,2);
    await assert.rejects(runAssistantTeam({id:'mode',payload:{teamPlan:{...plan,executionMode:'unknown'}},checkpoints:[]} as any,context,chat),/执行模式/);
    await assert.rejects(runAssistantTeam({id:'mode',payload:{teamPlan:plan},checkpoints:[{data:{teamExecutionPlan:{}}}]} as any,context,chat),/不一致/);
    assert.equal(calls,2);
  }finally{store.close();}
});
