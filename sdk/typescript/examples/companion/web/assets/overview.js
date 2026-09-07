(() => {
  // The assistant is the default home; keep the original overview address compatible.
  if(new URLSearchParams(location.search).get('legacy')!=='1'){location.replace('/');return;}
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function load(){
    const status=document.getElementById('overviewStatus');status.textContent='正在读取本机记录…';
    try{
      const response=await fetch('/api/personal-work');if(!response.ok)throw new Error('读取失败');const data=await response.json();
      const active=data.matters.filter(m=>m.status!=='completed').slice(0,5);
      const states={active:'推进中',waiting:'等待中',paused:'已暂停'};
      document.getElementById('overviewMatters').innerHTML=active.length?active.map(m=>`<article class="wb-overview-item"><small>${esc(states[m.status]||m.status)}</small><h3>${esc(m.title)}</h3><p>${esc(m.status==='waiting'?m.waitingFor:m.nextAction||m.goal)}</p><a href="/matters">查看与更新进展 →</a></article>`).join(''):'<div class="wb-overview-empty"><h3>从一件你在意的事开始</h3><p>写下目标和下一步，重要的事就有了接续的位置。</p><a href="/matters">创建第一件事项 →</a></div>';
      document.getElementById('overviewArtifacts').innerHTML=data.artifacts.slice(0,5).map(a=>`<a class="wb-artifact-link" href="/office?artifact=${encodeURIComponent(a.id)}"><span>▧</span><strong>${esc(a.title||'未命名成果')}</strong><small>打开编辑 →</small></a>`).join('')||'<p class="wb-muted">还没有成果。完成任务后的交付物会保留在这里。</p>';
      status.textContent='已读取本机记录';
    }catch{status.innerHTML='暂时无法读取记录，已有数据未改变。<button id="overviewRetry">重新读取</button>';document.getElementById('overviewRetry').onclick=load;}
  }
  load();
})();
