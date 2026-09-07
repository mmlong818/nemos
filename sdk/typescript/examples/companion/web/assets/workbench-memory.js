/* Uses only existing memory APIs; no synthetic permissions or client-only deletion. */
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected='',query='',category='';
  const learningView=()=>new URLSearchParams(location.search).get('view')==='learning';
  const kindName={preference:'稳定偏好',decision:'已确认决定',constraint:'长期约束'};
  const stateName={pending:'待你确认',accepting:'确认待恢复',confirmed:'已记住',rejected:'不学习',revoking:'撤回待恢复',revoked:'已撤回'};
  const personal=(path='',body)=>fetch('/api/personal-work'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined).then(async r=>{const payload=await r.json();if(!r.ok)throw new Error(payload.userMessage||payload.error||'操作未完成，请重试');return payload;});
  /* 待确认：学习提议列表。只有用户确认的内容才进入长期记忆；确认/不学习/撤回均需明确确认。 */
  async function renderLearning({reload}){
    const root=document.getElementById('content');
    root.innerHTML='<p id="wbLearningStatus" role="status">正在读取待确认内容…</p>';
    let proposals=[];
    try{proposals=(await personal()).proposals||[];}
    catch(error){root.innerHTML=`<p role="alert">${esc(error.message)} <button id="wbLearningRetry">重新读取</button></p>`;root.querySelector('#wbLearningRetry').onclick=()=>renderLearning({reload});return;}
    const open=proposals.filter(p=>['pending','accepting'].includes(p.state)),settled=proposals.filter(p=>!['pending','accepting'].includes(p.state));
    const card=p=>`<article class="wb-learning-item" data-state="${esc(p.state)}"><header><span>${esc(kindName[p.kind]||p.kind)}</span><span class="wb-learning-state">${esc(stateName[p.state]||p.state)}</span></header><p class="wb-learning-content">${esc(p.content)}</p><p class="wb-learning-source">来源：${esc(p.source?.excerpt||'手动提议')}</p><div class="wb-memory-actions">${['pending','accepting'].includes(p.state)?`<button class="primary" data-decision="confirm" data-id="${esc(p.id)}" data-revision="${p.revision}">确认记住</button>${p.state==='pending'?`<button data-decision="reject" data-id="${esc(p.id)}" data-revision="${p.revision}">不学习这条</button>`:''}`:['confirmed','revoking'].includes(p.state)?`<button data-decision="revoke" data-id="${esc(p.id)}" data-revision="${p.revision}">撤回学习</button><a href="/memory">在已记住中查看</a>`:''}</div></article>`;
    root.innerHTML=`<div class="wb-learning-head"><p>这里是小丑鱼提议记住、但还没成为长期记忆的内容。只有你确认的内容才会进入「已记住」。</p><button class="primary" id="wbNewLearning" type="button">＋ 提议记住</button></div><p id="wbLearningStatus" role="status">${open.length} 条待确认 · ${settled.length} 条已处理</p><section aria-label="待确认" id="wbLearningOpen">${open.map(card).join('')||'<div class="wb-memory-empty"><h2>没有等待确认的内容</h2><p>在「事项」里从一件已完成的事提议记住，或在这里手动添加一条稳定偏好。</p></div>'}</section>${settled.length?`<details class="wb-learning-settled"><summary>已处理 ${settled.length} 条</summary>${settled.map(card).join('')}</details>`:''}`;
    root.querySelector('#wbNewLearning').onclick=()=>openProposal({reload});
    root.onclick=async e=>{
      const b=e.target.closest('[data-decision]');if(!b)return;
      const action=b.dataset.decision;
      if(!confirm(action==='confirm'?'确认这条内容真实属于你，并同意作为长期记忆使用？':action==='revoke'?'撤回后这条记忆将不再作为当前事实使用，处理记录仍会保留。':'不将这条提议写入长期记忆？'))return;
      b.disabled=true;document.getElementById('wbLearningStatus').textContent=action==='confirm'?'正在写入长期记忆…':'正在更新…';
      try{await personal('/decision',{id:b.dataset.id,revision:Number(b.dataset.revision),action,confirmed:true});await renderLearning({reload});}
      catch(error){document.getElementById('wbLearningStatus').textContent=error.message;b.disabled=false;}
    };
  }
  function openProposal({reload}){
    const dialog=document.createElement('dialog');dialog.className='wb-search-dialog';dialog.setAttribute('aria-labelledby','wbProposalTitle');
    dialog.innerHTML=`<form id="wbProposalForm"><header><h2 id="wbProposalTitle">提议记住</h2><button type="button" data-cancel aria-label="关闭">×</button></header><label>内容类型<select name="kind"><option value="preference">稳定偏好</option><option value="decision">已确认的决定</option><option value="constraint">长期约束</option></select></label><label>希望小丑鱼记住什么<textarea name="content" required maxlength="1000" rows="4" placeholder="例如：用户偏好先看结论，再看简短依据"></textarea></label><label>来源说明<textarea name="excerpt" maxlength="1500" rows="2" placeholder="记录它来自哪次决定或完成结果"></textarea></label><p class="wb-muted">提交后仍是待确认，不会立即变成长期记忆。不要把第三方材料或临时测试当作你的偏好。</p><p role="alert"></p><div class="wb-memory-actions"><button type="button" data-cancel>取消</button><button class="primary" type="submit">加入待确认</button></div></form>`;
    dialog.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target.elements,submit=e.target.querySelector('[type=submit]');submit.disabled=true;try{await personal('/learning',{kind:f.kind.value,content:f.content.value.trim(),source:{excerpt:f.excerpt.value.trim()}});dialog.close();await renderLearning({reload});}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}finally{submit.disabled=false;}};
    document.body.append(dialog);dialog.showModal();dialog.querySelector('textarea').focus();
  }
  function render(options){
    if(learningView())return renderLearning(options);
    return renderMemories(options);
  }
  function renderMemories({items,layers,openDetail,api,reload}){
    const root=document.getElementById('content');
    root.innerHTML=`<div class="wb-memory-toolbar"><label>搜索记忆<input id="wbMemorySearch" type="search" placeholder="搜索内容或所属助理…" value="${esc(query)}"></label><label>分类<select id="wbMemoryType"><option value="">全部记忆</option>${Object.entries(layers).map(([key,name])=>`<option value="${key}"${category===key?' selected':''}>${name}</option>`).join('')}</select></label></div><p id="wbMemoryStatus" role="status"></p><div class="wb-memory-layout"><section aria-label="记忆列表" id="wbMemoryRows"></section><aside aria-label="记忆详情" id="wbMemoryDetail"></aside></div><details class="wb-memory-add"><summary>＋ 记住一项习惯</summary><form id="memoryForm"><label for="memoryPreference">希望小丑鱼记住什么</label><textarea id="memoryPreference" required maxlength="500" placeholder="例如：正式文档先给结论，再展开依据。"></textarea><p>保存到真实记忆库；不要填写临时测试材料或密钥。</p><button class="primary" type="submit">记住这项习惯</button></form></details><p class="wb-memory-note">这里展示真实的记忆与现有来源。修正会保留原始来源；忘记不会删除聊天记录。当前尚不支持逐条停用或删除撤销。</p>`;
    const add=root.querySelector('.wb-memory-add'),layout=root.querySelector('.wb-memory-layout');layout.before(add);add.open=items.length===0;layout.hidden=items.length===0;
    const rows=document.getElementById('wbMemoryRows'),detail=document.getElementById('wbMemoryDetail'),status=document.getElementById('wbMemoryStatus');
    function draw(){
      const list=items.filter(m=>(!category||m.layer===category)&&(m.content+' '+m.who).toLowerCase().includes(query.toLowerCase()));
      if(!list.some(m=>m.id===selected))selected=list[0]?.id||'';
      status.textContent=`${list.length} 条记忆 · 共 ${items.length} 条`;
      rows.innerHTML=list.length?list.map(m=>`<button class="wb-memory-row" data-memory-select="${esc(m.id)}" aria-pressed="${selected===m.id}"><strong>${esc(m.content)}</strong><small>${esc(layers[m.layer]||m.layer)} · ${esc(m.who||'主助理')}</small></button>`).join(''):`<div class="wb-memory-empty"><h2>${items.length?'没有匹配的记忆':'小丑鱼还没有记住这些事'}</h2><p>${items.length?'换个关键词，或清空筛选。':'从对话开始，或在下方明确记录一项习惯。'}</p>${items.length?'<button id="wbClearMemory">清空筛选</button>':'<a href="/">回到助理工作区 →</a>'}</div>`;
      const m=list.find(m=>m.id===selected);
      detail.innerHTML=m?`<span class="wb-muted">${esc(layers[m.layer]||m.layer)}</span><h2>${esc(m.content)}</h2><dl><dt>所属助理</dt><dd>${esc(m.who||'未提供')}</dd><dt>来源摘录</dt><dd>${esc(m.source?.excerpt||'没有找到对应的消息片段；不能据此认定来源已核验。')}</dd><dt>来源类型</dt><dd>${m.source?.kind==='confirmed-learning'?'用户确认的学习，摘录由用户填写或确认':m.source?.sourceMessageId?'关联原始消息':'未提供可定位的消息标识'}</dd><dt>记录时间</dt><dd>${esc(m.created?new Date(m.created).toLocaleString('zh-CN'):'未提供')}</dd></dl><div class="wb-memory-actions"><button data-memory-detail="${esc(m.id)}">${m.correctable?'查看与修正':'查看来源详情'}</button><button class="danger" data-memory-forget="${esc(m.id)}">忘记</button></div><p>不会把这条记忆自动共享给 Bot 团队。</p>`:'<p class="wb-muted">选择一条记忆，查看来源和可用操作。</p>';
      // The API's `who` identifies the memory subject, not necessarily an assistant.
      if(detail.querySelector('dt'))detail.querySelector('dt').textContent='记录主体';
      const clear=document.getElementById('wbClearMemory');if(clear)clear.onclick=()=>{query='';category='';document.getElementById('wbMemorySearch').value='';document.getElementById('wbMemoryType').value='';draw();};
    }
    document.getElementById('wbMemorySearch').oninput=e=>{query=e.target.value;draw();};document.getElementById('wbMemoryType').onchange=e=>{category=e.target.value;draw();};
    rows.onclick=e=>{const b=e.target.closest('[data-memory-select]');if(b){selected=b.dataset.memorySelect;draw();}};
    detail.onclick=e=>{const open=e.target.closest('[data-memory-detail]'),forget=e.target.closest('[data-memory-forget]');if(open){const m=items.find(m=>m.id===open.dataset.memoryDetail);if(m)openDetail(m);}if(forget)confirmForget(items.find(m=>m.id===forget.dataset.memoryForget));};
    function confirmForget(m){
      if(!m)return;
      const dialog=document.createElement('dialog');dialog.className='wb-search-dialog';dialog.setAttribute('aria-label','确认忘记记忆');
      dialog.innerHTML=`<h2>忘记这条记忆？</h2><p>${esc(m.content)}</p><p>聊天记录不会删除。本次操作无法在界面中撤销。</p><p role="alert"></p><div class="wb-memory-actions"><button data-cancel>取消</button><button class="danger" data-confirm>确认忘记</button></div>`;
      const confirm=dialog.querySelector('[data-confirm]');let saving=false;
      dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());
      confirm.onclick=async()=>{saving=true;confirm.disabled=true;dialog.querySelector('[data-cancel]').disabled=true;try{await api('/api/memory/forget',{method:'POST',body:JSON.stringify({id:m.id})});dialog.close();await reload();}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}finally{saving=false;confirm.disabled=false;dialog.querySelector('[data-cancel]').disabled=false;}};
      document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').focus();
    }
    document.getElementById('memoryForm').onsubmit=async e=>{e.preventDefault();const input=document.getElementById('memoryPreference'),button=e.target.querySelector('button'),content=input.value.trim();if(!content)return;button.disabled=true;try{await api('/api/memory/preference',{method:'POST',body:JSON.stringify({content})});query='';category='';await reload();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
    draw();
  }
  window.ClownfishWorkbenchMemory=Object.freeze({render});
})();
