import { renderWorkbenchNavigation, renderWorkbenchBar } from "./workbench-shell.js";
/** One route/navigation contract for all application pages, including legacy bookmarks. */
export const APP_ROUTES = [
  { path: "/overview", file: "overview.html", section: "matters", title: "总览" },
  { path: "/", file: "index.html", section: "assistant", title: "助理" },
  { path: "/matters", file: "matters.html", section: "matters", title: "进行中的事" },
  { path: "/bots", file: "bots.html", section: "bots", title: "任务工作区" },
  { path: "/capabilities", file: "capabilities.html", section: "capabilities", title: "工具与执行" },
  { path: "/office", file: "office.html", section: "files", title: "文件工作台" },
  { path: "/settings", file: "settings.html", section: "settings", title: "设置" },
  { path: "/tasks", file: "work.html", section: "matters", title: "流程管理", workView: "tasks" },
  { path: "/spaces", file: "work.html", section: "matters", title: "项目", workView: "spaces" },
  { path: "/automations", file: "work.html", section: "automations", title: "自动化", workView: "automations" },
  { path: "/collaboration", file: "work.html", section: "bots", title: "流程协作设置", workView: "collaboration" },
  { path: "/resources", file: "work.html", section: "files", title: "参考资料", workView: "resources" },
  { path: "/artifacts", file: "work.html", section: "files", title: "生成成果", workView: "artifacts" },
  { path: "/runs", file: "work.html", section: "settings", title: "运行日志", workView: "runs" },
  { path: "/memory", file: "work.html", section: "settings", title: "记忆", workView: "memory" },
] as const;

export function canonicalAppPath(path: string): string {
  let result = path.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  result = result.replace(/\.html$/, "");
  if (result === "/index") return "/";
  if (result === "/work") return "/tasks";
  return result;
}
export function appRoute(path: string) {
  return APP_ROUTES.find((route) => route.path === canonicalAppPath(path));
}
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function renderAppPage(html: string, path: string): string {
  const route = appRoute(path);
  if (!route) throw new Error("Unknown application page");
  const marker = "<!-- APP_NAVIGATION -->";
  if (!html.includes(marker)) throw new Error("Application page is missing shared navigation");
  const manifest = JSON.stringify(APP_ROUTES).replace(/</g, "\\u003c");
  const wallpaper = html.includes("/assets/scramble-wallpaper.js") ? "" : '<link rel="stylesheet" href="/assets/scramble-wallpaper.css"><script src="/assets/scramble-wallpaper.js"></script>';
  html = html.replace(/<html\b/, '<html data-ui="workbench"')
    .replace(/<body\b/, `<body data-ui="workbench" data-wb-route="${route.path}"`)
    .replace(/<main\b/, renderWorkbenchBar() + '<main');
  return html.replace(marker, renderWorkbenchNavigation(route.path))
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(route.title)} · 小丑鱼</title>`)
    .replace("</head>", `${wallpaper}<link rel="stylesheet" href="/assets/app-shell.css"><script id="app-route-manifest" type="application/json">${manifest}</script><script src="/assets/app-navigation.js"></script><link rel="stylesheet" href="/assets/workbench-ui.css"><script src="/assets/workbench-ui.js" defer></script></head>`);
}
