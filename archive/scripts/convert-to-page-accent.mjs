import fs from 'fs';

const p = new URL('../examples/companion/web/assets/scramble-theme.css', import.meta.url);
let css = fs.readFileSync(p, 'utf-8');
const before = css;

// Replace hardcoded emerald colors with page accent variables
const replacements = [
  // Main accent
  [/var\(--scramble-emerald\)/g, 'var(--page-accent)'],
  [/var\(--scramble-emerald-dark\)/g, 'var(--page-accent-dark)'],
  [/var\(--scramble-emerald-light\)/g, 'var(--page-accent)'],
  // Soft backgrounds
  [/rgba\(0, 200, 150, 0\.12\)/g, 'var(--page-accent-soft)'],
  [/rgba\(0, 200, 150, 0\.13\)/g, 'var(--page-accent-soft)'],
  [/rgba\(0, 200, 150, 0\.28\)/g, 'color-mix(in srgb, var(--page-accent) 28%, transparent)'],
  [/rgba\(0, 200, 150, 0\.22\)/g, 'color-mix(in srgb, var(--page-accent) 22%, transparent)'],
  [/rgba\(0, 200, 150, 0\.18\)/g, 'color-mix(in srgb, var(--page-accent) 18%, transparent)'],
  [/rgba\(0, 200, 150, 0\.14\)/g, 'color-mix(in srgb, var(--page-accent) 14%, transparent)'],
  [/rgba\(0, 200, 150, 0\.32\)/g, 'color-mix(in srgb, var(--page-accent) 32%, transparent)'],
  [/rgba\(0, 200, 150, 0\.62\)/g, 'color-mix(in srgb, var(--page-accent) 62%, transparent)'],
  // Gradients
  [/linear-gradient\(135deg, var\(--page-accent\), var\(--scramble-cyan\)\)/g, 'var(--page-accent-grad)'],
];

for (const [from, to] of replacements) {
  css = css.replace(from, to);
}

fs.writeFileSync(p, css, 'utf-8');
console.log('changed:', before !== css);
console.log('total length:', css.length);
