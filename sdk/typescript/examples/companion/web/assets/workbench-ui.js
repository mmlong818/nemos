/* Move existing controls; never replace their handlers or reproduce private state. */
(() => {
  const $=s=>document.querySelector(s), body=document.body;
  function loadPreferences(){try{const root=document.documentElement;root.dataset.wbColor=['teal','coral','blue','violet'].includes(localStorage.getItem('clownfish-workbench-color'))?localStorage.getItem('clownfish-workbench-color'):'teal';root.dataset.wbDensity=localStorage.getItem('clownfish-workbench-density')==='compact'?'compact':'comfortable';root.dataset.wbMotion=localStorage.getItem('clownfish-workbench-motion')==='reduced'?'reduced':'full';}catch{document.documentElement.dataset.wbColor='teal';document.documentElement.dataset.wbDensity='comfortable';document.documentElement.dataset.wbMotion='full';}}
  loadPreferences();window.addEventListener('storage',event=>{if(['clownfish-workbench-color','clownfish-workbench-density','clownfish-workbench-motion'].includes(event.key))loadPreferences();});
  const actions=$('#wbPageActions'), nav=$('#wbNavigation'), menu=$('#wbMenu');
  const product=window.ClownfishProductStructure;
  product?.organizeNavigation(nav);
  // Remove the obsolete breadcrumb emitted by an already-running server.
  $('#wbPageTitle')?.parentElement.remove();
  const botNav=$('#railBots');if(botNav)botNav.href='/bots?view=tasks';
  for(const path of ['/tasks','/collaboration','/runs']){const link=nav.querySelector('[data-wb-path="'+path+'"]');if(link)link.hidden=true;}
  // Full-document navigation must preserve the rail independently of page content.
  const navScroll=nav.querySelector('nav'), navTools=nav.querySelector('.wb-tools');
  const navStateKey='clownfish-workbench-navigation';
  function readNavState(){
    try{const state=JSON.parse(sessionStorage.getItem(navStateKey)||'null');return state&&typeof state.open==='boolean'&&Number.isFinite(state.scroll)&&state.scroll>=0?state:null;}catch{return null;}
  }
  function restoreNavState(){
    const state=readNavState();if(!state)return;
    navTools.open=state.open;
    if(navScroll.clientHeight)navScroll.scrollTop=state.scroll;
  }
  function saveNavState(){
    // A closed mobile menu has zero dimensions; do not erase its last scroll offset.
    if(!navScroll.clientHeight)return;
    try{sessionStorage.setItem(navStateKey,JSON.stringify({open:navTools.open,scroll:navScroll.scrollTop}));}catch{}
  }
  restoreNavState();
  navScroll.addEventListener('scroll',saveNavState,{passive:true});
  navTools.addEventListener('toggle',saveNavState);
  window.addEventListener('pagehide',saveNavState);
  window.addEventListener('pageshow',restoreNavState);
  nav.addEventListener('click',e=>{if(e.target.closest('a'))saveNavState();},true);
  const routes=JSON.parse($('#app-route-manifest').textContent);
  // Presentation compatibility for a running server that has not reloaded route titles yet.
  const updatedTitles={'/capabilities':'工具与连接','/collaboration':'流程协作设置','/tasks':'流程管理','/bots':'任务工作区','/runs':'运行日志'};
  for(const route of routes){
    if(!updatedTitles[route.path] || route.title===updatedTitles[route.path])continue;
    route.title=updatedTitles[route.path];
    const link=nav.querySelector('[data-wb-path="'+route.path+'"]');
    if(!product&&link?.childNodes)for(const node of link.childNodes)if(node.nodeType===3)node.textContent=route.title;
  }
  const current=()=>{let path=location.pathname.replace(/\/$/,'').replace(/\.html$/,'')||'/';if(path==='/index')path='/';if(path==='/work')path='/tasks';return routes.find(r=>r.path===path);};
  function sync(){
    const route=current();if(!route)return;
    const areaTitle=product?.items.find(item=>item.key===product.area(location.pathname,location.search))?.label;
    document.title=(areaTitle||route.title)+' · 小丑鱼';
    body.dataset.wbRoute=route.path;
    if(product)body.dataset.productArea=product.area(location.pathname,location.search);
    const activePath=route.path==='/runs'?'/settings':['/tasks','/collaboration'].includes(route.path)?'/bots':route.path;
    nav.querySelectorAll('[data-wb-path]').forEach(a=>{const active=product?a.dataset.productKey===product.area(location.pathname,location.search):a.dataset.wbPath===activePath;if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(product)document.querySelectorAll('.wb-tabbar [data-tab-key]').forEach(a=>{if(a.dataset.tabKey===product.area(location.pathname,location.search))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  }
  // 手机上的底部标签栏（窄屏才显示）：常去的四页一点就到，"更多"打开完整导航。
  // 聊天页会把顶栏连同 ☰ 一起藏起来，手机上原来进了聊天就去不了别的页面。
  const TABBAR_KEYS=['assistant','overview','matters','tasks'];
  // 内联图标：不是每个页面都加载 app-icons.js，标签栏不能依赖它。
  const TABBAR_ICONS={
    assistant:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    overview:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    matters:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    tasks:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    more:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const tabbarIcon=key=>'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+TABBAR_ICONS[key]+'</svg>';
  if(product){
    const bar=document.createElement('nav');bar.className='wb-tabbar';bar.setAttribute('aria-label','常用页面');
    for(const key of TABBAR_KEYS){
      const item=product.items.find(entry=>entry.key===key);if(!item)continue;
      const link=document.createElement('a');link.href=item.href;link.dataset.tabKey=key;
      link.innerHTML=tabbarIcon(key)+'<b></b>';link.querySelector('b').textContent=item.label;bar.append(link);
    }
    const more=document.createElement('button');more.type='button';more.className='wb-tabbar-more';more.setAttribute('aria-controls','wbNavigation');
    more.innerHTML=tabbarIcon('more')+'<b>更多</b>';
    more.onclick=event=>{event.stopPropagation();menu.click();};
    bar.append(more);body.append(bar);
  }
  function closeNav(){body.classList.remove('wb-nav-open');menu.setAttribute('aria-expanded','false');}
  menu.onclick=()=>{saveNavState();const open=body.classList.toggle('wb-nav-open');menu.setAttribute('aria-expanded',String(open));if(open)restoreNavState();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeNav();});
  document.addEventListener('click',e=>{if(body.classList.contains('wb-nav-open')&&!nav.contains(e.target)&&!menu.contains(e.target))closeNav();});
  nav.addEventListener('click',e=>{if(e.target.closest('a'))closeNav();});
  const main=document.querySelector('.app-shell>main,.personal-shell>main');
  if(main){main.id=main.id||'wbMain';main.tabIndex=-1;const skip=document.createElement('a');skip.className='wb-skip';skip.href='#'+main.id;skip.textContent='跳到主要内容';body.prepend(skip);}

  function panel(node,label){
    if(!node)return;
    const dialog=document.createElement('dialog');dialog.className='wb-panel-dialog';dialog.setAttribute('aria-label',label);
    const head=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent=label;close.textContent='关闭';close.type='button';head.append(title,close);dialog.append(head,node);body.append(dialog);
    const trigger=document.createElement('button');trigger.type='button';trigger.textContent=label;trigger.setAttribute('aria-haspopup','dialog');actions.append(trigger);
    trigger.onclick=()=>dialog.showModal();close.onclick=()=>dialog.close();
    // Existing detail modals must not be visually covered by this drawer.
    dialog.addEventListener('click',e=>{if(e.target.closest('#quickGroup,#sidebarSearchToggle,.contact-item,[data-conversation-id],[data-conversation-key]'))dialog.close();});
    return dialog;
  }
  panel($('#sessionPane'),'对话记录');
  if($('#quickGroup')){const create=document.createElement('button');create.type='button';create.textContent='新对话';create.onclick=()=>$('#quickGroup').click();actions.append(create);}
  panel($('.capability-panel'),'流程与工具记录');
  panel($('#studio'),'本机状态');
  const workSidebar=$('.work-sidebar');
  if(workSidebar){
    const localActions=$('#workLocalActions');
    for(const id of ['workSearchToggle','newTaskSide']){const node=document.getElementById(id);if(node)(localActions||actions).append(node);}
    workSidebar.hidden=true;
  }
  if(body.dataset.wbRoute==='/bots'){
    const intro=$('.market-intro');if(intro){const details=document.createElement('details');details.className='wb-market-notes';const summary=document.createElement('summary');summary.textContent='目录来源与使用边界';details.append(summary);while(intro.firstChild)details.append(intro.firstChild);intro.replaceWith(details);$('#marketPane').append(details);}
  }
  if(body.dataset.wbRoute==='/' && actions){
    const composer=document.querySelector('#composer');
    if(composer){
      const strip=document.createElement('div');strip.className='home-utility-strip';strip.setAttribute('aria-label','工作区快捷入口');
      const label=document.createElement('span');label.className='home-utility-label';label.textContent='工作区';strip.append(label);
      while(actions.firstChild)strip.append(actions.firstChild);
      const workMain=document.querySelector('#main');
      workMain?.insertBefore(strip,workMain.firstChild);
      actions.parentElement?.setAttribute('hidden','');
    }
  }
  // Stable page anatomy: heading, section tabs, filters, content. Move nodes, not data.
  for(const id of ['newTask']){
    const button=document.getElementById(id);
    if(button&&button.closest('.personal-head')){actions.append(button);button.classList.add('wb-primary-action');}
  }
  if(body.dataset.wbRoute==='/settings'){
    $('.page-head h1').textContent='设置';
    $('.page-head .lede').textContent='管理模型服务、数据连接与本机偏好。';
    const appearance=$('[data-panel="appearance"]');
    const values={wbColor:['clownfish-workbench-color','teal'],wbDensity:['clownfish-workbench-density','comfortable'],wbMotion:['clownfish-workbench-motion','full']};
    Object.entries(values).forEach(([id,[key,fallback]])=>{const select=$('#'+id);if(!select)return;select.value=document.documentElement.dataset[id]||fallback;select.onchange=()=>{try{localStorage.setItem(key,select.value);loadPreferences();}catch{$('#wallpaperStatus').textContent='浏览器未允许保存偏好，请检查本地存储权限。';}};});
  }
  if(body.dataset.wbRoute==='/capabilities'){
    $('.hero h1').textContent='工具与连接';
    const notice=$('.capability-orientation');if(notice){const info=document.createElement('details');info.className='wb-inline-info';const summary=document.createElement('summary');summary.textContent='助理、技能与工具如何分工？';info.append(summary,notice);$('.hero').after(info);}
  }
  if(body.dataset.wbRoute==='/office'){
    const toggle=$('#toggleFiles'),files=$('#filePanel');
    toggle.textContent='文件记录';toggle.setAttribute('aria-label','文件记录');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','filePanel');
    actions.append(toggle,$('#newDocument'),$('.file-panel-footer-actions [data-open-office-file]'));
    const back=document.createElement('a');back.href='/artifacts';back.textContent='返回文件';back.className='product-file-back';actions.prepend(back);
    const title=document.createElement('strong');title.textContent='最近文件';$('.file-panel-heading').prepend(title);
    $('#editorEmpty h1').textContent='文件工作台';
    const sub=$('#editorEmpty .section-label');if(sub)sub.textContent='文档、演示、表格与资料';
    const updateFiles=()=>{
      const open=files.classList.contains('is-open');toggle.setAttribute('aria-expanded',String(open));
      files.setAttribute('aria-hidden',String(!open));files.inert=!open;
    };
    new MutationObserver(updateFiles).observe(files,{attributes:true,attributeFilter:['class']});updateFiles();
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&files.classList.contains('is-open')){$('#closeFiles').click();toggle.focus();}});
    // Existing file search opens a native dialog; do not leave the file drawer over the editor.
    files.addEventListener('click',e=>{if(e.target.closest('#fileSearchToggle'))$('#closeFiles').click();});
  }
  const search=document.createElement('dialog');search.className='wb-search-dialog';search.setAttribute('aria-label','搜索页面');
  const head=document.createElement('header');head.innerHTML='<h2>跳转到</h2><button type="button" aria-label="关闭页面搜索">×</button>';head.querySelector('button').onclick=()=>search.close();
  const input=document.createElement('input');input.type='search';input.placeholder='输入页面名称…';input.setAttribute('aria-label','搜索页面名称');
  const results=document.createElement('nav');results.setAttribute('aria-label','页面搜索结果');
  for(const route of product?product.items:routes.filter(route=>!['/tasks','/collaboration','/runs'].includes(route.path))){const a=document.createElement('a');a.href=route.href||route.path;a.textContent=route.label||route.title;results.append(a);}
  const empty=document.createElement('p');empty.textContent='没有匹配页面';empty.hidden=true;
  input.oninput=()=>{let count=0;for(const a of results.children){a.hidden=!a.textContent.includes(input.value.trim());if(!a.hidden)count++;}empty.hidden=count>0;};
  search.append(head,input,results,empty);body.append(search);
  $('#wbSearch').onclick=()=>{closeNav();search.showModal();input.focus();};
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#wbSearch').click();}});
  window.addEventListener('popstate',sync);window.addEventListener('clownfish:navigation',sync);sync();
})();
