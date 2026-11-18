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
    approvals:[{id:'ap-1',call:{name:'save_file',arguments:{path:'a.md'}},tool:{name:'save_file'},sessionEligible:true}],
    relationshipMemory:null,
  };
  const html=runInNewContext(render+'\nrenderAttentionInbox(true);',{state,escapeHtml:(v:unknown)=>String(v),encodeURIComponent});
  assert.match(html,/data-review-approval="ap-1" data-allowed="true" data-scope="once"/);
  assert.match(html,/data-review-approval="ap-1" data-allowed="true" data-scope="session"/);
  assert.match(html,/data-review-approval="ap-1" data-allowed="false" data-scope="once"/);
  // 会话档要点名是哪个工具，不能是"全都允许"这种没边界的说法。
  assert.match(html,/本会话允许同一动作与对象/);
});

test('提交审批决定时把 scope 一起发出，未识别取值退回只此一次',()=>{
  // 服务端已有更宽的「写成永久准则」(always)，但界面刻意不暴露——
  // 那是跨会话永久生效的授权，要单独的产品决定，不在这次范围内。
  assert.match(source,/const scope = decision\.dataset\.scope === "session" \? "session" : "once";/);
  assert.match(source,/JSON\.stringify\(\{ id: decision\.dataset\.reviewApproval, allowed: decision\.dataset\.allowed === "true", scope \}\)/);
  assert.doesNotMatch(source,/always: *true/);
});

test('会话内放行在界面上看得见、能撤销',()=>{
  const render=source.slice(source.indexOf('function renderAttentionInbox('),source.indexOf('function renderRuns('));
  const state:any={
    reviewQueue:[],reviewGroups:[],relationshipMemory:null,approvals:[],
    sessionGrants:[{sessionId:'s1',tool:'save_file',grantedAt:'2026-09-11T10:00:00.000Z',expiresAt:'2026-09-11T18:00:00.000Z'}],
  };
  const html=runInNewContext(render+'\nrenderAttentionInbox(true);',
    {state,escapeHtml:(v:unknown)=>String(v),encodeURIComponent,date:(v:unknown)=>String(v)});
  assert.match(html,/已放行的操作/);
  assert.match(html,/save_file/);
  assert.match(html,/data-revoke-grant="s1" data-revoke-tool="save_file"/);
  assert.match(html,/到期/,'必须显示到期时间——没有期限的放行就是永久放行');
  // 没有放行时不占版面
  state.sessionGrants=[];
  assert.doesNotMatch(runInNewContext(render+'\nrenderAttentionInbox(true);',
    {state,escapeHtml:(v:unknown)=>String(v),encodeURIComponent,date:(v:unknown)=>String(v)}),/已放行的操作/);
});

test('撤销走专用接口，并且只撤指定的那一条',()=>{
  assert.match(source,/api\("\/api\/agent\/approval\/session-grant\/revoke"/);
  assert.match(source,/sessionId: revoke\.dataset\.revokeGrant, tool: revoke\.dataset\.revokeTool/);
});

test('自动化卡片显示上次运行的真实结果，失败不再伪装成"尚未运行"',()=>{
  const fn=source.slice(source.indexOf('function renderAutomations('),source.indexOf('function collaborationJob('));
  const helpers=source.slice(source.indexOf('function jobStatusLabel('),source.indexOf('function renderAttentionInbox('));
  const tone=source.slice(source.indexOf('function statusPill('),source.indexOf('function jobStatusLabel('));
  const tasks=[
    {id:'t1',title:'每日资料简报',enabled:true,schedule:{mode:'daily'},capabilityId:'research-brief',execution:{jobId:'j1',status:'failed',error:'达到本次运行的轮次上限，模型还没交出可核验的成果',updatedAt:'2026-09-21T20:00:00.000Z'}},
    {id:'t2',title:'周报',enabled:true,schedule:{mode:'weekly'},capabilityId:'doc',lastRunAt:'2026-09-20T01:00:00.000Z'},
    {id:'t3',title:'新任务',enabled:false,schedule:{mode:'daily'},capabilityId:'doc'},
  ];
  const content:any={innerHTML:''};
  runInNewContext(tone+helpers+fn+'\nrenderAutomations();',{
    location:{search:''},URLSearchParams,state:{snapshot:{tasks}},$:()=>content,escapeHtml:(v:unknown)=>String(v),encodeURIComponent,
    scheduleLabel:()=>'每天',abilityName:(id:string)=>id,date:(v:string)=>v.slice(0,10),renderAttentionInbox:()=>'',
  });
  assert.match(content.innerHTML,/每日资料简报[\s\S]*上次 2026-09-21[\s\S]*未完成[\s\S]*达到本次运行的轮次上限/);
  assert.match(content.innerHTML,/周报[\s\S]*上次 2026-09-20/);
  assert.match(content.innerHTML,/新任务[\s\S]*尚未运行/);
});

test('项目详情只读取所选项目摘要，并忽略切换后的旧响应', async () => {
  const location = { search: '?space=slow-project' };
  const calls: string[] = [];
  const rendered: string[] = [];
  let finishSlow: (value: { space: { id: string } }) => void = () => {};
  const slow = new Promise<{ space: { id: string } }>(resolve => { finishSlow = resolve; });
  const content = { setAttribute() {}, removeAttribute() {} };
  const ctx = runInNewContext(`let loadSequence = 0; let view = "spaces";
    ${source.slice(source.indexOf('function projectIdFromLocation('), source.indexOf('function hydrateIcons('))}
    ${source.slice(source.indexOf('async function load('), source.indexOf('function render()'))}
    ({ load });`, {
    location, URLSearchParams, $: () => content,
    api: (url: string) => {
      calls.push(url);
      return url.endsWith('slow-project') ? slow : Promise.resolve({ space: { id: 'current' } });
    },
    renderProjectOverview: (result: { space: { id: string } }) => rendered.push(result.space.id),
  });
  const first = ctx.load();
  location.search = '?space=current%26project';
  await ctx.load();
  finishSlow({ space: { id: 'obsolete' } });
  await first;
  assert.deepEqual(calls, ['/api/capabilities/space?id=slow-project', '/api/capabilities/space?id=current%26project']);
  assert.deepEqual(rendered, ['current']);
});

test('项目聚合使用原有详情地址，并转义标题、下一步和资料编号', () => {
  const nodes: Record<string, { innerHTML?: string; textContent?: string }> = {};
  const project = {
    space: { id: 'p?1', title: '<项目>', description: '项目目标', status: 'active' },
    tasks: [{ id: 't&1', title: '<任务>', status: 'active' }],
    materials: [{ id: 'm"1', title: '<资料>', kind: 'note' }],
    artifacts: [{ id: 'a&1', taskId: 't&1', title: '<成果>', format: 'doc', createdAt: '2026-11-18T00:00:00.000Z' }],
    nextAction: { taskId: 't&1', taskTitle: '<任务>', text: '<下一步>' },
    counts: { tasks: 7, materials: 1, artifacts: 1 },
  };
  runInNewContext(`${source.slice(source.indexOf('function escapeHtml('), source.indexOf('async function api('))}
    ${source.slice(source.indexOf('function projectSection('), source.indexOf('async function continueOneOffTask('))}
    renderProjectOverview(project);`, {
    project, document: {}, $: (key: string) => nodes[key] ||= {},
    storylineStatusLabel: () => '推进中', resourceKindLabel: () => '文字笔记',
  });
  assert.equal(nodes['#pageTitle']?.textContent, '<项目>');
  const html = nodes['#content']?.innerHTML || '';
  assert.match(html, /&lt;下一步&gt;/);
  assert.match(html, /\/tasks\?space=p%3F1&amp;task=t%261/);
  assert.match(html, /data-preview-resource="m&quot;1"/);
  assert.match(html, /\/api\/capabilities\/artifact\/preview\?id=a%261/);
  assert.match(html, /\/bots\?task=t%261/);
  assert.match(html, /显示 1 \/ 7/);
  assert.doesNotMatch(html, /<任务>|<资料>|<成果>/);
});
