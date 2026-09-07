/** Presentation-only shell. Existing pages own their actions and data. */
export const WORKBENCH_LINKS = [
  { href: "/overview", label: "总览", icon: "◫", group: "primary" },
  { href: "/", label: "助理工作区", icon: "◌", group: "primary" },
  { href: "/matters", label: "事项", icon: "◉", group: "primary" },
  { href: "/bots?view=tasks", label: "任务工作区", icon: "▦", group: "primary" },
  { href: "/memory", label: "记忆", icon: "▤", group: "primary" },
  { href: "/tasks", label: "任务记录", group: "work" },
  { href: "/spaces", label: "项目", group: "work" },
  { href: "/automations", label: "自动化", group: "work" },
  { href: "/skills", label: "技能库", icon: "◇", group: "tools" },
  { href: "/capabilities", label: "工具与执行", group: "tools" },
  { href: "/office", label: "文件编辑", group: "tools" },
  { href: "/resources", label: "参考资料", group: "tools" },
  { href: "/artifacts", label: "生成成果", group: "tools" },
  { href: "/collaboration", label: "流程协作记录", group: "tools" },
  { href: "/runs", label: "运行日志", group: "settings" },
  { href: "/settings", label: "设置", group: "settings" },
] as const;

type NavigationEntry = { href: string; label: string; icon: string; id?: string; productKey?: string };

export function renderWorkbenchNavigation(path: string): string {
  // /bots hosts two links (tasks and skill library); only the first path match
  // carries the server-rendered aria-current so the rail keeps a single highlight.
  let currentPlaced = false;
  const link = (item: NavigationEntry) => {
    const wbPath = item.href.split("?")[0];
    const current = !currentPlaced && wbPath === path ? (currentPlaced = true, ' aria-current="page"') : "";
    return `<a class="wb-link"${item.id ? ` id="${item.id}"` : ""} href="${item.href}" data-wb-path="${wbPath}"${current}${item.productKey ? ` data-product-key="${item.productKey}"` : ""}><span aria-hidden="true">${item.icon}</span>${item.label}</a>`;
  };
  const primary: NavigationEntry[] = [
    { href: "/overview", label: "总览", icon: "◫", productKey: "overview" },
    { href: "/", label: "助理", icon: "◌", id: "railAssistant", productKey: "assistant" },
    { href: "/matters", label: "事项", icon: "◉", id: "railMatters", productKey: "matters" },
    { href: "/bots?view=tasks", label: "任务", icon: "▦", id: "railBots", productKey: "tasks" },
    { href: "/artifacts", label: "文件", icon: "▧", productKey: "files" },
    { href: "/memory", label: "记忆", icon: "▤", productKey: "memory" },
  ];
  const tools: NavigationEntry[] = [
    { href: "/skills", label: "技能库", icon: "◇", id: "railSkills", productKey: "bots" },
    { href: "/capabilities", label: "工具与连接", icon: "⌘", id: "railCap", productKey: "tools" },
  ];
  // Legacy bookmarks stay in the DOM so old addresses remain reachable from the rail.
  // /matters is a primary destination (事项) since 2026-09-08 and no longer lives here.
  // /automations is a tab of 任务 (rendered in-page); the hidden entry keeps the old bookmark reachable.
  const legacy: NavigationEntry[] = [
    { href: "/tasks", label: "任务记录", icon: "·" },
    { href: "/automations", label: "自动化", icon: "·", id: "railWork" },
    { href: "/spaces", label: "项目", icon: "·" },
    { href: "/office", label: "文件编辑", icon: "·", id: "railOffice" },
    { href: "/resources", label: "参考资料", icon: "·" },
    { href: "/collaboration", label: "流程协作记录", icon: "·" },
    { href: "/runs", label: "运行日志", icon: "·" },
  ];
  const toolsOpen = tools.some((item) => item.href.split("?")[0] === path) ? " open" : "";
  return `<aside class="rail app-nav" aria-label="主导航" id="wbNavigation" data-product-navigation="true"><a class="brand wb-brand" href="/overview" aria-label="小丑鱼总览"><img src="/assets/brand/clownfish-mark.svg" alt="" width="36" height="36"><span>小丑鱼<small>个人助理工作台</small></span></a><button class="wb-search" id="wbSearch" type="button">搜索或跳转 <kbd>Ctrl K</kbd></button><nav aria-label="主要页面">${primary.map(link).join("")}<details class="wb-tools"${toolsOpen}><summary>管理</summary>${tools.map(link).join("")}</details><div hidden data-legacy-navigation>${legacy.map(link).join("")}</div></nav><div class="wb-bottom">${link({ href: "/settings", label: "设置", icon: "⚙", id: "settingsbtn", productKey: "settings" })}<small>本地数据 · 由你掌控</small></div></aside>`;
}

export function renderWorkbenchBar(): string {
  return `<div class="wb-topbar"><button id="wbMenu" type="button" aria-label="展开导航" aria-expanded="false" aria-controls="wbNavigation">☰</button><div id="wbPageActions"></div></div>`;
}
