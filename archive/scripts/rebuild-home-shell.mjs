import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'companion', 'web');
const p = path.join(base, 'index.html');
let html = fs.readFileSync(p, 'utf-8');

function fail(msg) { console.error('FAIL:', msg); process.exit(1); }

// 1) wechatRail + appColumn → 标准 .app-shell > .rail + main.home-shell
const railRe = /<div id="wechatRail">[\s\S]*?\r?\n {2}<\/div>\r?\n {2}<div id="appColumn">\r?\n/;
if (!railRe.test(html)) fail('wechatRail/appColumn block not found');
const chrome = `  <div class="app-shell">
    <aside class="rail" aria-label="主导航">
      <a class="brand" href="/" id="railUserAvatar" aria-label="回到小丑鱼对话"><img class="avatar-img" alt="" src="/assets/brand/clownfish-mark.svg" /></a>
      <nav>
        <a class="is-current" href="/" aria-current="page" data-app-icon="message"><span></span><small>任务</small></a>
        <a href="/capabilities" id="railCap" data-app-icon="boxes"><span></span><small>能力</small></a>
        <a href="/office" id="railOffice" data-app-icon="file"><span></span><small>文件</small></a>
        <a href="/develop" id="railDev" data-app-icon="code"><span></span><small>开发</small></a>
        <a href="/tasks" id="railWork" data-app-icon="work"><span></span><small>工作</small></a>
      </nav>
      <a class="rail-secondary" href="/settings" id="settingsbtn" data-app-icon="settings"><span></span><small>设置</small></a>
    </aside>
    <main class="task-workbench home-shell">
`;
html = html.replace(railRe, chrome);

// 2) appRow + sidebar → workbench-body（sessionPane 直接成为侧栏）
const rowRe = / {4}<div id="appRow">\r?\n {2}<div id="sidebar">\r?\n {4}<div id="sessionPane"/;
if (!rowRe.test(html)) fail('appRow/sidebar open not found');
html = html.replace(rowRe, '      <div class="workbench-body">\r\n    <div id="sessionPane"');

// 3) 去掉 #sidebar 的闭合标签（sessionPane 闭合后原本还多一层 sidebar 闭合）
const sideCloseRe = /( {4}<\/div>)\r?\n {2}<\/div>(\r?\n {2}<div id="onboardingmodal")/;
if (!sideCloseRe.test(html)) fail('sidebar close not found');
html = html.replace(sideCloseRe, '$1\r\n$2');

// 4) 尾部：appRow/appColumn 闭合 → workbench-body/main/app-shell 闭合
const tailRe = /(<\/aside>)\r?\n {4}<\/div>\r?\n {2}<\/div>(\r?\n<script src="\/assets\/app-icons\.js">)/;
if (!tailRe.test(html)) fail('tail close not found');
html = html.replace(tailRe, '$1\r\n      </div>\r\n    </main>\r\n  </div>$2');

fs.writeFileSync(p, html, 'utf-8');
console.log('index.html rebuilt to shared app-shell');
