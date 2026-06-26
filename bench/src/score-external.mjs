// Scores an external system's retrieved-sets (e.g. mem0) with the SAME judge as Nemos.
// Input: results/<task>-<sys>-retrieved.json  (from a *_run adapter)
// Usage: node src/score-external.mjs --task BUC --sys mem0
import { readFileSync, writeFileSync } from 'fs';
import { judgeProbe } from './score.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]]);
  return a;
}, []));
const task = (args.task || 'BUC').toUpperCase();
const sys = args.sys || 'mem0';

const data = JSON.parse(readFileSync(`results/${task.toLowerCase()}-${sys}-retrieved.json`, 'utf-8'));

async function main() {
  let exp = 0, forb = 0, n = 0;
  for (const item of data) {
    for (const p of item.probes) {
      const j = await judgeProbe({ query: p.query, expected: p.expected, forbidden: p.forbidden }, p.retrieved);
      n++; if (j.contains_expected) exp++; if (j.contains_forbidden) forb++;
    }
  }
  const summary = { system: sys, task, n, expected_rate: exp / n, forbidden_rate: forb / n };
  console.log(`\n=== ${sys} on ${task} (n=${n}) ===`);
  if (task === 'BUC') console.log(`UA=${(summary.expected_rate * 100).toFixed(1)}%  SLR=${(summary.forbidden_rate * 100).toFixed(1)}%`);
  else if (task === 'ASP') console.log(`UFR=${(summary.expected_rate * 100).toFixed(1)}%  PR=${(summary.forbidden_rate * 100).toFixed(1)}%`);
  else console.log(`IFR=${(summary.expected_rate * 100).toFixed(1)}%  triviaLeak=${(summary.forbidden_rate * 100).toFixed(1)}%`);
  writeFileSync(`results/${task.toLowerCase()}-${sys}.json`, JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
