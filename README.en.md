# Clownfish

[中文](README.md) · **English**

[![CI](https://github.com/mmlong818/nemos/actions/workflows/ci.yml/badge.svg)](https://github.com/mmlong818/nemos/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/integration-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen)](#run-locally)

Clownfish is a **local-first AI work application with long-term memory and real task execution**. The user describes an outcome; Clownfish selects capabilities, coordinates internal specialists, works with files, or delegates real project work to a coding engine while retaining the complete task history.

![Clownfish tasks](docs/assets/readme/clownfish-chat-2026-08-16.png)

## Main surfaces

| Surface | User action | Outcome |
| --- | --- | --- |
| **Tasks** | Describe a goal and attach images or files | Persistent task, progress, automatic title, and results |
| **Capabilities** | Auto-select or directly launch specialized work | Structured research, documents, presentations, analysis, and design |
| **Files** | Open office files, convert, edit, process, and export | Original, editable copy, versions, and new exports |
| **Development** | Create or link a local project and describe a change | Real code changes, checks, proposals, rollback, and run history |
| **Automations** | Manage repeated work | Pausable, editable, and manually runnable schedules |
| **Settings** | Configure models, engines, connectors, and storage | Encrypted configuration and verified connection state |

All surfaces share task, attachment, decision, and artifact identities. A handoff carries the full source text, a deduplicated summary, attachments, and prior decisions rather than only the latest message.

## Tasks and collaboration

A new task can be a normal conversation, outcome-oriented work, or guided study. Clownfish remains the single user-facing coordinator. Specialists are internal execution units selected again when the topic changes; users do not need to configure or chat with them individually.

Runs retain checkpoints, cancellation, failure reasons, retry paths, and delivery receipts. Execution and delivery are recorded separately so a refresh or restart does not turn an undelivered result into a false completion.

## Capabilities

Clownfish currently includes 23 built-in capabilities across:

- research, source verification, decisions, and market briefings;
- documents, conversion, OCR, meeting minutes, editing, and HTML reports;
- presentations, product design, and image-prompt reconstruction;
- operator workspaces, group progress, workflows, business development, and market simulation;
- real project development and reusable capability creation.

Capabilities can continue one another while keeping the original task context. Volatile prices, ticket inventory, room availability, and reservations are confirmed only when a reliable live source actually returns them. The product does not currently ship transaction adapters for rail, flights, hotels, or restaurants.

![Clownfish capabilities](docs/assets/readme/clownfish-capabilities-2026-08-16.png)

## File workbench

The workbench supports Word, PowerPoint, Excel, PDF, OpenDocument, RTF, EPUB, CSV, TXT, and Markdown.

Its boundary is explicit: **keep the original, edit a converted working copy, and export a new file.**

- Word conversion preserves supported headings, paragraphs, blank lines, spaces, indentation, numbering, tables, and alignment;
- PDF converts through AnyDoc into an editable Markdown copy; scanned PDFs still require OCR;
- PowerPoint retains per-slide text, tables, and speaker notes; Excel retains worksheet tables;
- TXT and Markdown may be written back only after authorization and conflict checks;
- other formats never overwrite the original and report conversion changes;
- autosave, version comparison, restore, trash, and standalone export are supported;
- exports include DOCX, PDF, PPTX, XLSX, HTML, and Markdown.

Complex floating objects, comments, cross-section headers and footers, formulas, charts, slide masters, and spreadsheet formulas still rely on the original or desktop Office/WPS for fidelity.

![Clownfish files](docs/assets/readme/clownfish-office-2026-08-16.png)

## Development workbench

The interface is designed for regular users; the selected coding engine performs the real project work.

- **Pi Agent 0.84.2** is the default;
- **DeepSeek Harness, Kilo Code, OpenCode, and Codex** are available;
- all five use one plugin contract with separate adapters and honest capability declarations;
- new projects use a managed root, while a directory in the task links an existing project directly;
- context selection can include related code, explicit files, current Git changes, and active decisions;
- the process view normalizes context, tool, checking, approval, and completion events;
- projects support archive, run comparison, per-file review, selective application, and safe rollback.

Ordinary modifications prefer an isolated workspace and an approval proposal. Codex full access directly edits the current project only after explicit selection.

### Engine updates

On startup, Clownfish performs a read-only npm release check for all five engines. It evaluates version range, release channel, CLI entry point, Node.js requirement, and deprecation state. Safe-looking updates are offered normally; structural risk produces a warning and a second confirmation.

Installation never happens silently. After confirmation, Clownfish installs the package, runs the application build and engine-specific tests, and restores the previous dependency files if validation fails. A successful upgrade requires a restart and leaves an audit record.

![Clownfish development](docs/assets/readme/clownfish-develop-2026-08-16.png)

## Memory, models, and storage

The memory core comes from the independent [`@nemos/sdk`](https://github.com/mmlong818/nemos-memory) dependency. User facts, persona self-memory, task context, and specialist execution remain separated. Capabilities may apply a small number of delivery preferences or disable them for one run; the current request always wins.

Model presets cover Zhipu GLM, OpenAI, Anthropic Claude, DeepSeek, Alibaba Qwen, MiniMax, and custom OpenAI/Anthropic-compatible services. Windows credentials are encrypted for the current user with DPAPI and are never echoed in full.

The default data directory is `~/.clownfish`. Storage is local by default. The included Docker service can receive AES-256-GCM encrypted snapshots while the local copy remains the working database.

```powershell
$env:CLOWNFISH_SYNC_TOKEN="replace-with-a-random-token-of-at-least-24-characters"
docker compose up -d --build
```

Local Docker may use `http://127.0.0.1:8799`; remote deployment requires HTTPS.

## Verified status

As of 2026-08-16:

- build and type checking pass;
- **453 automated tests: 452 pass and one Blender check is skipped because Blender is not installed**;
- all five coding engines have real CLI/SDK adapters and readiness checks;
- Pi Agent is upgraded to **0.84.2**, with the build and engine-specific tests passing;
- document conversion, Office export, development isolation, proposal application, rollback, task recovery, and encrypted sync have automated coverage.

Tests validate specific code paths; they do not imply manual verification of every external model account, live data source, or complex Office layout.

## Run locally

Node.js 22.19 or newer is required.

```powershell
cd sdk\typescript
npm install
npm run companion
```

Open <http://localhost:8787>. Use `PORT` to change the port and `CLOWNFISH_HOME` to change the data directory.

### Windows portable client

```powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

Output: `examples\companion\client\dist\portable\小丑鱼`.

## Documentation

| Document | Purpose |
| --- | --- |
| [Application guide](sdk/typescript/examples/companion/README.md) | Pages, data, endpoints, coding engines, and desktop builds |
| [TypeScript integration](sdk/typescript/README.en.md) | Agent runtime exports and memory APIs |
| [Memory architecture](docs/architecture-overview.md) | Implemented structure and boundaries |
| [Agent runtime](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | Tasks, tools, permissions, and recovery |
| [Documentation index](docs/README.en.md) | Public documentation entry point |
| [Security policy](SECURITY.md) | Vulnerability reporting |

## Licensing

[LICENSING.md](LICENSING.md) is authoritative:

- the TypeScript integration, Agent runtime, and public research material use [PolyForm Noncommercial 1.0.0](LICENSE);
- the independent `@nemos/sdk` memory core follows its own repository license;
- the Clownfish application under `sdk/typescript/examples/companion/` is all rights reserved under its [separate notice](sdk/typescript/examples/companion/LICENSE).
