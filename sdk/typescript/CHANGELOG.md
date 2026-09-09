# Changelog

## Unreleased

- Tool calls on OpenAI reasoning models now go through the Responses API. Chat completions rejects function tools for those models unless reasoning is switched off, so `gpt-5.6-terra` and `gpt-5.6-luna` could not use tools at all; forcing reasoning off instead would have silently downgraded the model the user chose. Offered thinking efforts and the transport now come from one prefix-matched family table rather than two separately hardcoded lists.
- A stored model check now records the transport it actually exercised and is ignored once that model would be reached over a different one, so a check made over chat completions no longer speaks for a Responses route. Checks written before the field existed are read as the routing that was in force when they were made, which keeps an already valid `gpt-6-astra` check without blessing the others.
- Agent runs in task mode with tools mounted now carry an explicit turn disposition: `completed` requires visible text or artifact evidence, while `blocked`, `waiting_input`, and cancellation stay as distinct states instead of passing for delivery.
- Added a bounded, atomically persisted ledger of every real text-model HTTP call, keyed by purpose (`task_turn`, `team_plan`, `team_worker`, `team_review`, `team_final`, `memory_extract`), exposed read-only at `/api/llm-calls`. Provider usage is recorded as returned or as `unknown`, never as zero, and in-flight entries left by a restart become `interrupted`. Team task details show call counts and known tokens.
- Messages appended to a running tool-free team task are now steered at phase boundaries: `merge` adds context for the next phase, `redirect` replaces the remaining goal and invalidates old-goal receipts as completion evidence. The inbox is capped at 500 messages and returns 409 beyond that rather than dropping input.
- Chat, background tasks, and capability runs share one bounded context snapshot; scheduled tasks resume from an explicit handoff record (latest per task, at most 200 tasks) and stay within the originally persisted tool mode and memory scope.
- Imported skill templates keep the template source version separate from a local derived rule version; editing rules bumps only the local version and re-importing a template never overwrites the user's rules. Rules are fixed to `private` visibility.
- Model connections carry an opaque local `connectionRevision`; catalog, favorites, and model checks are bound to it. Saving, switching, or loading settings issues no inference request; a model check is an explicit, possibly billable, single-ID operation whose result expires after seven days. Changing provider, protocol, base URL, or credentials discards old checks instead of reusing them.
- The clownfish brand mark is now a PNG family generated from one master image by `Update-Clownfish-Icons.ps1`; the SVG mark was removed.

## 0.7.6

- Made CI green on both Linux and Windows for the first time; the documentation and vendored-artifact checks had never actually run there, having always been preceded by a failing test step.
- Integration tests that need Windows DPAPI to store a model key are now skipped by platform instead of failing on Linux, and the limitation is documented rather than left invisible: on Linux and macOS a model API key cannot be saved at all.
- The documentation link checker now rejects link targets that escape the repository root. Previously a link could point anywhere on the author's disk and still pass locally while failing in CI.
- `model-reasoning` no longer asserts on a total request count, which background activity could perturb; it now checks whether a specific text ever reached the model.
- Corrected two inaccurate README claims: that Linux and macOS can run the web interface without noting that no model can be configured there, and that all 772 tests pass when some are skipped for missing Blender or DPAPI.

## 0.7.5

- Added a failure registry: every failure carries a code, domain, retryability, consequence summary, and the single site that raises it; unregistered failures are reclassified and never leak the original text.
- Collected the agent budget bounds into one source, replacing two drifting copies in the chat and resume paths.
- Added work guidelines: user-readable natural-language rules with a `never > ask-first > allow-automatically` precedence, an evidence bar for derived rules, and an "always allow" approval that persists as an editable rule.
- Scheduled tasks now auto-pause after repeated unread results and never resume on their own.
- Added a presence contract so in-flight background work is described as evidence rather than instructions, with delivery separated from completion.
- Added Bot recipes: templates may carry reusable skills and scheduled routines behind a two-step consent gate; routines are always created paused and a receipt records what landed.
- Added a declarative outbound network policy with per-host allow and deny lists, evaluated before DNS resolution.
- Restructured both root READMEs into open-source form and corrected stale claims about the Bot market, capability counts, and screenshots.
- Deliverables now carry the assistant's least-confident judgements as structured metadata, produced by a separate cheap pass so a failure there costs an annotation rather than the deliverable; pure-conversion capabilities skip it.
- Extensions that run outside the extension sandbox are announced once per version at startup, stating that file and network access is not bound by the read/write paths or the network policy.

## 0.5.5

- Unified the personal assistant workbench across tasks, Bots, capabilities, files, memory, and model settings.
- Added bounded autonomous text collaboration with planning, step receipts, model queue visibility, cancellation, and shared call budgets.
- Added the local Bot market and clarified the boundaries between assistant, Bot, capability, and tool.
- Removed the legacy development engine and updated the application, desktop manifest, privacy policy, and documentation version.
- Updated safe dependency ranges and fixed PDF.js to 5.4.624; PPTX image input rejects ICNS, JXL, HEIF, and HEIC data.

## 0.2.3

- Unified the TypeScript package, desktop manifest, runtime fallback, public documentation, and privacy-policy version.
- Added Chinese and English privacy policies covering local storage, model providers, plugins, coding engines, self-hosted encrypted sync, memory, retention, deletion, and security reporting.
- Completed real model-backed acceptance for 22 public capabilities plus a 10-project development corpus.
- Fixed accidental market-source routing, extended explicit capability execution timeouts, and added one bounded final repair for malformed audited capability output.

## 0.2.2

- Unified core tools, permissions, risk metadata, timeouts, and execution history across tasks, learning, capabilities, files, development, and automations.
- Completed isolated execution, incremental events, cancellation, and session continuation for Pi Agent, DeepSeek Harness, Kilo Code, OpenCode, and Codex.
- Added audited extension updates and four optional bundled plugins: Playwright browser control, safe table analysis, EML/ICS file parsing, and image/video generation.
- Clarified plugin dependencies, online-account boundaries, and non-realtime travel and hospitality source guidance.
- Verified the release with 483 automated tests: 482 passed and one Blender-only check was skipped because Blender is not installed.

## 0.7.5-alpha.17

- Kept complete family-relation statements in bounded evidence excerpts for aggregate kinship questions.
- Recorded an external 89.8% overall result on a 500-question shared-reader LongMemEval comparison. The raw evaluation artifact is not included in this repository, so this number is release context rather than a repository-reproducible gate.

## 0.7.5-alpha.16

- Resolved relative week, weekday, and weekend expressions to bounded calendar ranges before recall.
- Preserved family-relation evidence near the end of long conversational turns.

## 0.7.5-alpha.15

- Preferred user-authored payment evidence for named-subject cost totals so assistant price recommendations cannot contaminate arithmetic.
- Expanded sibling and music-release vocabulary during evidence retrieval so semantically equivalent family and media terms remain recallable.

## 0.7.5-alpha.14

- Reserved a wider evidence window for an explicitly requested conversational turn so answers are not truncated at the excerpt boundary.

## 0.7.5-alpha.13

- Resolved natural assistant-turn ordinals from the user request that initiated each response, tolerating multi-part assistant continuations.
- Scored single-event relation groups from personal evidence only so unrelated assistant references cannot manufacture a relationship.

## 0.7.5-alpha.12

- Rejected query premises that contradict the current structured role claim instead of returning unrelated counts.
- Kept single-event relation answers inside one source session to prevent unsupported cross-session joins.
- Preserved natural assistant-turn ordinals through long-text segmentation so requested later turns remain visible.

## 0.7.5-alpha.11

- Treated shared first-person language such as we and our as user evidence and prioritized the latest unstructured statement for current facts.
- Kept multi-month questions out of a misleading single-month event-time filter.
- Selected natural ordinal assistant turns, such as the second generated song, before building bounded evidence excerpts.
- Balanced concise derived facts ahead of authoritative source excerpts while preserving source coverage.

## 0.7.5-alpha.10

- Expanded current and compositional recall beyond a single exact claim so multi-source calculations retain all required evidence.
- Recognized temporal comparisons, standalone month names, and ordinal lookups during query planning and evidence projection.
- Removed assistant recommendations from first-person calculations when they are not supported as user facts.
- Added regression coverage for multi-source current facts, temporal order, long numbered lists, month filtering, and unsupported price comparisons.

## 0.7.5-alpha.9

- Expanded compositional recall so authoritative sources cannot be crowded out by lower-ranked derived candidates.
- Added role-aware, query-focused evidence excerpts for totals, ordered events, durations, and assistant-reference questions.
- Normalized simple English inflections during evidence search and preserved strong event matches for relative and multi-source queries.
- Ordered explicit updates by source-event time so older plans cannot outrank later cancellations.

## 0.7.5-alpha.8

- Softened relative-time admission when a query explicitly matches evidence whose conversation timestamp differs from the mentioned time.
- Preserved distinct authoritative source events for aggregate recall even when derived candidates partially overlap them.
- Prioritized explicit project-leadership spans in long conversations.

## 0.7.5-alpha.7

- Applied query-focused projections to every oversized recalled memory, preventing long derived transcripts from exhausting the packet budget before source evidence can be included.

## 0.7.5-alpha.6

- Split long conversations into role-aware spans and combined several query-relevant evidence passages into one bounded projection.
- Prioritized first-person numeric and monetary evidence for aggregate questions without modifying the immutable source event.
- Expanded aggregate recall packets to retain up to eight distinct authoritative source events.

## 0.7.5-alpha.5

- Projected oversized authoritative events into query-focused excerpts without changing their immutable stored content.
- Scored excerpt windows by combined query-term coverage so generic early matches cannot displace the strongest evidence span.
- Budgeted and rendered recall packets from excerpts while keeping search and recall APIs backward-compatible with full memories.
- Retained bounded competing evidence for current-fact queries that do not map to a controlled claim key.

## 0.7.5-alpha.4

- Retried truncated analyzer JSON with progressively smaller chunks while preserving the immutable source event.
- Allowed old authoritative events to re-enter recall when the query explicitly names their contents.
- Reserved several bounded evidence slots for questions that need facts from multiple source events.
- Expanded evidence-query stop words so conversational phrasing does not dilute lexical source ranking.

## 0.7.5-alpha.3

- Reserved an early recall-packet slot for authoritative source evidence when derived Top-K results are already full.
- Clarified extraction of task transitions so completed, exchanged, cancelled, and remaining actions are not conflated.
- Reconciled personal-best metrics by activity so newer records replace older values without losing provenance.
- Classified controlled facts sentence by sentence so unrelated conditional wording cannot suppress literal facts.
- Allowed explicit supported matches to bypass age-based salience filtering when the query names the stored fact.

## 0.7.5-alpha.2

- Honored explicit recall result and token budgets instead of silently capping Top-K at 12.
- Preserved Markdown table row/column relationships as deterministic retrieval facts.
- Kept extracted fact language aligned with its source text and clarified user/reference ownership.
- Allowed directly supported personal facts to remain queryable without weakening stale unstructured-trivia filtering.
- Reweighted first-person factual recall so generic advice no longer crowds out the user's own events and tasks.
- Recovered all three previously failing LongMemEval diagnostic cases in targeted reruns, with sufficient evidence packets in each case.

## 0.7.5-alpha.1

- Anchored relative-time extraction to each source event and enabled historical recall for explicit past ranges.
- Added deterministic workplace, passport-expiry, emergency-contact, and primary-camera facts.
- Made dense extraction exhaustive while preserving unknown high-value predicates.
- Allowed explicit first-person health queries to retrieve the user's own sensitive facts without weakening broad-query filtering.
- Prioritized later source events for explicit update questions such as cancellations.
- Raised fresh core-v2 Recall@5 to 100% with 100% strict no-pollution and provenance/time exposure.

## 0.7.4-alpha.1

- Persisted explainable salience scores and retention signals on every memory.
- Added direct, supported, corroborated, and unverified evidence coverage states.
- Recomputed quality metadata when provenance gains independent evidence.
- Replaced query-time milestone rules with persisted long-term admission metadata.
- Added idempotent SQLite migration and restart coverage.
## 0.7.3-alpha.1

- Added deterministic controlled-claim extraction for common personal facts.
- Added persisted lifecycle stages, event ordering, retry backoff, and reflection cursors.
- Added claim reconciliation for add, confirm, supersede, dispute, correction, and invalidation.
- Added rule-based query planning, multi-channel recall, bounded evidence fallback, and recall traces.
- Added temporal filtering, provenance propagation, long-term salience admission, and stale-fact suppression.
- Added reversible identity merge/split and auditable claim re-key operations.
