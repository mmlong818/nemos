import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'companion', 'web');
const files = ['index.html', 'capabilities.html', 'office.html', 'develop.html', 'development.html', 'work.html', 'settings.html'];
const inject = '<link rel="stylesheet" href="/assets/scramble-wallpaper.css">\n  <script src="/assets/scramble-wallpaper.js"></script>';

for (const file of files) {
  const p = path.join(base, file);
  let html = fs.readFileSync(p, 'utf-8');
  if (html.includes('scramble-wallpaper.css')) {
    console.log('skip (already wired)', file);
    continue;
  }
  const re = /(\s*)<link rel="stylesheet" href="\/assets\/scramble-theme\.css"\s*\/?>/;
  const m = html.match(re);
  if (!m) {
    console.log('NO MATCH', file);
    continue;
  }
  const indent = m[1].replace(/^\n/, '');
  const replacement = `${m[0]}\n${indent}${inject.replace('\n  ', '\n' + indent)}`;
  html = html.replace(re, replacement);
  fs.writeFileSync(p, html, 'utf-8');
  console.log('wired', file);
}
