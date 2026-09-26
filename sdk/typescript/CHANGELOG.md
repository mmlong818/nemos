# Current release

## 0.7.6

- Provides the Clownfish local-first work application with conversations, matters, tasks, skills, files, deliverables, automations, Pantheon, and user-controlled long-term memory.
- Supports OpenAI and Zhipu BigModel key setup with explicit connection checks, capability assignment, and local credential protection on Windows.
- Includes an auditable Agent runtime with bounded execution, approvals, cancellation, structured step receipts, model-call records, and resumable task state.
- Keeps source files intact while creating editable working copies and new export artifacts for supported document workflows.
- Gives Clownfish one editable persona shared by conversation and task work, quick-reply buttons, local slash commands in the input, and an activity rail showing live status, approvals, upcoming schedules, and identity settings.
- Adds goals clarified in conversation and saved only after approval, with milestones, a dated timeline, momentum judgements with their basis, periodic check-ins, and one conversation thread per goal.
- Adds a sourced feed written from an editable topic, learning only from explicit likes, discussions, and "not interested" feedback, plus personalised ideas that the assistant can start in chat.
- Adds interactive widgets built in chat: sandboxed, locally stateful, self-checked in a local browser under the same sandbox before delivery, and pinnable to the overview. Forms inside widgets submit to the page's own script while form data still cannot leave the sandbox.
- Adds "keep an eye on it" web checks that speak up only when something changes and cite their sources, with fixed daily limits.
- Adds quiet hours, tell-me and never-mention topic preferences, scheduled feed generation, and optional start-in-tray at Windows sign-in.
- Opens model-generated HTML deliverables in an origin-less sandbox so their scripts cannot call the application API.
- Ships the Windows portable client, local web application, optional encrypted self-hosted synchronization service, and current privacy and security documentation.
- Uses the Clownfish Source-Available Non-Commercial License 1.0; third-party components retain their own licenses.
