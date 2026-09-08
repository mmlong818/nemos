/* Presentation only: status, results and disclosures never start or retry a task. */
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={queued:'等待处理',running:'正在处理',succeeded:'已交付 · 待审阅',failed:'未完成',cancelled:'已取消',uncertain:'待核对'};
  function notice(state,hasResult){
    if(state==='running'||state==='queued')return hasResult?'本次仍在处理中，下方已有成果不代表本次执行完成。':'任务已入队；处理完成后，交付内容会显示在这里。';
    if(state==='failed')return hasResult?'本次执行未完成。下方已有成果保留，请先检查失败原因。':'本次未能完成交付。已保存的过程仍可查看，请检查原因后再继续。';
    if(state==='cancelled')return '本次执行已取消，已保存的内容仍保留。';
    if(state==='uncertain')return '执行状态需要核对。请先查看处理过程和运行日志，不要重复提交。';
    if(state==='succeeded')return hasResult?'交付已生成，请核对内容与来源。':'执行已结束，但没有可展示的交付内容。请查看处理过程确认。';
    return '查看已有成果与处理过程。';
  }
  function modelState(job){
    if(job.status!=='running')return undefined;
    const state=Array.isArray(job.checkpoints)?job.checkpoints.at(-1)?.data?.modelAdmission?.state:job.modelAdmission;
    return state==='waiting'||state==='active'?state:undefined;
  }
  function modelLabel(job){const state=modelState(job);return state==='waiting'?'等待模型':state==='active'?'模型执行中':undefined;}
  function botDetail(job){
    const admission=modelState(job);
    const resourceLabel=admission==='waiting'?'等待模型':admission==='active'?'模型执行中':undefined;
    const plan=job.payload?.teamPlan||{},delivery=job.result?.data?.delivery;
    const disposition=job.disposition;
    const needsNewTask=disposition?.state==='waiting_input'||disposition?.state==='blocked';
    const dispositionText=disposition?.state==='waiting_input'?`待补充：${disposition.question||'需要更多信息'}`:disposition?.state==='blocked'?`受阻：${disposition.blocker||'当前无法继续'}`:'';
    const receipts=new Map();
    for(const checkpoint of job.checkpoints||[])if(checkpoint.data?.teamReceipt)receipts.set(checkpoint.data.teamReceipt.stageId,checkpoint.data.teamReceipt);
    const returned=[...receipts.values()].filter(r=>r.state==='returned'||r.state==='verified').length;
    const llm=job.llmCallLedgerAssociated===true?job.llmCallSummary:undefined;
    const llmLine=llm?`<p class="hint">模型调用：${esc(llm.calls)} 次 · 已知 Token ${esc(llm.knownUsage?.totalTokens||0)} · 用量未知 ${esc(llm.unknownUsageCalls||0)} 次${llm.byStatus?.interrupted?` · 重启中断 ${esc(llm.byStatus.interrupted)} 次`:''}。仅记录服务商实际返回的用量；不会估算金额。</p>`:'';
    const execution=job.checkpoints?.filter(c=>c.data?.teamExecutionPlan).at(-1)?.data.teamExecutionPlan.plan;
    const used=(job.checkpoints||[]).filter(c=>c.data?.teamBudgetReservation).length;
    const consumed=Math.max(0,...[...receipts.values()].map(r=>Number(r.steeringRevision||0)));
    const steering=(job.steering||[]).map(item=>`<li><strong>${item.mode==='redirect'?'转向新目标':'合并补充'}</strong> · ${item.revision<=consumed?'已纳入Bot阶段':['queued','running'].includes(job.status)?'已接收，等待下一阶段':'未生效（任务已结束）'}<p>${esc(item.text)}</p></li>`).join('');
    const steeringBox=['queued','running'].includes(job.status)?`<section class="team-steering" aria-label="追加任务消息"><h3>补充或转向当前任务</h3><p class="hint">消息在下一个 Bot 阶段边界生效；不会新建任务或重放外部动作。进入最终核验后将拒绝追加。</p><select data-steering-mode aria-label="追加方式"><option value="merge">合并补充</option><option value="redirect">转向新目标</option></select><textarea data-steering-text maxlength="4000" placeholder="写下需要补充或改变的内容"></textarea><button data-steering-send>发给当前任务</button><p data-steering-status role="status"></p></section>`:'';
    const steeringHistory=steering?`<details class="task-detail-disclosure" data-task-disclosure="steering"><summary>追加消息 · ${(job.steering||[]).length}</summary><ol>${steering}</ol></details>`:'';
    const arrangement=plan.executionMode==='planned-text-v1'?`<section aria-label="自主协作安排"><p class="hint">自主文字协作 · 已预留调用 ${used}/${esc(plan.planningBudget||'未记录')} 次（含失败尝试；不是金额上限）</p>${execution?`<details data-task-disclosure="plan"><summary>执行安排 · ${execution.steps.length} 个步骤</summary><ol>${execution.steps.map(step=>{const receipt=receipts.get(step.id);const name=step.executorId==='clownfish'?'小丑鱼':(plan.candidates||plan.workers||[]).find(b=>b.id===step.executorId)?.name||step.executorId;return `<li><strong>${esc(name)}</strong> · ${receipt?.state==='returned'?'已完成':receipt?.state==='failed'?'未完成':receipt?'处理中':'待执行'}<p>${esc(step.objective)}</p><small>交付：${esc(step.output)}</small></li>`;}).join('')}</ol></details>`:'<p class="hint">执行安排尚未生成；开始规划后会显示在这里。</p>'}</section>`:'';
    const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN'):'未记录时间';
    const result=delivery?`<section class="team-result" aria-label="最终交付"><h3>交付结果</h3><p class="task-result-summary">${esc(delivery.summary)}</p><div class="team-detail-actions"><button data-copy-result>复制完整结果</button><button data-download-result>下载文本</button>${job.status==='succeeded'&&(plan.workers||[]).some(b=>b.template?.id==='bot-designer')?'<button data-review-bot>审阅并保存规则</button>':''}</div><dl>${(delivery.fields||[]).map((field,i)=>`<dt><span>${esc(field.label)}</span><button data-copy-field="${i}" aria-label="复制 ${esc(field.label)}">复制正文</button></dt><dd>${esc(field.value)}<small>来源：${esc((field.sources||[]).join('；')||'未提供')}</small></dd>`).join('')}</dl><p class="hint">必填字段与来源格式已检查；内容真实性仍需你审阅。复制单项只包含正文；完整结果和下载文本保留来源。</p></section>`:'';
    return `<header class="team-detail-head"><h2>${esc(plan.objective||job.title||'任务详情')}</h2><span class="personal-state">${esc(resourceLabel||labels[job.status]||job.status)}</span></header>
      <p class="task-status-note" role="status">${esc(dispositionText||(admission==='waiting'?'当前模型连接繁忙，任务正在排队；无需重复提交，可取消等待。':notice(job.status,!!delivery)))}</p>
      ${needsNewTask?'<p class="hint">这个原任务已终止，当前追加入口不能恢复它；请根据上述问题新建任务。</p>':''}
      ${plan.routing?`<p class="team-model">自动分派 · ${esc((plan.routing.matches||[]).map(item=>item.name).join(' → ')||'小丑鱼独立完成')}<br>${esc(plan.routing.reason)}</p>`:''}
      ${llmLine}
      ${job.error?`<p role="alert" class="task-detail-error">${esc(job.error)}</p>`:''}
      <div class="team-detail-actions task-next-actions">${!needsNewTask&&['failed','cancelled'].includes(job.status)?'<button class="primary" data-action="retry">从已保存回执继续</button>':''}${['queued','running'].includes(job.status)?'<button data-action="cancel">取消本次任务</button>':''}${['failed','uncertain'].includes(job.status)?`<a href="/runs#record-job-${encodeURIComponent(job.id)}">查看运行日志</a>`:''}</div>
      ${steeringBox}${steeringHistory}
      ${arrangement}
      ${result}
      <details class="task-detail-disclosure unified-process" data-task-disclosure="process"><summary>处理过程 <span>${returned} 份回执已返回</span></summary><ol class="team-ledger" aria-label="交接记录">${[...receipts.values()].map(r=>`<li class="${esc(r.state)}"><header><strong>${esc(r.botName)} · ${r.state==='verified'?'必填字段与来源结构已核验':r.state==='returned'?(r.verification==='independent-review-returned'?'独立审阅已返回（不等于事实核验）':'已返回成果'):r.state==='executing'?'正在执行':r.state==='failed'?'未完成':'已接收，等待成果'}</strong><time>${esc(time(r.returnedAt||r.receivedAt))}</time></header>${r.output?`<details data-receipt="${esc(r.stageId)}" data-task-disclosure="receipt:${esc(r.stageId)}"><summary>查看回执正文与输入指纹</summary><p class="team-text">${esc(r.output)}</p><p class="hint">输入指纹 ${esc(r.inputHash)}</p></details>`:''}${r.error?`<p class="task-detail-error">${esc(r.error)}</p>`:''}</li>`).join('')||'<li class="hint">尚无回执。</li>'}</ol></details>
      <details class="task-detail-disclosure" data-task-disclosure="context"><summary>任务要求与共享材料</summary><p class="team-model">模型：${esc(plan.model||'未记录')} · 仅共享本次资料 · 工具关闭</p><p class="team-text">${esc(plan.materials||'未附加材料')}</p><p>必填字段：${esc((plan.requiredFields||[]).join('、')||'最终简报')}</p><p class="hint">规则版本：${esc([...(plan.workers||[]),...(plan.reviewer?[plan.reviewer]:[])].map(b=>b.name+' v'+b.revision).join('、')||'小丑鱼独立完成')}</p></details>`;
  }
  function mount(root,html,key){
    // Preserve disclosures only while refreshing the same task, never leak state across tasks.
    const same=root.dataset.detailTask===key;
    const expanded=new Set(same?[...root.querySelectorAll('[data-task-disclosure][open]')].map(n=>n.dataset.taskDisclosure):[]);
    const active=typeof document!=='undefined'?document.activeElement:null;
    const focusKey=same&&root.contains(active)?active.closest('[data-task-disclosure]')?.dataset.taskDisclosure:null;
    root.innerHTML=html;root.dataset.detailTask=key;
    for(const node of root.querySelectorAll('[data-task-disclosure]')){
      node.open=expanded.has(node.dataset.taskDisclosure);
      if(focusKey===node.dataset.taskDisclosure)node.querySelector('summary')?.focus({preventScroll:true});
    }
  }
  window.ClownfishTaskDetail=Object.freeze({botDetail,notice,mount,modelState,modelLabel});
})();
