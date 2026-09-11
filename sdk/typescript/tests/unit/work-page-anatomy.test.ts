import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source=readFileSync('examples/companion/web/assets/work-center.js','utf8');
test('自动化展示计划优先，全局异常仅做摘要且保留故障警告',()=>{
  const render=source.slice(source.indexOf('function renderAttentionInbox('),source.indexOf('function renderRuns('));
  const state:any={reviewQueue:Array(23).fill({}),reviewGroups:[],relationshipMemory:null};
  const get=()=>runInNewContext(render+'\nrenderAttentionInbox(false);',{state});
  assert.match(get(),/全局有 23 项待处理/);assert.match(get(),/href="\/runs"/);
  assert.doesNotMatch(get(),/compact-row|data-review-approval/);
  state.reviewQueue=[];assert.equal(get(),'');
  state.relationshipMemory={state:'unavailable'};assert.match(get(),/role="alert"/);
  const automations=source.slice(source.indexOf('function renderAutomations('),source.indexOf('function collaborationJob('));
  assert.match(automations,/work-primary-list[\s\S]+renderAttentionInbox\(false\)/);
  assert.doesNotMatch(automations,/id="newAutomation"/);
});

test('创建与搜索归入页面主体，资料及项目不重复创建入口',()=>{
  const ui=readFileSync('examples/companion/web/assets/workbench-ui.js','utf8');
  assert.match(ui,/localActions\|\|actions/);
  const html=readFileSync('examples/companion/web/work.html','utf8');
  assert.ok(html.indexOf('id="workInlineEditor"')<html.indexOf('id="content"'));
  assert.doesNotMatch(source,/id="newKnowledge"|id="newSpace"|data-create-first-space/);
  assert.match(source,/view==='automations'\?'daily':'manual'/);
  assert.match(source,/#workResourceBody"\)\.textContent/);
  const matters=readFileSync('examples/companion/web/matters.html','utf8');
  assert.doesNotMatch(matters,/class="section-links"/);
});

test('自动化、项目、资料复用原表单页内编辑，任务记录保留原有编辑弹窗',()=>{
  const fn=source.slice(source.indexOf('function showWorkEditor('),source.indexOf('function closeWorkEditor('));
  for(const [view,dialogId,formId,inline] of [['automations','taskDialog','taskForm',true],['spaces','spaceDialog','spaceForm',true],['resources','knowledgeDialog','knowledgeForm',true],['tasks','taskDialog','taskForm',false]] as const){
    let moved:any,modal=false;
    const form={querySelector:()=>({textContent:'',focus(){}})};
    const host={hidden:true,replaceChildren:(node:any)=>{moved=node;}};
    const dialog={showModal:()=>{modal=true;}};
    const nodes:any={['#'+formId]:form,['#'+dialogId]:dialog,'#workInlineEditor':host};
    runInNewContext(fn+`\nshowWorkEditor('${dialogId}');`,{view,$:(key:string)=>nodes[key]});
    assert.equal(modal,!inline);assert.equal(host.hidden,!inline);
    if(inline)assert.equal(moved,form,'原表单节点及事件保留');
  }
});

test('页内保存失败不丢失内容，防重复提交并恢复控件',async()=>{
  const fn=source.slice(source.indexOf('async function submitWorkForm('),source.indexOf('function openTaskDialog('));
  const field={disabled:false,value:'原始草稿'},error={textContent:''};
  const form={dataset:{} as any,querySelector:()=>error,querySelectorAll:()=>[field]};
  const ctx:any={};runInNewContext(fn,ctx);
  let reject:(reason:Error)=>void=()=>{},calls=0;
  const save=()=>{calls++;return new Promise((_resolve,fail)=>{reject=fail;});};
  const event={target:form,preventDefault(){}};
  const pending=ctx.submitWorkForm(event,save);
  assert.equal(field.disabled,true);await ctx.submitWorkForm(event,save);assert.equal(calls,1);
  reject(new Error('保存失败'));await pending;
  assert.equal(field.value,'原始草稿');assert.equal(field.disabled,false);assert.equal(error.textContent,'保存失败');
});

test('编辑暂停的自动化保持暂停，不因保存内容而重新启用',async()=>{
  const fn=source.slice(source.indexOf('async function saveTask('),source.indexOf('function openSpaceDialog('));
  const nodes:any={};
  for(const [key,value] of Object.entries({taskId:'paused-task',taskSchedule:'daily',taskTitle:'编辑后的名称',taskInstruction:'合成要求',taskCapability:'research',taskFormat:'md',taskSpace:'',taskTime:'09:10'}))nodes['#'+key]={value,dataset:{promote:''}};
  let body:any;
  const ctx:any={state:{snapshot:{tasks:[{id:'paused-task',enabled:false}]}},$:(key:string)=>nodes[key],$$:()=>[],api:async(_path:string,options:any)=>{body=JSON.parse(options.body);},closeWorkEditor(){},toast(){},load:async()=>{}};
  await runInNewContext(fn+'\nsaveTask();',ctx);
  assert.equal(body.enabled,false);assert.equal(body.schedule.time,'09:10');
  nodes['#taskId'].value='';await runInNewContext(fn+'\nsaveTask();',ctx);assert.equal(body.enabled,true);
});

test('审批卡提供三档决定：只此一次、本会话内、拒绝',()=>{
  const render=source.slice(source.indexOf('function renderAttentionInbox('),source.indexOf('function renderRuns('));
  const state:any={
    reviewQueue:[{}],
    reviewGroups:[{id:'g1',items:[{id:'i1',kind:'approval',sourceId:'ap-1',title:'写入报告',nextAction:'需要你确认'}]}],
    approvals:[{id:'ap-1',call:{name:'save_file',arguments:{path:'a.md'}},tool:{name:'save_file'}}],
    relationshipMemory:null,
  };
  const html=runInNewContext(render+'\nrenderAttentionInbox(true);',{state,escapeHtml:(v:unknown)=>String(v),encodeURIComponent});
  assert.match(html,/data-review-approval="ap-1" data-allowed="true" data-scope="once"/);
  assert.match(html,/data-review-approval="ap-1" data-allowed="true" data-scope="session"/);
  assert.match(html,/data-review-approval="ap-1" data-allowed="false" data-scope="once"/);
  // 会话档要点名是哪个工具，不能是"全都允许"这种没边界的说法。
  assert.match(html,/本次会话内都允许「save_file」/);
});

test('提交审批决定时把 scope 一起发出，未识别取值退回只此一次',()=>{
  // 服务端已有更宽的「写成永久准则」(always)，但界面刻意不暴露——
  // 那是跨会话永久生效的授权，要单独的产品决定，不在这次范围内。
  assert.match(source,/const scope = decision\.dataset\.scope === "session" \? "session" : "once";/);
  assert.match(source,/JSON\.stringify\(\{ id: decision\.dataset\.reviewApproval, allowed: decision\.dataset\.allowed === "true", scope \}\)/);
  assert.doesNotMatch(source,/always: *true/);
});
