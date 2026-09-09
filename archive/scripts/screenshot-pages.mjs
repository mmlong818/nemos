import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const base = 'http://localhost:8787';
const outDir = '.tmp-screenshots';
fs.mkdirSync(outDir, { recursive: true });

const pages = [
  { route: '/', name: 'home' },
  { route: '/capabilities', name: 'capabilities' },
  { route: '/office', name: 'office' },
  { route: '/develop', name: 'develop' },
  { route: '/tasks', name: 'work' },
  { route: '/settings', name: 'settings' },
];

const browser = await chromium.launch({ headless: true });

for (const { route, name } of pages) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1200);
    const file = path.join(outDir, `clownfish-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`${route} saved, errors:`, errors.length ? errors : 'none');
  } catch (e) {
    console.error(`${route} failed: ${e.message}`);
  } finally {
    await page.close();
    await context.close();
  }
}

await browser.close();
