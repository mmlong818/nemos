# Clownfish

[中文](README.md) · **English**

> A local-first AI conversation and work application with long-term memory. Start in chat, invoke a capability when needed, work with office files, and review tasks, results, and memory in one product.

![Clownfish chat](docs/assets/readme/clownfish-chat.jpg)

## What it does today

Clownfish combines four everyday surfaces:

| Surface | User action | Current implementation |
|---|---|---|
| **Chat** | Ask, upload images or files, speak, and resume past conversations | A single Clownfish entry, optional companion and teaching roles, expert-group collaboration, and in-chat delivery |
| **Capabilities** | Describe an outcome or choose a capability directly | Background jobs, live progress, cancellation, retries, previews, and downloads |
| **Files** | Open Word, PowerPoint, Excel, or PDF files | Original-file retention, local working copies, inline processing, and versions |
| **Work** | Review tasks, results, runs, and memory | Scheduled tasks, artifacts, execution records, and preference management |

New users do not need to create a project or understand tool names first.

## Chat: a simple entry with expertise where it belongs

The home screen keeps one clear default one-to-one entry:

- **Clownfish** handles everyday questions, capability calls, expert coordination, and final delivery.

Companion and teaching roles such as Feifei and Teacher Lin remain available, but users add them only when needed instead of seeing them on a new home screen.

The first time a role conversation is opened, the page briefly explains what that role can help with and which problems it suits, so users do not need to probe for its purpose.

Functional experts no longer occupy separate one-to-one contacts. They live in the Clownfish expert group and are not locked after the first turn: every turn is routed from the current topic, follow-ups prefer the previous specialists, topic changes select a new set, and `@expert` can name someone explicitly. Clownfish coordinates the final result. When chat hands work to a capability, both the original conversation text and a distilled task context are transferred instead of only the final sentence.

## Capabilities: describe the goal or choose directly

The capability page supports two equal paths:

1. Describe the outcome and let Clownfish choose;
2. Select a capability directly when you already know what you need.

Selection opens the task form immediately, without an extra preparation step. Jobs continue in the background and remain available locally.

![Clownfish capabilities](docs/assets/readme/clownfish-capabilities.jpg)

Built-in capabilities cover presentation creation, formal documents, deep research, Hong Kong market briefs, complex-problem framing, product interface design, project development, meeting minutes, web reports, option comparison, business development, market opportunity simulation, and new-capability generation.

Outputs include PPTX, DOCX, PDF, XLSX, HTML, Markdown, and structured data.

## Files: original, working copy, and result stay together

The file workspace supports DOCX, PPTX, XLSX, and PDF:

- New and open actions sit above recent files;
- The original stays local and is never overwritten by editing;
- PDFs retain their original layout; Office formats receive a structured preview while the original file is retained;
- Editing, versions, AI progress, and results stay on the same page;
- Results created in chat or by a capability can open as a local working copy for continued editing;
- Deleted working files move to a recoverable trash area before permanent deletion;
- Results can be exported to DOCX, PDF, PPTX, XLSX, HTML, or Markdown.

![Clownfish office workspace](docs/assets/readme/clownfish-office.jpg)

## Memory: focused, visible, and user-controlled

Clownfish uses the Nemos Memory SDK in this repository. The application currently:

- Separates user memory from each role's own memory namespace;
- Stores source conversation records in a protected archival layer and uses categorized memories for recall;
- Recalls task-relevant context for normal chat;
- In preference-only capability mode, searches procedural and personal-semantic memory and applies at most six matching items;
- Task records show which habits were applied, while a single task can disable preference memory entirely;
- Lets users add an explicit habit and forget an individual categorized memory;
- Preserves archival records when categorized memories are forgotten or cleared.

Writing, layout, and format preferences supplement the current request; they do not replace it.

![Clownfish memory](docs/assets/readme/clownfish-memory.jpg)

See the [TypeScript SDK](sdk/typescript/README.en.md) and the [v0.7 implementation design](sdk/typescript/docs/nemos-memory-v0.7-design.md) for the memory lifecycle and APIs.

## Provider-neutral model connection

Choose a provider, model name, and API key under **Settings → Model connection**. Clownfish tests the connection before saving it.

Clownfish follows provider presets when routing models. Providers with a separate daily-chat model use it automatically, while experts, capabilities, file generation, and complex work use the configured task model. When no separate route is defined, both use the same model. A conversation can also override the model explicitly.

![Clownfish model connection](docs/assets/readme/clownfish-model-connection.jpg)

Presets are available for Zhipu GLM, OpenAI, Anthropic Claude, DeepSeek, Alibaba Qwen, MiniMax, and custom services. OpenAI-compatible and Anthropic-compatible protocols are supported. Vision, web, voice, and embedding support depends on the selected service and model.

On Windows, secrets are encrypted with DPAPI for the current user and full keys are never returned by the API. Offline mode keeps the interface and local-only functions available.

## Data and privacy boundaries

- Memory, tasks, runs, working copies, and artifacts are stored under **~/.clownfish** by default.
- When a configured model is called, the request and required context are sent to that provider. Network source features contact their corresponding public services when used.
- Logs and run records redact common credential fields, but secrets should never be placed in task text.
- Before exporting or sharing a backup or portable package, check that it does not contain a user data directory.

## Run locally

Node.js 22.19 or newer is required.

~~~powershell
cd sdk\typescript
npm install
npm run companion
~~~

The default URL is <http://localhost:8787>. Use **PORT** to change the port and **CLOWNFISH_HOME** to change the data directory.

### Windows portable client

~~~powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
~~~

The build downloads and verifies WebView2 plus the sandboxed Node and Python runtimes. Output:

~~~text
examples\companion\client\dist\portable\小丑鱼
~~~

## Use the memory SDK independently

~~~typescript
import { Nemos } from "@nemos/sdk";

const nemos = new Nemos({
  storage: { type: "sqlite", path: "./memory.db" },
  llm,
});

const memory = nemos.forUser(authenticatedUserId);
await memory.ingest("The user says: formal documents should lead with the conclusion.");
const context = await memory.getRelevantContext("Draft a proposal");
~~~

**userId** must come from a trusted server-side identity, not an untrusted client parameter.

## Documentation

| Document | Purpose |
|---|---|
| [Clownfish guide](sdk/typescript/examples/companion/README.md) | Startup, data directory, desktop build, and endpoints |
| [TypeScript SDK](sdk/typescript/README.en.md) | Current memory APIs |
| [Memory architecture](docs/architecture-overview.md) | Implemented structure and boundaries |
| [Runtime architecture](sdk/typescript/examples/companion/docs/agent-runtime-design.md) | Tasks, tools, permissions, and recovery |
| [Roadmap](ROADMAP.md) | Current versions and next priorities |
| [Documentation guide](docs/README.en.md) | Product, integration, architecture, and research documents |

## License

This project uses the [PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use, modification, and distribution are allowed; commercial use requires separate permission.
