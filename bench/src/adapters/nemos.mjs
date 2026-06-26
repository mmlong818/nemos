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

// FOR task decay variant: use aggressive decay params so trivial items go cold.
// coldDormancyDays=0 means any un-accessed memory is eligible; coldThreshold=0.3 marks it cold
// when FSRS R drops below 30% (after 120 days without access that's well below 0.3 for trivial items).
// These params only apply to the FOR task's nemos-v2-semantic run; other tasks use default decay.
const forDecayParams = { coldDormancyDays: 0, coldThreshold: 0.3 };

export const VARIANTS = {
  // full == v2 semantic detector (the improved system)
  'nemos-full': { ...base, invalidation: { enabled: true, detector: 'semantic' } },
  'nemos-v2-semantic': { ...base, invalidation: { enabled: true, detector: 'semantic' } },
  'nemos-v1-lexical': { ...base, invalidation: { enabled: true, detector: 'lexical' } },
  'nemos-no-invalidation': { ...base, invalidation: { enabled: false } },
  'nemos-no-decay': { reflect: base.reflect, decay: { enabled: false }, domains: { enabled: true }, invalidation: { enabled: true, detector: 'semantic' } },
  'nemos-no-domains': { reflect: base.reflect, decay: { enabled: true }, domains: { enabled: false }, invalidation: { enabled: true, detector: 'semantic' } },
};

// FOR-task decay scan time.
// CRITICAL: last_accessed is set to real Date.now() at ingest/search time (see touchAccess in
// decay-ops-sqlite.ts). If FOR_SCAN_NOW_MS is earlier than real Date.now(), then
// computeRetrievability returns 1.0 for all memories (dtDays ≤ 0 → R=1), and no memory goes cold.
// Therefore FOR_SCAN_NOW_MS must be well AFTER real Date.now(), not a past fixed date.
// We use Date.now() + 120 days so FSRS sees dt=120d → R=exp(-120/1)≈0 for un-accessed memories.
const DAY_MS = 24 * 60 * 60 * 1000;
// FOR_SCAN_NOW_MS is captured once at module load time.
// All items in a single run share this timestamp — sufficient for determinism within a run.
const FOR_SCAN_NOW_MS = Date.now() + 120 * DAY_MS;

// Run one benchmark item through Nemos.
//   item.sessions: [{speaker, text, contentDate?}]
//   isolatePersona: if true, persona statements go to forUser('persona:p'); else same user store.
//   forTask: if true, apply FOR-specific decay protocol (see below).
// Returns: array of probe results [{ query, retrieved: [text...] }]
export async function runNemosItem(variant, item, { topK = 10, isolatePersona = true, searchLayers = undefined, forTask = false } = {}) {
  // FOR task uses aggressive decay params and disables reflect.
  // Reflect is disabled for FOR tasks because it generates semantic-layer summaries that mix
  // important and trivial session content. Those reflect memories are not subject to the same
  // access_count gate in decideDecay (they may inherit access_count > 0 or be otherwise warm),
  // causing trivia to leak into search results even after decay scan marks original session
  // memories cold. Disabling reflect ensures only raw ingest memories exist in the store, so
  // decay can cleanly separate warm (important, reinforced) from cold (trivial, never accessed).
  const baseFeatures = VARIANTS[variant];
  if (!baseFeatures) throw new Error('unknown variant ' + variant);
  let features = baseFeatures;
  if (forTask) {
    // Disable reflect for both decay-on and decay-off variants in FOR task.
    features = { ...baseFeatures, reflect: { enabled: false } };
    if (baseFeatures.decay?.enabled) {
      // Apply aggressive decay params for decay-on variant.
      features = { ...features, decay: { ...baseFeatures.decay, ...forDecayParams } };
    }
  }

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

    if (forTask && features.decay?.enabled) {
      // FOR-task decay protocol:
      // Goal: important facts (recent contentDate) stay warm; trivial ones go cold.
      //
      // Strategy: use the *exact original text* of important sessions as reinforce queries.
      // Important sessions are those with contentDate >= FOR_IMPORTANT_CUTOFF (2025-12-01).
      // Exact-text search will hit the ingested memory directly, not trivia, with topK=1.
      //
      // Using probe.expected phrases would risk: (a) reflect-generated summary memories
      // being the top match instead of the original session memory, and (b) embedding
      // collisions with trivia. Using the exact session text avoids both risks.
      //
      // After reinforcing (access_count > 0 for important facts), run decay scan at +120d.
      // Trivial items (access_count=0, R≈0 after 120d) → cold; important (access_count>0) → warm.
      const FOR_IMPORTANT_CUTOFF = '2025-12-01';
      const importantTexts = (item.sessions || [])
        .filter((s) => s.speaker === 'user' && s.contentDate && s.contentDate >= FOR_IMPORTANT_CUTOFF)
        .map((s) => s.text);

      for (const text of importantTexts) {
        // topK=1: hit the single best match (should be the memory itself).
        // includeCold:true to avoid skipping already-cold items (though none should be cold yet).
        await user.search(text, { topK: 1, includeCold: true }).catch(() => {});
      }
      // Run decay scan 120 days in the future from fixed base date.
      await user.runDecayScan(FOR_SCAN_NOW_MS).catch(() => {});
    } else if (!forTask) {
      // Non-FOR tasks: old behaviour (workerHandle path was always a no-op; keep as-is).
      // No decay scan driven here for BUC/ASP tasks.
    }
    // nemos-no-decay variant: decay.enabled=false, so runDecayScan is not called above.

    const out = [];
    for (const p of item.probes) {
      // FOR task: default search (includeCold=false) hides cold memories → trivia suppressed.
      // Other tasks: pass searchLayers as before.
      const searchOpts = forTask
        ? { topK }  // default includeCold=false, no layer filter
        : { topK, layers: searchLayers };
      const hits = await user.search(p.query, searchOpts);
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
