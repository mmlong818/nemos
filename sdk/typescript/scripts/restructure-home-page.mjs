import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'companion', 'web');
const p = path.join(base, 'index.html');
let html = fs.readFileSync(p, 'utf-8');

function fail(msg) { console.error('FAIL:', msg); process.exit(1); }

// 1) 抽出 wechatRail（从 #sidebar 中提出，成为 body 直接子节点）
const railRe = /\r?\n {4}<div id="wechatRail">[\s\S]*?\r?\n {4}<\/div>/;
const railMatch = html.match(railRe);
if (!railMatch) fail('wechatRail block not found');
const rail = railMatch[0];
html = html.replace(railRe, '');

// 2) 抽出 topbar（从 #main 中提出）
const topbarRe = /\r?\n {4}<div id="topbar" class="task-workbench-topbar">[\s\S]*?\r?\n {4}<\/div>/;
const topbarMatch = html.match(topbarRe);
if (!topbarMatch) fail('topbar block not found');
let topbar = topbarMatch[0];
html = html.replace(topbarRe, '');

// 3) 抽出「小工具」「交给能力」按钮（从 composer 移入 topbar）
const toolBtnRe = /\r?\n {12}(<button id="composerTool"[^\r\n]*<\/button>)/;
const capBtnRe = /\r?\n {12}(<button id="composerCapability"[^\r\n]*<\/button>)/;
const toolBtn = html.match(toolBtnRe)?.[1];
const capBtn = html.match(capBtnRe)?.[1];
if (!toolBtn || !capBtn) fail('composer buttons not found');
html = html.replace(toolBtnRe, '').replace(capBtnRe, '');

if (!topbar.includes('<div id="topActions"')) fail('topActions not in topbar');
topbar = topbar.replace(
  '<div id="topActions"',
  toolBtn + '\r\n      ' + capBtn + '\r\n      <div id="topActions"'
);

// 4) 重新组装：rail → appColumn(topbar + appRow(sidebar … main … studio))
const sidebarAnchor = html.indexOf('  <div id="sidebar">');
if (sidebarAnchor < 0) fail('sidebar anchor not found');
html = html.replace(
  '  <div id="sidebar">',
  rail.trimStart().replace(/^ {4}/gm, '  ') +
  '\r\n  <div id="appColumn">' +
  topbar +
  '\r\n    <div id="appRow">\r\n  <div id="sidebar">'
);

// 5) 在 #studio 结束后关闭 appRow / appColumn
const studioStart = html.indexOf('<aside id="studio">');
if (studioStart < 0) fail('studio not found');
const studioEnd = html.indexOf('</aside>', studioStart);
if (studioEnd < 0) fail('studio end not found');
const insertAt = studioEnd + '</aside>'.length;
html = html.slice(0, insertAt) + '\r\n    </div>\r\n  </div>' + html.slice(insertAt);

fs.writeFileSync(p, html, 'utf-8');
console.log('index.html restructured');
