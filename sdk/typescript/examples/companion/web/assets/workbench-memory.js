/* Uses only existing memory APIs; no synthetic permissions or client-only deletion. */
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected='',query='',category='';
  function render({items,layers,openDetail,api,reload}){
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
