import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { APP_ROUTES, renderAppPage } from "../../examples/companion/app-navigation.js";
import { WORKBENCH_LINKS } from "../../examples/companion/workbench-shell.js";

test('输入框以细边框聚焦，组合搜索框不叠圈，键盘导航保留提示',()=>{
  const css=readFileSync('examples/companion/web/assets/workbench-ui.css','utf8');
  assert.ok(!css.includes(':is(a,button,input,textarea,select,summary):focus-visible'));
  assert.match(css,/textarea,select\):focus\{outline:none!important;box-shadow:none!important;border-color:var\(--cf-coral\)!important/);
  assert.match(css,/\.bot-search,[^}]+:focus-within\{outline:none!important;box-shadow:none!important;border-color:var\(--cf-coral\)!important/);
  assert.match(css,/input\[type=checkbox\][^}]+:focus-visible\{outline:2px solid #276b5b!important/);
  assert.match(css,/:focus:not\(:focus-visible\)\{outline:none!important/);
  const bots=readFileSync('examples/companion/web/assets/bot-library.css','utf8');
  assert.match(bots,/\.bot-search:focus-within \{ border-color:var\(--cf-coral\); \}/);
});

for(const route of APP_ROUTES)test('新工作台保留路由与单一高亮 '+route.path,()=>{
  const source=readFileSync('examples/companion/web/'+route.file,'utf8');
  const html=renderAppPage(source,route.path);
  const nav=html.match(/<aside class="rail app-nav"[\s\S]*?<\/aside>/)![0];
  assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
  assert.ok(nav.includes(`data-wb-path="${route.path}" aria-current="page"`));
  assert.ok(html.includes('data-ui="workbench"'));
  assert.ok(html.includes('id="wbPageActions"'));
  assert.ok(!html.includes('id="wbLegacy"'));
  assert.ok(!html.includes('legacy-navigation.js'));
  for(const id of ['settingsbtn','railCap','railOffice','railWork'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
  assert.ok(html.includes('/assets/workbench-ui.css'));
});
test('服务端直接渲染单层产品导航，旧书签保留在隐藏容器',()=>{
  const html=renderAppPage(readFileSync('examples/companion/web/index.html','utf8'),'/');
  const nav=html.match(/<aside class="rail app-nav"[\s\S]*?<\/aside>/)![0];
  assert.match(nav,/id="wbNavigation" data-product-navigation="true"/);
  assert.match(nav,/<details class="wb-tools"><summary>管理<\/summary>/);
  for(const key of ['overview','assistant','matters','tasks','files','memory','bots','tools','settings'])assert.ok(nav.includes(`data-product-key="${key}"`),key);
  const legacy=nav.match(/<div hidden data-legacy-navigation>([\s\S]*?)<\/div>/)![1];
  for(const href of ['/tasks','/automations','/spaces','/office','/resources','/collaboration','/runs'])assert.ok(legacy.includes(`href="${href}"`),href);
  assert.ok(!legacy.includes('href="/matters"'),'事项已是主入口，不应再作为旧书签');
  assert.match(nav,/<a class="wb-link" id="railMatters" href="\/matters" data-wb-path="\/matters" data-product-key="matters">/);
  for(const id of ['railAssistant','railBots','railWork','railCap','railMatters','railOffice','settingsbtn'])assert.ok(nav.includes(`id="${id}"`),id);
});
test('管理分组在当前路径属于技能库或工具与连接时展开',()=>{
  const page=readFileSync('examples/companion/web/bots.html','utf8');
  assert.doesNotMatch(renderAppPage(page,'/bots'),/<details class="wb-tools" open>/,'/bots 是任务主入口，不展开管理组');
  assert.match(renderAppPage(page,'/skills'),/<details class="wb-tools" open>/);
  assert.doesNotMatch(renderAppPage(readFileSync('examples/companion/web/work.html','utf8'),'/automations'),/<details class="wb-tools" open>/,'自动化属于任务页签，不在管理组');
  assert.match(renderAppPage(readFileSync('examples/companion/web/capabilities.html','utf8'),'/capabilities'),/<details class="wb-tools" open>/);
  assert.doesNotMatch(renderAppPage(page,'/'),/<details class="wb-tools" open>/);
});
test('新导航覆盖全部应用地址，无虚假目标',()=>{
  assert.deepEqual(new Set(WORKBENCH_LINKS.map(l=>l.href.split('?')[0])),new Set(APP_ROUTES.map(r=>r.path)));
});

test('所有页面不再注入重复抬头，操作入口与移动端导航保留',()=>{
  for(const route of APP_ROUTES){
    const source=readFileSync('examples/companion/web/'+route.file,'utf8');
    const html=renderAppPage(source,route.path);
    assert.ok(!html.includes('id="wbPageTitle"'),route.path);
    assert.ok(!html.includes('>我的工作台</a>'),route.path);
    assert.equal((html.match(/id="wbMenu"/g)||[]).length,1);
    assert.equal((html.match(/id="wbPageActions"/g)||[]).length,1);
  }
  const css=readFileSync('examples/companion/web/assets/workbench-ui.css','utf8');
  assert.ok(css.includes('.wb-topbar:has(#wbPageActions:empty){display:none}'));
  assert.ok(css.includes('grid-template-rows:var(--wb-tools-height,0px)'));
});
test('总览与其他页面共用根滚动条占位，不依赖旧标签样式',()=>{
  const css=readFileSync('examples/companion/web/assets/workbench-ui.css','utf8');
  assert.match(css,/html\[data-ui=workbench\]\{[^}]*scrollbar-gutter:stable!important/);
  for(const route of APP_ROUTES){
    const source=readFileSync('examples/companion/web/'+route.file,'utf8');
    const html=renderAppPage(source,route.path);
    assert.match(html,/<html data-ui="workbench"/);
    assert.ok(html.includes('/assets/workbench-ui.css'));
  }
});
test('导航图标同时约束最小尺寸，防止旧主题把文字向右推移',()=>{
  const css=readFileSync('examples/companion/web/assets/workbench-ui.css','utf8');
  const icon=css.match(/#wbNavigation \.wb-link>span\{([^}]+)\}/)?.[1] || '';
  for(const rule of ['width:18px!important','min-width:18px!important','max-width:18px!important','height:22px!important','min-height:22px!important'])assert.ok(icon.includes(rule),rule);
});
test('记忆新界面使用真实接口，不提供假的停用和撤销',()=>{
  const script=readFileSync('examples/companion/web/assets/workbench-memory.js','utf8');
  for(const endpoint of ['/api/memory/forget','/api/memory/preference'])assert.ok(script.includes(endpoint));
  assert.ok(script.includes('openDetail(m)'));
  assert.ok(!script.includes('localStorage'));
  assert.ok(!script.includes('/api/memory/toggle'));
  assert.ok(script.includes('无法在界面中撤销'));
});
