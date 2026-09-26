# Clownfish

> A local-first personal AI assistant: one assistant with a consistent personality talks with you, gets things done for you, and keeps an eye on what you care about. Goals, matters, tasks, files, deliverables, and long-term memory live in one traceable, auditable local workspace.

[中文](README.md) · **English**

[![CI](https://github.com/mmlong818/nemos/actions/workflows/ci.yml/badge.svg)](https://github.com/mmlong818/nemos/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-v0.7.6-b33f72)](https://github.com/mmlong818/nemos/tree/v0.7.6)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen)](#install-and-run)
[![Status](https://img.shields.io/badge/status-Alpha-orange)](#current-boundaries)
[![License](https://img.shields.io/badge/license-noncommercial%20only-blue)](LICENSE)

> [!IMPORTANT]
> This is **source-available software, not OSI-approved open source**. The current version is licensed only for personal, educational, and nonprofit research use. Direct and indirect commercial use is prohibited, including paid services, internal business operations, commercial product integration, resale, SaaS or hosted offerings, commercial training, and any other for-profit activity. Commercial rights require separate written permission from the copyright holder. [LICENSE](LICENSE) is authoritative; third-party components retain their own licenses.

![Clownfish overview with a topic-based feed and a pinned training-checklist widget](docs/assets/readme/overview.png)

_Captured from the current application with isolated synthetic demo data; no user data or real service credentials are shown._

## Product overview

Clownfish is more than a one-turn chat window. It is a personal assistant that keeps track, follows up, and speaks up on its own, while every step stays on your machine where you can check it:

**talk it through → turn it into a goal, matter, or task → the assistant acts (writes a page, builds a small tool, sets a check-in, runs a task) → status, receipts, and self-check results are kept → it reminds you on schedule or tells you when something changes → you decide what becomes long-term memory**

The current application brings these areas together:

- **Assistants**: Clownfish is one assistant with a single, editable personality used for both conversation and task work; its name, verbosity, and persona can be changed. When a choice is needed, replies end with quick-reply buttons. Feifei, Teacher Lin, Azhe, and Lingling provide life conversation, tutoring, decision support, and lightweight companionship, and domain perspectives can be invited for the current question. A right-side activity rail shows what the assistant is doing, what awaits your approval, and what is scheduled next.
- **Goals**: pick a category, clarify in chat how success is measured and what the rhythm is, then approve before anything is saved. Goals carry milestones, a dated timeline, a momentum judgement (on track / at risk / behind, with its basis), optional periodic check-ins, and one dedicated conversation thread.
- **Matters and tasks**: a matter retains an ongoing item and its next action; a task is one concrete execution with attachments, queueing, checkpoints, failure reasons, and delivery receipts.
- **Feed**: from a topic you write plus your goals, matters, and preferences, Clownfish searches the web and writes a short briefing. News must cite sources actually retrieved; if nothing is worth writing, nothing is padded. It learns from your likes and "not interested" feedback.
- **Ideas**: Clownfish proposes a few things it can do for you, each stating the deliverable and why it thought of you; "Start" hands the opening request to the assistant in chat.
- **Widgets**: ask in chat for "a checklist I can tick" or "a pomodoro timer" and the assistant builds an interactive, stateful tool embedded in the reply, self-checked in a browser before delivery and pinnable to the overview.
- **Keep an eye on it**: list a few things you care about; Clownfish checks the web periodically and only speaks up, with sources, when something has changed.
- **Skill library**: reusable local working methods can be inspected, edited, and enabled. Bundled templates and user revisions remain separate.
- **Pantheon**: a structured multi-perspective workspace that selects one to three complementary methods, then runs positions, directed questions, responses, and summaries. Seats represent methods, not impersonations of real people.
- **Memory**: remembered information is separate from pending learning proposals. Users can inspect provenance, confirm, correct, or forget information, and the current request always outranks old preferences.
- **Files and artifacts**: originals are preserved, editable working copies are created, and exports are registered as new deliverables that can be linked back to tasks and sources.
- **Automations, reminders, and background**: recurring tasks can be paused, edited, or run immediately; quiet hours and "tell me about / never mention" topic preferences are configurable; the Windows desktop client can start in the tray at sign-in so reminders and schedules keep working after the window closes. The capability center shows workflows, plugins, connections, dependencies, and actual readiness as separate states.

## Current workflows

### One assistant for talking and doing

Clownfish's persona is an editable setting: renaming it changes how it refers to itself, while "Clownfish" remains the app name. Conversation and task work share one speaking style; during tasks it delivers results directly instead of promising to "send it later", and it names what is missing when information is insufficient. When you need to choose, a reply can end with two to four quick-reply buttons. Typing `/` in the input opens a command menu: start a new conversation, open conversation history, local status, or the activity rail, or jump to goals, the feed, ideas, and "keep an eye on it"; commands run locally and are not sent to the model.

The activity rail on the assistant page has four tabs: **Activity** (background results, taken from recorded status rather than model-written summaries), **Approvals** (pending actions you can allow once or for the session), **Upcoming** (next scheduled tasks and goal check-ins), and **Identity** (assistant settings, memory, and work guidelines).

### Goals: clarify first, then track

Under Matters → Goals, pick a category (health, relationships, finance, career, interests, productivity, other). Clownfish asks what you want to achieve, how it counts as done, and how you plan to get there — at most two questions at a time — and shows an approval card before saving. A goal includes:

- its measure, plan, deadline, and two to four milestones;
- a dated timeline in which every entry records whether you or the assistant wrote it, containing only things that actually happened;
- momentum: when logging progress, the assistant judges on track, at risk, or behind against the deadline and plan and states why, or leaves it unset when it cannot judge;
- periodic check-ins (daily, weekly, every two weeks, or monthly) delivered as a chat message;
- one dedicated conversation: "Talk about progress" and check-in links return to the same thread;
- related ideas listed on the goal.

![Clownfish goals showing momentum, measures, and milestone progress for two synthetic goals](docs/assets/readme/goals.png)

_Each momentum label is followed by its basis; both goals are synthetic examples created for the documentation._

### Feed, ideas, and watching

The **feed** sits at the top of the overview. Write a topic and press Generate (or schedule a daily run); Clownfish picks a few search terms, searches the web, and writes up to five posts based only on the sources found and your local goals, matters, and preferences. Each post says why you are seeing it; news must cite a source retrieved in that run or it is dropped. You can like a post, mark it not interested with a reason, delete it, or discuss it — which opens a new conversation carrying the post. Taste is learned only from these explicit actions. Changing the topic starts a new batch right away.

**Ideas** sit at the top of the skill library. Clownfish proposes things it can actually do now (a small tool, a scheduled task, a goal, a report, or a rule), explaining how and why it thought of you; "Start" sends a prepared first request in chat. Ideas can be marked "more like this" or "not interested" and expire after two weeks.

![Clownfish ideas at the top of the skill library, each stating the deliverable and why it was suggested](docs/assets/readme/ideas.png)

_Each idea names its deliverable type and basis; the basis can only come from goals, matters, and preferences._

**Keep an eye on it** lives in Settings → Reminders and background. Write up to five things, one per line, and choose an interval of one to twenty-four hours. Each check searches the web once and compares with what was seen last time; nothing is said if nothing changed, and a change is reported in chat with sources. At most 48 checks run per day, and nothing runs without a configured web search — model memory is never passed off as a fresh check.

"Tell me about / never mention" preferences on the same page are read before writing the feed or proposing ideas; never-mention topics do not appear.

### Widgets: built and usable in the reply

Ask for "a tickable packing list for Iceland", "a pomodoro timer", or "a mortgage calculator", and Clownfish writes a single-file, offline interactive page embedded directly in the reply:

- ticks and inputs are saved locally and stay the same after a refresh or on the overview;
- before delivery, the page is opened in the local Edge or Chrome the way it will actually run, offline, and its controls are clicked; script errors and attempts to load external resources are reported in the reply. Without a local browser the reply says no self-check ran, and an unfinished page does not pass;
- widgets can be pinned to the overview and used there.

### Tasks and skills

The assistant supports conversation, task completion, and tutoring modes. A task can include source files, use a selected model, or let Clownfish choose from enabled skills. Selecting a file only registers the original; content is read when an execution actually needs it.

Task states distinguish completion, waiting for input, blocked, cancelled, and uncertain external side effects. Empty output is not reported as success, and run completion is stored separately from result delivery. Instructions can be added at collaboration stage boundaries; once final synthesis begins, changes that cannot honestly be incorporated are rejected.

![Clownfish task workspace showing the delivery and step history of a synthetic task](docs/assets/readme/task-workspace.png)

_The workspace keeps the synthetic task, final delivery, sources, and step receipts together._

A skill is a local work rule, not another model. Clownfish does not automatically download third-party scripts or synchronize private memory from third-party Bots.

### Pantheon

Pantheon supports structured multi-perspective reasoning. It first classifies the request as exploration, challenge, decision, or direct answer, then exposes its seat-selection reasons and limits. Each round uses independent positions, directed cross-examination, responses, and a moderator summary. A final conclusion is produced only after an explicit convergence action.

![Clownfish Pantheon showing disclosed seat selection for a synthetic decision](docs/assets/readme/pantheon.png)

_Seats represent reasoning methods; the issue in this image is a synthetic example created for the documentation._

The thought library can distill user-supplied material into a reviewable draft. Without source material it creates only a user-defined framework and does not invent biographical claims. A draft becomes eligible for automatic seating only after user approval. Sessions currently live in the running process; approved private thought units are stored locally.

### Files and artifacts

The file workbench follows a clear boundary: preserve the original, edit a working copy, and export a new file.

- Reads DOCX, PPTX, XLSX, PDF, ODT / ODS / ODP, RTF, EPUB, CSV, TXT, and Markdown;
- exports DOCX, PDF, PPTX, XLSX, HTML, and Markdown;
- writes back TXT and Markdown only after explicit authorization and conflict checks; other formats never overwrite the original;
- tracks versions, restore actions, trash, downloads, and opening in a system application;
- does not promise lossless conversion of complex floating objects, formulas, charts, comments, masters, or macros; use the original and desktop Office or WPS when fidelity matters.

The capability center currently exposes 17 user-facing workflows across research and verification, formal documents, presentations, meeting minutes, translation, transcription, polishing, web reports, product design, decisions, and business analysis. Installability, installed dependencies, external configuration, and verified readiness are separate states in the interface.

### Memory and automation

Long-term memory separates user facts, assistant self-memory, task threads, and expert execution context. A pending learning proposal requires explicit confirmation before becoming memory, and ordinary work recalls only a small amount relevant to the current goal. The memory core is the separately maintained [`@nemos/sdk`](https://github.com/mmlong818/nemos-memory) dependency.

![Clownfish memory management showing a synthetic preference, provenance, and available actions](docs/assets/readme/memory.png)

_Remembered items and pending proposals are separate; each item retains its subject, provenance, and correction or forgetting controls._

Automations schedule recurring work locally and support pause, edit, and run-now actions while retaining related tasks and artifacts. Live external results still depend on the relevant tool, connection, and permissions being operational.

## One-time OpenAI and Zhipu setup

The standard setup asks only for an **OpenAI** and/or **Zhipu BigModel** API key. Either key can be used alone; two keys can complement one another. Submission runs one coordinated flow:

![Clownfish model setup with OpenAI and Zhipu two-key automatic configuration](docs/assets/readme/model-setup.png)

_Both key fields are empty in this screenshot; the application does not reveal complete saved keys on this page._

1. encrypt credentials with Windows DPAPI for the current user;
2. read the provider catalog or maintained candidates and shortlist recommended models;
3. make one minimal connection check per key and at most one synthetic check for each additional capability;
4. enable models that pass and assign capability defaults;
5. report complete, partial, or failed outcomes without discarding healthy manual choices.

Verification makes real provider requests and can incur small charges. APIs never return complete saved keys. Advanced settings still support additional providers, compatible protocols, custom endpoints, full catalogs, and manual overrides, but those are outside the standard two-key path.

What each provider handles:

| Provider | Capabilities |
| --- | --- |
| OpenAI | Text, vision, speech-to-text, text-to-speech, and image generation; actual readiness depends on the account, model, permission, and verification result |
| Zhipu BigModel | Text tasks and web search |

## Data, privacy, and security

- The web service listens on `127.0.0.1` by default; user data defaults to `~/.clownfish`.
- On Windows, model and tool credentials are encrypted for the current user with DPAPI, and common credential fields are redacted from logs.
- Opening a page does not send tasks, attachments, or memory to a model. Necessary material leaves the machine only when a relevant task runs, when you press Generate, "Think of some", or "Check now", or when a scheduled generation or watch you enabled comes due.
- Before the assistant writes goals, matters, or similar local records, an approval card shows exactly what will be saved.
- Model-generated HTML deliverables and widgets open in an origin-less sandbox: their own scripts run, but they cannot act as the application, call its API, or make outbound requests.
- Tools are subject to permission, network, and runtime auditing. The UI exposes boundaries when local processes or external services are required.
- The optional sync service stores client-side AES-256-GCM encrypted snapshots; the local copy remains the working copy, and remote deployments require HTTPS.
- Do not put API keys, passwords, or private tokens in task text, attachments, or project files.

See [PRIVACY.en.md](PRIVACY.en.md) for storage, export, and deletion rules. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Install and run

Requires **Node.js ≥ 22.19**. Windows is the primary verified platform. Linux and macOS can run the web service, but API-key persistence currently depends on Windows DPAPI and is unavailable outside Windows; see the [known limitation](docs/model-key-storage-non-windows.md).

```powershell
git clone https://github.com/mmlong818/nemos.git
cd nemos\sdk\typescript
npm install
npm run companion
```

Open <http://127.0.0.1:8787> and use **设置 → 模型与服务** (Settings → Models & Services). Without a configured model, local data remains browsable but model tasks do not run. The interface is currently primarily Chinese.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Web-service port | `8787` |
| `CLOWNFISH_HOME` | User-data directory | `~/.clownfish` |
| `COMPANION_USER` | Local user namespace | `local-user` |
| `CLOWNFISH_SYNC_TOKEN` | Optional self-hosted sync token | unset |

### Windows portable client

```powershell
cd sdk\typescript
powershell -NoProfile -ExecutionPolicy Bypass -File examples\companion\client\Build-Clownfish.ps1
```

Extract the generated portable ZIP completely and launch `portable\小丑鱼\小丑鱼.exe`. The package includes the desktop shell and required runtime, while model configuration and user data remain in the local user profile. Check that no user data is included before redistribution.

Closing the window can minimize Clownfish to the tray. Tick "开机自动启动" (start at sign-in) in the tray icon's menu to have it start in the tray without opening a window. Tray notifications state whether a matter follow-up, a goal check-in, or a watched item is due, and stay silent during quiet hours.

### Optional self-hosted sync

```powershell
$env:CLOWNFISH_SYNC_TOKEN="replace-with-a-random-token-of-at-least-24-characters"
docker compose up -d --build
```

A loopback URL is suitable locally. Any remote sync deployment must be placed behind HTTPS.

## Current boundaries

- The product is **Alpha**; schemas, interfaces, and public APIs can change.
- The UI is primarily Chinese, and desktop behavior is primarily verified on Windows.
- Current automated acceptance used fake providers. It did not use real user keys or verify every external account, model, or media entitlement.
- Complex Office layouts, third-party website changes, and live data need separate acceptance in the target environment.
- Tasks waiting for input or blocked normally require a new task to continue; arbitrary lossless resume at every stage is not promised.
- Pantheon sessions do not currently survive a service-process restart, while approved private thought units are stored locally.
- Reminders, scheduled generation, and watching run only while the application is running (including in the tray), use local time, and are not promised to fire on the exact minute.
- Feed, ideas, and watching depend on web search results and model judgement; news and alerts carry their sources, which are authoritative.

## Repository layout

| Directory | Contents |
| --- | --- |
| [`sdk/typescript/`](sdk/typescript/) | TypeScript integration and auditable Agent runtime |
| [`sdk/typescript/examples/companion/`](sdk/typescript/examples/companion/) | Clownfish server, web interface, capabilities, and Windows client |
| [`sync-service/`](sync-service/) | Optional self-hosted encrypted synchronization |
| [`docs/`](docs/) | Current architecture, security boundaries, integration, and operations documentation |
| [`rfcs/`](rfcs/) | Design decisions for public interfaces, data models, and long-term compatibility |

## Verification and development

The current source is guarded by the build, dual type checks, dependency-license audit, release-metadata check, automated tests, and documentation-link checks. These checks cover tested local paths; they do not mean every external service has been verified with a real account.

```powershell
cd sdk\typescript
npm run check
cd ..\..
node scripts\verify-docs.mjs
```

See the [application guide](sdk/typescript/examples/companion/README.md) and [documentation index](docs/README.en.md). Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

## License

Copyright © 2026 **mmlong818 (猫叔)**. The current version is made available under the [Clownfish Source-Available Non-Commercial License 1.0](LICENSE): personal, educational, and nonprofit research uses are allowed; all commercial use requires separate written authorization. Modified or redistributed copies must remain noncommercial and retain the copyright and license text.

This license does not retroactively revoke rights validly granted for earlier versions; those versions remain governed by the licenses distributed with them. Third-party terms are not replaced by the project license. See [LICENSING.md](LICENSING.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
