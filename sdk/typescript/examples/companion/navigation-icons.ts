/**
 * 左栏导航图标。
 *
 * 这里放的是**服务端渲染**的那一份：左栏由 `workbench-shell.ts` 在请求时注入，
 * 而 `web/assets/app-icons.js` 是浏览器脚本，`overview.html` 甚至没有加载它，
 * 只有首页会主动调用它的填充函数。所以左栏若依赖客户端填充，就会有页面留下空图标。
 * 服务端直出没有这个问题，也不会有先空后填的闪动。
 *
 * 代价是路径数据在两处各有一份。`companion-icon-system.test.ts` 里有守卫逐条比对
 * 同名图标的路径必须逐字节相同，所以两边漂开不可能悄悄上线。风格与浏览器那套一致：
 * 24 见方、2 像素描边、圆头线帽、跟随文字颜色，实心形状只用来做重音锚点。
 *
 * **不要在这里用 Unicode 几何字符**。曾经用过 ◫ ◌ ◉ ▦ ▧ ▤ ◇ ⌘ ⚙：它们来自三个互不
 * 相干的形状家族，其中 ⌘ 是 Mac 的 Command 键符号，而界面声明的字体栈
 * （Segoe UI、Microsoft YaHei）根本不含这些字符，每一个都由未声明的回退字体供给，
 * 于是笔画粗细与基线各不相同，且换机器还会变。
 */

export type NavigationIconName =
  | "panel"
  | "message"
  | "bookmark"
  | "matters"
  | "boxes"
  | "file"
  | "memory"
  | "skills"
  | "plug"
  | "settings"
  | "work"
  | "spark"
  | "document"
  | "users"
  | "code";

const NAVIGATION_ICON_PATHS: Readonly<Record<NavigationIconName, string>> = Object.freeze({
  panel: "<rect x=\"3\" y=\"3.5\" width=\"18\" height=\"17\" rx=\"3\"/><path d=\"M9 4v16\" opacity=\".45\"/><path d=\"M5.7 8h.1M5.7 12h.1M12 8h6M12 12h4\"/>",
  message: "<path d=\"M12 3.75C6.9 3.75 2.75 7.25 2.75 11.55c0 2.5 1.2 4.7 3.1 6.15L5 21.25l3.6-1.95c1.05.3 2.2.45 3.4.45 5.1 0 9.25-3.5 9.25-8.2S17.1 3.75 12 3.75Z\"/>",
  bookmark: "<path fill=\"currentColor\" stroke=\"none\" d=\"M6 3h12v18l-6-3.8L6 21V3Z\"/><path d=\"M9.2 7.5h5.6\" stroke=\"#fff\" stroke-width=\"1.5\" opacity=\".8\"/>",
  matters: "<path d=\"M6.5 5h11a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5Z\"/><path fill=\"currentColor\" stroke=\"none\" d=\"M9 2.5h6v4H9z\"/><path d=\"M8.5 11h7M8.5 15h4.5\"/>",
  boxes: "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1.8\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1.8\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1.8\"/><rect x=\"13.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1.8\"/>",
  file: "<path d=\"M6.5 2.5h7L19 8v13.5A1.5 1.5 0 0 1 17.5 23h-11A1.5 1.5 0 0 1 5 21.5V4a1.5 1.5 0 0 1 1.5-1.5Z\"/><path d=\"M13.5 2.5V8H19\"/>",
  memory: "<rect x=\"3.5\" y=\"4\" width=\"17\" height=\"6.5\" rx=\"2\"/><rect x=\"3.5\" y=\"13.5\" width=\"17\" height=\"6.5\" rx=\"2\"/><circle cx=\"7.6\" cy=\"7.25\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"7.6\" cy=\"16.75\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
  skills: "<path d=\"M5 5a2 2 0 0 1 2-2h11.5v18H7a2 2 0 0 1-2-2V5Z\"/><path d=\"M18.5 16.25H7\" opacity=\".42\"/><path fill=\"currentColor\" stroke=\"none\" d=\"M10 3h3.6v6.4l-1.8-1.5-1.8 1.5V3Z\"/>",
  plug: "<path d=\"M9.25 3v4.5M14.75 3v4.5\"/><path d=\"M6.75 7.5h10.5v3.25a5.25 5.25 0 0 1-10.5 0V7.5Z\"/><path d=\"M12 16v5\"/><circle cx=\"12\" cy=\"21\" r=\"1.3\" fill=\"currentColor\" stroke=\"none\"/>",
  settings: "<circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z\"/>",
  work: "<path d=\"M3.5 3.5V19a1.5 1.5 0 0 0 1.5 1.5h15.5\"/><path d=\"M8.5 15.5v-4.5M13 15.5V7.5M17.5 15.5v-3\"/>",
  spark: "<path fill=\"currentColor\" stroke=\"none\" d=\"m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z\"/><path fill=\"currentColor\" stroke=\"none\" d=\"m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z\" opacity=\".42\"/>",
  document: "<path d=\"M7.5 3.25h7.2l4.05 4.05v12.2c0 .7-.55 1.25-1.25 1.25h-10c-.7 0-1.25-.55-1.25-1.25v-15c0-.7.55-1.25 1.25-1.25Z\"/><path d=\"M14.5 3.5v4h4\"/><path d=\"M4 7.2v11.3A2.5 2.5 0 0 0 6.5 21\" opacity=\".38\"/><path d=\"M9.5 12h5.5M9.5 15.5h4\" stroke-width=\"1.6\"/>",
  users: "<path fill=\"currentColor\" stroke=\"none\" d=\"M8.3 4.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Zm7.7 1.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM2.7 20v-2.3c0-3 2.45-5.45 5.45-5.45h.3c3 0 5.45 2.45 5.45 5.45V20H2.7Zm11.6 0v-2.1c0-1.8-.7-3.45-1.85-4.65.8-.55 1.8-.85 2.85-.85h.25A5.75 5.75 0 0 1 21.3 18.15V20h-7Z\"/>",
  code: "<path d=\"m8.5 7-5.5 5 5.5 5M15.5 7l5.5 5-5.5 5M13.25 4.5l-2.5 15\"/>",
});

export function navigationIconNames(): NavigationIconName[] {
  return Object.keys(NAVIGATION_ICON_PATHS) as NavigationIconName[];
}

/**
 * 渲染一个导航图标。名字未登记时直接抛错，不回退到通用图形：静默兜底会让写错名字的
 * 入口看起来"有个图标"而没人发现，那正是这次要修掉的那类问题。
 */
export function renderNavigationIcon(name: NavigationIconName): string {
  const content = NAVIGATION_ICON_PATHS[name];
  if (!content) throw new Error(`未登记的导航图标：${name}`);
  return `<svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
}

export function navigationIconPath(name: NavigationIconName): string {
  return NAVIGATION_ICON_PATHS[name];
}
