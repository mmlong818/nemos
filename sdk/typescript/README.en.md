# @nemos/sdk

[中文](README.md)

An embedded TypeScript long-term memory engine backed by local SQLite. It is designed for AI assistants, agents, knowledge tools, and other applications that need durable cross-session memory.

## Install

```powershell
npm install
npm run build
```

Install locally from another project:

```powershell
npm install <repository-path>\sdk\typescript
```

## Initialize

```typescript
import { Nemos } from "@nemos/sdk";

const nemos = new Nemos({
  storage: { type: "sqlite", path: "./nemos.db" },
  llm: { provider: "openai", apiKey: process.env.OPENAI_API_KEY! },
  embedding: { provider: "openai", apiKey: process.env.OPENAI_API_KEY! },
});

const user = nemos.forUser("user-001");
```

Use `{ type: "memory" }` for temporary in-memory storage. Embeddings are optional. Anthropic, OpenAI, Zhipu, and custom LLM providers are supported.

## Ingest and recall

```typescript
await user.ingest("I currently live in Fuzhou.", {
  scenario: "chat",
  contentDate: "2026-07-25",
});

const packet = await user.recall("Where do I currently live?", {
  maxResults: 8,
  maxTokens: 1200,
});

if (packet.reliable) {
  for (const item of packet.items) {
    console.log(item.memory.content);
    console.log(item.reasons);
  }
}
```

`recall()` returns a structured `MemoryPacket`. `search()` provides a backward-compatible array view, `getRelevantContext()` builds prompt-ready context, and `explainRecall()` exposes the recall trace.

## Explicit structured facts

```typescript
const fact = await user.write({
  layer: "personal_semantic",
  content: "The user currently lives in Fuzhou",
  source: {
    authoritative: false,
    origin: "user-statement",
    chain_depth: 1,
  },
  subject: "user:self",
  predicate: "residence.current",
  object: "Fuzhou",
  trustTier: 1,
  utteranceMode: "literal",
  validFrom: "2026-07-25",
});

await user.correct(fact.id, {
  content: "Correction: I currently live in Shanghai",
  object: "Shanghai",
});
```

Facts converge through stable `claim_key` identity. A new value does not overwrite history; valid time and belief state determine the current version. Each record also persists `salience`, `evidence_coverage`, and `evidence_count` for explainable long-term admission.

## Background ingestion

```typescript
const handle = await user.ingest(largeText, {
  mode: "background",
  scenario: "doc-research",
});

const status = await user.getIngestStatus(handle.id);
```

The raw archival event is committed synchronously. Extraction, normalization, linking, and commit share one persisted lifecycle.

## Scenarios

Built-in scenarios:

- `chat`
- `diary`
- `meeting`
- `doc-research`
- `coding`
- `voice-transcript`

Scenarios adjust extraction focus, allowed layers, temporal handling, and sensitivity without weakening immutable provenance or user isolation.

## Data operations

```typescript
await user.invalidate(memoryId, "The user confirmed this fact is no longer valid");
await user.resolveDispute(claimKey, winnerMemoryId);
await user.forget(memoryId);

const json = await user.export("json-ld");
const markdown = await user.export("markdown");
```

## Close

```typescript
await nemos.close();
```

Closing drains active background work before releasing the SQLite connection.

## License

PolyForm Noncommercial 1.0.0.