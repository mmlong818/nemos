import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const window:any={};
for(const file of ['task-detail','unified-task-history'])runInNewContext(readFileSync(`examples/companion/web/assets/${file}.js`,'utf8'),{window});
const detail=window.ClownfishTaskDetail;
test('列表摘要与完整详情共用排队标签，序列化刷新后保持一致',()=>{
  for(const state of ['waiting','active','released','invalid']){
    const full={status:'running',checkpoints:[{data:{modelAdmission:{state}}}]};
    const summary=JSON.parse(JSON.stringify({status:'running',modelAdmission:state}));
    assert.equal(window.ClownfishUnifiedHistory.statusLabel(summary),window.ClownfishUnifiedHistory.statusLabel(full));
    if(state==='waiting'||state==='active')assert.ok(detail.botDetail(full).includes(window.ClownfishUnifiedHistory.statusLabel(summary)));
    for(const status of ['queued','cancelled','failed','succeeded'])assert.equal(detail.modelState({...summary,status}),undefined);
  }
  assert.equal(detail.modelState({status:'running',modelAdmission:'waiting',checkpoints:[]}),undefined);
});
test('任务详情显示当前模型等待，终态和后续检查点不沿用旧等待',()=>{
  const job:any={status:'running',checkpoints:[{data:{modelAdmission:{state:'waiting'}}}]};
  assert.match(detail.botDetail(job),/等待模型/);
  job.checkpoints.push({data:{modelAdmission:{state:'active'}}});
  assert.match(detail.botDetail(job),/模型执行中/);
  assert.doesNotMatch(detail.botDetail(job),/当前模型连接繁忙/);
  job.checkpoints.push({data:{modelAdmission:{state:'waiting'}}});job.status='cancelled';
  assert.doesNotMatch(detail.botDetail(job),/当前模型连接繁忙/);
  job.status='running';job.checkpoints.push({status:'恢复任务'});
  assert.doesNotMatch(detail.botDetail(job),/当前模型连接繁忙/);
});
const fixture=(status='succeeded')=>({id:'synthetic job',status,payload:{teamPlan:{objective:'验收报告',model:'test-model',materials:'合成资料',requiredFields:['结论'],workers:[{name:'整理 Bot',revision:1,template:{id:'bot-designer'}}]}},checkpoints:[{data:{teamReceipt:{stageId:'one',botName:'整理 Bot',state:'returned',output:'合成回执',inputHash:'abc',receivedAt:'2026-09-07'}}}],result:{data:{delivery:{summary:'已整理合成资料',fields:[{label:'结论',value:'只用于测试',sources:['S1']}]}}}});

test('Bot 交付在回执和共享材料之前，复制、下载与审阅创建入口保留',()=>{
  const job=fixture(),before=JSON.stringify(job),html=detail.botDetail(job);
  assert.ok(html.indexOf('aria-label="最终交付"')<html.indexOf('data-task-disclosure="process"'));
  assert.ok(html.indexOf('data-task-disclosure="process"')<html.indexOf('data-task-disclosure="context"'));
  for(const value of ['data-copy-result','data-copy-field="0"','data-download-result','data-review-bot','data-receipt="one"','输入指纹 abc','1 份回执已返回','工具关闭'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/<details[^>]*\sopen[\s>]/);
  assert.equal(JSON.stringify(job),before);
});

test('不同任务状态只显示允许的现有操作，不把未完成当成交付',()=>{
  for(const state of ['queued','running','failed','cancelled','uncertain','succeeded']){
    const job:any=fixture(state);delete job.result;
    const html=detail.botDetail(job);
    assert.equal(html.includes('data-action="retry"'),['failed','cancelled'].includes(state));
    assert.equal(html.includes('data-action="cancel"'),['queued','running'].includes(state));
    assert.equal(html.includes('data-copy-result'),false);
    assert.equal(html.includes('data-review-bot'),false);
    assert.ok(html.includes(detail.notice(state,false)));
  }
  assert.match(detail.notice('succeeded',false),/没有可展示/);
  assert.match(detail.notice('uncertain',false),/不要重复提交/);
});

test('失败原因直接可见且外来文本转义，重复阶段回执只显示最后一份',()=>{
  const job:any=fixture('failed');job.error='<img src=x>';job.payload.teamPlan.materials='<script>bad</script>';
  job.checkpoints.push({data:{teamReceipt:{stageId:'one',state:'failed',botName:'核验',error:'<failure>'}}});
  const html=detail.botDetail(job);
  assert.ok(html.indexOf('role="alert"')<html.indexOf('aria-label="最终交付"'));
  assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img|<script/);
  assert.match(html,/0 份回执已返回/);assert.doesNotMatch(html,/合成回执/);
  assert.match(html,/record-job-synthetic%20job/);
});

test('旧任务缺少可选字段也能查看，不虚构正文或模型',()=>{
  const html=detail.botDetail({id:'empty',status:'uncertain'});
  assert.match(html,/尚无回执/);assert.match(html,/模型：未记录/);assert.doesNotMatch(html,/data-copy-result/);
});

test('追加消息显示事实消费状态，待补充和受阻不误导为可原任务恢复',()=>{
  const running:any=fixture('running');delete running.result;
  running.steering=[{mode:'merge',revision:1,text:'<new>'},{mode:'redirect',revision:2,text:'new goal'}];
  running.checkpoints.push({data:{teamReceipt:{stageId:'two',botName:'Bot',state:'received',steeringRevision:1,receivedAt:'2026-09-09'}}});
  const html=detail.botDetail(running);
  assert.match(html,/data-steering-send/);assert.match(html,/已纳入Bot阶段/);assert.match(html,/已接收，等待下一阶段/);
  assert.match(html,/&lt;new&gt;/);assert.doesNotMatch(html,/<new>/);
  for(const disposition of [{state:'waiting_input',question:'请提供日期'},{state:'blocked',blocker:'权限不足'}]){
    const stopped:any=fixture('failed');stopped.disposition=disposition;
    const stoppedHtml=detail.botDetail(stopped);
    assert.ok(stoppedHtml.includes(disposition.state==='waiting_input'?'请提供日期':'权限不足'));
    assert.doesNotMatch(stoppedHtml,/data-action="retry"/);assert.match(stoppedHtml,/新建任务/);
  }
});

test('流程保留历史成果，但最新失败原因位于成果之前',()=>{
  const html=window.ClownfishUnifiedHistory.flowDetail({id:'t',title:'流程',instruction:'原始要求'},
    {artifacts:[{id:'old-result',taskId:'t',title:'旧成果'}]},
    [{id:'run',payload:{taskId:'t'},status:'failed',error:'本次连接失败'}]);
  assert.ok(html.indexOf('role="alert"')<html.indexOf('aria-label="交付成果"'));
  assert.match(html,/已有成果 · 请结合本次状态核对/);
  assert.ok(html.indexOf('aria-label="交付成果"')<html.indexOf('原始要求'));
  for(const value of ['data-flow-process','data-task-disclosure="context"','管理此流程','流程协作设置','old-result'])assert.ok(html.includes(value));
});

test('详情由共用挂载维护折叠状态，旧结果处理事件仍使用原始任务',()=>{
  const source=readFileSync('examples/companion/web/assets/assistant-team.js','utf8');
  assert.match(source,/ClownfishTaskDetail.mount\(\$\('#jobDetail'\),html,id\)/);
  assert.match(source,/ClownfishTaskDetail.botDetail\(job\)/);
  assert.match(source,/currentJob\.id/);
  assert.match(source,/id!==selected/);
});
