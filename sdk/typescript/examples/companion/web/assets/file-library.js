/* Unified read-only index; original stores, documents and artifact IDs stay unchanged. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function entries(artifacts,documents,knowledge){
    return [
      ...artifacts.map(x=>({id:x.id,key:'artifact:'+x.id,kind:'artifact',label:'生成成果',title:x.title||'未命名成果',summary:x.summary||'',format:x.format||'',date:x.createdAt,taskId:x.taskId,raw:x})),
      ...documents.map(x=>({id:x.id,key:'document:'+x.id,kind:'document',label:x.originArtifactId?'编辑副本':'本机文件',title:x.name||'未命名文件',summary:x.originArtifactId?'来自任务成果的工作副本':'保存在文件工作台',format:x.kind||'',date:x.updatedAt||x.createdAt,raw:x})),
      ...knowledge.filter(x=>!x.archivedAt).map(x=>({id:x.id,key:'resource:'+x.id,kind:'resource',label:'参考资料',title:x.title||'未命名资料',summary:x.excerpt||'',format:x.kind||'',date:x.updatedAt||x.createdAt,raw:x}))
    ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  }
  function filter(items,{kind='',query=''}={}){
    const q=query.trim().toLocaleLowerCase();
    return items.filter(x=>(!kind||x.kind===kind)&&(!q||[x.title,x.summary,x.format].join(' ').toLocaleLowerCase().includes(q)));
  }
  function row(item){
    let actions='';
    if(item.kind==='artifact')actions=`<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.id)}" target="_blank" rel="noopener">预览</a><a href="/office?artifact=${encodeURIComponent(item.id)}">编辑副本</a><a href="/api/capabilities/artifact?id=${encodeURIComponent(item.id)}" download>下载</a>${item.taskId?`<a href="/bots?task=${encodeURIComponent(item.taskId)}">来源任务</a>`:''}<details class="file-row-more"><summary>更多</summary><button data-feedback-useful="${esc(item.id)}">有帮助</button><button data-feedback-improve="${esc(item.id)}">需改进</button>${item.raw.metadata?.lineage?.previousArtifactId?`<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.raw.metadata.lineage.previousArtifactId)}" target="_blank" rel="noopener">上一版</a>`:''}</details>`;
    else if(item.kind==='document')actions=`<a href="/office?document=${encodeURIComponent(item.id)}">打开编辑</a>${item.raw.originArtifactId?`<a href="/api/capabilities/artifact/preview?id=${encodeURIComponent(item.raw.originArtifactId)}" target="_blank" rel="noopener">原始成果</a>`:''}`;
    else actions=`<button data-preview-resource="${esc(item.id)}">查看资料</button><a href="/resources">管理资料</a>`;
    const timestamp=item.date&&Number.isFinite(Date.parse(item.date))?new Date(item.date).toLocaleDateString('zh-CN'):'未记录时间';
    return `<article class="file-library-row"><div class="file-row-icon" aria-hidden="true">▧</div><div class="file-row-copy"><h2>${esc(item.title)}</h2><p>${esc(item.label)} · ${esc(item.format)} · ${esc(timestamp)}</p>${item.summary?`<p class="file-row-summary">${esc(item.summary)}</p>`:''}</div><div class="file-row-actions">${actions}</div></article>`;
  }
  function mount({root,artifacts=[],documents=[],knowledge=[],warnings=[],onPreview}){
    const all=entries(artifacts,documents,knowledge), params=new URLSearchParams(location.search);
    let kind=['artifact','document','resource'].includes(params.get('kind'))?params.get('kind'):'',query=params.get('q')||'';
    root.innerHTML=`<div class="file-library-toolbar"><label class="file-library-search">搜索文件<input id="fileLibrarySearch" type="search" placeholder="文件名称或内容摘要…" value="${esc(query)}"></label><div class="file-library-create"><a href="/resources?create=1">添加资料</a><a href="/office">打开或新建文件</a><a class="wb-primary-link" href="/capabilities?bot=document">让助理制作文档</a></div></div><nav class="product-section-nav" aria-label="文件类型">${[['','全部'],['artifact','生成成果'],['document','本机文件'],['resource','参考资料']].map(([value,label])=>`<button data-file-kind="${value}" aria-pressed="${value===kind}">${label}</button>`).join('')}</nav><p class="form-error" role="status">${warnings.map(esc).join('；')}</p><div id="fileLibraryRows"></div><p class="hint">资料和成果保留各自来源；编辑副本不会被当作原始文件覆盖。</p>`;
    function render(updateUrl=false){
      const rows=filter(all,{kind,query});root.querySelector('#fileLibraryRows').innerHTML=rows.map(row).join('')||`<section class="product-empty"><h2>${all.length?'没有匹配的文件':'从第一份资料或成果开始'}</h2><p>${all.length?'调整关键词或类型筛选。':'添加需要处理的资料，或让助理制作一份文档。已有原件和历史版本不会被删除。'}</p></section>`;
      root.querySelectorAll('[data-file-kind]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fileKind===kind)));
      if(updateUrl){const next=new URL(location.href);if(kind)next.searchParams.set('kind',kind);else next.searchParams.delete('kind');if(query)next.searchParams.set('q',query);else next.searchParams.delete('q');history.replaceState(null,'',next.pathname+next.search+next.hash);}
    }
    root.querySelector('#fileLibrarySearch').oninput=event=>{query=event.target.value;render(true);};
    root.addEventListener('click',event=>{const button=event.target.closest('[data-file-kind]');if(button){kind=button.dataset.fileKind;render(true);}const preview=event.target.closest('[data-preview-resource]');if(preview)onPreview?.(preview.dataset.previewResource);});
    render();
  }
  window.ClownfishFileLibrary=Object.freeze({entries,filter,row,mount});
})();
