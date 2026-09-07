/* Product navigation is presentation-only. The server renders the final rail;
   this module is the fallback for cached pre-merge HTML. Legacy addresses and handlers remain reachable. */
(() => {
  const items=[
    {key:'overview',href:'/overview',label:'总览',icon:'◫'},
    {key:'assistant',href:'/',label:'助理',icon:'◌'},
    {key:'matters',href:'/matters',label:'事项',icon:'◉'},
    {key:'tasks',href:'/bots?view=tasks',label:'任务',icon:'▦'},
    {key:'files',href:'/artifacts',label:'文件',icon:'▧'},
    {key:'memory',href:'/memory',label:'记忆',icon:'▤'},
    {key:'bots',href:'/skills',label:'技能库',icon:'◇'},
    {key:'tools',href:'/capabilities',label:'工具与连接',icon:'⌘'},
    {key:'settings',href:'/settings',label:'设置',icon:'⚙'}
  ];
  function area(path,search=''){
    path=path.replace(/\.html$/,'').replace(/\/$/,'')||'/';
    if(path==='/bots')return ['bots','market'].includes(new URLSearchParams(search).get('view'))?'bots':'tasks';
    if(path==='/skills')return 'bots';
    if(path==='/overview')return 'overview';
    // 事项 (personal matters) is its own primary area; learning proposals moved to /memory?view=learning.
    if(path==='/matters')return 'matters';
    // 任务 owns 进行中 / 项目 / 自动化 as in-page tabs.
    if(['/tasks','/work','/spaces','/collaboration','/automations'].includes(path))return 'tasks';
    if(['/artifacts','/resources','/office'].includes(path))return 'files';
    if(path==='/memory')return 'memory';
    if(path==='/capabilities')return 'tools';
    if(['/settings','/runs'].includes(path))return 'settings';
    return 'assistant';
  }
  function organizeNavigation(nav){
    if(!nav||nav.dataset.productNavigation)return;
    nav.dataset.productNavigation='true';
    const primary=nav.querySelector('nav'), tools=nav.querySelector('.wb-tools');
    const legacy=document.createElement('div');legacy.hidden=true;legacy.dataset.legacyNavigation='';
    const oldLinks=[...nav.querySelectorAll('[data-wb-path]')];
    for(const link of oldLinks)legacy.append(link);
    for(const child of [...primary.children])if(child!==tools)child.remove();
    tools.replaceChildren();const summary=document.createElement('summary');summary.textContent='管理';tools.append(summary);
    function linkFor(item){
      const link=oldLinks.find(a=>a.getAttribute('href')===item.href)||document.createElement('a');
      link.href=item.href;link.hidden=false;link.className='wb-link';
      link.dataset.wbPath=item.href.split('?')[0];link.dataset.productKey=item.key;
      link.replaceChildren();const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');icon.textContent=item.icon;
      link.append(icon,document.createTextNode(item.label));return link;
    }
    items.slice(0,6).forEach(item=>primary.insertBefore(linkFor(item),tools));
    items.slice(6,8).forEach(item=>tools.append(linkFor(item)));
    const bottom=nav.querySelector('.wb-bottom');bottom.prepend(linkFor(items[8]));nav.append(legacy);
    const brand=nav.querySelector('.wb-brand');brand.href='/overview';brand.setAttribute('aria-label','小丑鱼总览');
  }
  const TASK_TABS=[['/bots?view=tasks','进行中','tasks'],['/spaces','项目','spaces'],['/automations','自动化','automations']];
  function tabs(links,current,label){
    const nav=document.createElement('nav');nav.className='product-section-nav';nav.setAttribute('aria-label',label);
    for(const [href,text,key] of links){const a=document.createElement('a');a.href=href;a.textContent=text;if(key===current)a.setAttribute('aria-current','page');nav.append(a);}
    return nav;
  }
  function mount(){
    const path=location.pathname.replace(/\.html$/,'');const params=new URLSearchParams(location.search);
    if(path==='/spaces'||path==='/automations'){
      const head=document.querySelector('.work-page-head,.personal-head');
      head?.after(tabs(TASK_TABS,path.slice(1),'任务视图'));
    }
    if(path==='/resources'){
      const head=document.querySelector('.work-page-head');head?.after(tabs([['/artifacts','全部文件','all'],['/artifacts?kind=artifact','生成成果','artifact'],['/resources','参考资料','resources']], 'resources','文件视图'));
    }
    if(path==='/memory'){
      const head=document.querySelector('.work-page-head');
      head?.after(tabs([['/memory','已记住','memory'],['/memory?view=learning','待确认','learning']], params.get('view')==='learning'?'learning':'memory','记忆视图'));
    }
  }
  window.ClownfishProductStructure=Object.freeze({items,area,organizeNavigation,taskTabs:TASK_TABS});
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',mount);
})();
