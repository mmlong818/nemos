# 小丑鱼 (Clownfish)

[中文](README.md) · **English**

> A local-first AI companion and workbench with long-term memory. Clownfish can continue a conversation, take over a goal, run a capability, and return the result to the original chat.

![Clownfish chat](docs/assets/readme/clownfish-chat.png)

## What Clownfish is

Clownfish turns three separate experiences into one continuous workflow:

| | What you experience | What Clownfish does |
|---|---|---|
| **Chat** | Talk to personas, ask questions, share images or voice | Keeps context and decides when to answer or act |
| **Capabilities** | Describe the outcome instead of finding a tool first | Selects a capability, runs it in the background, and produces editable output |
| **Work** | Review tasks, results, runs, and memory | Preserves history, execution state, recovery points, and preferences |
| **Office files** | Open common files, edit, and export | Protects originals while keeping local working copies and versions |
| **Memory** | Personas gradually adapt to your habits and preferences | Stores, updates, retrieves, and exposes long-term information locally |

Data, memory, task history, and deliverables stay on the local machine by default. You can inspect or clear memory, export a backup, or switch to offline mode.

## A continuous chat-to-capability workflow

Capabilities are not a separate, disconnected app. Type a goal in chat and choose **Hand off to capability**:

1. The active persona and goal are carried into the capability page.
2. Clownfish recommends a suitable capability and pre-fills the task.
3. After you confirm the materials and output format, the job continues in the background.
4. Its status is visible from both chat and the capability page.
5. The finished result returns to the original chat and remains available in history and files.

![A chat goal prepared as a capability task](docs/assets/readme/clownfish-capability-handoff.png)

## Built-in capabilities

The capability page starts with the outcome you want. New users do not need to learn a tool catalog first, while experienced users can still pick a capability directly.

| Capability | Designed for |
|---|---|
| **Presentation** | Reports, proposals, lessons, and pitches with layouts, notes, and editable PPTX output |
| **Formal document** | Plans, summaries, explanations, and long-form writing with light preference adaptation |
| **Deep research** | Search planning, source verification, and traceable conclusions |
| **Hong Kong market briefing** | Local watch codes, official HKEX disclosures, and timestamped third-party quote snapshots without trading instructions |
| **Thinking workbench** | Facts, assumptions, contradictions, options, and validation plans |
| **Product design** | User flows, screen structure, interactions, and acceptance criteria |
| **Meeting notes** | Decisions, action items, owners, risks, and open questions |
| **Web report** | Standalone HTML reports that open directly in a browser |
| **Decision brief** | Evidence, benefits, costs, risks, and decision-change conditions |
| **Business deal desk** | Stakeholders, objections, negotiation boundaries, and follow-ups |
| **Market opportunity simulator** | Demand, competition, execution scenarios, and invalidation conditions |
| **Capability builder** | Turn repeatable work into a local capability with boundaries, steps, and tests |

Tasks can include TXT, Markdown, CSV, JSON, and HTML material. Depending on the capability, output can be real PPTX, DOCX, PDF, XLSX, Markdown, structured data, or standalone web pages.

## Conversations, work, and office files

- Conversations support independent threads, branches, and rollback with an automatic backup branch. Model, reasoning depth, and tool scope can be set per conversation.
- The Work page collects recurring tasks, downloadable results, background runs, and memory preferences without forcing new users to create projects.
- Office files can import DOCX, PPTX, XLSX, and PDF into local working copies with version comparison and restore, without overwriting the original.
- Edited results export as real DOCX, PDF, PPTX, XLSX, HTML, or Markdown files, with layout warnings for overcrowded presentations.
## Long-term memory without taking over

Clownfish uses the Nemos Memory SDK rather than a single transcript dump, and model-generated text never becomes authoritative user memory by itself.

- **Layered storage** separates events, durable facts, personal preferences, procedures, and source records.
- **Temporal updates** let new information invalidate an old belief without erasing its history.
- **Sparse retrieval** activates memory relevant to the current topic instead of inserting the whole archive.
- **Light adaptation** can reuse writing, layout, and formatting preferences without overriding explicit task requirements.
- **Local auditability** keeps memory in SQLite and lets users inspect, back up, or clear it.

![Clownfish sparse memory activation](docs/assets/four-tier-sparse-activation.svg)

See the [architecture overview](docs/architecture-overview.md) and [RFCs](rfcs/) for details.

## Provider-neutral model connection

Open **Settings → Model connection**, select a provider, enter a model name and API key, and let Clownfish test the connection before saving it.

![Clownfish model connection](docs/assets/readme/clownfish-model-connection.png)

Clownfish currently includes presets for Zhipu GLM, OpenAI, Anthropic Claude, DeepSeek, Qwen, MiniMax, and custom services. It supports OpenAI-compatible and Anthropic-compatible protocols. Vision, web search, speech, and embedding support depend on the selected service and model.

On Windows, saved model connections are encrypted with DPAPI. Full keys are not returned by the UI or API. Without a key, you can still explore the interface and use local features.

## Personas and group chat

- **Clownfish is the application itself**, not a separate fictional persona. Chat, capabilities, and deliverables continue through the same app identity.
- Companion, reasoning, product, design, engineering, and business personas can be added when needed.
- Each persona's name, avatar, prompt, response volume, and voice can be customized locally.
- Group chat supports exact `@persona` mentions, and personas only use memories from conversations they were allowed to attend.

## Run locally

Node.js 20 or newer is required.

```bash
cd sdk/typescript
npm install
npm run companion
```

Open <http://localhost:8787>. If the port is already in use, set the `PORT` environment variable.

### Windows desktop client

```powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

Then run:

```text
examples\companion\client\dist\portable\小丑鱼\小丑鱼.exe
```

See the [Clownfish guide](sdk/typescript/examples/companion/README.md) for configuration, data locations, and diagnostics.

## Use the memory SDK independently

Clownfish is built on an embeddable TypeScript memory SDK:

```typescript
const mem = new Nemos({ storage, llm })
const user = mem.forUser(userId)

await user.ingest("The user says: I do not like dark themes")
const context = await user.getRelevantContext("Help me design an interface")
```

`forUser(userId)` isolates each user's memory, while applications can replace the storage, model, and retrieval strategy. See the [TypeScript SDK documentation](sdk/typescript/README.md).

## Documentation

| Document | Purpose |
|---|---|
| [Clownfish guide](sdk/typescript/examples/companion/README.md) | Startup, model connection, local data, and desktop packaging |
| [TypeScript SDK](sdk/typescript/README.md) | Embed Nemos memory in another product |
| [Agent Runtime design](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | Task, tool, permission, and runtime boundaries |
| [Architecture overview](docs/architecture-overview.md) | Layered memory and system structure |
| [MnemoBench](bench/README.md) | Reproducible memory-maintenance benchmarks |
| [Paper](paper/) | Method, evaluation, and ablations in Chinese and English |
| [Roadmap](ROADMAP.md) | Version plans and current progress |

## License

Clownfish uses the [PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use, modification, and distribution are allowed; commercial use requires separate permission.

---

*Clownfish is the user-facing application; Nemos Memory SDK is its local memory core.*
