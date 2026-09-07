import test from 'node:test';
import assert from 'node:assert/strict';
import {startModelHarness} from '../fixtures/companion-model-harness.js';

test('自主协作 HTTP 入口校验同意、保存规划和预算并完成文字交付', {timeout:60000}, async()=>{
  const h=await startModelHarness();
  const post=async(path:string,body:unknown)=>fetch(h.base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const config=await post('/api/llm-config',{provider:'custom',protocol:'openai-compatible',baseUrl:h.modelBase+'/v1',model:'manual',selectionMode:'manual'});
    assert.equal(config.ok,true);
    const info=await (await fetch(h.base+'/api/assistant-team')).json() as any;
    assert.equal(info.planningVersion,1);
    const request={requestId:'autonomous-http',objective:'整理合成测试材料',assignmentMode:'auto',planningBudget:5};
    assert.equal((await post('/api/assistant-team/start',request)).status,400);
    const before=h.requests.length;
    h.state.replyFor=(body:any)=>{
      const messages=body.messages;
      if(JSON.stringify(messages).includes('你是有界文字协作规划器')){
        const input=JSON.parse(messages.filter((m:any)=>m.role==='user').at(-1).content);
        return JSON.stringify({version:1,taskId:input.taskId,revision:1,finalStepId:'final',steps:[
          {id:'organize',executorId:'bot-organizer',objective:'整理材料',output:'条目',dependsOn:[]},
          {id:'final',executorId:'clownfish',objective:input.objective,output:'JSON',dependsOn:['organize']}
        ]});
      }
      return JSON.stringify(messages).includes('最终交付协议')?'{"summary":"合成验收完成","fields":[]}':'合成条目';
    };
    const start=await post('/api/assistant-team/start',{...request,planningConsent:true});
    const data=await start.json() as any;assert.equal(start.ok,true,JSON.stringify(data));
    let record:any;
    for(let i=0;i<200;i++){
      const detail=await (await fetch(h.base+'/api/assistant-team/job?id='+data.record.id)).json() as any;
      record=detail.job;
      if(record&&['succeeded','failed'].includes(record.status))break;
      await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(record?.status,'succeeded',JSON.stringify(record));
    assert.equal(record.payload.teamPlan.executionMode,'planned-text-v1');
    assert.equal(record.checkpoints.filter((c:any)=>c.data?.teamBudgetReservation).length,3);
    assert.equal(record.checkpoints.filter((c:any)=>c.data?.teamExecutionPlan).length,1);
    assert.equal(h.requests.length-before,3);
  }finally{await h.stop();}
});
