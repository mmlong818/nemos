import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (name: string) => readFileSync('examples/companion/web/assets/' + name, 'utf8');
const win: any = {};
runInNewContext(read('unified-task-history.js'), { window: win });
const h = win.ClownfishUnifiedHistory;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('统一列表只投影，不改写原始任务、Bot 记录或状态', () => {
  const bots = [{ id: 'same', title: 'Bot', status: 'succeeded' }];
  const snapshot = { tasks: [{ id: 'same', title: '流程', enabled: false }, { id: 'new', enabled: true }] };
  const before = JSON.stringify({ bots, snapshot });
  const items = h.entries(bots, snapshot, []);
  assert.deepEqual(plain(items.map((x: any) => [x.id, x.status])), [['same','succeeded'],['flow:same','paused'],['flow:new','planned']]);
  assert.equal(JSON.stringify({ bots, snapshot }), before);
  assert.notEqual(items[0], bots[0]);
  assert.deepEqual(plain(h.groups(items).map((g: any) => g.title)), ['待开始与已暂停', '已结束']);
});

test('三种历史关联均能找回，活跃执行优先且不混入其他任务', () => {
  const jobs = [
    { id:'old', payload:{taskId:'t'}, status:'running', updatedAt:'2026-09-01' },
    { id:'new', metadata:{workTaskId:'t'}, status:'succeeded', updatedAt:'2026-09-03' },
    { id:'artifact', result:{data:{artifact:{taskId:'t'}}}, updatedAt:'2026-09-02' },
    { id:'foreign', payload:{taskId:'other'}, status:'running' },
  ];
  assert.deepEqual(plain(h.related({id:'t'}, jobs).map((x: any) => x.id)), ['new','artifact','old']);
  assert.equal(h.entries([], {tasks:[{id:'t'}]}, jobs)[0].status, 'running');
});

test('搜索、来源、项目筛选组合，不改变原始顺序', () => {
  const items = [{title:'Monthly Review',source:'workflow',spaceId:'p'}, {title:'Review',source:'bot'}, {title:'other',source:'workflow',spaceId:'p'}];
  assert.deepEqual(plain(h.filter(items,{query:' REVIEW ',source:'workflow',space:'p'})), [items[0]]);
  assert.equal(h.filter(items,{space:'missing'}).length,0);
  assert.ok(h.filter(items,{source:'automation'}).every((x:any)=>x.kind==='自动化'));
  assert.ok(h.filter(items,{source:'single'}).every((x:any)=>x.kind!=='自动化'));
  assert.equal(h.filter(items,{source:'automation'}).length+h.filter(items,{source:'single'}).length,items.length);
});

test('详情保留管理与协作能力，成果归属准确，所有外来文本转义', () => {
  const task = {id:'a&b', title:'<img onerror=1>',instruction:'<script>bad</script>',enabled:false,schedule:{mode:'daily'},storyline:{events:[{text:'<x>',createdAt:'2026-09-01'}]}};
  const html = h.flowDetail(task,{artifacts:[{id:'file&1',taskId:'a&b',title:'my-result'},{id:'foreign',taskId:'other',title:'not-mine'}]},[]);
  assert.ok(html.includes('&lt;img onerror=1&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('my-result'));
  assert.ok(!html.includes('not-mine'));
  for (const fragment of ['/tasks?legacy=1&task=a%26b','/collaboration?legacy=1&task=a%26b','/automations?task=a%26b','data-flow-process','计划已暂停'])
    assert.ok(html.includes(fragment), fragment);
  assert.match(h.flowDetail(undefined,{},[]),/不可用或尚未读取成功/);
});

test('执行结果、错误、检查点和深链接出现在处理过程内', () => {
  const html = h.flowDetail({id:'t',title:'task'}, {}, [{id:'job&1',payload:{taskId:'t'},status:'failed',error:'<failure>',checkpoints:[{status:'检查材料'}]}]);
  assert.ok(html.includes('/runs#record-job-job%261'));
  assert.ok(html.includes('&lt;failure&gt;'));
  assert.ok(html.includes('检查材料'));
});

test('旧记录地址重定向到统一任务，保留任务和项目，管理与排错地址不重定向', () => {
  const win: any = {}, writes: string[] = [];
  runInNewContext(read('task-navigation.js'),{window:win,URLSearchParams,location:{pathname:'/collaboration',search:'?task=a%26b&space=p',replace:(url:string)=>writes.push(url)}});
  assert.deepEqual(writes,['/bots?view=tasks&task=a%26b&space=p']);
  const target=win.ClownfishTaskNavigation.target;
  assert.equal(target('/tasks','?legacy=1&task=t'),'');
  assert.equal(target('/collaboration','?legacy=1&task=t'),'');
  assert.equal(target('/runs'),'');
  assert.equal(target('/work'),'/bots?view=tasks');
});

test('流程读取失败保留缓存、显示提示并限速重试，恢复后清除提示', async () => {
  const source=read('assistant-team.js');
  const fn=source.slice(source.indexOf('  async function loadFlows('),source.indexOf('  function renderHistory('));
  let requests=0, success=false;
  const context: any={flowLoadedAt:0,flowSnapshot:{tasks:[{id:'saved'}]},flowJobs:[{id:'saved-job'}],flowWarning:'', Date, Promise,
    fetch:async()=>{requests++;return {ok:success,json:async()=>({tasks:[{id:'fresh'}],jobs:[]})};}};
  await runInNewContext(fn+'\nloadFlows()',context);
  assert.equal(context.flowSnapshot.tasks[0].id,'saved');
  assert.match(context.flowWarning,/读取失败/);
  await runInNewContext(fn+'\nloadFlows()',context);
  assert.equal(requests,2);
  success=true;context.flowLoadedAt=0;
  await runInNewContext(fn+'\nloadFlows()',context);
  assert.equal(context.flowSnapshot.tasks[0].id,'fresh');
  assert.equal(context.flowWarning,'');
});

test('单入口导航隐藏旧记录项，高级日志和成果来源仍然可达', () => {
  assert.match(read('workbench-ui.js'),/for\(const path of \['\/tasks','\/collaboration','\/runs'\]\)/);
  assert.match(read('work-center.js'),/来源任务/);
  const page=readFileSync('examples/companion/web/settings.html','utf8');
  assert.match(page,/data-panel="advanced"/);
  assert.match(page,/href="\/runs">打开运行日志/);
});
