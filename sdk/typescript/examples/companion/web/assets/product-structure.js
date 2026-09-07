/* Product navigation is presentation-only. Legacy addresses and handlers remain reachable. */
(() => {
  const items=[
    {key:'assistant',href:'/',label:'助理',icon:'◌'},
    {key:'tasks',href:'/bots?view=tasks',label:'任务',icon:'▦'},
    {key:'files',href:'/artifacts',label:'文件',icon:'▧'},
    {key:'memory',href:'/memory',label:'记忆',icon:'▤'},
    {key:'bots',href:'/bots?view=bots',label:'技能库',icon:'◇'},
    {key:'automations',href:'/automations',label:'自动化',icon:'◷'},
    {key:'tools',href:'/capabilities',label:'工具与连接',icon:'⌘'},
    {key:'settings',href:'/settings',label:'设置',icon:'⚙'}
  ];
  function area(path,search=''){
    path=path.replace(/\.html$/,'').replace(/\/$/,'')||'/';
    if(path==='/bots')return ['bots','market'].includes(new URLSearchParams(search).get('view'))?'bots':'tasks';
    if(['/tasks','/work','/matters','/spaces','/collaboration'].includes(path))return path==='/matters'&&new URLSearchParams(search).get('view')==='learning'?'memory':'tasks';
    if(['/artifacts','/resources','/office'].includes(path))return 'files';
    if(path==='/memory')return 'memory';
    if(path==='/automations')return 'automations';
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
    items.slice(0,4).forEach(item=>primary.insertBefore(linkFor(item),tools));
    items.slice(4,7).forEach(item=>tools.append(linkFor(item)));
    const bottom=nav.querySelector('.wb-bottom');bottom.prepend(linkFor(items[7]));nav.append(legacy);
    const brand=nav.querySelector('.wb-brand');brand.href='/';brand.setAttribute('aria-label','小丑鱼助理');
  }
  function tabs(links,current,label){
    const nav=document.createElement('nav');nav.className='product-section-nav';nav.setAttribute('aria-label',label);
    for(const [href,text,key] of links){const a=document.createElement('a');a.href=href;a.textContent=text;if(key===current)a.setAttribute('aria-current','page');nav.append(a);}
    return nav;
  }
  function mount(){
    const path=location.pathname.replace(/\.html$/,'');const params=new URLSearchParams(location.search);
    if(['/spaces','/matters'].includes(path)&&params.get('view')!=='learning'){
      const head=document.querySelector('.work-page-head,.personal-head');
      head?.after(tabs([['/bots?view=tasks','执行任务','tasks'],['/matters','长期跟进','matters'],['/spaces','项目','spaces']],path.slice(1),'任务视图'));
    }
    if(path==='/resources'){
      const head=document.querySelector('.work-page-head');head?.after(tabs([['/artifacts','全部文件','all'],['/artifacts?kind=artifact','生成成果','artifact'],['/resources','参考资料','resources']], 'resources','文件视图'));
    }
    if(path==='/memory'){
      const head=document.querySelector('.work-page-head');
      head?.after(tabs([['/memory','已记住','memory'],['/matters?view=learning','待确认','learning']], 'memory','记忆视图'));
    }
    if(path==='/matters'&&params.get('view')==='learning'){
      const head=document.querySelector('.personal-head');
      if(head){head.querySelector('h1').textContent='记忆确认';head.querySelector('p:last-child').textContent='审阅值得长期保留的内容；只有确认后才会记住。';head.after(tabs([['/memory','已记住','memory'],['/matters?view=learning','待确认','learning']], 'learning','记忆视图'));}
    }
  }
  window.ClownfishProductStructure=Object.freeze({items,area,organizeNavigation});
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',mount);
})();
