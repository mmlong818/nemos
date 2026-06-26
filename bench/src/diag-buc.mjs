import { runNemosItem } from './adapters/nemos.mjs';

const ITEM = {
  id: 'buc-p3', task: 'BUC',
  sessions: [
    { speaker: 'user', text: 'I am a vegetarian.' },
    { speaker: 'user', text: 'My favorite hobby is rock climbing.' },
    { speaker: 'user', text: 'Update on diet: I started eating fish again, so I am pescatarian now.' },
  ],
  probes: [{ kind: 'current', query: 'What is the user\'s current dietary preference?',
    expected: ['pescatarian'], forbidden: ['vegetarian'] }],
};

async function dump(variant, layers, label) {
  const pr = await runNemosItem(variant, ITEM, { topK: 10, searchLayers: layers });
  console.log(`\n--- ${variant} | ${label} ---`);
  for (const h of pr[0].hits) console.log(`   [${h.layer}] bs=${h.belief_state} :: ${h.content.slice(0, 75)}`);
}

async function main() {
  await dump('nemos-v2-semantic', undefined, 'all layers');
  await dump('nemos-v1-lexical', undefined, 'all layers');
  await dump('nemos-no-invalidation', undefined, 'all layers');
}
main().catch((e) => { console.error(e); process.exit(1); });
