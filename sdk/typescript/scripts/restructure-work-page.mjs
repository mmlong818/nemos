import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'companion', 'web');
const p = path.join(base, 'work.html');
let html = fs.readFileSync(p, 'utf-8');

// 1) 引入 task-workbench.css 与 work-shell.css
if (!html.includes('work-shell.css')) {
  html = html.replace(
    /<link rel="stylesheet" href="\/assets\/app-navigation-labels\.css">/,
    '<link rel="stylesheet" href="/assets/app-navigation-labels.css">\n  <link rel="stylesheet" href="/assets/task-workbench.css">\n  <link rel="stylesheet" href="/assets/work-shell.css">'
  );
}

// 2) 用 task-workbench 壳替换 <main>...</main>
const newMain = `
    <main class="task-workbench work-shell">
      <aside class="task-workbench-sidebar work-sidebar">
        <header class="task-sidebar-head">
          <div class="task-sidebar-brand"><strong>工作</strong></div>
          <div class="task-sidebar-primary">
            <button id="newTaskSide" class="task-workbench-new" type="button"><span data-app-icon="plus-circle" aria-hidden="true"><span></span></span><span>新任务</span></button>
          </div>
        </header>
        <section class="task-sidebar-section task-sidebar-list work-view-section">
          <div class="task-list-label">视图</div>
          <nav class="tabs work-view-nav" aria-label="工作页面">
            <a href="/tasks" data-view="tasks">任务</a>
            <a href="/spaces" data-view="spaces">空间</a>
            <a href="/automations" data-view="automations">自动化</a>
            <a href="/collaboration" data-view="collaboration">协作</a>
            <a href="/resources" data-view="resources">资料</a>
            <a href="/artifacts" data-view="artifacts">结果</a>
            <a href="/runs" data-view="runs">运行</a>
            <a href="/memory" data-view="memory">记忆</a>
          </nav>
        </section>
      </aside>

      <section class="task-workbench-main work-main">
        <header class="task-workbench-topbar">
          <div class="task-workbench-title"><div><div class="hname" id="pageTitle">任务</div></div></div>
          <div class="task-workbench-top-actions work-top-actions">
            <a href="/" title="返回对话" aria-label="返回对话"><span data-app-icon="message-circle" aria-hidden="true"><span></span></span></a>
          </div>
        </header>
        <div class="task-workbench-stage work-stage">
          <header class="work-page-head">
            <p class="eyebrow" id="pageEyebrow">持续工作</p>
            <p class="work-page-description" id="pageDescription">把需要重复执行的事情留在这里。</p>
          </header>
          <section class="content" id="content" aria-live="polite">
            <div class="loading">正在读取本机数据…</div>
          </section>
        </div>
      </section>
    </main>
`;

const mainRe = /\r?\n\s*<main>[\s\S]*?<\/main>/;
if (!mainRe.test(html)) {
  console.error('NO <main> MATCH');
  process.exit(1);
}
html = html.replace(mainRe, newMain);

// 3) 侧栏「新任务」按钮绑定到 work-center.js 的 openTaskDialog
if (!html.includes('newTaskSide')) {
  console.error('sidebar button missing after replace');
  process.exit(1);
}
if (!html.includes('newTaskSideBinder')) {
  html = html.replace(
    /<script src="\/assets\/work-center\.js" defer><\/script>/,
    `<script id="newTaskSideBinder">document.addEventListener("DOMContentLoaded",function(){var b=document.getElementById("newTaskSide");if(b)b.addEventListener("click",function(){if(typeof openTaskDialog==="function")openTaskDialog();});});</script>\n  <script src="/assets/work-center.js" defer></script>`
  );
}

fs.writeFileSync(p, html, 'utf-8');
console.log('work.html rewritten');
