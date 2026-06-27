import './proxy-boot.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { runLMEItem } from './adapters/longmemeval.mjs';
import { chatJSON, client, JUDGE_MODEL, GEN_MODEL } from './llm.mjs';

// LongMemEval knowledge-update slice: standard-benchmark cross-anchor.
// Methodology mirrors LongMemEval — generate an answer from retrieved memories, then an
// LLM judge scores correctness vs the gold answer. We ablate invalidation (semantic vs off)
// to show the maintenance mechanism helps on an external, recall-style benchmark.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, label, tries = 6) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try { return await fn(); } catch (e) {
      last = e;
      const m = String(e?.message || e) + ' ' + String(e?.cause?.code || e?.code || '');
      if (!/ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket disconnected|fetch failed|terminated|429|timeout/i.test(m) || a === tries) break;
      const b = Math.min(30000, 800 * 2 ** (a - 1)) + Math.floor(Math.random() * 400);
      console.log(`  [retry ${a}] ${label}: ${m.slice(0, 70)}`); await sleep(b);
    }
  }
  console.error(`  [give-up] ${label}: ${String(last?.message || last).slice(0, 100)}`);
  return null;
}

async function generateAnswer(question, retrieved) {
  const r = await client.chat.completions.create({
    model: GEN_MODEL, temperature: 0,
    messages: [
      { role: 'system', content: 'Answer the question using ONLY the provided memories about the user. Be concise. If the memories do not contain the answer, reply "I don\'t know".' },
      { role: 'user', content: `Memories:\n${retrieved.map((t) => '- ' + t).join('\n')}\n\nQuestion: ${question}` },
    ],
  });
  return r.choices[0].message.content.trim();
}

const JUDGE_SYS = `You grade whether a model answer is correct for a question, given the gold answer.
Knowledge-update questions test whether the latest value is reported (an outdated value is WRONG).
Output strict JSON: {"correct": true|false}. The answer is correct iff it conveys the gold answer's
information as current (minor phrasing/precision differences are fine; a stale/old value is incorrect).`;

async function judge(question, gold, modelAns) {
  const r = await chatJSON(JUDGE_MODEL, JUDGE_SYS,
    JSON.stringify({ question, gold_answer: gold, model_answer: modelAns }), 0);
  return !!r.correct;
}

const N = Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n') + 1] : 30);
const VARIANTS = ['nemos-v2-semantic', 'nemos-no-invalidation'];

async function main() {
  const all = JSON.parse(readFileSync('data/longmemeval/oracle.json', 'utf8'));
  const ku = all.filter((q) => q.question_type === 'knowledge-update').slice(0, N);
  console.log(`LongMemEval knowledge-update slice: ${ku.length} questions × ${VARIANTS.length} variants`);
  const summary = {};
  const perItem = [];
  for (const variant of VARIANTS) { summary[variant] = { correct: 0, n: 0 }; }
  for (const item of ku) {
    const row = { id: item.question_id, gold: item.answer, variants: {} };
    for (const variant of VARIANTS) {
      const res = await withRetry(async () => {
        const retrieved = await runLMEItem(variant, item, { topK: 12 });
        const ans = await generateAnswer(item.question, retrieved);
        const correct = await judge(item.question, item.answer, ans);
        return { ans, correct };
      }, `${variant} ${item.question_id}`);
      if (!res) continue;
      summary[variant].n++; if (res.correct) summary[variant].correct++;
      row.variants[variant] = res;
      console.log(`[LME-KU][${variant}] ${item.question_id}: correct=${res.correct} | ans="${res.ans.slice(0, 50)}" gold="${String(item.answer).slice(0, 40)}"`);
    }
    perItem.push(row);
  }
  console.log('\n===== LongMemEval KU SUMMARY =====');
  for (const v of VARIANTS) {
    const s = summary[v];
    console.log(`${v.padEnd(24)} accuracy=${(100 * s.correct / s.n).toFixed(1)}%  (${s.correct}/${s.n})`);
  }
  writeFileSync('results/longmemeval-ku.json', JSON.stringify({ task: 'LongMemEval-KU', n: ku.length, summary, per_item: perItem }, null, 2));
  console.log('\nwrote results/longmemeval-ku.json');
}
main().catch((e) => { console.error('LME FAIL:', e); process.exit(1); });
