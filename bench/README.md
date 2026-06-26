# MnemoBench

A reproducible benchmark for **memory maintenance** in long-lived LLM memory systems —
the behaviours that erode trust over time but that recall-centric benchmarks (LOCOMO,
LongMemEval) don't isolate:

| Task | Question it asks | Primary metric (lower=better) |
|------|------------------|-------------------------------|
| **BUC** — Belief Update & Contradiction | When a fact changes, does the system return the *current* value and stop surfacing the stale one? | **Stale Leakage Rate** (guardrail: Update Accuracy) |
| **ASP** — Anti-Self-Pollution | Does the agent's own first-person / imagined content leak into the *user's* fact base? | **Pollution Rate** (guardrail: User-Fact Recall) |
| **FOR** — Forgetting & Salience | Does unreferenced trivia stop surfacing over time without losing important facts? | **Trivia Leakage** (guardrail: Important-Fact Retention) |

See [`DESIGN.md`](./DESIGN.md) for the full rationale, metrics, threats, and schema.

## Why ground truth is reliable

Each item's **fact script** (which attribute changes to what, in what order; which persona
statements are traps) is fixed by the generator *before* rendering to natural language.
Labels are therefore not post-hoc judgments. Scoring uses an **LLM judge that inspects only
the retrieved record set** and decides whether the expected fact is present and whether a
forbidden (stale/leaked) fact is presented as current — it never writes the final answer,
decoupling memory quality from generation quality.

## Layout

```
data/        frozen datasets (buc.jsonl, asp.jsonl, for.jsonl) — one JSON item per line
results/     metric outputs per system/task
src/
  gen/generate.mjs        synthetic data generator (gpt-4o; fact-script -> rendered sessions)
  run.mjs                 Nemos ablation runner (UA/SLR, PR/UFR, TL/IFR)
  adapters/nemos.mjs      Nemos adapter + ablation variants
  adapters/mem0_run.py    external baseline (mem0), same models, shared judge
  score.mjs               LLM judge (set-membership)
  score-external.mjs      scores any system's retrieved-sets with the same judge
  proxy-boot.mjs          routes Node fetch through HTTPS_PROXY (undici ignores it by default)
```

## Reproduce

```bash
npm install
export OPENAI_API_KEY=...            # LLM=gpt-4o, embeddings=text-embedding-3-small
# (behind a proxy) export HTTPS_PROXY=http://127.0.0.1:7897

# regenerate datasets (optional — frozen copies are committed)
node src/gen/generate.mjs --task all --n 50

# Nemos ablations
node src/run.mjs --task BUC --n 50    # semantic vs lexical vs no-invalidation
node src/run.mjs --task ASP --n 50    # namespace-isolated vs shared store
node src/run.mjs --task FOR --n 50    # decay-on vs decay-off

# external baseline (mem0), then score with the shared judge
python src/adapters/mem0_run.py --task BUC --n 50
node src/score-external.mjs --task BUC --sys mem0
```

> Note: the SDK must be built first — `cd ../sdk/typescript && npm run build`. The runner
> imports the compiled `dist/`.

## Ablation = attribution

Each task ablates exactly the mechanism under test, so any metric difference is attributable
to that mechanism (not to model or data): invalidation detector for BUC, namespace isolation
for ASP, decay for FOR. An external system (mem0) is scored by the identical judge as a
reference point.

## License

Inherits the repository license (PolyForm-Noncommercial). The datasets are synthetic and
contain no real personal data.
