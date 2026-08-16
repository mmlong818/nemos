import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(__dirname, "..", "..", "examples", "companion", "web");
const readWeb = (name: string) => readFileSync(join(web, name), "utf8");

test("主要页面共享小丑鱼统一视觉层", () => {
  for (const file of ["index.html", "capabilities.html", "office.html", "work.html", "develop.html", "settings.html"]) {
    const html = readWeb(file);
    assert.match(html, /href="\/assets\/clownfish-theme\.css"/);
    assert.ok(
      html.indexOf("/assets/clownfish-theme.css") < html.indexOf("/assets/app-navigation-labels.css"),
      `${file} 必须让导航尺寸合同最后生效`,
    );
  }

  const css = readWeb(join("assets", "clownfish-theme.css"));
  assert.match(css, /--cf-coral: #ad315f/);
  assert.match(css, /--cf-sea: #30b0c7/);
  assert.match(css, /--cf-workspace-radius: 24px/);
  assert.match(css, /--cf-workspace-shadow:/);
  assert.match(css, /--cf-sidebar-width: 252px/);
  assert.match(css, /--cf-panel-radius: 16px/);
  assert.match(css, /内部组件合同/);
  assert.doesNotMatch(readWeb("develop.html"), /class="development-starters"/);
  const workbenchCss = readWeb(join("assets", "task-workbench.css"));
  assert.match(workbenchCss, /\.task-workbench--development \.task-workbench-tools \{ order: 2; \}/);
  assert.doesNotMatch(css, /开发页与新任务页同构/);
  assert.match(css, /body > #main/);
  assert.match(css, /height: calc\(100vh - \(var\(--cf-workspace-gap\) \* 2\)\)/);
  assert.match(css, /\.topbar, #topbar, \.office-topbar, \.coding-topbar/);
  assert.match(css, /\.app-shell \{ grid-template-columns: 76px minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("本机背景图不设固定体积上限并使用 IndexedDB 保存", () => {
  const wallpaper = readWeb(join("assets", "scramble-wallpaper.js"));
  const settingsWallpaper = readWeb(join("assets", "settings-wallpaper.js"));
  assert.match(wallpaper, /window\.setWallpaperFile = setWallpaperFile/);
  assert.match(wallpaper, /indexedDB\.open\(DATABASE_NAME, 1\)/);
  assert.match(wallpaper, /objectStore\(STORE_NAME\)\.put\(file, FILE_KEY\)/);
  assert.match(wallpaper, /DEFAULT_WALLPAPER = '\/assets\/wallpapers\/wallpaper-anime-teal\.png'/);
  assert.ok(existsSync(join(web, "assets", "wallpapers", "wallpaper-anime-teal.png")));
  assert.doesNotMatch(settingsWallpaper, /MAX_UPLOAD_BYTES|2\s*\*\s*1024\s*\*\s*1024|超过 2MB/);
  assert.match(settingsWallpaper, /await window\.setWallpaperFile\(file\)/);
});

test("带新建入口的页面共享右侧搜索按钮和独立浮层", () => {
  const pages = [
    ["index.html", "quickGroup", "sidebarSearchToggle", "conversationSearchDialog"],
    ["develop.html", "newDevelopment", "developmentSearchToggle", "developmentSearchDialog"],
    ["work.html", "newTaskSide", "workSearchToggle", "workSearchDialog"],
    ["office.html", "newDocument", "fileSearchToggle", "fileSearchDialog"],
  ] as const;
  for (const [file, createId, searchId, dialogId] of pages) {
    const html = readWeb(file);
    assert.match(html, /href="\/assets\/app-search-overlay\.css"/);
    assert.match(html, /src="\/assets\/app-search-overlay\.js"/);
    assert.match(html, new RegExp(`class="[^"]*app-create-search[^"]*"[\\s\\S]*id="${createId}"[\\s\\S]*id="${searchId}"`));
    assert.match(html, new RegExp(`id="${dialogId}"[^>]*aria-labelledby=`));
  }
  const css = readWeb(join("assets", "app-search-overlay.css"));
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 34px/);
  assert.match(css, /\.app-search-dialog::backdrop/);
  assert.match(css, /\.app-search-trigger:focus-visible/);
});

test("首页和独立页面使用完全相同的左栏几何", () => {
  const css = readWeb(join("assets", "app-navigation-labels.css"));
  for (const contract of [
    "--app-rail-reserved: 100px",
    "--app-rail-shell: 72px",
    "--app-brand-size: 46px",
    "--app-brand-nav-gap: 12px",
    "--app-nav-width: 60px",
    "--app-nav-height: 54px",
    "--app-nav-gap: 4px",
    "--app-icon-size: 20px",
  ]) assert.ok(css.includes(contract), contract);
  assert.match(css, /\.rail \{/);
  assert.match(css, /#wechatRail \{/);
  assert.match(css, /#sessionPane \{[\s\S]*?width: 252px/);
  assert.match(css, /\.rail > \.brand,\s*#wechatRail > \.rail-avatar/);
});

test("新任务与开发复用同一套工作台组件", () => {
  const home = readWeb("index.html");
  const develop = readWeb("develop.html");
  const shared = readWeb(join("assets", "task-workbench.css"));
  for (const html of [home, develop]) {
    assert.match(html, /\/assets\/task-workbench\.css/);
    assert.match(html, /task-workbench-sidebar/);
    assert.match(html, /task-workbench-main/);
    assert.match(html, /task-workbench-topbar/);
    assert.match(html, /task-workbench-stage/);
    assert.match(html, /task-workbench-composer/);
    assert.match(html, /task-sidebar-brand/);
    assert.match(html, /task-sidebar-primary/);
  }
  assert.doesNotMatch(home, /task-workbench-top-actions/);
  assert.match(develop, /task-workbench-top-actions/);
  assert.match(home, /role-intro-state task-workbench-empty-frame/);
  assert.match(home, /role-intro-card task-workbench-empty is-composer-empty/);
  assert.match(develop, /role-intro-state task-workbench-empty-frame/);
  assert.match(develop, /role-intro-card task-workbench-empty/);
  assert.match(develop, /id="developmentSearchToggle"/);
  assert.match(develop, /id="taskTitle" class="task-workbench-title">[\s\S]*?<div class="hname">/);
  assert.match(shared, /--task-shell-sidebar: 252px/);
  assert.match(shared, /\.task-workbench-empty,/);
  assert.doesNotMatch(home, /starter-prompts|starter-help-close|clownfishStarterHelpClosed/);
  assert.match(shared, /\.task-workbench-topbar \{[\s\S]*?display: flex !important;[\s\S]*?align-items: center !important;/);
  assert.match(shared, /\.task-workbench-main \{[\s\S]*?flex: 1 1 0% !important;/);
  assert.match(shared, /\.task-workbench-stage \{[\s\S]*?flex: 1 1 0% !important;/);
  assert.match(shared, /\.task-workbench-composer \{[\s\S]*?backdrop-filter: blur\(18px\) !important;/);
  assert.match(shared, /\.task-workbench-title \.hname \{[\s\S]*?font-size: 15\.5px !important;[\s\S]*?font-weight: 500 !important;/);
  const developmentOnly = readWeb(join("assets", "development-coding.css"));
  assert.doesNotMatch(developmentOnly, /\.coding-shell\s*\{/);
  assert.doesNotMatch(developmentOnly, /\.coding-sidebar\s*\{/);
  assert.doesNotMatch(developmentOnly, /\.coding-composer\s*\{/);
  assert.doesNotMatch(develop, /project-block|development-settings-link/);
  const developmentScript = readWeb(join("assets", "develop-center.js"));
  assert.match(developmentScript, /const emptyStateCopy = \$\("#codingEmpty"\)\.cloneNode\(true\)/);
  assert.match(developmentScript, /transcript\.innerHTML = emptyTranscriptTemplate/);
  assert.match(developmentScript, /function setTaskTitle\(title\)/);
  assert.match(developmentScript, /AppSearchOverlay\.bind\(\{[\s\S]*dialog: "#developmentSearchDialog"/);
  assert.doesNotMatch(developmentScript, /coding-mark/);
  const flatWorkbench = readWeb(join("assets", "flat-workbench.css"));
  assert.match(flatWorkbench, /body\[data-page="home"\] #msgs > \.task-workbench-empty-frame \{[\s\S]*height: 100% !important;[\s\S]*min-height: 100% !important;/);
  assert.match(flatWorkbench, /body\[data-page="home"\] \.is-composer-empty \{[\s\S]*translateY\(clamp\(-72px, -9vh, -56px\)\)/);
});

test("任务页的小丑鱼回复可使用八成内容宽度", () => {
  const home = readWeb("index.html");
  assert.match(home, /\.row\.other:not\(\.expert-longform-row\) \{[\s\S]*?width:calc\(80% \+ 44px\);[\s\S]*?max-width:calc\(80% \+ 44px\);/);
  assert.match(home, /\.row\.other:not\(\.expert-longform-row\) \.msg-body \{[\s\S]*?width:calc\(100% - 44px\);[\s\S]*?max-width:none;[\s\S]*?align-items:flex-start;/);
  assert.match(home, /\.row\.other:not\(\.expert-longform-row\) \.bub \{[\s\S]*?max-width:100%;/);
});
