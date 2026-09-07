import test from 'node:test';
import assert from 'node:assert/strict';
import {startModelHarness} from '../fixtures/companion-model-harness.js';

test('三个任务排队，取消中间任务后其余交付，刷新与重启保留状态', {timeout:60000}, async()=>{
  const h=await startModelHarness();let release!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const post=async(path:string,body:unknown)=>{
    const response=await fetch(h.base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json() as any;assert.ok(response.ok,JSON.stringify(data));return data;
  };
  const jobs=async()=>(await (await fetch(h.base+'/api/assistant-team')).json() as any).jobs;
  const wait=async(predicate:(value:any[])=>boolean)=>{
    for(let i=0;i<200;i++){const current=await jobs();if(predicate(current))return current;await new Promise(r=>setTimeout(r,40));}
    throw Error('未达到预期任务状态');
  };
  try {
    await post('/api/llm-config',{provider:'custom',protocol:'openai-compatible',baseUrl:h.modelBase+'/v1',model:'manual',selectionMode:'manual'});
    h.state.beforeReply=()=>hold;h.state.replyFor=()=>'{"summary":"合成结果","fields":[]}';
    const ids:string[]=[];
    for(const name of ['A','B','C'])ids.push((await post('/api/assistant-team/start',{requestId:'multi-'+name,objective:'MULTI-QUEUE '+name,workerIds:[],reviewerId:''})).record.id);
    const initial=await wait(list=>list.some(j=>j.id===ids[0]&&j.modelAdmission==='active'));
    assert.equal(initial.find((j:any)=>j.id===ids[1]).status,'queued');
    assert.equal(initial.find((j:any)=>j.id===ids[2]).status,'queued');
    await post('/api/assistant-team/cancel',{id:ids[1]});
    h.state.beforeReply=undefined;release();
    await wait(list=>ids.every(id=>['succeeded','cancelled'].includes(list.find(j=>j.id===id)?.status)));
    await h.restart();
    const final=await jobs();
    assert.deepEqual(ids.map(id=>final.find((j:any)=>j.id===id).status),['succeeded','cancelled','succeeded']);
    assert.ok(final.every((j:any)=>!j.modelAdmission));
    const calls=h.requests.filter(r=>r.body?.messages?.some((m:any)=>String(m.content).includes('MULTI-QUEUE')));
    assert.equal(calls.length,2);assert.ok(calls.every(r=>!JSON.stringify(r.body).includes('MULTI-QUEUE B')));
  } finally {h.state.beforeReply=undefined;release();await h.stop();}
});
