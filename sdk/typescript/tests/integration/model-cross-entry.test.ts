import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startModelHarness} from '../fixtures/companion-model-harness.js';
import {onboardModel} from '../helpers/onboard-model.js';

test('助理占用模型时任务等待；取消等待任务不调用模型，后续任务继续', {timeout:60000}, async()=>{
  const h=await startModelHarness();let release!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  let chat:Promise<Response>|undefined;
  const post=(path:string,body:unknown)=>fetch(h.base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const json=async(path:string,body:unknown)=>{const response=await post(path,body);const value=await response.json() as any;assert.ok(response.ok,JSON.stringify(value));return value;};
  const summary=async()=>(await (await fetch(h.base+'/api/assistant-team')).json() as any).jobs;
  const detail=async(id:string)=>(await (await fetch(h.base+'/api/assistant-team/job?id='+id)).json() as any).job;
  const until=async(check:()=>Promise<boolean>)=>{
    for(let i=0;i<250;i++){if(await check())return;await new Promise(r=>setTimeout(r,30));}
    throw Error('跨入口排队状态未达到预期');
  };
  try {
    await onboardModel(h.base,{provider:'custom',protocol:'openai-compatible',baseUrl:h.modelBase+'/v1',model:'manual',selectionMode:'manual'});
    h.state.beforeReply=()=>hold;
    h.state.replyFor=(body)=>String(body.messages[0]?.content).includes('最终交付协议')?'{"summary":"跨入口任务完成","fields":[]}':String(body.messages[0]?.content).includes('记忆分析器')?'{}':'CHAT-HELD finished';
    chat=post('/api/chat/stream',{text:'CHAT-HELD',target:{kind:'persona',id:'clownfish'},sessionId:'cross-entry-test',model:'manual',toolMode:'off'});
    await until(async()=>h.requests.some(r=>r.body?.messages?.some((m:any)=>String(m.content).includes('CHAT-HELD'))));
    const start=async(name:string)=>(await json('/api/assistant-team/start',{requestId:name,objective:name,workerIds:[],reviewerId:''})).record.id;
    const a=await start('CROSS-CANCEL'),b=await start('CROSS-CONTINUE');
    await until(async()=>(await summary()).some((j:any)=>j.id===a&&j.modelAdmission==='waiting'));
    const waiting=await detail(a);
    assert.equal(waiting.status,'running');
    assert.equal(waiting.checkpoints.at(-1).data.modelAdmission.state,'waiting');
    assert.equal((await summary()).find((j:any)=>j.id===b).status,'queued');
    await json('/api/assistant-team/cancel',{id:a});
    await until(async()=>(await summary()).some((j:any)=>j.id===b&&j.modelAdmission==='waiting'));
    assert.equal((await detail(a)).status,'cancelled');
    assert.equal((await summary()).find((j:any)=>j.id===a).modelAdmission,undefined);
    h.state.beforeReply=undefined;release();
    const chatResponse=await chat;assert.equal(chatResponse.status,200);assert.match(await chatResponse.text(),/CHAT-HELD finished/);
    await until(async()=>(await detail(b)).status==='succeeded');
    const completed=await detail(b);
    assert.ok(completed.checkpoints.some((c:any)=>c.data?.modelAdmission?.state==='active'));
    assert.equal((await summary()).find((j:any)=>j.id===b).modelAdmission,undefined);
    const has=(name:string)=>h.requests.filter(r=>r.body?.messages?.some((m:any)=>String(m.content).includes(name)));
    // Memory extraction is deliberately asynchronous (400ms worker poll). The
    // Agent job worker is event-driven, so the foreground task can now finish
    // before that next poll instead of incidentally waiting on the old 500ms job
    // poll. Assert eventual exactly-once extraction, not the old timer ordering.
    await until(async()=>has('CHAT-HELD').filter(r=>String(r.body.messages[0]?.content).includes('记忆分析器')).length===1);
    assert.equal(has('CROSS-CANCEL').length,0);
    assert.equal(has('CROSS-CONTINUE').length,1);
    assert.equal(has('CHAT-HELD').filter(r=>r.body.stream).length,1);
    assert.equal(has('CHAT-HELD').filter(r=>String(r.body.messages[0]?.content).includes('记忆分析器')).length,1);
  } finally {
    h.state.beforeReply=undefined;release();await chat?.then(response=>response.body?.cancel()).catch(()=>{});await h.stop();
  }
});

test('active model work blocks connection edits and queued capability work never crosses connections', {timeout:60000}, async()=>{
  const h=await startModelHarness();let release!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const post=async(path:string,body:unknown,expected=200)=>{
    const response=await fetch(h.base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const value=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(value));return value;
  };
  const readJob=async(id:string)=>(await (await fetch(h.base+'/api/agent/job?id='+encodeURIComponent(id))).json() as any).job;
  const until=async(check:()=>Promise<boolean>)=>{
    for(let i=0;i<300;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,30));}
    throw new Error('model connection isolation state did not arrive');
  };
  try {
    const config={provider:'custom',protocol:'openai-compatible',baseUrl:h.modelBase+'/v1',model:'manual',selectionMode:'manual'};
    await onboardModel(h.base,config);
    const ability=(await post('/api/capabilities/ability',{personaId:'clownfish',name:'Connection isolation fixture',goal:'Return a short result',defaultFormat:'md'})).ability;
    const task=(await post('/api/capabilities/task',{personaId:'clownfish',capabilityId:ability.id,title:'Queued capability fixture',instruction:'CAPABILITY-CROSS-CONNECTION',format:'md',schedule:{mode:'manual'},enabled:true})).task;

    h.requests.splice(0);
    h.state.beforeReply=()=>hold;
    await post('/api/assistant-team/start',{requestId:'connection-edit-blocker',objective:'ACTIVE-MODEL-JOB',workerIds:[],reviewerId:''},202);
    await until(async()=>h.requests.some(request=>request.body?.messages?.some((message:any)=>String(message.content).includes('ACTIVE-MODEL-JOB'))));
    const staged=await post('/api/llm-connection/save',{...config,connectionId:(await (await fetch(h.base+'/api/llm')).json() as any).resourceCenter.connections[0].id,baseUrl:h.modelBase+'/other'});
    assert.equal(staged.activationRequired,true);assert.equal(staged.model,'manual');

    const capabilityTask=(await post('/api/capabilities/task/run',{id:task.id},202)).job.id;
    const adhoc=(await post('/api/agent/job',{kind:'capability-adhoc',title:'Queued adhoc fixture',personaId:'clownfish',capabilityId:ability.id,instruction:'ADHOC-CROSS-CONNECTION',memoryMode:'off'},202)).job.id;
    const orchestration=(await post('/api/agent/orchestration',{objective:'ORCHESTRATION-CROSS-CONNECTION',tasks:[{id:'only',title:'Only',instruction:'ORCHESTRATION-SUBTASK-CROSS-CONNECTION',personaId:'clownfish',capabilityId:ability.id,format:'md'}]},202)).job.id;

    await h.restart(()=>{
      h.state.beforeReply=undefined;release();
      const path=join(h.dir,'llm-key.dpapi.json');
      const saved=JSON.parse(readFileSync(path,'utf8')) as any;
      const active=saved.connections[0];
      active.baseUrl=h.modelBase+'/other';
      active.connectionRevision=randomUUID();
      active.catalogConnectionRevision='';
      active.modelChecks={};
      writeFileSync(path,JSON.stringify(saved,null,2)+'\n','utf8');
    });
    for(const id of [capabilityTask,adhoc,orchestration]){
      await until(async()=>['failed','cancelled','uncertain','succeeded'].includes((await readJob(id))?.status));
    }
    for(const id of [capabilityTask,adhoc,orchestration]){
      const job=await readJob(id);assert.ok(['failed','uncertain'].includes(job.status));assert.match(job.error,/连接已改变|另一服务/);
    }
    const leaked=h.requests.filter(request=>request.body?.messages?.some((message:any)=>/CAPABILITY-CROSS-CONNECTION|ADHOC-CROSS-CONNECTION|ORCHESTRATION-(?:SUBTASK-)?CROSS-CONNECTION/.test(String(message.content))));
    assert.deepEqual(leaked,[]);
  } finally {
    h.state.beforeReply=undefined;release();await h.stop();
  }
});
