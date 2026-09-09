import { chromium } from 'playwright';

const base = 'http://localhost:8787';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', err => errors.push(err.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

// 1) 打开设置 → 外观
await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
await page.click('[data-section="appearance"]');
await page.waitForTimeout(400);
const panelVisible = await page.isVisible('[data-panel="appearance"] .wallpaper-grid');
const thumbCount = await page.locator('.wallpaper-grid button').count();
console.log('appearance panel visible:', panelVisible, '| default thumbs:', thumbCount);

// 2) 选择第二张默认壁纸
await page.locator('.wallpaper-grid button').nth(1).click();
await page.waitForTimeout(300);
const stored = await page.evaluate(() => localStorage.getItem('clownfish-wallpaper'));
const applied = await page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper-url'));
console.log('stored:', stored);
console.log('applied var:', applied);
await page.screenshot({ path: '.tmp-screenshots/wallpaper-tahoe.png' });

// 3) 回到任务页确认跨页生效
await page.goto(`${base}/tasks`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const appliedOnTasks = await page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper-url'));
console.log('on /tasks var:', appliedOnTasks);
await page.screenshot({ path: '.tmp-screenshots/wallpaper-tasks-tahoe.png' });

// 4) URL 输入
await page.goto(`${base}/settings#appearance`, { waitUntil: 'networkidle' });
await page.click('[data-section="appearance"]');
await page.fill('#wallpaperUrl', '/assets/wallpapers/wallpaper-sonoma.svg');
await page.click('#wallpaperUrlForm button[type="submit"]');
await page.waitForTimeout(300);
console.log('after URL set:', await page.evaluate(() => localStorage.getItem('clownfish-wallpaper')));

// 5) 恢复默认
await page.click('#wallpaperReset');
await page.waitForTimeout(300);
console.log('after reset:', await page.evaluate(() => localStorage.getItem('clownfish-wallpaper')), '| var:', await page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper-url')));

console.log('JS errors:', errors.length ? errors : 'none');
await browser.close();
