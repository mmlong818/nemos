import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {FileAgentJobQueue} from '../../src/agent/job-queue.js';
import {FileDeliveryOutbox} from '../../examples/companion/delivery-outbox.js';
const window:any={};
for(const name of ['task-detail','unified-task-history'])runInNewContext(readFileSync(`examples/companion/web/assets/${name}.js`,'utf8'),{window});
const render=window.ClownfishTaskDetail.runReceipt;

test('receipt separates execution/result/delivery and refuses a different run delivery',()=>{
 const job:any={id:'run-1',status:'succeeded',attempts:1,payload:{taskId:'task-1',trigger:'manual'},result:{summary:'done',artifactRefs:['artifact:a&b']},deliveryRequired:true,delivery:{sourceType:'agent-job',sourceId:'run-1',channel:'chat',status:'failed',attempts:5,lastError:'<failure>'}};
 const html=render(job);
 for(const text of ['手动触发','已完成','送达失败','task-1','run-1','done','a%26b','&lt;failure&gt;'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<failure>|data-action=|<button/);
 job.delivery.sourceId='other-run';assert.match(render(job),/无关联回执/);assert.doesNotMatch(render(job),/送达失败|failure/);
 job.delivery.sourceId=job.id;job.completedAt='2026-11-18T12:00:00Z';job.delivery.createdAt='2026-11-17T12:00:00Z';
 assert.match(render(job),/无关联回执/);assert.doesNotMatch(render(job),/送达失败/);
 job.delivery.createdAt='2026-11-18T12:00:01Z';assert.match(render(job),/送达失败/);
 job.delivery.channel='email';assert.doesNotMatch(render(job),/送达失败/);job.delivery.channel='chat';
 job.status='running';assert.doesNotMatch(render(job),/送达失败/);job.status='succeeded';
 delete job.delivery;assert.match(render(job),/送达状态未知/);
 job.deliveredAt='2026-11-17T12:00:00Z';assert.doesNotMatch(render(job),/已确认送达/);
 job.deliveredAt='2026-11-18T12:00:01Z';assert.match(render(job),/已确认送达/);
 for(const state of ['running','queued']){job.status=state;assert.doesNotMatch(render(job),/已确认送达/);}
 job.status='succeeded';delete job.deliveredAt;
 job.deliveryRequired=false;assert.match(render(job),/不要求聊天通知/);
});

test('historical trigger and next check are separate from the current plan',()=>{
 const job:any={id:'scheduled',status:'queued',attempts:1,availableAt:'2026-11-18T12:00:00Z',metadata:{scheduled:'true'},payload:{taskId:'task',trigger:'time',nextCheckAt:'2026-11-19T12:00:00Z'},error:'prior failure'};
 const task={id:'task',enabled:false,schedule:{mode:'daily',time:'20:00',timezone:'Asia/Shanghai'}};
 for(const text of ['定时触发','等待重试','已尝试 1 次','可重试时间','当时预计的下次检查','prior failure'])assert.ok(render(job).includes(text),text);
 assert.doesNotMatch(render(job),/计划已暂停|计划配置/);
 assert.match(window.ClownfishUnifiedHistory.flowDetail(task,{artifacts:[]},[job]),/当前计划 · 计划已暂停/);
 job.payload.trigger='turn';assert.match(render(job),/对话轮次触发/);assert.doesNotMatch(render(job),/定时触发/);
 delete job.payload.nextCheckAt;
 assert.doesNotMatch(render(job),/下次检查/);
 delete job.payload.trigger;assert.match(render(job),/自动触发（类型未记录）/);
 const legacy=render({status:'uncertain'});assert.match(legacy,/尝试次数未记录/);assert.match(legacy,/触发方式未记录/);assert.match(legacy,/无关联回执/);
});

test('both Bot and workflow details expose run-specific receipts without mutating input',()=>{
 const job={id:'run',status:'failed',payload:{taskId:'task',trigger:'manual'},error:'failure'};
 const task={id:'task',title:'task',instruction:'input',schedule:{mode:'manual'}};
 const before=JSON.stringify({job,task});
 assert.match(window.ClownfishTaskDetail.botDetail(job),/运行收据/);
 const html=window.ClownfishUnifiedHistory.flowDetail(task,{artifacts:[]},[job]);
 assert.match(html,/运行收据/);assert.match(html,/作业 ID/);
 const lazy=window.ClownfishUnifiedHistory.flowDetail(task,{artifacts:[]},[job],{jobs:[job],loadedAt:1,summaryAt:1});
 assert.match(lazy,/最近一次运行/);assert.match(lazy,/data-run-history-job="run"/);assert.doesNotMatch(lazy,/运行收据时间线/);
 assert.equal(JSON.stringify({job,task}),before);
});

test('durable queue/outbox survive reload; reading receipt never starts or retries work',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nemos-run-receipt-'));
 try{
 const queueFile=join(dir,'queue.json'),outboxFile=join(dir,'outbox.json');
 let queue=new FileAgentJobQueue(queueFile,{retryBaseDelayMs:1});
 const pending=queue.enqueue({type:'capability-task',payload:{taskId:'task',trigger:'manual'},maxAttempts:2,deliveryRequired:true});
 queue.claimNext('worker');const retry=queue.fail(pending.id,'worker','temporary failure');
 assert.equal(retry.status,'queued');assert.match(render(retry),/等待重试/);
 queue.claimNext('worker',new Date(Date.now()+1000));
 const done=queue.complete(pending.id,'worker',{summary:'persisted result'});
 let outbox=new FileDeliveryOutbox(outboxFile);
 const delivery=outbox.enqueue({dedupeKey:'one',sourceType:'agent-job',sourceId:done.id,channel:'chat',payload:{jobId:done.id},maxAttempts:1});
 outbox.claimPending('browser');outbox.fail(delivery.id,'browser','notification unavailable');
 queue=new FileAgentJobQueue(queueFile);outbox=new FileDeliveryOutbox(outboxFile);
 const filesBefore=[readFileSync(queueFile,'utf8'),readFileSync(outboxFile,'utf8')];
 const job={...queue.get(done.id),delivery:outbox.getBySource('agent-job',done.id)};
 for(let i=0;i<3;i++){const html=render(job);assert.match(html,/persisted result/);assert.match(html,/已尝试 2 次/);assert.match(html,/送达失败/);}
 assert.deepEqual([readFileSync(queueFile,'utf8'),readFileSync(outboxFile,'utf8')],filesBefore);
 assert.equal(queue.get(done.id)?.status,'succeeded');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Bot GET projects only matching persisted delivery without enqueue or execution',()=>{
 const source=readFileSync('examples/companion/server.ts','utf8');
 const route=source.slice(source.indexOf('if (req.method === "GET" && pathname === "/api/assistant-team/job")'));
 const block=route.slice(0,route.indexOf('if (req.method === "POST"'));
 assert.match(block,/delivery: deliveryOutbox\.getBySource\("agent-job", job\.id, "chat"\)/);
 assert.doesNotMatch(block,/ensureJobDelivery|\.enqueue\(|\.retry\(|claimPending/);
});
