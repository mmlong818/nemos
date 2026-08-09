# MnemoBench

> 状态：冻结研究快照（哈希与论文数字复核于 2026-08-10）。论文主表使用每项 50 条合成任务；原始结果、提交版本和文件哈希见 [`results/manifest.json`](./results/manifest.json)。

A reproducible benchmark for **memory maintenance** in long-lived LLM memory systems —
the behaviours that erode trust over time but that recall-centric benchmarks (LoCoMo,
LongMemEval) do not isolate in the same way:

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
reducing, but not eliminating, generation-model variance.

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
python -m pip install -r requirements-mem0.txt
python src/adapters/mem0_run.py --task BUC --n 50
node src/score-external.mjs --task BUC --sys mem0

# standard-benchmark cross-anchor: LongMemEval knowledge-update slice
curl -sL https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json \
  -o data/longmemeval/oracle.json          # ~15 MB, not vendored (upstream license)
node src/run-lme.mjs --n 30                 # nemos-v2-semantic vs no-invalidation, QA accuracy
```

> Note: the SDK must be built first — `cd ../sdk/typescript && npm run build`. The runner
> imports the compiled `dist/`.
>
> The model IDs in these commands are the frozen 2026 experiment configuration, not current
> model recommendations. Reproducing a run also requires preserving the provider, model
> revision, prompts, datasets, and result manifest; hosted APIs can still introduce variance.

## Interpreting the ablations

Each task changes one named mechanism while keeping the local runner configuration fixed:
invalidation for BUC, namespace isolation for ASP, and decay for FOR. The observed
differences are evidence consistent with those mechanisms, not proof of universal causal
effects across other datasets, providers, or deployments. mem0 is scored by the same judge
as an external reference point.

## License

Inherits the repository license (PolyForm-Noncommercial). The datasets are synthetic and
contain no real personal data.
