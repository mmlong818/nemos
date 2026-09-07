import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistantBotStore,runAssistantTeam} from '../../examples/companion/assistant-team.js';

test('候选池按用户、启用和市场状态隔离，冻结后不受编辑影响',async()=>{
  const store=new AssistantBotStore(':memory:');store.seed('qa');store.seed('other');
  try {
    const selected=store.save('qa',{name:'预算分析',role:'worker',instructions:'预算分析。'.repeat(60)+'FROZEN-END',enabled:true});
    const disabled=store.save('qa',{name:'停用',role:'worker',instructions:'no',enabled:false});
    const market=store.save('qa',{name:'市场',role:'worker',instructions:'no',placement:'market'});
    const foreign=store.save('other',{name:'外部',role:'worker',instructions:'no'});
    const raw={requestId:'candidates',objective:'核对预算',assignmentMode:'auto',workerIds:[],reviewerId:''};
    const plan=store.plan('qa',raw,{planning:true});
    assert.deepEqual(plan.workerIds,[]);assert.equal(plan.executionMode,'planned-text-v1');
    for(const bot of [disabled,market,foreign])assert.ok(!plan.candidates!.some(c=>c.id===bot.id));
    store.save('qa',{...selected,instructions:'EDITED',enabled:false});
    assert.ok(plan.candidates!.find(c=>c.id===selected.id)!.instructions.endsWith('FROZEN-END'));
    const job:any={id:'candidate-job',payload:{teamPlan:plan},checkpoints:[]};let calls=0;
    await runAssistantTeam(job,{signal:new AbortController().signal,checkpoint(status,progress,data){job.checkpoints.push({status,progress,data});}},async(system,user)=>{
      calls++;
      if(system.includes('你是有界文字协作规划器')){
        const input=JSON.parse(user),candidate=input.executors.find((c:any)=>c.id===selected.id);
        assert.equal(candidate.descriptionTruncated,true);assert.ok(candidate.description.length<=240);
        assert.doesNotMatch(user,/FROZEN-END/);
        return JSON.stringify({version:1,taskId:job.id,revision:1,finalStepId:'final',steps:[
          {id:'budget',executorId:selected.id,objective:'预算核对',output:'差异',dependsOn:[]},
          {id:'final',executorId:'clownfish',objective:'汇总',output:'报告',dependsOn:['budget']},
        ]});
      }
      if(system.includes('最终交付协议'))return '{"summary":"完成","fields":[]}';
      assert.match(system,/FROZEN-END/);assert.doesNotMatch(system,/EDITED/);return '预算核对结果';
    });
    assert.equal(calls,3);
    assert.equal(store.plan('qa',{...raw,planning:true}).executionMode,'fixed-v1');
    assert.throws(()=>store.plan('qa',{...raw,assignmentMode:'solo'},{planning:true}),/自动分派/);
  }finally{store.close();}
});

test('损坏候选快照在任何模型调用之前被拒绝',async()=>{
  const store=new AssistantBotStore(':memory:');store.seed('qa');
  try {
    for(const mutate of [(p:any)=>p.candidates.push(p.candidates[0]),(p:any)=>p.candidates[0].enabled=false,(p:any)=>p.candidates[0].placement='market',(p:any)=>p.candidates[0].id='clownfish']){
      const plan=store.plan('qa',{requestId:'bad',objective:'测试',assignmentMode:'auto',workerIds:[],reviewerId:''},{planning:true});mutate(plan);
      let calls=0;
      await assert.rejects(runAssistantTeam({id:'bad',payload:{teamPlan:plan},checkpoints:[]} as any,{signal:new AbortController().signal,checkpoint(){}},async()=>{calls++;return '';}),/候选角色/);
      assert.equal(calls,0);
    }
  }finally{store.close();}
});
