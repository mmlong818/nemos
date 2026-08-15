import { chromium } from 'playwright';

const base = 'http://localhost:8787';
const browser = await chromium.launch({ headless: true });
const errors = [];

// 1) 移动端视口截图
for (const [route, name] of [['/', 'home'], ['/develop', 'develop'], ['/tasks', 'work']]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}(mobile): ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}(mobile): ${m.text()}`); });
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `.tmp-screenshots/mobile-${name}.png` });
  await ctx.close();
}

// 2) 桌面端交互：顶栏按钮可用
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`desktop: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`desktop: ${m.text()}`); });

await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
// 小工具按钮在顶栏
const toolInTopbar = await page.evaluate(() => {
  const btn = document.getElementById('composerTool');
  const topbar = document.getElementById('topbar');
  return btn && topbar ? topbar.contains(btn) : false;
});
const capInTopbar = await page.evaluate(() => {
  const btn = document.getElementById('composerCapability');
  const topbar = document.getElementById('topbar');
  return btn && topbar ? topbar.contains(btn) : false;
});
console.log('home: 小工具 in topbar =', toolInTopbar, '| 交给能力 in topbar =', capInTopbar);
await page.click('#composerTool');
await page.waitForTimeout(400);
const toolModalVisible = await page.evaluate(() => {
  const el = document.querySelector('#toolmodal');
  return el ? getComputedStyle(el).display !== 'none' : false;
});
console.log('home: 小工具点击后弹层 =', toolModalVisible);
await page.keyboard.press('Escape');
await page.screenshot({ path: '.tmp-screenshots/home-tool-modal.png' });

// 开发页顶栏控件
await page.goto(`${base}/develop`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const wsInTopbar = await page.evaluate(() => {
  const btn = document.getElementById('workspaceButton');
  const topbar = document.querySelector('.coding-topbar');
  return btn && topbar ? topbar.contains(btn) : false;
});
console.log('develop: 选择项目 in topbar =', wsInTopbar);
await page.click('#workspaceButton');
await page.waitForTimeout(300);
console.log('develop: 项目弹窗 open =', await page.evaluate(() => document.getElementById('workspaceDialog')?.open));
await page.keyboard.press('Escape');

console.log('JS errors:', errors.length ? errors : 'none');
await browser.close();
