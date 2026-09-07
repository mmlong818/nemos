import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelScheduler, modelResourceKey} from '../../examples/companion/model-scheduler.js';
import {makeConnectionAgentModel} from '../../examples/companion/llm.js';
import {normalizeCompanionModelConnection} from '../../examples/companion/model-connection.js';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test('等待、获得名额和释放准确通知；观察器失败不泄漏名额',async()=>{
  const scheduler=new ModelScheduler(),hold=gate(),events:string[]=[];
  const first=scheduler.run('x',undefined,()=>hold.promise);
  const second=scheduler.run('x',undefined,async()=>{},state=>events.push(state));
  await tick();assert.deepEqual(events,['waiting']);
  hold.resolve();await Promise.all([first,second]);assert.deepEqual(events,['waiting','active','released']);
  await scheduler.run('x',undefined,async()=>{},()=>{throw Error('observer failed');});
  assert.equal(scheduler.snapshot('x').active,0);
});
test('两个独立模型适配器的真实调用入口共享排队名额',async()=>{
  const original=globalThis.fetch,hold=gate();let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)await hold.promise;return Response.json({choices:[{message:{content:'synthetic'}}]});};
  const connection=normalizeCompanionModelConnection({provider:'custom',protocol:'openai-compatible',baseUrl:'http://127.0.0.1:19437/v1',model:'one',apiKey:''});
  const make=(model:string)=>makeConnectionAgentModel({connection,model,maxTokens:100,temperature:0,stream:false});
  const request={messages:[{role:'user' as const,content:'test'}],tools:[],signal:new AbortController().signal};
  try {
    const first=make('one').complete(request),second=make('two').complete(request);
    await tick();assert.equal(calls,1);hold.resolve();
    const result=await Promise.all([first,second]);assert.equal(calls,2);assert.equal(result[1].text,'synthetic');
  }finally{hold.resolve();globalThis.fetch=original;}
});
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise,resolve}; }
test('同资源串行 FIFO，不同资源独立，结束后释放', async () => {
  const scheduler=new ModelScheduler(), hold=gate(), order:string[]=[];
  const a=scheduler.run('same',undefined,async()=>{order.push('a');await hold.promise;});
  const b=scheduler.run('same',undefined,async()=>{order.push('b');});
  const c=scheduler.run('same',undefined,async()=>{order.push('c');});
  await scheduler.run('other',undefined,async()=>{order.push('other');});
  assert.deepEqual(order,['a','other']);assert.deepEqual(scheduler.snapshot('same'),{active:1,waiting:2});
  hold.resolve();await Promise.all([a,b,c]);assert.deepEqual(order,['a','other','b','c']);
  assert.deepEqual(scheduler.snapshot('same'),{active:0,waiting:0});
});
test('等待取消不会执行，也不会占住后续任务',async()=>{
  const scheduler=new ModelScheduler(), hold=gate(), abort=new AbortController();let called=false;
  const a=scheduler.run('x',undefined,()=>hold.promise);
  const b=scheduler.run('x',abort.signal,async()=>{called=true;});
  const rejected=assert.rejects(b);abort.abort();await rejected;
  assert.equal(called,false);assert.equal(scheduler.snapshot('x').waiting,0);
  hold.resolve();await a;
  await scheduler.run('x',undefined,async()=>{});
});
test('执行失败释放名额，正在执行的取消必须等原调用结束',async()=>{
  const scheduler=new ModelScheduler(),hold=gate(),abort=new AbortController();let second=false;
  const first=scheduler.run('x',abort.signal,async()=>{await hold.promise;throw Error('failure');});
  const rejected=assert.rejects(first,/failure/);await tick();abort.abort();
  const next=scheduler.run('x',undefined,async()=>{second=true;});await tick();assert.equal(second,false);
  hold.resolve();await rejected;await next;assert.equal(second,true);
});
test('有限并发与队列上限，预取消零执行',async()=>{
  const scheduler=new ModelScheduler(2,1),hold=gate();
  const first=scheduler.run('x',undefined,()=>hold.promise),second=scheduler.run('x',undefined,()=>hold.promise);
  const third=scheduler.run('x',undefined,async()=>{});
  await assert.rejects(scheduler.run('x',undefined,async()=>{}),/队列已满/);
  assert.deepEqual(scheduler.snapshot('x'),{active:2,waiting:1});
  const abort=new AbortController();abort.abort();let called=false;
  await assert.rejects(scheduler.run('y',abort.signal,async()=>{called=true;}));assert.equal(called,false);
  hold.resolve();await Promise.all([first,second,third]);
});
test('同凭据同来源共享资源，不暴露 Key，不因不同 API 路径重复计数',()=>{
  const a={baseUrl:'https://example.test/v1',apiKey:'synthetic-key'};
  assert.equal(modelResourceKey(a),modelResourceKey({...a,baseUrl:'https://example.test/v2'}));
  assert.notEqual(modelResourceKey(a),modelResourceKey({...a,apiKey:'different'}));
  assert.notEqual(modelResourceKey(a),modelResourceKey({...a,baseUrl:'https://other.test'}));
  assert.doesNotMatch(modelResourceKey(a),/synthetic/);
});
