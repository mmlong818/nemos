# Current release

## 0.7.11

- Clownfish can draw in chat: when you ask for an image and Models & Services has a verified image model, it generates one after you approve a card that states each image is billed to your account. The image appears in the reply, stays after a refresh, can be previewed or downloaded, and is kept in the results library.
- Lets each service account be deleted on its own, together with its saved key. Capabilities pinned to it go back to automatic; if it was the conversation service, conversation moves to another automatically selected service, or pauses while the other services stay. Deleting the last one is the same as disconnecting all services.
- Images sent in chat now get a reply from the persona, with memory and context, instead of the raw output of the image model. The image is first read by the verified vision model with room for a full description or OCR result; without a verified vision model the message is still refused.
- The image and video plugin generates images with the image model verified in Models & Services, and uses environment-variable endpoints only when that model is unavailable. That path no longer sends `response_format` to GPT image models, which rejected it with HTTP 400.
- Fixes image generation checks that always failed with HTTP 400: requests no longer send `response_format`, which GPT image models reject. When OpenAI names a rejected parameter, the message now says which one, without keeping any provider text.
- Reorganizes Models & Services into three parts: a one-line status, service accounts that show what each service is used for (or that it is a backup) with in-place key replacement and adding services, and one row per capability. Rarely used tools live under Advanced, and duplicate entry points are gone.
- Shows model names plainly (for example "gpt 5.5"), adding the service name only when the same model comes from two services.
- Removes contradictory messages on that page: stale results of an earlier setup, a false "model not in catalog" warning, and speech, image, and voice models shown as unverified after passing their checks.
- Recommends gpt-5.5 for OpenAI and adds Claude Opus 5.5; superseded models such as gpt-5.4 stay usable, and when the account offers the replacement, Models & Services offers a one-click test before switching conversation to it.
- Explains in the setup result when a newly verified key ends up unused, either because earlier fixed model choices were kept or because it serves as the backup, and points to where to change it.
- Redesigns Models & Services as four parts: what is in use now, service accounts, which model each capability uses, and a collapsed advanced area; capabilities that are not wired yet are no longer shown.
- Brings Pantheon onto the shared navigation, theme, and page frame used by every other page.
- Smooths the first run: the input stays usable while the welcome plays, a notice above the input explains that no model is connected and links to setup, service cards link to where keys are issued, and a rejected key explains what to do instead of showing a bare HTTP status.
- Adds an opt-in update check: only after the user agrees, Clownfish reads the latest published version number from GitHub at most every 12 hours and shows new versions in the sidebar; the current version and a feedback link are always visible, and the check can be turned off under Data & Privacy.
- Provides the Clownfish local-first work application with conversations, matters, tasks, skills, files, deliverables, automations, Pantheon, and user-controlled long-term memory.
- Supports OpenAI and Zhipu BigModel key setup with explicit connection checks, capability assignment, and local credential protection on Windows; Zhipu speech-to-text powers voice dictation into the input.
- Includes an auditable Agent runtime with bounded execution, approvals, cancellation, structured step receipts, model-call records, and resumable task state.
- Keeps source files intact while creating editable working copies and new export artifacts for supported document workflows.
- Greets new users with what Clownfish can actually do and three starter actions it can carry out in chat.
- Gives Clownfish one editable persona shared by conversation and task work (renamable from chat with approval), quick-reply buttons, local slash commands in the input (including today's model calls by purpose), and an activity rail showing live status, approvals, upcoming schedules, and identity settings.
- Adds goals clarified in conversation and saved only after approval, with milestones, a dated timeline, momentum judgements with their basis, periodic check-ins, and one conversation thread per goal.
- Adds a sourced feed written from an editable topic, learning only from explicit likes, discussions, and "not interested" feedback, plus personalised ideas that the assistant can start in chat.
- Adds interactive widgets built in chat: sandboxed, locally stateful, self-checked in a local browser under the same sandbox before delivery, and pinnable to the overview. Forms inside widgets submit to the page's own script while form data still cannot leave the sandbox.
- Adds "keep an eye on it" web checks that speak up only when something changes and cite their sources, with fixed daily limits; items can be added from settings or, with approval, from chat.
- Adds quiet hours, tell-me and never-mention topic preferences, scheduled feed generation, and optional start-in-tray at Windows sign-in.
- Adds a bottom tab bar on narrow screens (assistant, overview, matters, tasks, more) so every page stays reachable on a phone.
- Opens model-generated HTML deliverables in an origin-less sandbox so their scripts cannot call the application API.
- Fixes the Windows portable client starting in offline mode: saved model keys are decrypted with the full PowerShell path, so the desktop app uses the configured model.
- Ships the Windows portable client, local web application, optional encrypted self-hosted synchronization service, and current privacy and security documentation.
- Uses the Clownfish Source-Available Non-Commercial License 1.0; third-party components retain their own licenses.
