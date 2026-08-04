# Changelog

## 0.7.5-alpha.17

- Kept complete family-relation statements in bounded evidence excerpts for aggregate kinship questions.
- Reached 89.8% overall accuracy in the full 500-question, shared-reader LongMemEval comparison with zero generation or judge errors.

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