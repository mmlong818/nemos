/** Presentation-only shell. Existing pages own their actions and data. */
export const WORKBENCH_LINKS = [
  { href: "/overview", label: "总览", icon: "◫", group: "primary" },
  { href: "/", label: "助理工作区", icon: "◌", group: "primary" },
  { href: "/bots?view=tasks", label: "任务工作区", icon: "▦", group: "primary" },
  { href: "/memory", label: "记忆", icon: "▤", group: "primary" },
  { href: "/matters", label: "进行中的事", group: "work" },
  { href: "/tasks", label: "任务记录", group: "work" },
  { href: "/spaces", label: "项目", group: "work" },
  { href: "/automations", label: "自动化", group: "work" },
  { href: "/capabilities", label: "工具与执行", group: "tools" },
  { href: "/office", label: "文件编辑", group: "tools" },
  { href: "/resources", label: "参考资料", group: "tools" },
  { href: "/artifacts", label: "生成成果", group: "tools" },
  { href: "/collaboration", label: "流程协作记录", group: "tools" },
  { href: "/runs", label: "运行日志", group: "settings" },
  { href: "/settings", label: "设置", group: "settings" },
] as const;

export function renderWorkbenchNavigation(path: string): string {
  const ids: Record<string,string> = {"/":"railAssistant","/matters":"railMatters","/bots?view=tasks":"railBots","/capabilities":"railCap","/office":"railOffice","/automations":"railWork","/settings":"settingsbtn"};
  const link = (item: typeof WORKBENCH_LINKS[number]) => `<a class="wb-link"${['/tasks','/collaboration','/runs'].includes(item.href)?' hidden':''}${ids[item.href] ? ` id="${ids[item.href]}"` : ''} href="${item.href}" data-wb-path="${item.href.split('?')[0]}"${item.href.split('?')[0] === path ? ' aria-current="page"' : ''}><span aria-hidden="true">${'icon' in item ? item.icon : '·'}</span>${item.label}</a>`;
return `<aside class="rail app-nav" aria-label="主导航" id="wbNavigation"><a class="brand wb-brand" href="/overview" aria-label="小丑鱼总览"><img src="/assets/brand/clownfish-mark.svg" alt="" width="36" height="36"><span>小丑鱼<small>个人助理工作台</small></span></a><button class="wb-search" id="wbSearch" type="button">搜索或跳转 <kbd>Ctrl K</kbd></button><nav aria-label="主要页面">${WORKBENCH_LINKS.filter(i=>i.group==='primary').map(link).join('')}<div class="wb-nav-label">我的工作</div>${WORKBENCH_LINKS.filter(i=>i.group==='work').map(link).join('')}<details class="wb-tools"${WORKBENCH_LINKS.some(i=>i.group==='tools'&&i.href===path)?' open':''}><summary>工具与文件</summary>${WORKBENCH_LINKS.filter(i=>i.group==='tools').map(link).join('')}</details></nav><div class="wb-bottom">${WORKBENCH_LINKS.filter(i=>i.group==='settings').map(link).join('')}<small>本地数据 · 由你掌控</small></div></aside>`;
}

export function renderWorkbenchBar(): string {
  return `<div class="wb-topbar"><button id="wbMenu" type="button" aria-label="展开导航" aria-expanded="false" aria-controls="wbNavigation">☰</button><div id="wbPageActions"></div></div>`;
}
