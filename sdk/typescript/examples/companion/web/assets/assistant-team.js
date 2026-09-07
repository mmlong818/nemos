(() => {
  const $ = (q) => document.querySelector(q);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data = { bots:[],jobs:[],models:[],ready:false }, selected = new URLSearchParams(location.search).get('job') || '', detailKey = '', loading = false, timer;
  let requestId = '', requestBody = '', taskOptionsKey = '', submitting = false;
  let templates = [], activeTemplate, currentJob;
  const handoff=window.ClownfishTeamResults;
  const materialUploads=window.ClownfishTeamMaterials.bind();
  const routingUi=window.ClownfishTeamRouting.bind();
  const workflows=window.ClownfishWorkflowCatalog.workflows;
  const library=window.ClownfishBotLibrary;
  const skills=window.ClownfishSkills;
  const historyView=window.ClownfishUnifiedHistory;
  let flowSnapshot={tasks:[],artifacts:[]},flowJobs=[],flowLoadedAt=0,flowWarning='';
  let historySpace=new URLSearchParams(location.search).get('space')||'';
  let botFilter='all', libraryKey='';
  function workflowCard(t) {
    return `<article class="bot-library-card" data-workflow-bot="${esc(t.id)}"><header><span class="bot-mark" data-app-icon="${esc(({presentation:"panel",document:"document",research:"search",marketBrief:"work",thinking:"role-think",product:"role-interface",meeting:"users",web:"code",decision:"role-decision",business:"role-sales",market:"role-strategy"})[t.id] || "boxes")}" aria-hidden="true"></span><div><span class="bot-card-kind">${esc(t.category)}</span><h3><button data-inspect-workflow="${esc(t.id)}">${esc(t.name)}</button></h3></div></header><p class="bot-card-summary">${esc(t.summary)}</p><footer><span class="bot-card-output">${esc(t.deliverable)}</span><a href="${esc(t.href)}" aria-label="准备任务：${esc(t.name)}">准备任务 →</a></footer></article>`;
  }
  $('#builtinBotList').innerHTML=workflows.map(workflowCard).join('');
  function textBotCard(b) {
    return `<article class="bot-library-card${b.enabled?'':' is-disabled'}" data-personal-bot="${esc(b.id)}"><header><span class="bot-mark" data-app-icon="${library.icon(b)}" aria-hidden="true"></span><div><span class="bot-card-kind">${b.role==='reviewer'?'独立核验':'执行与整理'}</span><h3><button data-inspect-bot="${esc(b.id)}">${esc(b.name)}</button></h3></div>${b.enabled?'':'<span class="bot-disabled-label">已停用</span>'}</header><p class="bot-card-summary">${esc(library.summary(b))}</p><footer><button class="bot-secondary-action" data-edit-bot="${esc(b.id)}" aria-label="编辑规则：${esc(b.name)}">编辑规则</button><button class="bot-use-action" data-use-bot="${esc(b.id)}" aria-label="使用 ${esc(b.name)}" ${b.enabled?'':'disabled'}>使用规则 →</button></footer></article>`;
  }
  function renderLibrary() {
    const query=$('#botSearch').value;
    const key=JSON.stringify([data.bots,botFilter,query]);
    if(key===libraryKey)return;
    libraryKey=key;
    const visible=library.filter(data.bots,workflows,botFilter,query);
    const teamBots=data.bots.filter(b=>b.placement!=='market');
    $('#botCountAll').textContent=teamBots.length+workflows.length;
    $('#botCountText').textContent=teamBots.length;
    $('#botCountWorkflow').textContent=workflows.length;
    $('#botCountDisabled').textContent=teamBots.filter(b=>!b.enabled).length;
    $('#botList').innerHTML=visible.bots.map(textBotCard).join('');
    $('#botList').setAttribute('aria-busy','false');
    $('#builtinBotList').innerHTML=visible.workflows.map(workflowCard).join('');
    $('#textBotSection').hidden=!visible.bots.length;
    $('#workflowBotSection').hidden=!visible.workflows.length;
    $('#botNoResults').hidden=!!(visible.bots.length+visible.workflows.length);
    $('#botSearchResult').textContent='显示 '+(visible.bots.length+visible.workflows.length)+' 项技能与规则';
    document.querySelectorAll('[data-bot-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.botFilter===botFilter)));
    const marketBots=data.bots.filter(b=>b.marketListed||b.placement==='market');
    $('#marketEmpty').hidden=marketBots.length>0;
    $('#marketBotList').innerHTML=marketBots.map(b=>`<article class="bot-library-card" data-market-bot="${esc(b.id)}"><header><span class="bot-mark" data-app-icon="${library.icon(b)}" aria-hidden="true"></span><div><span class="bot-card-kind">规则模板 · 本机预览</span><h3><button data-inspect-bot="${esc(b.id)}">${esc(b.name)}</button></h3></div></header><p class="bot-card-summary">${esc(library.summary(b))}</p><footer><span class="bot-card-output">只处理本次文字 · 不调用工具</span>${b.placement==='market'?`<button class="bot-use-action" data-add-team="${esc(b.id)}">添加到技能库</button>`:'<span class="bot-card-output">已在技能库</span>'}</footer></article>`).join('');
    window.ClownfishIcons.hydrate();
  }
  function inspectBot(id, workflow=false) {
    const b=(workflow?workflows:data.bots).find(item=>item.id===id);
    if(!b)return;
    const contract=workflow?skills.workflow(b):skills.rule(b);
    const facts=[['适用场景',contract.use],['输入材料',contract.input],['处理方法',contract.steps],['交付要求',contract.output],['工具与资料权限',contract.permissions],['限制',contract.limits],['如何核对',contract.check]];
    $('#botInfoContent').innerHTML=`<p class="bot-card-kind">${esc(contract.label)}${!workflow?' · '+(b.enabled?'已启用':'已停用'):''}</p><h2 id="botInfoTitle">${esc(b.name)}</h2><p>${esc(workflow?b.description:library.summary(b))}</p><dl class="bot-info-facts">${facts.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`+(workflow
      ? `<a class="wb-primary-link bot-info-start" href="${esc(b.href)}">准备任务 →</a>`
      : `<details class="skill-original-rules"><summary>查看完整规则 · v${esc(b.revision)}</summary><p class="bot-full-rules">${esc(b.instructions)}</p>${b.template?`<p class="hint">原模板 v${esc(b.template.version)} · 设计参考 ${esc(b.template.source?.name||'本机模板')}${b.revision>1?' · 已编辑的个人版本':''}</p>`:''}</details><div class="team-detail-actions"><button data-use-bot="${esc(b.id)}" class="primary" ${b.enabled?'':'disabled'}>使用规则</button><button data-edit-bot="${esc(b.id)}">编辑规则</button></div>`);
    if(!workflow&&b.placement==='market') {
      $('#botInfoContent .team-detail-actions').innerHTML=`<button class="primary" data-add-team="${esc(b.id)}">添加到技能库</button>`;
    }
    $('#botInfoDialog').showModal();
  }
  $('#botSearch').oninput=renderLibrary;
  $('#clearBotFilters').onclick=()=>{botFilter='all';$('#botSearch').value='';renderLibrary();$('#botSearch').focus();};
  async function api(path = '', body) {
    const res = await fetch('/api/assistant-team' + path, body === undefined ? {} : { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
    const result = await res.json(); if (!res.ok) throw new Error(result.userMessage || '请求未完成，请重试'); return result;
  }
  function toast(message) { $('#teamToast').textContent=message;$('#teamToast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>{$('#teamToast').hidden=true;},4500); }
  function showTaskContent() {
    $('#taskComposer').hidden=!!selected;
    $('#jobDetail').hidden=!selected;
  }
  function tabs(view, historyMode='push') {
    view=view===true?'bots':view===false?'tasks':view;
    $('#teamPageTitle').textContent=view==='tasks'?'任务':'技能库';
    $('#teamPageDescription').textContent=view==='tasks'?'交办一件事，查看进度并验收结果。':'小丑鱼使用的工作方法：复用文字规则，或准备已有执行技能。';
    $('#showTasks').hidden=view!=='tasks';
    $('#taskContextLinks').hidden=view!=='tasks';
    $('#showBots').hidden=view==='tasks';
    $('#showMarket').hidden=view==='tasks';
    for(const [name,id] of [['tasks','Tasks'],['bots','Bots'],['market','Market']]) {
      $('#'+name+'Pane').hidden=view!==name;$('#show'+id).setAttribute('aria-pressed',String(view===name));
    }
    for(const selector of ['.bot-help','#modelStatus','.personal-foot'])$(selector).hidden=view==='market';
    showTaskContent();
    let url=view==='tasks'&&selected?(selected.startsWith('flow:')?'/bots?task='+encodeURIComponent(selected.slice(5)):'/bots?job='+encodeURIComponent(selected)):'/bots?view='+view;
    if(view==='tasks'&&historySpace)url+='&space='+encodeURIComponent(historySpace);
    if(historyMode==='replace')history.replaceState(null,'',url);
    else if(historyMode==='push'&&location.pathname+location.search!==url)history.pushState(null,'',url);
    window.ClownfishNavigation?.sync();

  }
  async function loadTemplates() {
    if(templates.length)return;
    // Compatibility with the running pre-separation service; never displayed as official listings.
    const response=await fetch('/api/assistant-team/templates');
    if(response.status===404)templates=(await api('/market')).templates;
    else {
      if(!response.ok)throw new Error('本机规则资料暂时无法读取');
      templates=(await response.json()).templates;
    }
  }
  const installed = (t) => data.bots.find((b)=>b.template?.id===t.id);
  async function loadFlows(){
    if(Date.now()-flowLoadedAt<15000)return;
    flowLoadedAt=Date.now();
    try{
      const results=await Promise.all(['/api/capabilities','/api/agent/jobs?limit=5000'].map(async url=>{const response=await fetch(url);if(!response.ok)throw new Error('流程记录暂时无法读取');return response.json();}));
      flowSnapshot=results[0];flowJobs=results[1].jobs||[];flowLoadedAt=Date.now();flowWarning='';
    }catch(error){flowWarning='流程记录读取失败，已显示可用记录；保留上次读取结果，稍后重试。';}
  }
  function renderHistory(){
    const items=historyView.filter(historyView.entries(data.jobs,flowSnapshot,flowJobs),{query:$('#taskHistorySearch').value,source:$('#taskHistorySource').value,space:historySpace});
    const groups=historyView.groups(items);
    const jobsHtml=groups.map(group=>`<section class="team-job-group"><h3>${esc(group.title)}<span>${group.jobs.length}</span></h3>${group.jobs.map(j=>`<button class="team-job" data-job="${esc(j.id)}" aria-pressed="${j.id===selected}"><strong>${esc(j.title)}</strong><small>${esc(j.kind)} · ${esc(historyView.statusLabel(j))}</small></button>`).join('')}</section>`).join('') || '<p class="hint">没有匹配的任务，可新建任务或调整筛选。</p>';
    if($('#jobList').innerHTML!==jobsHtml)$('#jobList').innerHTML=jobsHtml;
    $('#historyLoadStatus').textContent=flowWarning+(historySpace?' 当前仅显示所选项目的流程任务。':'');
  }
  $('#taskHistorySearch').oninput=renderHistory;$('#taskHistorySource').onchange=renderHistory;
  $('#toggleTaskHistory').onclick=()=>{
    const open=$('#tasksPane').classList.toggle('history-expanded');
    $('#toggleTaskHistory').setAttribute('aria-expanded',String(open));
    $('#toggleTaskHistory').textContent=open?'收起任务记录':'查看任务记录';
  };
  async function load() {
    if (loading) return; loading=true;
    try {
      const results=await Promise.allSettled([api(),loadFlows()]);
      if(results[0].status==='fulfilled'){data=results[0].value;$('#teamError').textContent='';}
      else {$('#teamError').textContent='文字任务记录读取失败，其他来源仍可查看；保留已有内容。';}
      $('#modelStatus').textContent=data.ready ? '当前模型：'+data.model : '尚未连接模型，请先到设置中保存';
      renderHistory();
      $('#newTask').disabled=false;
      if(!submitting)syncTaskOptions();
      renderLibrary();

      if (selected) await loadDetail();
    } catch(error) { $('#teamError').textContent=error.message; $('#botList').setAttribute('aria-busy','false'); if(!libraryKey)$('#botList').textContent='技能库暂时无法读取，请稍后重试；已有配置未改变。'; }
    finally { loading=false; }
  }
  async function loadDetail() {
    const id=selected;
    if(id.startsWith('flow:')){
      currentJob=undefined;
      const html=historyView.flowDetail(flowSnapshot.tasks?.find(task=>task.id===id.slice(5)),flowSnapshot,flowJobs);
      if(html!==detailKey){window.ClownfishTaskDetail.mount($('#jobDetail'),html,id);detailKey=html;}return;
    }
    const {job}=await api('/job?id='+encodeURIComponent(id)); if(id!==selected) return;
    currentJob=job;const key=JSON.stringify(job); if(key===detailKey) return; detailKey=key;
    window.ClownfishTaskDetail.mount($('#jobDetail'),window.ClownfishTaskDetail.botDetail(job),id);
  }
  function syncTaskOptions() {
    const f=$('#taskForm');
    const key=JSON.stringify([data.model,data.models,data.bots]);
    if(key!==taskOptionsKey){
    const workers=new Set([...f.querySelectorAll('[name=workerIds]:checked')].map(c=>c.value)), reviewer=f.elements.reviewerId.value, model=f.elements.model.value;
    $('#workerOptions').innerHTML=data.bots.filter((b)=>b.placement!=='market'&&b.enabled&&b.role==='worker').map((b)=>`<label class="team-check"><input name="workerIds" type="checkbox" value="${esc(b.id)}">${esc(b.name)}</label>`).join('');
    f.elements.reviewerId.innerHTML='<option value="">不需要额外核验</option>'+data.bots.filter((b)=>b.placement!=='market'&&b.enabled&&b.role==='reviewer').map((b)=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
    f.elements.model.innerHTML=[...new Set([data.model,...data.models])].filter(Boolean).map((m)=>`<option value="${esc(m)}">${esc(m)}</option>`).join('') || '<option value="">请先连接模型</option>';
    for(const c of f.querySelectorAll('[name=workerIds]'))c.checked=workers.has(c.value);
    if([...f.elements.reviewerId.options].some(o=>o.value===reviewer))f.elements.reviewerId.value=reviewer;
    if([...f.elements.model.options].some(o=>o.value===model))f.elements.model.value=model;
    taskOptionsKey=key;
    }
    routingUi.update(data);
    f.querySelector('[type=submit]').disabled=!data.ready||!routingUi.canSubmit();
    $('#taskModelHint').textContent=data.ready?'':'尚未连接模型，请先在“设置 → 模型”中保存连接。';
  }
  function openTask(template, botId) {
    if(submitting){toast('任务正在提交，请稍候');return;}
    $('#botInfoDialog').close();
    const f=$('#taskForm');
    syncTaskOptions();
    selected='';detailKey='';currentJob=undefined;historySpace='';
    const chosen=botId?data.bots.find((b)=>b.id===botId):template&&installed(template);
    if(chosen){$('#manualBotAssignment').open=true;routingUi.manual();}
    if(chosen?.enabled){for(const c of f.querySelectorAll('[name=workerIds]'))c.checked=c.value===chosen.id;if(chosen.role==='reviewer')f.elements.reviewerId.value=chosen.id;}
    if(template){if(!f.elements.objective.value.trim())f.elements.objective.value='请根据本次材料，完成'+template.name+'的工作；缺少的信息列为待确认，不自行补造。';if(!f.elements.requiredFields.value.trim())f.elements.requiredFields.value=template.requiredFields.join('\n');$('#taskExtraOptions').open=true;}
    activeTemplate=template;$('#taskGuide').hidden=!template;$('#taskStarterStatus').textContent='';
    $('#taskGuideTitle').textContent=template?'准备给 '+(chosen?.name || template.name)+' 的资料':'';
    $('#taskGuideInput').textContent=template?'你提供：'+template.input+'。留空的事实请写“未知”。':'';
    $('#taskTitle').textContent=chosen?'使用规则：'+chosen.name:'你想完成什么？';
    tabs('tasks');void load();f.elements.objective.focus();
  }
  function ruleEditorMode(structured) {
    const f=$('#botForm');
    $('#skillRecipeFields').hidden=!structured;$('#skillRawRules').hidden=structured;
    f.elements.instructions.required=!structured;
    for(const field of $('#skillRecipeFields').querySelectorAll('textarea'))field.required=structured;
  }
  function openBot(id) {
    $('#botInfoDialog').close();
    const b=data.bots.find((x)=>x.id===id),f=$('#botForm');f.reset();f.querySelector('.form-error').textContent='';
    for(const k of ['id','revision','name','instructions']) f.elements[k].value=b?.[k] || '';
    f.elements.role.value=b?.role || 'worker';f.elements.enabled.checked=b?.enabled!==false;
    ruleEditorMode(!b);
    $('#botDraftNotice').hidden=true;$('#botTitle').textContent=b?'编辑规则模板':'新建规则模板';$('#botDialog').showModal();
  }
  $('#taskForm').onsubmit=async(event)=>{
    event.preventDefault();if(submitting)return;const f=event.target,b=f.querySelector('[type=submit]');submitting=true;b.disabled=true;
    f.querySelector('.form-error').textContent='';
    const preparation=materialUploads.prepare(), ticket=materialUploads.version(), lockedControls=[];
    try {
      const {materials,token}=await preparation;if(token!==materialUploads.version())return;
      const raw=new FormData(f),body={objective:raw.get('objective'),materials,requiredFields:String(raw.get('requiredFields')).split('\n').map((s)=>s.trim()).filter(Boolean),workerIds:raw.getAll('workerIds'),reviewerId:raw.get('reviewerId'),model:raw.get('model')};
      const assignmentMode=raw.get('assignmentMode');
      if(assignmentMode){body.assignmentMode=assignmentMode;if(assignmentMode!=='manual'){body.workerIds=[];body.reviewerId='';}}
      if(assignmentMode==='planned'){
        if(raw.get('planningConsent')!=='on')throw Error('请先确认自主协作的调用预算');
        body.assignmentMode='auto';body.planningBudget=Number(raw.get('planningBudget'));body.planningConsent=true;
      }
      for(const control of f.querySelectorAll('input,textarea,select,button'))if(!control.disabled){lockedControls.push(control);control.disabled=true;}
      const key=JSON.stringify(body);if(key!==requestBody){requestId=crypto.randomUUID();requestBody=key;}
      const result=await api('/start',{...body,requestId});
      if(token===materialUploads.version()){
        materialUploads.reset();f.reset();taskOptionsKey='';requestId='';requestBody='';activeTemplate=undefined;
        $('#taskGuide').hidden=true;$('#taskTitle').textContent='你想完成什么？';$('#taskExtraOptions').open=false;$('#manualBotAssignment').open=false;
      }
      selected=result.record.id;detailKey='';tabs(false);toast('任务已入队，后台将自动交接与汇总');await load();
    } catch(error){if(ticket===materialUploads.version()&&error.name!=='AbortError')f.querySelector('.form-error').textContent=error.message;}
    finally{for(const control of lockedControls)control.disabled=false;submitting=false;syncTaskOptions();}
  };
  $('#botForm').onsubmit=async(event)=>{
    event.preventDefault();const f=event.target,b=f.querySelector('[type=submit]');b.disabled=true;
    try{
      const raw=new FormData(f);
      const instructions=$('#skillRecipeFields').hidden?String(raw.get('instructions')):skills.compile(Object.fromEntries(skills.fields.map(([key])=>[key,raw.get('recipe'+key[0].toUpperCase()+key.slice(1))])));
      const body={id:raw.get('id'),revision:Number(raw.get('revision')),name:raw.get('name'),role:raw.get('role'),enabled:f.elements.enabled.checked,instructions};
      await api('/bot',body);$('#botDialog').close();toast('规则模板已保存，适用于未来任务');await load();
    }catch(error){f.querySelector('.form-error').textContent=error.message;}finally{b.disabled=false;}
  };
  $('#newTask').disabled=true;
  $('#newTask').onclick=()=>openTask();$('#newBot').onclick=()=>openBot();$('#showTasks').onclick=()=>{tabs(false);void load();};$('#showBots').onclick=()=>tabs(true);$('#showMarket').onclick=()=>tabs('market');

  function fillMaterials(sample){
    if(!activeTemplate)return;const field=$('#taskForm').elements.materials;
    try{field.value=handoff.materialStarter(field.value,activeTemplate,sample);$('#taskStarterStatus').textContent=sample?'已填入合成示例，不是你的个人事实；点击开始处理才会调用模型。':'已填入空白提纲，请用本次资料补充，未知信息不要猜。';field.focus();}
    catch(error){$('#taskStarterStatus').textContent=error.message;}
  }
  $('#fillOutline').onclick=()=>fillMaterials(false);$('#fillExample').onclick=()=>fillMaterials(true);
  async function copyText(value){
    try{await navigator.clipboard.writeText(value);toast('已复制');}
    catch{toast('剪贴板不可用，请选中正文手动复制，或下载完整文本');}
  }
  document.addEventListener('click',async(event)=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.close)return document.getElementById(b.dataset.close).close();
    if(b.dataset.botFilter){botFilter=b.dataset.botFilter;renderLibrary();return;}
    if(b.dataset.inspectBot)return inspectBot(b.dataset.inspectBot);
    if(b.dataset.inspectWorkflow)return inspectBot(b.dataset.inspectWorkflow,true);
    if(b.dataset.addTeam){
      const bot=data.bots.find(x=>x.id===b.dataset.addTeam);if(!bot||bot.placement!=='market')return;
      b.disabled=true;
      try{const result=await api('/bot',{id:bot.id,revision:bot.revision,placement:'team'});data.bots=data.bots.map(x=>x.id===bot.id?result.record:x);renderLibrary();$('#botInfoDialog').close();toast('已添加到技能库，原有规则与启用状态保留');}
      catch(error){toast(error.message);}finally{b.disabled=false;}return;
    }
    if(b.dataset.editBot)return openBot(b.dataset.editBot);
    if(b.dataset.useBot){const bot=data.bots.find((x)=>x.id===b.dataset.useBot);if(!bot?.enabled||bot.placement==='market')return;try{if(bot.template&&!templates.length)await loadTemplates();return openTask(templates.find((t)=>t.id===bot.template?.id),bot.id);}catch(error){toast(error.message);return;}}
    if(b.hasAttribute('data-copy-field')){const field=currentJob?.result?.data?.delivery?.fields[Number(b.dataset.copyField)];if(field)await copyText(field.value);return;}
    if(b.hasAttribute('data-copy-result')){if(currentJob?.result?.data?.delivery)await copyText(handoff.resultText(currentJob.result.data.delivery));return;}
    if(b.hasAttribute('data-download-result')){
      if(!currentJob?.result?.data?.delivery)return;
      const a=document.createElement('a');a.href='/api/assistant-team/export?id='+encodeURIComponent(currentJob.id);
      a.download='小丑鱼-协作结果.txt';document.body.append(a);a.click();a.remove();return;
    }
    if(b.hasAttribute('data-review-bot')){
      try{const draft=handoff.botDraft(currentJob);openBot();ruleEditorMode(false);const f=$('#botForm');f.elements.name.value=draft.name;f.elements.instructions.value=draft.instructions;$('#botTitle').textContent='审阅规则草稿';$('#botDraftNotice').hidden=false;}
      catch(error){toast(error.message);}return;
    }
    if(b.dataset.job){selected=b.dataset.job;detailKey='';$('#jobDetail').textContent='正在读取任务…';$('#tasksPane').classList.remove('history-expanded');$('#toggleTaskHistory').setAttribute('aria-expanded','false');$('#toggleTaskHistory').textContent='查看任务记录';tabs('tasks');await load();}
    if(b.dataset.action){b.disabled=true;try{await api('/'+b.dataset.action,{id:selected});detailKey='';await load();}catch(error){toast(error.message);b.disabled=false;}}
  });
  setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))void load();},2000);
  window.ClownfishIcons.hydrate();
  function restoreLocation(historyMode='none'){
    const params=new URLSearchParams(location.search);selected=params.get('task')?'flow:'+params.get('task'):params.get('job') || '';detailKey='';historySpace=params.get('space')||'';
    currentJob=undefined;$('#jobDetail').textContent=selected?'正在读取任务…':'';
    const view=params.get('view');tabs(selected?'tasks':['bots','market','tasks'].includes(view)?view:'tasks',historyMode);void load();
  }
  window.addEventListener('popstate',()=>restoreLocation());restoreLocation('replace');
})();
