# Clownfish

> A local-first AI work application with long-term memory and real task execution. You describe an outcome; it selects capabilities, coordinates execution units, works with files, and keeps the whole trail in one task.

[中文](README.md) · **English**

[![CI](https://github.com/mmlong818/nemos/actions/workflows/ci.yml/badge.svg)](https://github.com/mmlong818/nemos/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-v0.7.5-b33f72)](https://github.com/mmlong818/nemos/tree/v0.7.5)
[![License](https://img.shields.io/badge/integration-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen)](#quick-start)
[![Status](https://img.shields.io/badge/status-Alpha-orange)](ROADMAP.md)

> [!IMPORTANT]
> **This repository as a whole is not a single OSI open-source project.** The integration layer and Agent runtime are **noncommercial** source-available (PolyForm Noncommercial 1.0.0), and the Clownfish application directory is licensed separately (all rights reserved). Read [LICENSING.md](LICENSING.md) before any commercial use.

![Clownfish task workbench](docs/assets/readme/clownfish-task-current.png)

## What it is

Clownfish puts tasks, Bots, capabilities, files, memory, and model settings in one workbench. The core path is: **the assistant takes the goal, routes it to the right Bot or capability, it enters the task queue, and a traceable result comes back.** Every page keeps the same workspace structure, so a state change never moves the user out of their main context.

![Clownfish assistant home](docs/assets/readme/clownfish-assistant-current.png)

Data stays on the machine by default (`~/.clownfish`), and the HTTP service listens on `127.0.0.1` only. Model calls need your own API key; without one the application still starts but issues no model requests.

## Quick start

Requires **Node.js ≥ 22.19**. Windows is the primary target (local Edge rendering, file associations, drive/UNC paths).
Linux and macOS can run the web interface but **cannot save a model API key** — at-rest encryption uses Windows DPAPI; see the [known limitation](docs/model-key-storage-non-windows-2026-09-08.md).

```powershell
git clone https://github.com/mmlong818/nemos.git
cd nemos\sdk\typescript
npm install
npm run companion
```

Open <http://localhost:8787> and add an API key under **设置 → 模型与服务** (Settings → Models & Services) to begin. The application interface is currently Chinese only.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Web service port | `8787` |
| `CLOWNFISH_HOME` | Data directory | `~/.clownfish` |
| `CLOWNFISH_SYNC_TOKEN` | Token for the self-hosted sync service | unset (local only) |

### Windows portable client

```powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

Output: `examples\companion\client\dist\portable\小丑鱼`.

### Common development commands

```powershell
cd sdk\typescript
npm run build       # build, including the Office editor bundle
npm run typecheck   # type checking
npm test            # full automated test suite
```

## Features

| Surface | User action | Outcome |
| --- | --- | --- |
| **Tasks** | Describe a goal and attach images or files | Persistent task, progress, automatic title, and results |
| **Capabilities** | Auto-select or directly launch specialized work | Structured research, documents, presentations, analysis, and design |
| **Files** | Open office files, convert, edit, process, and export | Original, editable copy, versions, and new exports |
| **Automations** | Manage repeated work | Pausable, editable, and manually runnable schedules |
| **Settings** | Configure models, connectors, and storage | Encrypted configuration and verified connection state |

All surfaces share task, attachment, decision, and artifact identities. A handoff carries the full source text, a deduplicated summary, attachments, and prior decisions rather than only the latest message.

### Tasks and collaboration

Four concepts with distinct jobs:

- **Assistant** is the single user-facing coordinator that understands goals and delivers results;
- **Bot** is a reusable role and instruction set (project follow-up, meeting preparation, plant care);
- **Capability** is an executable end-to-end workflow (document conversion, research, presentation generation, file analysis);
- **Tool** is one concrete operation (reading a file, calling a model, running a connector).

Specialists are not roles to configure or chat with individually. They are internal execution units selected again when the topic changes, and Clownfish always integrates and delivers the final result.

Runs retain checkpoints, cancellation, failure reasons, retry paths, and delivery receipts. **Execution and delivery are recorded separately**, so a refresh or restart never turns an undelivered result into a false completion.

### Skill library and templates

The skill library (`/bots?view=bots`) ships eight natively adapted rule templates: project follow-up, meeting preparation, plant-care journal, copy editing, call follow-ups, idea stress test, deck review, and Bot design. Each can be searched, filtered, inspected for source and boundaries, and edited.

These templates **do not sync a Grok account, download third-party scripts, or carry private Bot memory.** They borrow workflow shape from public templates without bundling their prompts, scripts, or plugins — this is not a Grok market mirror. See [market adoption and verification](docs/bot-market-adoption-2026-09-06.md).

`/bots?view=market` is a placeholder for a future official market. It is **currently empty** and implies no connected online service; your rules, conversations, and task records are never uploaded. See [separating the official market from existing Bots](docs/official-market-separation-2026-09-07.md).

A template may carry a **recipe** (reusable skills and scheduled routines). Recipe content lands only after a two-step consent, and scheduled routines are always created paused. See [recipes and the consent gate](docs/bot-recipe-2026-09-08.md).

### Capabilities

The capabilities page shows the common set by default; you can also state a goal and let the system choose. Capabilities can continue one another while keeping the original task context. Coverage:

- **research and verification**: deep research, source discovery, decision support, market briefings;
- **documents and content**: drafts, conversion, OCR, meeting minutes, editing, HTML reports;
- **presentation and design**: slide decks, product design, image-prompt reconstruction;
- **work and business**: operator workspaces, group progress, workflows, business development, market simulation;
- **extension**: creating new capabilities.

Underneath is one capability registry: **tools** perform a single real operation, **capabilities** own an end-to-end workflow, and **providers** handle external connections for models, search, speech, and images. The interface states whether a capability is available and what configuration is missing, and separates "directly callable" from "handled by a product flow" — a prompt-only capability is never presented as a standalone tool.

Settings offers four optional plugins: official Playwright MCP browser control, safe CSV/JSON analysis, local EML/ICS parsing, and image/video generation through your own OpenAI-compatible endpoint. Analysis and file parsing run entirely locally; browser control needs local Chrome; media generation needs your own API, and its key is read only from a local environment variable.

> Live prices, ticket inventory, room availability, and reservations are marked confirmed only when a reliable live source actually returns them. **The product ships no live transaction adapters for rail, flights, hotels, or restaurants.**

### File workbench

Supports Word, PowerPoint, Excel, PDF, OpenDocument, RTF, EPUB, CSV, TXT, and Markdown. The boundary is explicit: **keep the original, edit a converted working copy, and export a new file.**

- Word conversion preserves supported headings, paragraphs, blank lines, spaces, indentation, numbering, tables, and alignment;
- PDF converts through AnyDoc into an editable Markdown copy; scanned PDFs still require OCR;
- PowerPoint retains per-slide text, tables, and speaker notes; Excel retains worksheet tables;
- TXT and Markdown may be written back only after authorization and conflict checks; other formats never overwrite the original and report conversion changes and known limits;
- autosave, version comparison, restore, trash, and standalone export are supported; exports include DOCX, PDF, PPTX, XLSX, HTML, and Markdown.

Complex floating objects, comments, cross-section headers and footers, formulas, charts, slide masters, and spreadsheet formulas still rely on the original or desktop Office/WPS for fidelity.

### Memory, models, and storage

![Clownfish memory workspace](docs/assets/readme/clownfish-memory-current.png)

Memory separates what is remembered from what is pending. **Pending content enters long-term memory only after explicit user confirmation** and can be withdrawn at any time.

- user facts, persona self-memory, and task context are stored separately to prevent identity crossover;
- an ordinary task recalls only what the current question needs;
- capabilities may apply a small number of delivery preferences, or disable them for one run;
- the current request always outranks a historical preference;
- the memory page shows understandable categories only and never exposes the internal raw archive.

The memory core comes from the independent [`@nemos/sdk`](https://github.com/mmlong818/nemos-memory) dependency; this repository keeps no duplicate copy.

Model presets cover Zhipu GLM, OpenAI, Anthropic Claude, DeepSeek, Alibaba Qwen, MiniMax, and custom OpenAI/Anthropic-compatible services. Windows credentials are encrypted for the current user with DPAPI and are never echoed in full.

Storage is local by default. The included Docker service can receive AES-256-GCM encrypted snapshots while the local copy remains the working database.

```powershell
$env:CLOWNFISH_SYNC_TOKEN="replace-with-a-random-token-of-at-least-24-characters"
docker compose up -d --build
```

Local Docker may use `http://127.0.0.1:8799`; **remote deployment requires HTTPS.**

## Architecture and repository layout

| Directory | Contents |
| --- | --- |
| [`sdk/typescript/`](sdk/typescript/) | TypeScript integration layer and Agent runtime (model loop, tool scheduling, approvals, credential proxy) |
| [`sdk/typescript/examples/companion/`](sdk/typescript/examples/companion/) | The Clownfish application: server, web interface, capability implementations, Office engines |
| [`sync-service/`](sync-service/) | Optional self-hosted encrypted sync service (Docker) |
| [`docs/`](docs/) | Public documentation: architecture, design reviews, verification records |
| [`spec/`](spec/) | Memory system specification (data model, REST, MCP, SDK contract) |
| [`rfcs/`](rfcs/) | Historical RFCs |
| [`bench/`](bench/) | Memory benchmarks and frozen results |
| [`paper/`](paper/) | Public research material |

The memory core is not in this repository: it lives in [nemos-memory](https://github.com/mmlong818/nemos-memory) and is consumed as the `@nemos/sdk` dependency at a fixed tag.

## Project status

**Alpha.** The data model and public APIs may still change; check [ROADMAP.md](ROADMAP.md) before upgrading.

As of 2026-09-08:

- build and type checking pass. 772 automated tests with no failures, on both Linux and Windows in CI (the few cases that need Blender or Windows DPAPI are skipped where those are unavailable);
- workbench, model scheduling, Bot market, autonomous collaboration, and file workflows have unit and isolated integration coverage;
- official Playwright MCP tool discovery and the media connector lifecycle are covered by executable tests;
- document conversion, Office export, task recovery, and encrypted sync have automated coverage.

> Tests validate specific code paths. They do **not** imply manual verification of every external model account, live data source, or complex Office layout.

## Documentation

| Document | Purpose |
| --- | --- |
| [Documentation index](docs/README.en.md) | Public documentation entry point |
| [Application guide](sdk/typescript/examples/companion/README.md) | Pages, data, endpoints, and desktop builds |
| [TypeScript integration](sdk/typescript/README.en.md) | Agent runtime exports and memory APIs |
| [Memory architecture](docs/architecture-overview.md) | Implemented structure and boundaries |
| [Agent runtime](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | Tasks, tools, permissions, and recovery |
| [Failure registry and work guidelines](docs/failure-registry-2026-09-08.md) | Failure codes, the permission rule layer, the presence contract |
| [Network policy and sandbox status](docs/network-policy-2026-09-08.md) | Outbound allowlist and what the extension sandbox actually enforces |
| [Alignment gates and prompt budget](docs/agentic-workflow-2026-09-08.md) | Pre-coding alignment gates and the prompt instruction-budget guard |

## Contributing

Code, tests, documentation, design improvements, and issue reports are all welcome. **A new capability needs a real implementation and tests — copy or prompts alone are not enough.**

| Kind | Path |
| --- | --- |
| Bugs, doc fixes, small improvements | Issue or a direct PR |
| New public API, data structures, breaking changes | Open an Issue first; an RFC when needed |
| Security problems | Report **privately** per [SECURITY.md](SECURITY.md) — never a public Issue |

Start with the [contributing guide](CONTRIBUTING.md); see also the [code of conduct](CODE_OF_CONDUCT.md) and [governance notes](GOVERNANCE.md). Before submitting, make sure `npm run build`, `npm run typecheck`, and `npm test` all pass.

## Security and privacy

- Vulnerability reporting: [SECURITY.md](SECURITY.md);
- local storage, external services, synchronization, export, and deletion boundaries: [Privacy Policy](PRIVACY.en.md).

## Licensing

[LICENSING.md](LICENSING.md) is authoritative:

| Part | License |
| --- | --- |
| TypeScript integration, Agent runtime, public research material | [PolyForm Noncommercial 1.0.0](LICENSE) (noncommercial) |
| Clownfish application under `sdk/typescript/examples/companion/` | All rights reserved, see the [separate notice](sdk/typescript/examples/companion/LICENSE) |
| Memory core `@nemos/sdk` | Per [its own repository](https://github.com/mmlong818/nemos-memory) license |
| Bundled third-party components | Their own open-source or software terms, see [third-party notices](THIRD_PARTY_NOTICES.md) |

To restate: this repository as a whole is not a single OSI open-source project. The integration layer is noncommercial source-available, the Clownfish application is licensed separately, and third-party components keep their own terms.
