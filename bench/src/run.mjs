import './proxy-boot.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { runNemosItem } from './adapters/nemos.mjs';
import { judgeProbe } from './score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const RESULTS_DIR = join(__dirname, '../results');

// Intra-task variant concurrency. Lower when running multiple task-processes in
// parallel so the shared proxy isn't overwhelmed (ECONNRESET). Override via env.
const CONC = Number(process.env.MNEMO_CONC || 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry transient network failures (ECONNRESET / TLS disconnect / 429 / fetch failed).
// Each retry of runNemosItem rebuilds a fresh temp DB, so retries are idempotent.
async function withRetry(fn, label, tries = 6) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e) + ' ' + String(e?.cause?.code || e?.code || '');
      const transient = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket disconnected|fetch failed|terminated|429|timeout/i.test(msg);
      if (!transient || attempt === tries) break;
      const backoff = Math.min(30000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
      console.log(`  [retry ${attempt}/${tries}] ${label}: ${msg.slice(0, 80)} — wait ${backoff}ms`);
      await sleep(backoff);
    }
  }
  console.error(`  [give-up] ${label}: ${String(lastErr?.message || lastErr).slice(0, 120)}`);
  return null; // signal failure without aborting the whole run
}

// ── Variant configs ───────────────────────────────────────────────────────────

const BUC_VARIANTS = ['nemos-v2-semantic', 'nemos-v1-lexical', 'nemos-no-invalidation'];
const FOR_VARIANTS = ['nemos-v2-semantic', 'nemos-no-decay'];

// ── Data loading ──────────────────────────────────────────────────────────────

function loadItems(task, limit) {
  const path = join(DATA_DIR, `${task.toLowerCase()}.jsonl`);
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, limit > 0 ? limit : undefined);
  return lines.map((l) => JSON.parse(l));
}

// ── Concurrency helper (≤4 parallel) ─────────────────────────────────────────

async function pLimit(tasks, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ── BUC ───────────────────────────────────────────────────────────────────────

async function runBUC(items) {
  const perItem = [];

  // variants can run in parallel per item; items run serially
  for (const item of items) {
    const variantResults = await pLimit(
      BUC_VARIANTS.map((variant) => async () => {
        const probeResults = await withRetry(() => runNemosItem(variant, item, {
          topK: 10,
          isolatePersona: true,
          searchLayers: ['personal_semantic', 'semantic'],
        }), `${variant} ${item.id}`);
        if (!probeResults) return { variant, judged: [], failed: true };
        const judged = [];
        for (const { probe, retrieved } of probeResults) {
          const j = await withRetry(() => judgeProbe(probe, retrieved), `judge ${item.id}`);
          if (!j) continue;
          console.log(
            `[BUC][${variant}] item ${item.id} probe${judged.length}: exp=${j.contains_expected} forb=${j.contains_forbidden}`,
          );
          judged.push({ probe: probe.query, retrieved, judge: j });
        }
        return { variant, judged };
      }),
      CONC,
    );
    perItem.push({ id: item.id, variants: variantResults });
  }

  // summary
  const summary = {};
  for (const variant of BUC_VARIANTS) {
    let expHit = 0, forbHit = 0, n = 0;
    for (const { variants } of perItem) {
      const vr = variants.find((v) => v.variant === variant);
      if (!vr) continue;
      for (const { judge } of vr.judged) {
        n++;
        if (judge.contains_expected) expHit++;
        if (judge.contains_forbidden) forbHit++;
      }
    }
    summary[variant] = { UA: n > 0 ? expHit / n : 0, SLR: n > 0 ? forbHit / n : 0, n };
  }

  return { perItem, summary };
}

// ── ASP ───────────────────────────────────────────────────────────────────────

async function runASP(items) {
  const modes = [
    { label: 'isolate', opts: { isolatePersona: true } },
    { label: 'shared', opts: { isolatePersona: false } },
  ];
  const variant = 'nemos-v2-semantic';
  const perItem = [];

  for (const item of items) {
    const modeResults = await pLimit(
      modes.map((mode) => async () => {
        const probeResults = await withRetry(() => runNemosItem(variant, item, {
          topK: 10,
          ...mode.opts,
        }), `${variant}/${mode.label} ${item.id}`);
        if (!probeResults) return { mode: mode.label, judged: [], failed: true };
        const judged = [];
        for (const { probe, retrieved } of probeResults) {
          const j = await withRetry(() => judgeProbe(probe, retrieved), `judge ${item.id}`);
          if (!j) continue;
          console.log(
            `[ASP][${variant}/${mode.label}] item ${item.id} probe${judged.length}: exp=${j.contains_expected} forb=${j.contains_forbidden}`,
          );
          judged.push({ probe: probe.query, retrieved, judge: j });
        }
        return { mode: mode.label, judged };
      }),
      CONC,
    );
    perItem.push({ id: item.id, modes: modeResults });
  }

  // summary keyed by variant/mode
  const summary = {};
  for (const mode of modes) {
    const key = `${variant}/${mode.label}`;
    let expHit = 0, forbHit = 0, n = 0;
    for (const { modes: modeResults } of perItem) {
      const mr = modeResults.find((m) => m.mode === mode.label);
      if (!mr) continue;
      for (const { judge } of mr.judged) {
        n++;
        if (judge.contains_expected) expHit++;
        if (judge.contains_forbidden) forbHit++;
      }
    }
    // PR = pollution rate (forbidden), UFR = user-fact recall (expected)
    summary[key] = { PR: n > 0 ? forbHit / n : 0, UFR: n > 0 ? expHit / n : 0, n };
  }

  return { perItem, summary };
}

// ── FOR ───────────────────────────────────────────────────────────────────────

async function runFOR(items) {
  const perItem = [];

  for (const item of items) {
    const variantResults = await pLimit(
      FOR_VARIANTS.map((variant) => async () => {
        const probeResults = await withRetry(() => runNemosItem(variant, item, {
          topK: 10,
          isolatePersona: true,
          forTask: true,
        }), `${variant} ${item.id}`);
        if (!probeResults) return { variant, judged: [], failed: true };
        const judged = [];
        for (const { probe, retrieved } of probeResults) {
          const j = await withRetry(() => judgeProbe(probe, retrieved), `judge ${item.id}`);
          if (!j) continue;
          console.log(
            `[FOR][${variant}] item ${item.id} probe${judged.length}: exp=${j.contains_expected} forb=${j.contains_forbidden}`,
          );
          judged.push({ probe: probe.query, retrieved, judge: j });
        }
        return { variant, judged };
      }),
      CONC,
    );
    perItem.push({ id: item.id, variants: variantResults });
  }

  // summary: expected hit rate + trivia leak rate (contains_forbidden)
  const summary = {};
  for (const variant of FOR_VARIANTS) {
    let expHit = 0, forbHit = 0, n = 0;
    for (const { variants } of perItem) {
      const vr = variants.find((v) => v.variant === variant);
      if (!vr) continue;
      for (const { judge } of vr.judged) {
        n++;
        if (judge.contains_expected) expHit++;
        if (judge.contains_forbidden) forbHit++;
      }
    }
    summary[variant] = {
      IFR: n > 0 ? expHit / n : 0,      // Important-Fact Retention
      triviaLeak: n > 0 ? forbHit / n : 0, // trivia leak rate
      n,
    };
  }

  return { perItem, summary };
}

// ── Summary printing ──────────────────────────────────────────────────────────

function printSummaryBUC(summary) {
  console.log('\n===== BUC SUMMARY =====');
  console.log('variant                  UA        SLR       n');
  console.log('─'.repeat(55));
  for (const [v, r] of Object.entries(summary)) {
    console.log(
      `${v.padEnd(24)} UA=${(r.UA * 100).toFixed(1).padStart(5)}%  SLR=${(r.SLR * 100).toFixed(1).padStart(5)}%  n=${r.n}`,
    );
  }
}

function printSummaryASP(summary) {
  console.log('\n===== ASP SUMMARY =====');
  console.log('variant/mode                     PR        UFR       n');
  console.log('─'.repeat(60));
  for (const [k, r] of Object.entries(summary)) {
    console.log(
      `${k.padEnd(32)} PR=${(r.PR * 100).toFixed(1).padStart(5)}%  UFR=${(r.UFR * 100).toFixed(1).padStart(5)}%  n=${r.n}`,
    );
  }
}

function printSummaryFOR(summary) {
  console.log('\n===== FOR SUMMARY =====');
  console.log('variant                  IFR       triviaLeak  n');
  console.log('─'.repeat(58));
  for (const [v, r] of Object.entries(summary)) {
    console.log(
      `${v.padEnd(24)} IFR=${(r.IFR * 100).toFixed(1).padStart(5)}%  trivia=${(r.triviaLeak * 100).toFixed(1).padStart(5)}%  n=${r.n}`,
    );
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let task = 'BUC';
  let n = 0; // 0 = all
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) { task = args[i + 1].toUpperCase(); i++; }
    if (args[i] === '--n' && args[i + 1]) { n = parseInt(args[i + 1], 10); i++; }
  }
  return { task, n };
}

async function runTask(task, n) {
  const items = loadItems(task, n);
  console.log(`Running task ${task} on ${items.length} items …`);

  let result;
  if (task === 'BUC') {
    const { perItem, summary } = await runBUC(items);
    printSummaryBUC(summary);
    result = { task, timestamp: new Date().toISOString(), per_item: perItem, summary };
  } else if (task === 'ASP') {
    const { perItem, summary } = await runASP(items);
    printSummaryASP(summary);
    result = { task, timestamp: new Date().toISOString(), per_item: perItem, summary };
  } else if (task === 'FOR') {
    const { perItem, summary } = await runFOR(items);
    printSummaryFOR(summary);
    result = { task, timestamp: new Date().toISOString(), per_item: perItem, summary };
  } else {
    throw new Error(`Unknown task: ${task}`);
  }

  const outPath = join(RESULTS_DIR, `${task.toLowerCase()}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nResults written → ${outPath}`);
}

async function main() {
  const { task, n } = parseArgs();
  await runTask(task, n);
}

main().catch((e) => { console.error('RUN FAIL:', e); process.exit(1); });
