/* Read-only projection: original task/job IDs and stores are never rewritten. */
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={queued:'等待处理',running:'正在处理',succeeded:'已交付',completed:'已完成',failed:'未完成',cancelled:'已取消',uncertain:'待核对',paused:'已暂停',waiting:'等待中',planned:'未开始',active:'推进中'};
  const statusLabel=job=>window.ClownfishTaskDetail?.modelLabel(job)||labels[job.status]||job.status;
  const time=value=>value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN'):'未记录时间';
  const related=(task,jobs)=>jobs.filter(job=>job.payload?.taskId===task.id || job.metadata?.workTaskId===task.id || job.result?.data?.artifact?.taskId===task.id).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  function entries(botJobs,snapshot,jobs){
    const flows=(snapshot.tasks||[]).map(task=>{
      const runs=related(task,jobs),latest=runs.find(job=>['queued','running'].includes(job.status))||runs[0];
      const status=latest?.status || (task.storyline?.status==='completed'?'succeeded':task.enabled===false?'paused':'planned');
      return {id:'flow:'+task.id,taskId:task.id,title:task.title,status,source:'workflow',spaceId:task.spaceId,updatedAt:latest?.updatedAt||task.updatedAt||task.createdAt||'',kind:task.schedule?.mode && task.schedule.mode!=='manual'?'自动化':'流程任务'};
    });
    return [...botJobs.map(job=>({...job,source:'bot',kind:'文字任务'})),...flows];
  }
  function filter(items,{query='',source='',space=''}={}){
    return items.filter(item=>(!source||item.source===source)&&(!space||item.spaceId===space)&&String(item.title||'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }
  function groups(items){
    const list=[{title:'进行中',jobs:[]},{title:'需要处理',jobs:[]},{title:'待开始与已暂停',jobs:[]},{title:'已结束',jobs:[]}];
    for(const item of [...items].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))){
      const index=['queued','running','active'].includes(item.status)?0:['succeeded','completed','cancelled'].includes(item.status)?3:['planned','paused','waiting'].includes(item.status)?2:1;
      list[index].jobs.push(item);
    }
    return list.filter(group=>group.jobs.length);
  }
  function flowDetail(task,snapshot,jobs){
    if(!task)return '<p role="status">这项流程任务已不可用或尚未读取成功。原始执行日志仍保留在设置的高级入口中。</p>';
    const runs=related(task,jobs),story=task.storyline||{};
    const artifacts=(snapshot.artifacts||[]).filter(item=>item.taskId===task.id||item.id===task.execution?.artifactId);
    const state=entries([], {tasks:[task]},jobs)[0];
    const latest=runs.find(job=>['queued','running'].includes(job.status))||runs[0];
    const needsAttention=['failed','uncertain','cancelled'].includes(state.status);
    const note=window.ClownfishTaskDetail?.notice(state.status,artifacts.length>0)||'';
    const runRows=runs.map(job=>`<li><header><strong>${esc(labels[job.status]||job.status)}</strong><time>${esc(time(job.updatedAt||job.createdAt))}</time></header><p>${esc(job.result?.summary||job.error||'尚未返回结果')}</p>${(job.checkpoints||[]).length?`<details data-task-disclosure="run:${esc(job.id)}"><summary>处理步骤</summary><ul>${job.checkpoints.map(c=>`<li>${esc(c.status||c.name||c.id||'已保存检查点')}</li>`).join('')}</ul></details>`:''}<a href="/runs#record-job-${encodeURIComponent(job.id)}">排错日志</a></li>`).join('');
    return `<header class="team-detail-head"><h2>${esc(task.title)}</h2><span class="personal-state">${esc(labels[state.status]||state.status)}</span></header><p class="team-model">${esc(state.kind)}${state.kind==='自动化'?` · 计划${task.enabled?'已启用':'已暂停'}`:''} · 按原有流程的配置与授权执行</p>${note?`<p class="task-status-note">${esc(note)}</p>`:''}${needsAttention&&latest?.error?`<p role="alert" class="task-detail-error">${esc(latest.error)}</p>`:''}${needsAttention?`<div class="team-detail-actions task-next-actions"><a href="/tasks?legacy=1&task=${encodeURIComponent(task.id)}">检查并管理此流程</a><a href="/runs#record-job-${encodeURIComponent(latest?.id||'')}">查看运行日志</a></div>`:''}${story.summary?`<p>${esc(story.summary)}</p>`:''}${story.nextAction?`<p><strong>下一步：</strong>${esc(story.nextAction)}</p>`:''}<section class="team-result" aria-label="交付成果"><h3>${['queued','running','failed','uncertain'].includes(state.status)&&artifacts.length?'已有成果 · 请结合本次状态核对':'交付成果'}</h3>${artifacts.length?artifacts.map(item=>`<article class="unified-artifact"><strong>${esc(item.title||'任务成果')}</strong><p>${esc(item.summary||'')}</p><div class="team-detail-actions"><a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.id)}" target="_blank" rel="noopener">预览</a><a href="/api/capabilities/artifact?id=${encodeURIComponent(item.id)}" download>下载</a><a href="/office?artifact=${encodeURIComponent(item.id)}">继续编辑</a></div></article>`).join(''):'<p>尚无可用成果。执行完成不一定代表已生成文件，请结合处理过程核对。</p>'}</section><details class="unified-process" data-flow-process data-task-disclosure="process"><summary>处理过程 · ${runs.length} 次执行</summary>${(story.experts||[]).length?`<p>参与分工：${story.experts.map(x=>esc(typeof x==='string'?x:x.name||x.personaId||x.role||'专业检查')).join('、')}</p>`:''}${(story.decisions||[]).length?`<h3>关键决定</h3><ul>${story.decisions.map(d=>`<li>${esc(d.text||d.content||'')} ${esc(d.note||'')}</li>`).join('')}</ul>`:''}${(story.events||[]).length?`<h3>进展记录</h3><ul>${story.events.map(e=>`<li>${esc(e.text||e.summary||'')} · ${esc(time(e.createdAt))}</li>`).join('')}</ul>`:''}<ol class="team-ledger">${runRows||'<li>尚无执行记录。</li>'}</ol><p class="hint">展示最近读取的执行明细；更早的排错记录可从设置中的高级入口查找。</p></details><details class="task-detail-disclosure" data-task-disclosure="context"><summary>任务要求与执行设置</summary><p class="team-text">${esc(task.instruction||'未填写任务要求')}</p><div class="team-detail-actions"><a href="/tasks?legacy=1&task=${encodeURIComponent(task.id)}">管理此流程</a><a href="/collaboration?legacy=1&task=${encodeURIComponent(task.id)}">流程协作设置</a>${state.kind==='自动化'?`<a href="/automations?task=${encodeURIComponent(task.id)}">查看自动化计划</a>`:''}</div></details>`;
  }
  window.ClownfishUnifiedHistory=Object.freeze({entries,filter,groups,flowDetail,labels,related,statusLabel});
})();
