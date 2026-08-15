# Clownfish

[中文](README.md) · **English**

[![CI](https://github.com/mmlong818/nemos/actions/workflows/ci.yml/badge.svg)](https://github.com/mmlong818/nemos/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/integration-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen)](#run-locally)

Clownfish is a **local-first AI work application with long-term memory**. Start with one sentence, then complete tasks, work with files, and organize ongoing work without creating a project, choosing an expert, or learning tool names first.

![Clownfish chat](docs/assets/readme/clownfish-chat-2026-08-10.png)

## Product structure

| Surface | Best for | Main outcome |
| --- | --- | --- |
| **Conversations** | Questions, discussion, task completion, and guided study | Independent threads, automatic titles, attachments, and returned results |
| **Capabilities** | Research, documents, presentations, analysis, design, and development | Background execution, progress, retry, and downloadable artifacts |
| **Files** | Opening, converting, editing, and exporting office files | Editable working copies, originals, versions, and exported files |
| **Development** | Implementing, fixing, or reviewing code in an authorized local project | File changes, dependency receipts, checks, and recoverable run history |
| **Work** | Managing tasks, resources, automations, runs, and memory | Ongoing work, workspaces, review records, and deliverables |
| **Settings** | Configuring models, development, data connections, and storage | Connection status, encrypted credentials, and local or self-hosted storage |

All four surfaces share task context and artifact identity instead of creating disconnected copies.

## Conversations and tasks

Each new conversation can use one of three modes:

- **Chat** for everyday questions, discussion, and ideas;
- **Task** for sustained work toward a concrete outcome;
- **Study** for explanation, guided questions, practice, and feedback.

Every conversation keeps its own context and draft. A short title is generated after the first message. Multiple tasks can run in parallel. Experts and teaching personas remain internal execution details rather than settings the user must manage.

When a conversation is handed to a capability, Clownfish transfers the **complete transcript, a concise context summary, attachments, and recorded decisions**, not only the last message.

## Capabilities

Users can describe an outcome and let Clownfish select a capability, or choose one directly. Selection opens the task form immediately without an extra preparation step.

Built-in capabilities cover:

- research and source verification;
- formal documents, meeting notes, web reports, and presentations;
- complex-problem framing, comparison, and market analysis;
- product-interface design, business development, and software projects;
- translation, speech transcription, and light copy editing;
- creation of reusable capabilities.

Background tasks preserve checkpoints, cancellation, failure reasons, retry paths, and final artifacts. Run completion and result delivery are recorded separately; an unacknowledged result is delivered again after a refresh or restart, and a delivery failure is not shown as task completion. One capability can continue another capability's result while keeping the same task history.

Project development uses a dedicated workbench: select a folder, describe the desired outcome, and Clownfish reads the project, edits code, and runs checks. Pi Agent is the default engine; DeepSeek Harness, Kilo Code, OpenCode, and Codex are available through the same isolated proposal and verification flow. Missing dependencies can be installed from the project's declared lockfiles into the project or a Python virtual environment. It never performs global installs or executes model-invented install commands. Changes remain inside an authorized workspace and stop if the project changes concurrently.

Product-interface design produces an editable canvas rather than a static brief. Users can adjust screen copy, content areas, states, color tokens, and desktop/tablet/mobile previews, then keep those changes in local versions.

![Clownfish capabilities](docs/assets/readme/clownfish-capabilities-2026-08-10.png)

## File workbench

The file workbench handles common Word, PowerPoint, Excel, PDF, OpenDocument, RTF, EPUB, CSV, TXT, and Markdown formats.

Its core rule is: **keep the original, edit a working copy, and export a new file.**

- TXT and Markdown can be written back only after explicit authorization; other imported formats do not overwrite the original;
- Word, PDF, and other text-oriented documents become structured copies with headings, paragraphs, lists, tables, quotes, and code;
- presentations and spreadsheets use their own structure models instead of being flattened into chat text;
- each conversion reports what was preserved and what changed, while the original remains viewable and downloadable;
- revision checks prevent a stale window from overwriting a newer save;
- deleted working files first move to recoverable trash;
- results export to DOCX, PDF, PPTX, XLSX, HTML, or Markdown.

Complex floating objects, comments, cross-section headers and footers, formulas, charts, slide masters, and spreadsheet formulas still rely on the original file or desktop Office/WPS for fidelity. Clownfish does not present a structured copy as lossless in-place editing.

![Clownfish file workbench](docs/assets/readme/clownfish-office-2026-08-11.png)

## Work center

The Work center keeps ongoing tasks and deliverables together:

- **Tasks** store the goal, progress, next action, and key decisions;
- **Spaces** organize related tasks and results and support archive and restore;
- **Automations** run daily or by usage frequency and can be paused, edited, or run now;
- **Collaboration** lets Clownfish select experts dynamically and merge their reviews into one delivery;
- **Resources** store local notes, text, and links and enter a task only when explicitly selected;
- **Results** collect generated files and reports;
- **Runs** show status, checkpoints, errors, review queues, and product-review records;
- **Memory** manages facts, experiences, and a small set of high-value habits.

Resources reports the real state of six connector categories: **local files, browser, GitHub, email, calendar, and enterprise documents**. Local files and supported browser functions can be built in; other connectors become available only after installation and a successful connection test.

Extensions support permission review, install, enable, update, previous-version restore, disable, and uninstall. Local execution, network access, file writes, and permission expansion require renewed confirmation.
Extensions can mark destructive tools explicitly. After one such operation fails, later destructive calls in the same run and resumed checkpoint are stopped until the failure is reviewed.

![Clownfish work center](docs/assets/readme/clownfish-work-2026-08-10.png)

## Memory and privacy

The memory core comes from the independent [`@nemos/sdk`](https://github.com/mmlong818/nemos-memory) dependency. This repository does not keep a duplicate copy.

- User facts and persona self-memory use separate namespaces;
- normal conversation recalls only context relevant to the current request;
- capability tasks can apply only delivery preferences such as writing, layout, and format, or disable preference memory for one run;
- task results show which preferences were actually used;
- users can inspect, add, or forget categorized memories, while the interface does not expose the internal raw archive.

The current request always overrides historical preferences.

New installations use `~/.clownfish` as the default data directory. Requests and required context are sent to the configured model provider when that model is used. Local logs redact common credential fields, but task text should never contain secrets.

On Windows, model credentials are encrypted with DPAPI for the current user and full keys are never returned by the API.

### Data storage

The default is fully local. For multi-device use or server backups, **Settings → Data storage** can connect to the included self-hosted Docker service. The client encrypts every snapshot end to end before upload; the server stores ciphertext only. Sync tokens and passphrases are protected with Windows DPAPI and excluded from snapshots.

Local Docker may use `http://127.0.0.1:8799`; remote deployments must sit behind HTTPS:

```powershell
$env:CLOWNFISH_SYNC_TOKEN="replace-with-a-random-token-of-at-least-24-characters"
docker compose up -d --build
```

Server mode still uses local data as the working copy, so an outage does not block normal work. Restore downloads and verifies a snapshot first, then applies it on the next Clownfish restart.

## Model connection

Open **Settings → Models and services**, choose a provider and model, and enter an API key. The configuration is saved only after a successful connection test.

Presets cover Zhipu GLM, OpenAI, Anthropic Claude, DeepSeek, Alibaba Qwen, MiniMax, and custom services. OpenAI-compatible and Anthropic-compatible protocols are supported. Vision, web search, and embedding support depend on the selected service and model.

Everyday conversation prefers a lighter provider model when available. Experts, capabilities, file generation, and complex work use the task model. When a provider has no separate route, both use the same configuration.

## Verified status

As of 2026-08-15:

- build, type checking, and **417 automated tests** pass;
- **20/20** sanitized DOCX cases pass structural round-trip checks and open in local Microsoft Word;
- **10/10** small-project profiles pass inspection, patch proposal, selective application, and rollback;
- this release adds **10 retained real product-review rounds**; 30 runs are now recorded with no unresolved issue;
- Docker sync passed health, authentication, encrypted upload, download, and restart-restore checks; controlled dependency installation passed a real locked npm install;
- the offline dependency audit reports no known vulnerability, and the sensitive-data scan finds no credential.

See the [product capability acceptance record](docs/product-capability-acceptance-2026-08-13.md) and [integration evidence matrix](docs/integration-capability-evidence-2026-08-15.md) for evidence. Memory-core tests remain in the separate `nemos-memory` repository and are not counted in the 417 tests above.

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

## Use the memory core

The memory API comes from the independently maintained `@nemos/sdk`. This repository adds the Agent runtime and Clownfish application on top.

```typescript
import { Nemos } from "@nemos/sdk";

const nemos = new Nemos({
  storage: { type: "sqlite", path: "./memory.db" },
  llm,
});

const memory = nemos.forUser(authenticatedUserId);
await memory.ingest("The user says: formal documents should lead with the conclusion.");
const context = await memory.getRelevantContext("Draft a proposal");
```

`userId` must come from a trusted server-side identity, not an untrusted client parameter.

## Documentation

| Document | Purpose |
| --- | --- |
| [Clownfish guide](sdk/typescript/examples/companion/README.md) | Startup, data directory, desktop build, and endpoints |
| [TypeScript integration](sdk/typescript/README.en.md) | Agent runtime exports and memory APIs |
| [Memory architecture](docs/architecture-overview.md) | Implemented structure and boundaries |
| [Agent runtime](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | Tasks, tools, permissions, and recovery |
| [Roadmap](ROADMAP.md) | Current version and next priorities |
| [Documentation guide](docs/README.en.md) | All public documentation |
| [Security policy](SECURITY.md) | Vulnerability reporting |

## Licensing

This repository uses a dual licensing structure. [LICENSING.md](LICENSING.md) is authoritative:

- the TypeScript integration, Agent runtime, and public research material use [PolyForm Noncommercial 1.0.0](LICENSE); commercial use requires a separate grant;
- the independent `@nemos/sdk` memory core follows the license shipped with its repository;
- the Clownfish application under `sdk/typescript/examples/companion/` is all rights reserved; see its [separate notice](sdk/typescript/examples/companion/LICENSE).
