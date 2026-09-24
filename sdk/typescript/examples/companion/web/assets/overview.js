(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function load(){
    const status=document.getElementById('overviewStatus');status.textContent='正在读取本机记录…';
    try{
      const response=await fetch('/api/personal-work');if(!response.ok)throw new Error('读取失败');const data=await response.json();
      const active=data.matters.filter(m=>m.status!=='completed').slice(0,5);
      const states={active:'推进中',waiting:'等待中',paused:'已暂停'};
      document.getElementById('overviewMatters').innerHTML=active.length?active.map(m=>`<article class="wb-overview-item"><small>${esc(states[m.status]||m.status)}</small><h3>${esc(m.title)}</h3><p>${esc(m.status==='waiting'?m.waitingFor:m.nextAction||m.goal)}</p><a href="/matters">查看与更新进展 →</a></article>`).join(''):'<div class="wb-overview-empty"><h3>从一件你在意的事开始</h3><p>写下目标和下一步，重要的事就有了接续的位置。</p><a href="/matters?new=1">创建第一件事项 →</a></div>';
      document.getElementById('overviewArtifacts').innerHTML=data.artifacts.slice(0,5).map(a=>`<a class="wb-artifact-link" href="/office?artifact=${encodeURIComponent(a.id)}"><span>▧</span><strong>${esc(a.title||'未命名成果')}</strong><small>打开编辑 →</small></a>`).join('')||'<p class="wb-muted">还没有成果。完成任务后的交付物会保留在这里。</p>';
      status.textContent='已读取本机记录';
      loadWidgets();
    }catch{status.innerHTML='暂时无法读取记录，已有数据未改变。<button id="overviewRetry">重新读取</button>';document.getElementById('overviewRetry').onclick=load;}
  }
  // 钉住的构件：在这里直接用，状态和聊天里是同一份。只读已有产物，不调用模型。
  let widgetKey='';
  async function loadWidgets(){
    try{
      const response=await fetch('/api/capabilities/widget/pinned');if(!response.ok)return;const {widgets=[]}=await response.json();
      const key=widgets.map(w=>w.id).join('|');if(key===widgetKey)return;widgetKey=key;
      const section=document.getElementById('overviewWidgets'),list=document.getElementById('overviewWidgetList');
      section.hidden=!widgets.length;list.innerHTML='';
      for(const w of widgets){
        const card=document.createElement('article');card.className='wb-widget-card';
        card.innerHTML='<header><h3>'+esc(w.title||'构件')+'</h3><button type="button" data-unpin="'+esc(w.id)+'">取消钉住</button></header>';
        list.appendChild(card);window.ClownfishWidgetHost&&window.ClownfishWidgetHost.mount(card,w.id,{title:w.title,maxHeight:520});
      }
    }catch{}
  }
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-unpin]');if(!b)return;b.disabled=true;await fetch('/api/capabilities/widget/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.unpin,pinned:false})}).catch(()=>{});widgetKey='';loadWidgets();});
  // 动态：看页面只读取已有内容；点「生成」才联网和调用模型。
  let feedData=null,feedState={editing:false,generating:false};
  function renderFeed(){if(feedData&&window.ClownfishFeed)window.ClownfishFeed.render(document.getElementById('overviewFeedBody'),feedData,feedState);}
  async function loadFeed(){try{const r=await fetch('/api/feed');if(!r.ok)throw 0;feedData=await r.json();renderFeed();}catch{document.getElementById('overviewFeedBody').innerHTML='<p class="wb-muted">动态暂时读不到。</p>';}}
  async function feedPost(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.error||'操作没完成');return p;}
  document.getElementById('overviewFeedBody').addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-feed-edit')){feedState.editing=true;renderFeed();document.getElementById('feedPromptInput').focus();return;}
    if(b.hasAttribute('data-feed-more')){feedState.showAll=true;renderFeed();return;}
    if(b.hasAttribute('data-feed-cancel')){feedState.editing=false;renderFeed();return;}
    if(b.hasAttribute('data-feed-save')){b.disabled=true;try{feedData.prompt=(await feedPost('/api/feed/prompt',{prompt:document.getElementById('feedPromptInput').value})).prompt;feedState.editing=false;}catch(err){alert(err.message);}renderFeed();return;}
    if(b.hasAttribute('data-feed-generate')){feedState.generating=true;renderFeed();try{await feedPost('/api/feed/generate');}catch(err){alert(err.message);}feedState.generating=false;await loadFeed();return;}
    if(b.dataset.feedLike){const liked=b.getAttribute('aria-pressed')!=='true';b.disabled=true;try{await feedPost('/api/feed/like',{id:b.dataset.feedLike,liked});const p=feedData.posts.find(x=>x.id===b.dataset.feedLike);if(p)p.liked=liked;}catch{}renderFeed();}
  });
  loadFeed();
  load();
})();
