# Nemos

[中文](README.md) | **English**

> A local-first AI work and companion client whose characters remember you, use tools, execute tasks, and deliver results.

---

## Why we built it

Most chatbots stop at a reply. They do not reliably retain long-term preferences or carry work through to a downloadable deliverable.

Nemos combines an independent long-term memory engine with the Nemos Companion client and Agent Runtime. Characters remember preferences, changes, and conversation boundaries while authorized tools can read web pages and images, process speech and documents, run background jobs, and return results to the chat.

Memory, task history, and artifacts stay local by default. A regular user only needs one Zhipu API key to start.

**Companionship is the entry point; memory and execution are the core.**

## Who is in your contacts

The default contact list stays focused. Additional characters can be added from the plus button beside search, and users can create groups:

- **Zhiwei**: the default personal assistant and the single dispatcher for capabilities, tasks, and delivery.
- **Feifei and Tuanzi**: everyday conversation and companionship.
- **Azhe and Lingling**: optional contacts for practical judgment and quiet companionship.
- **Musk, Jobs, Munger, and Socrates**: distinct reasoning styles for difficult questions.
- **Bezos and additional specialists**: strategy, product, engineering, design, testing, market, and business analysis.

The user avatar and every character's name, avatar, persona, and voice can be edited and persisted independently. In groups, mentioning a character routes the request to that character without making everyone respond. Search, OCR, documents, tasks, and external tools remain under Zhiwei's execution control.

---

## What Nemos Companion can do

- **Natural interaction**: text, images, screenshots, voice messages, and voice calls; bubbles support Markdown, HTML, and downloadable files.
- **Content work**: web reading, image understanding, OCR, long-audio transcription, meeting notes, rewriting, and document conversion.
- **Real delivery**: research and analysis can be saved as Markdown or HTML and opened from the conversation.
- **Durable jobs**: scheduled or turn-based collection, briefing, and monitoring with recoverable run, retry, cancel, and delivery state.
- **Extensible capabilities**: install, disable, update, and remove Skills; connect MCP tools behind permissions, approvals, credential brokering, and sandboxes.
- **Controlled expert collaboration**: Zhiwei can invite 2-4 specialists, apply fixed budgets and review, and return one final result to the active chat.

See the [Agent Runtime design](sdk/typescript/examples/companion/docs/agent-runtime-design.md) and [Capability OS design](sdk/typescript/examples/companion/docs/capability-os-design.md) for implementation and security boundaries.

---

## The memory system: the core (the whole app exists for this one thing)

This memory system (Nemos) can be lifted out and used on its own — it isn't welded to the companion layer; the companion is just its first application. It's not "dump chat logs into a vector store" — it's a **structured, evolving, traceable** memory engine. These mechanisms are exactly why the companion "really seems to remember you."

**① Layered memory, not one bag of vectors**
Memory isn't a flat pile of text — it's split into five layers, each with a job:

| Layer | Holds | Example |
|---|---|---|
| episodic | concrete events that happened | "last Wednesday you crunched on a deck till 3am" |
| semantic | objective facts | "you do brand design" |
| personal_semantic | preferences / profile about *you* | "you dislike flashy color schemes" |
| procedural | how you do things / habits | "you write in the mornings" |
| archival | raw, unprocessed words | a backup of everything you said |

Answering "what do you like" vs. "what happened last Wednesday" hits different layers — instead of dumping the whole chat log into the model.

**② Extraction + reflection: a profile grows from scattered talk**
What you say lands in the archival layer first; in the background, **asynchronously**, the facts are extracted and filed into the right layers (it doesn't block replies — you get an answer immediately, the memory settles in the background). As you talk more it triggers "reflect": consolidating scattered episodes into a more stable profile (e.g. "tends to be productive in the morning"), and maintaining the mechanisms below along the way.

**③ One source of truth, consistent across characters**
Facts about you live in exactly one place. Each character only sees what it should within the conversation boundary it's "present" in: things said in a group are remembered by everyone present, private things told to one person stay hidden from others, and characters not present can't see the group's content.

**④ Sparse activation by domain (MoE)**
Memories self-organize into "domains" by topic (incubated offline by reflect). On retrieval it first routes to the **relevant domain** and brings up only that domain's memories, down-weighting the rest — four-tier activation: shared layer (always on) → primary domain rises to top → adjacent domains next → then one "cross-domain hop" along memory links to pull in related memories from other domains. This stays precise as scale grows, instead of stuffing the whole memory into the prompt every retrieval. It's soft isolation: on low confidence it falls back to global search, so a routing miss never drops anything. Rare among similar projects.

**⑤ Self-correcting, doesn't dredge up the past (bi-temporal + contradiction invalidation)**
Every memory carries a "when it was true" timeline and a belief state. The moment you change your mind ("I moved to Shanghai"), the new fact **invalidates** the old one rather than physically deleting it — history stays auditable, but retrieval returns only what's currently valid by default. So characters rarely embarrass themselves with stale info, and won't dredge up something you already corrected.

**⑥ Anti-self-pollution**
A character's own made-up "recent life" and "facts about you" are **physically isolated** in storage (separate namespace, marked non-authoritative) and never written back into your memory. What the model says is used only for the character's own consistency — it never masquerades as truth about you.

**⑦ Trustworthy provenance, forgery-proof**
Every derived memory records its source and rewrite chain; whatever the model extracts is "inference" by default and can't pose as "an authoritative fact you stated yourself." This hard constraint is guarded by tests — so the model's own fabrications can't backflow into your "profile."

**⑧ Forgets**
Long-unused memories are auto-decayed along a forgetting curve, so things don't pile up endlessly and a three-year-old habit won't override the present. The important, frequently-revisited ones stick around.

**⑨ Yours, and auditable**
Inspect what the AI remembers about you anytime; wipe the whole memory store with one click to start over. Data lives in a local SQLite file, under your control. (Per-item editing isn't supported yet.)

> Design details in [`rfcs/`](rfcs/): RFC-0004 forgetting & consolidation / RFC-0005 domain routing / RFC-0007 bi-temporal invalidation / RFC-0008 companion memory topology.

---

## Not just claims: measured on MnemoBench

We built **MnemoBench**, a reproducible benchmark for memory *maintenance* (belief update / anti-self-pollution / forgetting; ground truth fixed by the generator before rendering, an LLM judge doing set-membership only — it never writes the answer), and showed by ablation that each key mechanism above accounts for a measurable improvement (n=50 per task):

| Mechanism | Primary metric (lower is better) | Off → on |
|---|---|---|
| ⑥ anti-self-pollution (namespace isolation) | Pollution Rate | 96.8% → **1.6%** (~60×) |
| ⑧ forgetting decay | Trivia Leakage | 100% → **16.4%** (important facts retained) |
| ⑤ contradiction invalidation (semantic) | Stale Leakage Rate | 80.0% → **34.0%** |

On the knowledge-update slice of LongMemEval, toggling invalidation alone is worth **+10 points** of QA accuracy. Full method and numbers: [`bench/`](bench/) (harness & data) and [`paper/`](paper/) (arXiv paper, bilingual).

---

## The characters are yours

In the client, users can edit their own avatar and separately change each character's name, avatar, persona, language style, and voice. Avatar images can be cropped and are scaled automatically. Developers can add or change defaults in [personas.ts](sdk/typescript/examples/companion/personas.ts).

---

## Run it

Development mode:

~~~bash
cd sdk/typescript
npm install
npm run companion
~~~

Then open http://localhost:8787. The UI works without a key; real model responses and built-in AI capabilities require one Zhipu key entered in client settings.

Windows standalone client:

~~~powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-NemosCompanion.ps1
~~~

Run examples\companion\client\dist\portable\Nemos Companion\Nemos Companion.exe after the build. Start Nemos Companion.cmd is a compatibility entry point, not a requirement.

---

## For developers

The memory core is an embeddable TypeScript SDK you can use on its own in your (non-commercial) project — a few lines to integrate:

```typescript
const mem = new Nemos({ storage, llm })
const user = mem.forUser(userId)

await user.ingest("User said: I don't like dark themes")
const context = await user.getRelevantContext("help me design a UI")
// → "User prefers light themes; previously expressed a liking for clean styles…"
```

| Doc | Content |
|---|---|
| [sdk/typescript/README.en.md](sdk/typescript/README.en.md) | SDK usage and API |
| [Companion README](sdk/typescript/examples/companion/README.md) | Client setup, configuration, and packaging |
| [Agent Runtime design](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | Architecture, implementation status, and acceptance baseline |
| [`docs/architecture-overview.md`](docs/architecture-overview.md) | System design & the five-layer memory model |
| [`rfcs/`](rfcs/) | Major design decisions |
| [`bench/README.md`](bench/README.md) | MnemoBench memory-maintenance benchmark (reproducible) |
| [`paper/`](paper/) | arXiv paper (method + ablation results, bilingual) |
| [`ROADMAP.md`](ROADMAP.md) | Versioning & progress |

The SDK ships with Anthropic / OpenAI / Zhipu LLM providers (plus a custom hook); the companion example defaults to Zhipu.

---

## Open source, non-commercial

Nemos uses **[PolyForm Noncommercial License 1.0.0](LICENSE)**: free to use, modify, distribute, and make your own version for any noncommercial purpose; **commercial use requires a separate license**. (A license with a "no commercial use" restriction is source-available — strictly speaking not OSI-defined open source.)

---

*Nemos, from the Greek for "memory" (μνήμη, mnēmē).*
