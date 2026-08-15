// office.html 重设计：顶栏收纳文件操作 + 精简侧栏头部
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../examples/companion/web/office.html', import.meta.url));
let html = readFileSync(path, 'utf8');
const norm = (s) => s.replace(/\r/g, '');
const orig = html;

// 1) 顶栏：右侧收纳 保存状态 + 新建文件 + 打开文件
const topbarRe = /<header class="office-topbar">[\s\S]*?<\/header>/;
const newTopbar = `<header class="office-topbar">
        <div class="office-title">
          <button class="topbar-icon" id="toggleFiles" type="button" aria-label="显示文件列表" data-office-icon="panel"></button>
          <span>办公文件</span>
        </div>
        <div class="topbar-actions">
          <div class="save-state" id="saveState" role="status" aria-live="polite">本机自动保存</div>
          <button class="toolbar-button" id="newDocument" type="button" data-office-icon="plus">新建文件</button>
          <button class="toolbar-button primary" type="button" data-open-office-file data-office-icon="upload">打开文件</button>
          <input id="officeFileInput" type="file" hidden accept=".doc,.docx,.docm,.odt,.rtf,.epub,.ppt,.pps,.pot,.pptx,.pptm,.ppsx,.ppsm,.odp,.xls,.xlsx,.xlsm,.xlsb,.ods,.csv,.pdf,.txt,.md,.markdown">
        </div>
      </header>`;
if (!topbarRe.test(html)) throw new Error('topbar block not found');
html = html.replace(topbarRe, newTopbar);

// 2) 侧栏头部：去掉大标题与说明，只留紧凑标题行
const headingRe = /<div class="panel-heading">[\s\S]*?<\/p>\r?\n/;
const newHeading = `<div class="panel-heading">
            <strong class="panel-title">文件</strong>
            <button class="panel-close" id="closeFiles" type="button" aria-label="关闭文件列表">×</button>
          </div>
`;
if (!headingRe.test(html)) throw new Error('panel-heading block not found');
html = html.replace(headingRe, newHeading);

// 3) 侧栏中的文件操作按钮已上移到顶栏，删除原区块
const actionsRe = /\s*<div class="file-panel-actions"[\s\S]*?<\/div>\r?\n/;
if (!actionsRe.test(html)) throw new Error('file-panel-actions block not found');
html = html.replace(actionsRe, '\n');

if (norm(html) === norm(orig)) throw new Error('no changes applied');
writeFileSync(path, html);
console.log('office.html restructured OK');
