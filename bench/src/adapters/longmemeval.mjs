import '../proxy-boot.mjs';
import { createRequire } from 'module';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VARIANTS } from './nemos.mjs';

const require = createRequire(import.meta.url);
const { Nemos } = require('../../../sdk/typescript/dist/index.js');
const KEY = process.env.OPENAI_API_KEY;

// Ingest a LongMemEval oracle item's evidence sessions into Nemos, then retrieve for the question.
// Sessions are chronological; each user turn is ingested as a user memory with the session date,
// so bitemporal invalidation can supersede earlier values with later ones.
// Returns retrieved memory contents (active, consolidated+episodic layers).
export async function runLMEItem(variant, item, { topK = 12 } = {}) {
  const features = VARIANTS[variant];
  if (!features) throw new Error('unknown variant ' + variant);
  const dir = mkdtempSync(join(tmpdir(), 'lme-'));
  const mem = new Nemos({
    storage: { type: 'sqlite', path: join(dir, 'm.db') },
    llm: { provider: 'openai', apiKey: KEY, model: 'gpt-4o' },
    embedding: { provider: 'openai', apiKey: KEY, model: 'text-embedding-3-small' },
    features,
    worker: { manualWorker: true },
  });
  try {
    const u = mem.forUser('lme');
    const sessions = item.haystack_sessions || [];
    const dates = item.haystack_dates || [];
    for (let i = 0; i < sessions.length; i++) {
      const date = dates[i];
      const contentDate = date ? new Date(date).toISOString().slice(0, 10) : undefined;
      for (const turn of sessions[i]) {
        if (turn.role !== 'user') continue;
        const opts = contentDate ? { contentDate } : {};
        await u.ingest(turn.content, opts);
      }
    }
    if (features.reflect?.enabled) await u.runReflect().catch(() => {});
    const hits = await u.search(item.question, { topK, layers: ['personal_semantic', 'semantic', 'episodic'] });
    return hits.map((h) => h.content);
  } finally {
    mem.close?.();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
