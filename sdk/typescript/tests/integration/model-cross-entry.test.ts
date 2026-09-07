import test from 'node:test';
import assert from 'node:assert/strict';
import {startModelHarness} from '../fixtures/companion-model-harness.js';

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
    await json('/api/llm-config',{provider:'custom',protocol:'openai-compatible',baseUrl:h.modelBase+'/v1',model:'manual',selectionMode:'manual'});
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
    assert.equal(has('CROSS-CANCEL').length,0);
    assert.equal(has('CROSS-CONTINUE').length,1);
    assert.equal(has('CHAT-HELD').filter(r=>r.body.stream).length,1);
    assert.equal(has('CHAT-HELD').filter(r=>String(r.body.messages[0]?.content).includes('记忆分析器')).length,1);
  } finally {
    h.state.beforeReply=undefined;release();await chat?.then(response=>response.body?.cancel()).catch(()=>{});await h.stop();
  }
});
