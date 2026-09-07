/* Run only in a disposable agent-browser session on /bots. No backend writes. */
(() => {
  const fixture={writes:[],clipboard:'',detailReads:0};
  fixture.job={id:'ui-detail-fixture',title:'整理一份活动复盘简报',status:'succeeded',updatedAt:'2026-09-07T10:00:00Z',payload:{teamPlan:{objective:'整理一份活动复盘简报',model:'synthetic-model',materials:'【合成测试资料】报名 48 人，到场 36 人；反馈表回收 28 份。',requiredFields:['关键结论','下一步'],workers:[{name:'资料整理助理',revision:1}]}},checkpoints:[{data:{teamReceipt:{stageId:'worker:1',botName:'资料整理助理',state:'returned',receivedAt:'2026-09-07T09:59:00Z',returnedAt:'2026-09-07T10:00:00Z',output:'【合成回执】到场率为 75%，反馈覆盖到场者约 77.8%。',inputHash:'synthetic-hash'}}}],result:{data:{delivery:{summary:'已将活动数据整理为两项结论，并列出下一次活动前需要确认的事项。',fields:[{label:'关键结论',value:'到场 36 人，占报名人数的 75%。反馈表回收 28 份，不能用未回收的反馈推断满意度。',sources:['S1：用户提供的活动记录（合成）']},{label:'下一步',value:'1. 补充缺席原因，区分报名与到场差异。\n2. 核对反馈题目与原始答案，再形成满意度结论。',sources:['S1：活动记录；以上建议需人工确认']}]}}}};
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    const method=(options.method||input?.method||'GET').toUpperCase();
    if(!['GET','HEAD'].includes(method)){fixture.writes.push({path:url.pathname,method});throw Error('UI fixture blocks backend writes');}
    if(url.pathname==='/api/assistant-team/job'){fixture.detailReads++;return Response.json({job:fixture.job});}
    if(url.pathname==='/api/assistant-team')return Response.json({bots:[],models:['synthetic-model'],model:'synthetic-model',ready:true,jobs:[fixture.job]});
    if(url.pathname==='/api/capabilities')return Response.json({tasks:[],artifacts:[]});
    if(url.pathname==='/api/agent/jobs')return Response.json({jobs:[]});
    return originalFetch(input,options);
  };
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{fixture.clipboard=text;}}});
  window.__taskDetailFixture=fixture;
  history.pushState(null,'','/bots?view=tasks&job=ui-detail-fixture');window.dispatchEvent(new PopStateEvent('popstate'));
  return 'Synthetic fixture installed. Backend writes blocked; refresh to remove.';
})();
