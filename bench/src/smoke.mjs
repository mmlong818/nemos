import './proxy-boot.mjs';
import { createRequire } from 'module';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const { Nemos } = require('../../sdk/typescript/dist/index.js');

const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('no OPENAI_API_KEY');

const dir = mkdtempSync(join(tmpdir(), 'nemos-smoke-'));
const mem = new Nemos({
  storage: { type: 'sqlite', path: join(dir, 'smoke.db') },
  llm: { provider: 'openai', apiKey: key, model: 'gpt-4o' },
  embedding: { provider: 'openai', apiKey: key, model: 'text-embedding-3-small' },
  features: {
    reflect: { enabled: true, autoTriggerThreshold: 1 },
    invalidation: { enabled: true },
    decay: { enabled: false },
    domains: { enabled: false },
  },
  worker: { manualWorker: true },
});

const u = mem.forUser('alice');

async function main() {
  console.log('--- ingest fact 1 ---');
  const r1 = await u.ingest('I work at Google as a software engineer.');
  console.log('archival:', r1.archival?.content?.slice(0, 60), '| derived:', r1.derived?.length);

  console.log('--- ingest fact 2 (contradiction) ---');
  const r2 = await u.ingest('I just left Google. I now work at OpenAI as a researcher.');
  console.log('derived:', r2.derived?.length);

  console.log('--- runReflect ---');
  const rr = await u.runReflect();
  console.log('reflect:', JSON.stringify({ episodicConsumed: rr.episodicConsumed, anchorCount: rr.anchorCount, derived: rr.derived?.length, invalidated: rr.invalidated }));

  console.log('--- search: active only ---');
  const hits = await u.search('where does the user work now', { topK: 10 });
  for (const h of hits) console.log(`  [${h.layer}] bs=${h.belief_state} :: ${h.content?.slice(0, 70)}`);

  console.log('--- search incl invalidated ---');
  const hits2 = await u.search('where does the user work now', { topK: 10, includeInvalidated: true });
  for (const h of hits2) console.log(`  [${h.layer}] bs=${h.belief_state} :: ${h.content?.slice(0, 70)}`);

  mem.close?.();
  console.log('OK');
}

main().catch((e) => { console.error('SMOKE FAIL:', e); process.exit(1); });
