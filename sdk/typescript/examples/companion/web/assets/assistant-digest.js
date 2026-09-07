/* Home context uses local read APIs only; never generates work or sends model requests. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function summary(personal={},team={},review={}){
    const rows=[];
    const count=(review.groups||[]).length||(review.items||[]).length;
    if(count)rows.push({title:count+' 项待确认',detail:'审批、异常或结果核对',href:'/runs'});
    for(const job of (team.jobs||[]).filter(j=>['running','queued','failed','uncertain'].includes(j.status)).slice(0,2))rows.push({title:job.title,detail:({running:'正在处理',queued:'等待处理',failed:'需要检查',uncertain:'结果待核对'})[job.status],href:'/bots?job='+encodeURIComponent(job.id)});
    for(const matter of (personal.matters||[]).filter(m=>!['completed','paused'].includes(m.status)).slice(0,2))rows.push({title:matter.title,detail:matter.nextAction||matter.waitingFor||'继续跟进',href:'/matters'});
    const artifact=(personal.artifacts||[])[0];if(artifact)rows.push({title:artifact.title||'最近成果',detail:'查看交付文件',href:'/artifacts'});
    return rows.slice(0,4);
  }
  window.ClownfishAssistantDigest=Object.freeze({summary});
  if(typeof document==='undefined')return;
  let html='';
  function mount(){const host=document.querySelector('.task-workbench-empty.is-composer-empty');if(host&&!host.querySelector('.assistant-digest')&&html)host.insertAdjacentHTML('beforeend',html);}
  async function load(){
    const reads=await Promise.allSettled(['/api/personal-work','/api/assistant-team','/api/review-queue'].map(async url=>{const response=await fetch(url);if(!response.ok)throw Error('read failed');return response.json();}));
    const rows=summary(...reads.map(result=>result.status==='fulfilled'?result.value:{}));
    html=`<section class="assistant-digest" aria-label="继续工作">${rows.length?`<details><summary>继续工作 · ${rows.length} 项</summary><div>${rows.map(row=>`<a href="${row.href}"><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></a>`).join('')}</div></details>`:'<a href="/bots?view=tasks">交办一项任务 →</a>'}${reads.some(r=>r.status==='rejected')?'<p role="status">部分工作摘要暂时无法读取，可从任务页查看。</p>':''}</section>`;
    mount();
  }
  document.addEventListener('DOMContentLoaded',()=>{const root=document.getElementById('msgs');if(root)new MutationObserver(mount).observe(root,{childList:true,subtree:true});void load();});
})();
