import { runNemosItem } from './adapters/nemos.mjs';
import { judgeProbe } from './score.mjs';

// Hand-authored BUC pilot items (fact-script -> rendered sessions).
const ITEMS = [
  {
    id: 'buc-p1', task: 'BUC',
    sessions: [
      { speaker: 'user', text: 'I work at Google as a software engineer.' },
      { speaker: 'user', text: 'Weekend was nice, went hiking near Tahoe.' },
      { speaker: 'user', text: 'Big news: I left Google and just started at OpenAI as a researcher.' },
    ],
    probes: [{ kind: 'current', query: 'Where does the user currently work and in what role?',
      expected: ['works at OpenAI', 'researcher at OpenAI'], forbidden: ['works at Google', 'software engineer at Google'] }],
  },
  {
    id: 'buc-p2', task: 'BUC',
    sessions: [
      { speaker: 'user', text: 'I live in Berlin.' },
      { speaker: 'user', text: 'I have been learning to cook Thai food lately.' },
      { speaker: 'user', text: 'I moved to Amsterdam last month for a new chapter.' },
      { speaker: 'user', text: 'Actually we relocated again — now settled in Lisbon.' },
    ],
    probes: [{ kind: 'current', query: 'Which city does the user live in now?',
      expected: ['Lisbon'], forbidden: ['Berlin', 'Amsterdam'] }],
  },
  {
    id: 'buc-p3', task: 'BUC',
    sessions: [
      { speaker: 'user', text: 'I am a vegetarian.' },
      { speaker: 'user', text: 'My favorite hobby is rock climbing.' },
      { speaker: 'user', text: 'Update on diet: I started eating fish again, so I am pescatarian now.' },
    ],
    probes: [{ kind: 'current', query: 'What is the user\'s current dietary preference?',
      expected: ['pescatarian', 'eats fish'], forbidden: ['vegetarian'] }],
  },
];

const VARIANTS = ['nemos-v2-semantic', 'nemos-v1-lexical', 'nemos-no-invalidation'];

async function main() {
  const results = {};
  for (const v of VARIANTS) {
    let expHit = 0, forbHit = 0, n = 0;
    console.log(`\n=== ${v} ===`);
    for (const item of ITEMS) {
      const probeResults = await runNemosItem(v, item, { topK: 10, searchLayers: ['personal_semantic', 'semantic'] });
      for (const { probe, retrieved } of probeResults) {
        const j = await judgeProbe(probe, retrieved);
        n++; if (j.contains_expected) expHit++; if (j.contains_forbidden) forbHit++;
        console.log(`  ${item.id}: exp=${j.contains_expected} forbidden=${j.contains_forbidden} | ${j.why}`);
        console.log(`     retrieved: ${retrieved.map((t) => t.slice(0, 55)).join(' || ')}`);
      }
    }
    results[v] = { UA: expHit / n, SLR: forbHit / n, n };
  }
  console.log('\n===== SUMMARY =====');
  for (const v of VARIANTS) {
    const r = results[v];
    console.log(`${v.padEnd(24)} UA=${(r.UA * 100).toFixed(0)}%  SLR=${(r.SLR * 100).toFixed(0)}%  (n=${r.n})`);
  }
}

main().catch((e) => { console.error('PILOT FAIL:', e); process.exit(1); });
