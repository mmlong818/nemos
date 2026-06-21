# Nemos

[中文](README.md) | **English**

> An AI chat app whose contacts are AI friends that **actually remember you**.

---

## Why we built it

You spend an evening talking to an AI — your tastes, what's going on in your life, what's been bugging you. Open it again tomorrow and it's forgotten everything; you're a stranger again. Most AI chat apps are like this — a new session wipes the slate.

Nemos is a handful of AI characters that **remember you across time**: the things you've said, your preferences, how you've been lately — they keep it; and when you change your mind, they update too.

You don't have to type, either: send a **voice message** (auto-transcribed), or open a **voice call** — a continuous spoken conversation, as if there's a real person on the other end.

What makes this actually work is an independent memory system underneath. — **Nemos**

---

**The companion is the shell; memory is the core.**

## Who's in your contacts

Five built-in characters, each with a distinct personality and voice:

- **Feifei** 🎨 friend — 25, freelance illustrator, a warm and delicate "rational romantic" with a ginger cat. Empathizes first, gives you space, never nags or lectures.
- **Azhe** ☕ friend — 30, product consultant; rational, terse, problem-oriented; a no-nonsense buddy who helps you stop spiraling and get things done.
- **Yuebai** 📋 personal assistant — calm and crisp; sorts your tasks, drafts text, searches the web, reads images, tracks deadlines and reminds you.
- **Tuanzi** 🍡 unidentified creature — round and soft, naive and warm; expresses feelings by "spinning in circles / flattening into mochi," and is unconditionally there for you.
- **Lingling** 🐾 spirit pet — a palm-sized fluffball that barely talks, keeping you company through coos and little gestures like "purr~ (nuzzles you)."

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

**⑤ Self-correcting, never steps on a landmine (bi-temporal + contradiction invalidation)**
Every memory carries a "when it was true" timeline and a belief state. The moment you change your mind ("I moved to Shanghai"), the new fact **invalidates** the old one rather than physically deleting it — history stays auditable, but retrieval returns only what's currently valid by default. So characters won't embarrass themselves with stale info, nor dredge up something you already corrected.

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

## The characters are yours — make your own version

Characters aren't hard-coded:

- **Edit right in the web UI** — "⚙️ Settings → Character" to change name, personality, talkativeness; takes effect instantly and persists. A character's background facts live in its own memory store and evolve naturally through conversation (new things update, old contradictions get invalidated).
- **Customize in code** — characters are defined in [`examples/companion/personas.ts`](sdk/typescript/examples/companion/personas.ts); add characters, rewrite personas, tune models.

---

## Run it

```bash
cd sdk/typescript
npm install
npx tsx examples/companion/server.ts        # open http://localhost:8787
```

It runs without a key too (offline fallback — you can see the UI and memory topology). For real multi-persona conversation, supply a Zhipu key — **just paste it in the web "⚙️ Settings" and switch at runtime, no restart needed** — or start with an env var:

```bash
# PowerShell:  $env:ZHIPU_API_KEY="<your-key>"; npx tsx examples/companion/server.ts
# bash:        ZHIPU_API_KEY=<your-key> npx tsx examples/companion/server.ts
```

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
| [`sdk/typescript/README.md`](sdk/typescript/README.md) | SDK usage & API |
| [`docs/architecture-overview.md`](docs/architecture-overview.md) | System design & the five-layer memory model |
| [`rfcs/`](rfcs/) | Major design decisions |
| [`ROADMAP.md`](ROADMAP.md) | Versioning & progress |

The system currently supports the Zhipu API only — though you can wire in your own.

---

## Open source, non-commercial

Nemos uses **[PolyForm Noncommercial License 1.0.0](LICENSE)**: free to use, modify, distribute, and make your own version for any noncommercial purpose; **commercial use requires a separate license**. (A license with a "no commercial use" restriction is source-available — strictly speaking not OSI-defined open source.)

---

*Nemos, from the Greek for "memory" (μνήμη, mnēmē).*
