import '../proxy-boot.mjs';
import { createRequire } from 'module';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const { Nemos } = require('../../../sdk/typescript/dist/index.js');

const KEY = process.env.OPENAI_API_KEY;

// Ablation variants. Each returns a `features` block.
const base = { reflect: { enabled: true, autoTriggerThreshold: 1 }, decay: { enabled: true }, domains: { enabled: true } };
export const VARIANTS = {
  // full == v2 semantic detector (the improved system)
  'nemos-full': { ...base, invalidation: { enabled: true, detector: 'semantic' } },
  'nemos-v2-semantic': { ...base, invalidation: { enabled: true, detector: 'semantic' } },
  'nemos-v1-lexical': { ...base, invalidation: { enabled: true, detector: 'lexical' } },
  'nemos-no-invalidation': { ...base, invalidation: { enabled: false } },
  'nemos-no-decay': { reflect: base.reflect, decay: { enabled: false }, domains: { enabled: true }, invalidation: { enabled: true, detector: 'semantic' } },
  'nemos-no-domains': { reflect: base.reflect, decay: { enabled: true }, domains: { enabled: false }, invalidation: { enabled: true, detector: 'semantic' } },
};

// Run one benchmark item through Nemos.
//   item.sessions: [{speaker, text, contentDate?}]
//   isolatePersona: if true, persona statements go to forUser('persona:p'); else same user store.
// Returns: array of probe results [{ query, retrieved: [text...] }]
export async function runNemosItem(variant, item, { topK = 10, isolatePersona = true, searchLayers = undefined } = {}) {
  const features = VARIANTS[variant];
  if (!features) throw new Error('unknown variant ' + variant);
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-'));
  const mem = new Nemos({
    storage: { type: 'sqlite', path: join(dir, 'm.db') },
    llm: { provider: 'openai', apiKey: KEY, model: 'gpt-4o' },
    embedding: { provider: 'openai', apiKey: KEY, model: 'text-embedding-3-small' },
    features,
    worker: { manualWorker: true },
  });
  try {
    const user = mem.forUser('subject');
    const persona = mem.forUser('persona:companion');
    for (const s of item.sessions) {
      const target = (s.speaker === 'persona' && isolatePersona) ? persona : user;
      const opts = s.contentDate ? { contentDate: s.contentDate } : {};
      await target.ingest(s.text, opts);
    }
    if (features.reflect?.enabled) {
      await user.runReflect().catch(() => {});
      if (isolatePersona) await persona.runReflect().catch(() => {});
    }
    if (features.decay?.enabled && mem.workerHandle) {
      try { await mem.workerHandle().runDecayScan?.(); } catch {}
    }
    const out = [];
    for (const p of item.probes) {
      // user-fact probes always query the user store
      const hits = await user.search(p.query, { topK, layers: searchLayers });
      out.push({
        probe: p,
        retrieved: hits.map((h) => h.content),
        hits: hits.map((h) => ({ content: h.content, layer: h.layer, belief_state: h.belief_state ?? 'active' })),
      });
    }
    return out;
  } finally {
    mem.close?.();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
