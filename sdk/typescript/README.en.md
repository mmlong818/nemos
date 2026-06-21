# @nemos/sdk

[中文](README.md) | **English**

> **Embedded TypeScript memory system SDK** — give your AI product a piece of structured, persistable, portable memory infrastructure. Wire it up in 5 lines of code.

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)

---

## Understand it in 30 seconds

**What nemos is**: a source-available "memory system for AI applications" protocol + implementation. It takes the scattered conversations / notes / observations that an LLM application accumulates and decomposes them into 5 semantic layers (event / knowledge / about-the-user / habits / immutable original text), tags them with source / emotion / surprise metadata, and serves them up on demand for later AI calls.

**What nemos is not**:
- Not yet another vector database (a vector DB is one of its components, not the whole thing)
- Not a chat memory window replacement (its goal is **long-term memory across sessions and across agents**)
- Not an end-to-end conversational system (your AI application is its client; it is infrastructure)

**Why use it**:
- ✅ **5-line integration**: install the package, configure storage + an LLM key, call `ingest()` and `getRelevantContext()`, and you're running
- ✅ **Embedded deployment**: a single SQLite file, zero ops, your product owns its own data
- ✅ **Trustworthy design principles**: 12 founding principles ([RFC 0001](../../rfcs/0001-nemos-design-principles.md)) hold the hard lines like "AI is a servant, not an agent", "immutable original layer", and "decay by default + explicit retention"
- ✅ **Portable data**: dual-track export as JSON-LD + Markdown, never locked in
- ✅ **Auditable**: every memory carries source / chain_depth / authoritative, so you can trace whether the user said it directly or the AI inferred it

---

## 5-minute Quickstart

### 1. Install

```bash
npm install @nemos/sdk better-sqlite3
npm install @anthropic-ai/sdk   # or: npm install openai
```

### 2. Initialize

```typescript
import { Nemos } from '@nemos/sdk';

const mem = new Nemos({
  storage: { type: 'sqlite', path: './nemos.db' },
  llm: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
});
```

### 3. Use

```typescript
// each user gets a namespace-isolated UserMemory
const userMem = mem.forUser('user-abc');

// deposit: any input from the user
await userMem.ingest('Tonight I talked with my boss about project X; he wants delivery in Q4');

// retrieve: search relevant memories before the AI replies
const ctx = await userMem.getRelevantContext('project X');
// → drop it straight into the LLM prompt
```

That's it. This is the basic usage — the snippet above was tested for real in `examples/coding-agent/`.

---

## Scenarios (v0.2)

v0.2 adds **scenario awareness**: for the same content, it adjusts layer preferences, extraction emphasis, temporal awareness, and privacy behavior according to the scenario.

```typescript
// built-in profile (string reference)
await userMem.ingest(diaryText,   { scenario: 'diary' });        // auto sensitive + hide
await userMem.ingest(meetingNote, { scenario: 'meeting' });      // capture decisions / action items / event_at
await userMem.ingest(researchPdf, { scenario: 'doc-research' }); // zero personal_semantic (author ≠ user)

// custom object
await userMem.ingest(symptomLog, {
  scenario: {
    name: 'health-tracker',
    promptAddendum: 'symptoms/medication/sleep go to episodic with timestamps; patterns/triggers go to procedural',
    privacy: { sensitive: true },
    temporal: { extractEventDate: true },
  },
});
```

### 6 built-in profiles

| Name | Emphasis | Exclude | Privacy | Use case |
|---|---|---|---|---|
| `default` | no weighting | — | — | unspecified (= v0.1 behavior, backward compatible) |
| `chat` | episodic 1.5, personal_semantic 1.3 | — | — | chat conversation snippets |
| `doc-research` | semantic 1.5, procedural 1.4 | **personal_semantic** | — | research reports / technical docs (the third-party "I" is not the user) |
| `coding` | procedural 1.5, semantic 1.3 | — | — | code review / project notes |
| `diary` | episodic 2.0, personal_semantic 1.5 | — | **sensitive + hideFromSearch** | personal diary / emotional records |
| `meeting` | episodic 1.5, procedural 1.3 | — | — | meeting minutes / multi-person discussion |
| `voice-transcript` | episodic 1.4 | — | — | voice transcription |

See `examples/scenario-profiles/` for details.

### Full ScenarioProfile fields

```typescript
type ScenarioProfile = {
  name?: string;
  emphasis?: { layers?: Partial<Record<DerivedLayer, number>>; signals?: string[] };
  exclude?:  { layers?: DerivedLayer[] };           // hard filter
  promptAddendum?: string;                          // appended to the end of SYSTEM_PROMPT
  temporal?: { extractEventDate?: boolean };
  privacy?:  { sensitive?: boolean; hideFromSearch?: boolean };
  chunking?: { maxChars?: number; overlap?: number };  // default 8000 / 200
};
```

⚠️ A custom `promptAddendum` cannot loosen the hard constraints (archival is immutable, derived must be authoritative=false, personal_semantic refuses authoritative=true). The SDK enforces this as a client-side backstop.

---

## Temporal Awareness (v0.2)

Distinguishes two time fields:

| Field | Meaning | Source |
|---|---|---|
| `created_at` | the time the memory was **persisted** into nemos | written by the SDK (enforced) |
| `event_at` | the time the **event actually occurred** in the content | extracted by the LLM / overridden by `contentDate` |

```typescript
// let the LLM extract it: built-in chat/diary/meeting/doc-research all enable this
await userMem.ingest('Last Wednesday I chatted with Xiao Li about product direction', { scenario: 'chat' });
// → derived.event_at ≈ "2026-05-28" (inferred using the ingest moment as anchor)

// explicit override: the content's creation time is known
await userMem.ingest(legacyNote, { contentDate: '2024-03-15' });
// → archival.event_at = "2024-03-15"
```

`event_at` accepts an ISO 8601 day (`2026-05-30`), month (`2026-05`), or full datetime; non-ISO formats are dropped by the SDK. SQLite adds `idx_event_at_<layer>` indexes, so time-window queries become possible in the future.

---

## Long Content (v0.2)

Content over 10k characters is chunked automatically:

```
content (e.g. a 50k-char research report)
   │
   ▼
chunkContent(maxChars=8000, overlap=200)
   │
   ├─→ chunk 1 ─→ analyzeOnce(prof) ─→ derived[]
   ├─→ chunk 2 ─→ analyzeOnce(prof) ─→ derived[]
   └─→ chunk N ─→ analyzeOnce(prof) ─→ derived[]
                       │
                       ▼
                 merge + dedupe (layer + content)
                       │
                       ▼
                  IngestResult
```

**Key decision (RFC 0002 resolution C)**: when chunking triggers, `doubleCheck` is turned off automatically. Multiple chunks already constitute "cross-perspective redundancy", so stacking a double pass on top is poor value for the cost.

**Archival always stores the complete original text** — never chunked. Chunking only affects the LLM input path.

Splitting strategy: a three-level fallback from markdown sections (`## / ###`) → paragraphs (`\n\n`) → sentences (Chinese and English punctuation). Adjacent chunks share `overlap` characters at the boundary, so meaning isn't cut off.

---

## Sensitive Content (v0.2)

```typescript
// write: profile.privacy.sensitive=true → all derived tagged sensitive
await userMem.ingest(diaryText, { scenario: 'diary' });

// default search: sensitive is hidden
const r1 = await userMem.search('anxiety');        // → [] (even if there are matches)

// explicitly surface it
const r2 = await userMem.search('anxiety', { includeSensitive: true });

// listByLayer is not filtered (the user proactively lists)
const all = await userMem.listByLayer('episodic'); // → includes sensitive

// archival is always visible (user sovereignty — the original-text layer)
const arch = await userMem.listByLayer('archival'); // → included
```

Design trade-off (RFC 0002 resolution 2): archival is the original-text layer, the user has full sovereignty over what they wrote themselves, and it is always visible; derived is the AI-inference layer, which is hidden by default when sensitive to avoid accidental exposure.

---

## Background Ingestion (v0.3)

Long content + multi-perspective extraction takes 5-30s to return → a friend's AI product on the hot path can't afford the wait. v0.3 splits ingest into two stages:

- **archival is written synchronously** (< 50ms) — a guarantee of zero loss of the user's original text
- **derived / entity / linking go asynchronously** through a worker — not blocking the hot path

```ts
// still defaults to the synchronous path (v0.2 behavior)
const result = await userMem.ingest(content);
// result.derived is ready

// background mode: returns a handle immediately
const handle = await userMem.ingest(content, { background: true });
// handle.archival is persisted; handle.status='queued'

// check status
const info = await userMem.getIngestStatus(handle.id);
// info.status: 'queued' | 'analyzing' | 'completed' | 'failed'

// wait for completion (optional)
const done = await mem.waitForIngest(handle.id, 30000);

// list incomplete ones
const pending = await userMem.listPendingIngests();
```

### Worker configuration

```ts
new Nemos({
  ...,
  worker: {
    enabled: true,            // default true; false is equivalent to manualWorker
    pollIntervalMs: 1000,     // polling interval; tests can lower it to 50
    manualWorker: false,      // set true for serverless, call runWorkerTick() yourself
    maxAttempts: 3,           // retry count (backoff 1s/4s/16s)
  },
});

// Serverless: spawn a new process per request
await mem.runWorkerTick(); // blocks while running one queued task

// before the process exits
mem.stopWorker();  // or just mem.close()
```

### Crash recovery

If the process dies while a task is in `status='analyzing'`, the next time Nemos starts it is automatically reset to `'queued'`, and the `attempts` field guards against infinite retries.

---

## Multi-Perspective Extraction (v0.3)

v0.2's "same prompt, double pass + check" is helpless against the blind spots of a single prompt. v0.3 changes this to several specialized perspectives extracting in parallel + a merge:

```ts
new Nemos({
  ...,
  features: {
    perspectives: ['fact', 'method', 'decision'],
    // mutually exclusive with doubleCheck=true; enabling both throws
  },
});
```

| Perspective | What it focuses on | Preferred layers |
|---|---|---|
| `fact` | objective facts, data, comparisons, citations, concept definitions | semantic / reference types |
| `emotion` | emotional signals, relational interactions, attitude tendencies | episodic / personal_semantic |
| `method` | methodologies, processes, patterns, how-to, configuration | procedural |
| `decision` | decisions, commitments, action items, turning points | episodic / personal_semantic |
| `temporal` | timelines, event sequences (including event_at extraction) | episodic |

### Output fields

```ts
memory.source.perspectives = ['fact', 'decision']; // which perspectives saw it
memory.source.perspectives_conflict = false;        // conflict between perspectives?
memory.source.confidence = 'high' | 'medium' | 'low' | 'conflict';
```

### Confidence derivation (client-side rules)

- `perspectives.length >= 2` → `high`
- `perspectives.length == 1` → `medium`
- `perspectives_conflict == true` → `conflict`
- fallback → `low`

> We don't trust the confidence the LLM fills in itself; client-side rules are more predictable and auditable.

### Relationship with doubleCheck / chunking

- Not passing `perspectives` = the v0.2 `doubleCheck` path (backward compatible)
- When chunking triggers, `perspectives` is turned off automatically (multiple chunks already constitute cross-context redundancy)
- `doubleCheck: true` + `perspectives: [...]` passed together → throw

---

## Cross-Memory Linking (v0.3)

The "project X" mentioned in entry #100 and the "project X" in entry #7 are the same thing, but SDK v0.1/v0.2 don't know that. v0.3 adds:

- **Entity extraction**: after each memory is written, the worker extracts ≤ 10 entities (people / projects / concepts / tools)
- **String match**: uses FTS5 to find older memories containing the same entity
- **Bidirectional link**: the top-5 are written bidirectionally into `related: [id1, id2, ...]`
- **Spreading activation retrieval**: expands N=2 hops along `related`

```ts
// enabled by default
new Nemos({
  features: {
    autoLinking: true,        // default; false to turn off
    crossScopeLink: true,     // default; false to disable cross-scope
  },
});

// enable it during search
const results = await userMem.search('project X', {
  topK: 20,
  spreadingActivation: true,
});
```

### Hard constraints

- **Never link across user namespaces** (even a manual set won't be expanded by spreading)
- entity field: `memory.entities: string[]` (≤ 10)
- the same content is cached within the process to avoid the LLM re-extracting

### v0.4 candidate improvements

- entity alias table (merging "张三" / "Zhang San" / "@zhangsan")
- vector + entity hybrid linking
- dead-letter queue + manual retry

---

## Sensitivity Defaults (v0.4)

v0.2 added the `sensitive` field; v0.4 makes the default behavior fully effective and adds LLM detection guidance.

- The system prompt of every non-`diary` profile automatically appends `SENSITIVITY_GUIDANCE`:
  "Content touching health / finances / intimate relationships (spouse/partner/family) / emotional crisis / identity → tag sensitive=true"
- `SearchOptions.includeSensitive` defaults to `false` (consistent with v0.3; v0.4 documents it so the friend can see it)
- New `SearchOptions.sensitiveOnly` — the user proactively views only their own sensitive records

```ts
// default search hides sensitive
const r1 = await u.search('health topics');                  // default [] or excludes sensitive
const r2 = await u.search('health topics', { includeSensitive: true });
const r3 = await u.search('', { sensitiveOnly: true });       // sensitive set only
```

> archival is always visible (user sovereignty, RFC 0001 principle 4). sensitive applies only to derived.

Why doesn't diary re-append the guidance? The diary profile already carries `privacy.sensitive=true`, which forces everything to be tagged, so stacking guidance on top would be redundant noise.

When the friend first integrates v0.4, if `search()` returns empty and `includeSensitive` was not passed, the SDK gives a one-time hint through the logger: "may have hit the default-hide behavior".

---

## Output Formats (v0.4)

`getRelevantContext` gains a `format` field. Three forms:

| format | Calls LLM | Use case |
|---|---|---|
| `flat` (default) | No | v0.3 behavior: layer grouping + `_conf:_` / `_ai-inferred_` suffixes |
| `tiered` | No | H2 Chinese labels + inline `(high confidence)` |
| `narrative` | Yes | 1 LLM call to synthesize memories into prose paragraphs (no bullets / no headings) |

```ts
// flat: default, v0.3 compatible
await u.getRelevantContext(q);

// tiered: more readable, suited to human review / semi-structured prompts
await u.getRelevantContext(q, { format: 'tiered' });

// narrative: a "user profile" paragraph fed directly to a downstream agent
await u.getRelevantContext(q, { format: 'narrative' });
```

The narrative path requires an available LLM provider (it shares `config.llm` with ingest). On failure it degrades to tiered + a warning, without throwing.

---

## FSRS Decay (v0.4)

Let frequently used memories strengthen naturally and rarely used ones degrade naturally, with **archival permanently exempt**.

### Formula (simplified FSRS)

```
R = exp(-Δt / S)
Δt = (now - last_accessed) days
S  = stability (days, capped 365)
```

| Event | Operation |
|---|---|
| `search()` hit | `last_accessed = now`, `access_count++`, `S *= 1.3` (capped) |
| Worker periodic scan (once / 24h) | compute R; if R<threshold and access_count=0 and dormancy met → mark cold |
| After marked cold | hidden from search by default; `includeCold:true` to see it; `clearCold(id)` to undo |
| archival always | excluded from scan / always protected=true |

### Configuration

```ts
new Nemos({
  features: {
    decay: {
      enabled: true,           // default false (v0.4 opt-in; v0.5 changes to true)
      coldThreshold: 0.1,      // R below this value becomes a cold candidate
      coldDormancyDays: 7,     // how many days without access before it can go cold
      scanIntervalMs: 24*3600*1000,
      stabilityCapDays: 365,
    },
  },
});
```

### When does a memory go cold

- R<0.1 (well past the forgetting curve)
- access_count == 0 (never been retrieved even once)
- ≥ `coldDormancyDays` since `last_accessed`
- not archival (archival_protected)

### How to protect important memories

- A frequently accessed memory reinforces automatically when a search hits it, with no manual operation needed
- Things you temporarily don't want to see can be manually forgotten; for things you want to protect, you can design upper-layer UI that lets the user call `clearCold(id)`
- v0.5 plans to add a `protected` flag (explicit user lock)

### Migration

v0.3 → v0.4 automatically adds the columns `difficulty / retrievability / last_decay_at / archival_protected / cold / cold_at / consolidated_from_json / consolidated_at`. All archival is automatically set to `archival_protected=1` (a one-time backfill, idempotent).

---

## Reflect Consolidation (v0.4)

Simulates the memory consolidation of the brain's sleep phase: periodically distills multiple episodic entries into semantic / personal_semantic.

### Triggers

| Trigger | When |
|---|---|
| accumulating ≥ `autoTriggerThreshold` new episodic entries | automatically enqueued when the next `ingest()` completes |
| explicit call to `userMem.runReflect()` | runs immediately |
| external cron calling `mem.runWorkerTick()` | scheduled by the friend themselves |

### Output

Every reflect-derived entry must carry:

- `layer`: `semantic` or `personal_semantic`
- `source.origin`: `"reflect-consolidation"`
- `source.authoritative`: `false` (hard constraint)
- `consolidated_from`: the list of source episodic ids it references (must be real ids; fabricated ones are dropped)
- `consolidated_at`: ISO 8601

### Configuration

```ts
new Nemos({
  features: {
    reflect: {
      enabled: true,                 // default false (v0.4 opt-in)
      autoTriggerThreshold: 20,      // triggers after accumulating N new episodic entries
      includePersonalSemantic: true, // whether to include personal_semantic as an anchor
    },
  },
});
```

### Constraints

- **archival is never read / never modified** (reflect only produces new derived, it does not change existing archival)
- **never reflect across user namespaces** (tenantId + userId hard constraint)
- **`consolidated_from` must reference real episodic ids within this input set** — prevents the LLM from fabricating
- **derived authoritative=false is forced** — gated through `persistDerivedList`

### Cost estimate

Each run is ~3000 input + ~1500 output tokens ≈ Claude Sonnet $0.02.
Once per week per user ≈ $1/month (billed against the friend's LLM provider).

---

## Full API

### `new Nemos(config)`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `storage` | `{type:'sqlite',path}` \| `{type:'memory'}` | ✓ | — | SQLite file path; `memory` is for testing only |
| `llm` | LLMConfig | ✓ | — | see below |
| `embedding` | EmbeddingConfig | | `{provider:'none'}` | configured → semantic search; unconfigured → FTS5 |
| `defaultScope` | string | | `'global'` | default value for scope |
| `tenantId` | string | | `'default'` | spec day-1 multi-tenant field |
| `features.doubleCheck` | bool | | `true` | double pass + verification against LLM nondeterminism (mutually exclusive with `perspectives`) |
| `features.autoIngest` | bool | | `true` | `ingest()` runs the analyzer automatically |
| `features.perspectives` | `Perspective[]` | | `undefined` | v0.3 multi-perspective extraction; enabled by a non-empty array |
| `features.autoLinking` | bool | | `true` | v0.3 worker auto-extracts entities + bidirectional links |
| `features.crossScopeLink` | bool | | `true` | v0.3 cross-scope auto-linking (within the same user) |
| `worker.enabled` | bool | | `true` | v0.3 worker auto-polling |
| `worker.pollIntervalMs` | number | | `1000` | v0.3 worker polling interval |
| `worker.manualWorker` | bool | | `false` | v0.3 serverless mode |
| `worker.maxAttempts` | number | | `3` | v0.3 worker retry count |
| `logger` | function | | stderr | custom log sink |

### `mem.forUser(userId): UserMemory`

Each `userId` corresponds to a fully isolated namespace. Data between two users is never shared.

### `UserMemory.ingest(content, options?)`

**The most commonly used method.** Deposits the user's original text into nemos.

```typescript
const r = await userMem.ingest(
  'I like to get up at 6am to write',
  {
    scope: 'project:my-app',          // default 'global'
    originAgent: 'cursor',            // who triggered the write (for auditing)
    skipAnalysis: false,              // when true, stores only archival, skips the LLM
  }
);
// r.archival: 1 immutable original-text record
// r.derived:  N facts/preferences/habits extracted by the LLM
// r.verification_stats: statistics from the double pass (high/medium/conflicts)
```

### `UserMemory.write(input)`

Writes a single memory directly (bypassing the LLM). For cases where the upper-layer application already knows the classification.

```typescript
await userMem.write({
  layer: 'episodic',
  content: 'The user submitted PR #42 at 14:30',
  source: { authoritative: false, origin: 'cursor', chain_depth: 1 },
});
```

⚠️ **Guarded constraint**: `layer: 'personal_semantic'` + `source.authoritative: true` will be rejected (spec I4).

### `UserMemory.search(query, options?)`

```typescript
const results = await userMem.search('writing preferences', {
  layers: ['personal_semantic', 'semantic'],
  scope: 'global',
  topK: 10,
  confidenceMin: 'high',          // high confidence only
  authoritativeOnly: false,       // only what the user stated directly, no AI inferences
});
```

If `embedding` is configured → vector similarity retrieval. Otherwise it degrades to SQLite FTS5 BM25.

### `UserMemory.getRelevantContext(query, options?)`

A convenience wrapper over `search`: returns a ready-assembled markdown string directly, for you to drop into an LLM prompt.

```typescript
const ctx = await userMem.getRelevantContext('writing a new handler', {
  topK: 5,
  asMarkdown: true,        // default true
  maxTokens: 1000,         // a rough cap estimated as char/4
});
```

### `UserMemory.listByLayer(layer, options?)`

Lists the most recent N entries by layer (descending by created_at).

```typescript
const recent = await userMem.listByLayer('episodic', { limit: 20, offset: 0 });
```

### `UserMemory.export(format)`

```typescript
const jsonld = await userMem.export('json-ld');     // full schema serialization
const md = await userMem.export('markdown');         // each entry carries frontmatter
```

### `UserMemory.forget(memoryId)`

Soft-deletes a single non-archival memory. archival is never deleted (spec I3).

### `UserMemory.stats()`

```typescript
const s = await userMem.stats();
// { total, by_layer: {...}, by_scope: {...}, schema_version }
```

---

## Configuration in detail

### Storage

```typescript
// recommended for production
storage: { type: 'sqlite', path: './data/nemos.db' }

// testing only
storage: { type: 'memory' }
```

### LLM Provider

```typescript
// Anthropic (default claude-sonnet-4-6)
llm: { provider: 'anthropic', apiKey: '...', model: 'claude-sonnet-4-6' }

// OpenAI (default gpt-4o; JSON mode enabled automatically)
llm: { provider: 'openai', apiKey: '...', model: 'gpt-4o' }

// Zhipu GLM (default glm-5.1; OpenAI-compatible endpoint + JSON mode)
llm: { provider: 'zhipu', apiKey: process.env.ZHIPU_API_KEY!, model: 'glm-5.1' }

// fully custom (connect Ollama / a local model / your own gateway)
llm: {
  provider: 'custom',
  name: 'ollama-local',
  chat: async (system, user) => {
    const resp = await fetch('http://localhost:11434/api/chat', { ... });
    return (await resp.json()).message.content;
  },
}
```

### Embedding Provider

```typescript
// OpenAI (default text-embedding-3-small, 1536 dim)
embedding: { provider: 'openai', apiKey: '...' }

// Zhipu GLM (default embedding-3, 2048 dim)
embedding: { provider: 'zhipu', apiKey: process.env.ZHIPU_API_KEY! }

// custom (any function that can return a Float32Array)
embedding: {
  provider: 'custom',
  embed: async (text) => { /* your local ONNX / API */ },
  modelId: 'bge-small-zh-v1.5',
  dim: 512,
}

// off; search degrades to SQLite FTS5
embedding: { provider: 'none' }
```

---

## Data flow diagrams

### Ingest path

```
   user content
       │
       ▼
  ┌─────────┐
  │ Nemos  │
  │.ingest()│
  └────┬────┘
       │
       ▼
  ┌────────────────┐    SYSTEM_PROMPT_A
  │ double-pass    │ ─────────────────────┐
  │ extract        │    SYSTEM_PROMPT_B   │
  │ (default on)   │                      ▼
  └────────┬───────┘       ┌──────────────────────┐
           │               │ Pass A: N derived    │
           │               │ Pass B: M derived    │
           │               └──────────┬───────────┘
           │                          │
           │                          ▼
           │               ┌──────────────────────┐
           │               │ CHECK_SYSTEM_PROMPT  │
           │               │ merge + confidence   │
           │               │ high/medium/conflict │
           │               └──────────┬───────────┘
           │                          │
           ▼                          ▼
  ┌───────────────────────────────────────────┐
  │ hard-constraint backstop:                 │
  │  - archival.content = original text (I3)  │
  │  - derived.authoritative = false          │
  │  - personal_semantic rejects auth=true(I4)│
  └────────────────┬──────────────────────────┘
                   │
                   ▼
  ┌──────────────────────────────────────┐
  │ SQLite (5 tables + FTS5 + emb)        │
  │ archival write trigger rejects update │
  └──────────────────────────────────────┘
```

### Search path

```
  query string
       │
       ▼
  ┌───────────────────────┐
  │ embedding configured? │
  └────┬─────────────┬────┘
   yes │             │ no
       ▼             ▼
  ┌──────────┐  ┌──────────┐
  │ vector   │  │ FTS5 BM25│
  │ search   │  │          │
  │ cosine   │  │          │
  └────┬─────┘  └────┬─────┘
       │             │
       └──────┬──────┘
             ▼
  ┌──────────────────────┐
  │ filters:             │
  │  - layers            │
  │  - scope             │
  │  - confidenceMin     │
  │  - authoritativeOnly │
  └──────────┬───────────┘
             │
             ▼
        Memory[]
```

---

## Integration scenarios

| Scenario | Example |
|---|---|
| Chat product (remember user preferences across conversations) | [`examples/chat-product/`](examples/chat-product/) |
| Document / note search | [`examples/doc-search/`](examples/doc-search/) |
| Coding agent (cross-session preferences) | [`examples/coding-agent/`](examples/coding-agent/) |

---

## FAQ

### Performance?

- **Writes**: with the default `doubleCheck:true` → 3 LLM calls, ~3-8s per entry (Sonnet). Turn it off for a single pass, ~1-3s per entry.
- **Reads**: SQLite + in-memory cosine is < 50ms on a < 10k-entry dataset. An embedding API call is around 100-300ms.
- **Data scale**: v0.1 suits < 100k entries per user (more than enough for long-term personal use).

### Data migration?

- **Schema upgrades**: every record carries `schema_version`, forward compatible within the v0.x range. Across minors it goes through a migration adapter (built in from v0.2+).
- **Cross-SDK migration**: `export('json-ld')` → any v0.x can import it (spec §11.3 promise).
- **embedding model upgrades**: every record carries `embedding_model_id`, for lazy re-embedding in the future.

### E2EE?

Not supported in v0.1. Spec §10 designs an E2EE SKU (client-side keys / client-side embedding / client-side HNSW), which belongs to SKU b. On the v0.2+ roadmap.

### Backups?

Just `cp` that SQLite file. It is single-process exclusive, so close the SDK instance before backing up:

```typescript
mem.close();
// now you can safely cp nemos.db backup-2026-06-04.db
```

### My product already has a database, can I integrate it?

Yes — `Nemos` uses its own SQLite file, independent of your existing database. You can also use `storage: { type: 'memory' }` to run during tests. In the future v0.2+ will add `{ type: 'remote', endpoint }` to abstract this layer away.

### Multiple agents sharing the same user's memory?

Yes. Have all agents call `forUser(userId)` with the same `userId`, then use the `originAgent` field to mark who wrote it. Later v0.2+ adds capability/agent signatures for cross-agent collusion protection (spec §7).

### Version compatibility promise?

- **Within v0.x**: minor versions are backward compatible, cross-minor goes through migration
- **v1.0+**: schema changes go through an RFC + a 6-month deprecation window
- **Export schema**: always backward compatible

---

## Comparison with existing solutions

| Dimension | mem0 | Letta (MemGPT) | Memory-Palace | **nemos** |
|---|---|---|---|---|
| Layered storage | ❌ single-pool vector | ✅ three tiers (core/recall/archival) | ✅ multi-layer | ✅ **5 layers + three-dimensional metadata** |
| Immutable original layer | ❌ | ❌ | partial | ✅ **I3 invariant + DB trigger** |
| Anti AI self-pollution | ❌ | ❌ | ❌ | ✅ **I4: personal_semantic rejects derived** |
| Decay by default | ❌ | ❌ | ✅ | ✅ + 12 classes of explicit retention signals |
| Cross-vendor portability | partial | partial | ❌ | ✅ **JSON-LD + Markdown dual-track** |
| Open protocol | proprietary API | open-source code | ❌ | ✅ **both protocol + ref impl open-source** |
| Deployment | SaaS-first | self-host + cloud | research | ✅ **embedded / self-hosted / SaaS, three tiers** |
| Design RFC | none | none | paper | ✅ **founding RFC + 5 specs** |

For a detailed comparison see [`docs/architecture-overview.md`](../../docs/architecture-overview.md).

---

## Design principles (for advanced users)

The complete 12 founding principles are in [`rfcs/0001-nemos-design-principles.md`](../../rfcs/0001-nemos-design-principles.md).

The 5 most critical:

1. **AI is a servant, not an agent** — LLM inferences are always tagged `authoritative=false`, and never disguised as a user statement
2. **Layered storage, separate-channel processing** — the CLS insight: fast/slow layering prevents catastrophic forgetting
3. **Decay by default + explicit retention** — not "remember everything" (the Funes pathology)
4. **Immutable archive + mutable interpretation layer** — the original text never changes, understanding can stack new versions on top
5. **Three-dimensional metadata enforced** — source / arousal / surprise are required

---

## Known Limitations & Future Work (v0.4+)

v0.3 already implemented: B2 background ingest queue / B4 multi-perspective extraction / B5 cross-memory auto-linking.
v0.4+ items not yet done (please be aware before production):

1. **FSRS not wired up** — still uses a single float `stability` field, the full FSRS three-parameter model is not connected. The R1-R12 signals of spec §9 do not yet trigger stability adjustment. **Planned for v0.4**.
2. **Reflect offline job not done** — the Episodic → Semantic abstraction currently happens only on the real-time ingest path. There is no nightly job doing higher-order abstraction / contradiction detection. **Planned for v0.4**.
3. ~~**Sensitivity tagging not auto-detected by default**~~ — ✅ implemented in v0.4 B6 (SENSITIVITY_GUIDANCE auto-appended to non-diary prompts).
4. ~~**Output formatting tiers not done**~~ — ✅ implemented in v0.4 B7 (`format: 'flat' | 'tiered' | 'narrative'`).
5. **Dead-letter queue not done** — after a worker fails N times it only marks `'failed'` + logs. **Planned for v0.5**: DLQ + manual retry API (RFC 0003 resolution 1).
6. **Entity alias table not done** — "张三" / "Zhang San" / "@zhangsan" won't be merged. **Planned for v0.5** (RFC 0003 resolution 2).
7. **Vector + entity hybrid linking** — v0.3 is entity exact-match only. **Planned for v0.5** (RFC 0003 Alternative C).
8. **Worker parallel processing** — v0.3 is single-threaded serial, throughput is limited. **Planned for v0.5**.

### New limitations added in v0.4 / left for v0.5+

23. **FSRS D parameter not enabled** — the v0.4 simplified version uses only the S/R two parameters (formula `R=exp(-Δt/S)`). The full FSRS includes the D (difficulty) parameter, left for v0.5.
24. **Reflect monthly / yearly reports not done** — v0.4 reflect outputs independent derived, not strung into time-window reports. **Planned for v0.5+**.
25. **User-initiated protected-flag lock not done** — archival is permanently protected, but important memories among derived (such as an annual anniversary) may be hit by cold by mistake. **Planned for v0.5**: `Memory.protected: true` for explicit user lock.
26. **multi-modal memory (images / audio) not done** — v0.4 is still text only. **Planned for v0.5+**.
27. **Cold storage secondary table** — currently cold is only a flag bit, still occupying main-table space; at large scale, migrating to a dedicated cold table could be considered. **Planned for v0.5+**.
28. **Narrative caching** — every `getRelevantContext({format:'narrative'})` calls the LLM; a query→narrative LRU cache could be added. **Planned for v0.5+**.
9. **Relational store not done** — cross-user shared memory goes through an independent ACL model (spec §7.4 + §2.7).
10. **E2EE not done** — the client-side encryption / client-side embedding / client-side HNSW designed in spec §12 is not implemented.
11. **Lifetime Period not done** — the "go back to me last Tuesday" time-travel query of spec §8 is not implemented (but `event_at` is already in place).
12. **id is not content-addressed** — still uses UUID v4 (with a type prefix). spec §3.1 requires `<prefix>_sha256(canonical_json)`. The prefix form is locked, with lossless migration in the future.
13. **content_hash deduplication not implemented** — archival writes don't check for duplicates.
14. **audit.mutations not recorded** — only created_at / last_accessed / access_count.
15. **embedding model migration not done** — replacing the embedding model in the future requires re-embedding the whole store; there's no automated mechanism yet.
16. **Multi-device sync not done** — single-device local SQLite.
17. **Agent signatures (Ed25519) not done** — the cross-agent collusion protection of spec §7.3 is not implemented.
18. **Proposal queue not done** — spec §2.3.2 mentions that personal_semantic should be written through a proposal queue (user approval). v0.1+ still simplifies to directly rejecting authoritative=true.
19. **sqlite-vec ANN not enabled** — uses the JS built-in cosine full scan. Enough at < 10k scale; at > 10k, switch to sqlite-vec (a hook is already reserved).
20. **`scenario: 'auto'` not done** — requires the friend to declare the scenario explicitly; auto-detection is still a v0.4+ candidate (RFC 0002 Alternative B).
21. **Cross-chunk entity association** — when chunking, each chunk is analyzed independently, and references to the same entity across chunks may produce duplicate derived (v0.2 backstops with layer+content lowercase dedupe, but it's not perfect).
22. **Relative-time anchor** — `event_at` extraction relies on the LLM parsing "yesterday" / "last week"; the SDK does not force the parse (the prompt guides but does not strictly validate).

---

## v0.3's alignment with the nemos spec

> This is a comparison table handed off to the maintainer.

### 100% implemented

| Spec requirement | Status |
|---|---|
| `tenant_id` + `user_id` namespace isolation (spec §1) | ✅ every row in the SQLite tables carries these two columns |
| `archival` table INSERT-only (spec §2.5 + I3) | ✅ enforced by a SQLite trigger |
| `source.kind` enum + `source.authoritative` dual-write (spec §3 #5,#7) | ✅ |
| `source.chain_depth` monotonically increasing (spec §3 #6) | ✅ derived forced ≥ 1 |
| `archival_ref` field (spec §3 #8) | ✅ all derived point back to archival.id |
| `schema_version` field (spec §3 #4) | ✅ required on every record; new writes get `"0.3"`; old records keep `"0.1"` / `"0.2"` |
| `related` field + cross-memory bidirectional link (spec §3 #14) | ✅ filled automatically by the v0.3 worker |
| background ingest queue + failure retry + crash recovery (spec §11 ops) | ✅ v0.3 |
| multi-perspective extraction (5 perspectives + merge) | ✅ v0.3, confidence derived client-side |
| `scope_id` three-part form (spec §7.1) | ✅ 'global' / 'project:xxx' / 'task:xxx' |
| `ownership.kind` enum (spec §3 #10) | ✅ defaults to 'self' |
| `embedding_model_id` field (spec §3 #11) | ✅ on every record that carries an embedding |
| Personal Semantic rejects `authoritative=true` (spec §2.3.2 + I4) | ✅ enforced at the SDK write layer |
| Import/Export dual-track (spec §10.1) | ✅ JSON-LD + Markdown |
| three-dimensional metadata enforced (spec §4) | ✅ every record has source / arousal / surprise |

### Simplified

| Spec requirement | v0.1 simplification |
|---|---|
| `id = <prefix>_sha256(canonical_json)` (spec §3.1) | UUID v4 + type prefix; the prefix form is locked, allowing a smooth transition in the future |
| FSRS three-parameter decay (spec §9) | single float `stability` field, no decay logic |
| complete `audit.mutations[]` (spec §2.0.1) | only created_at/last_accessed/access_count |
| `surprise.value` is bits (spec §4.3) | uses a 0-1 normalized value |
| `content_hash` SHA256 deduplication (spec §2.5) | not implemented |
| Lifetime Period (spec §8) | not implemented |
| Relational Store (spec §2.7 / §7.4) | not implemented |
| E2EE field-level visibility (spec §12) | not implemented (SQLite plaintext) |
| Migration adapter registry (spec §11.4) | not implemented (v0.1 single version) |
| Capability JWT (spec/20-rest-api.md) | not implemented (embedded SDK needs no auth) |

### Intentional deviations

| Spec | SDK v0.1 |
|---|---|
| spec/40-sdk-contract.md is a **remote client** (→ REST → server) | SDK v0.1 is an **embedded direct connection to SQLite** (no server). This is hard constraint 1 of this task. A future v0.2 can add `storage: { type: 'remote' }` to switch back to the spec design |
| `proposePersonalSemantic` goes through a proposal queue | v0.1 directly rejects authoritative=true (stricter but lacks the user-approval UX) |

---

## The 3 features the friend should most wait for when upgrading to v0.2

1. **FSRS decay + 12 classes of retention signals** — makes "what to remember and what to forget" truly effective. Currently all memories have a uniform lifecycle, which over the long term turns into noise.
2. **Reflect offline job** — Episodic → Semantic abstraction + contradiction detection, letting the memory system "review". Needs LLM credentials + a timer.
3. **E2EE SKU** (spec §12) — client-side keys + client-side embedding, a hard requirement for sensitive scenarios.

---

## PR suggestions for the maintainer (implementation order)

Ordered by "leverage / unlocking follow-on features":

1. **Add content-addressed ids** (spec §3.1)
   - Replace `randomUUID` in `utils/id.ts` with `sha256(canonical_json)`
   - Add a migration that recomputes ids across the whole store (with a mapping table)
   - Unlocks: cross-vendor id verification, deduplication, lossless import

2. **Abstract the storage layer interface to be pluggable**
   - The `Storage` interface is already done
   - Add a `PostgresStorage` implementation → unlocks multi-user SaaS deployment
   - Add a `RemoteStorage` → switches back to the remote-client model of spec/40-sdk-contract.md

3. **Wire up FSRS**
   - Add `src/decay.ts` using the ts-fsrs library
   - On a `search()` hit, update `last_accessed` and run an FSRS step
   - Add a nightly cron hook (the user wires up their own setInterval or cron)

4. **Proposal queue**
   - Add a `proposals` table to storage
   - `proposePersonalSemantic(input)` + `listProposals()` + `approveProposal(id)`
   - Replaces the v0.1 "hard-reject authoritative=true" logic

5. **Full audit.mutations recording**
   - Append a MutationEntry on every write/update
   - Unlocks: compliance auditing + the basis for time-travel queries

---

## License

PolyForm Noncommercial 1.0.0 (noncommercial use only) © Nemos contributors. See [LICENSE](LICENSE). Commercial use requires separate licensing.

nemos is a source-available protocol + implementation. You may use, modify, and embed it into your product for noncommercial purposes. The only requirement: keep the license header + a statement of changes.

---

## Project links

- Main repo: [nemos-org/nemos](https://github.com/nemos-org/nemos)
- Spec: [`spec/`](../../spec/)
- RFCs: [`rfcs/`](../../rfcs/)
- Architecture overview: [`docs/architecture-overview.md`](../../docs/architecture-overview.md)
- Design principles (must-read): [`rfcs/0001-nemos-design-principles.md`](../../rfcs/0001-nemos-design-principles.md)
