import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'companion', 'web');
const pages = [
  { file: 'index.html', page: 'home' },
  { file: 'capabilities.html', page: 'capabilities' },
  { file: 'office.html', page: 'office' },
  { file: 'develop.html', page: 'develop' },
  { file: 'development.html', page: 'develop' },
  { file: 'work.html', page: 'tasks' },
  { file: 'settings.html', page: 'settings' },
];

for (const { file, page } of pages) {
  const p = path.join(base, file);
  let html = fs.readFileSync(p, 'utf-8');
  const before = html;

  // Replace <body> with <body data-page="...">
  html = html.replace(/<body(\s|>)/, `<body data-page="${page}"$1`);

  if (html !== before) {
    fs.writeFileSync(p, html, 'utf-8');
    console.log('updated', file);
  } else {
    console.log('no change', file);
  }
}
