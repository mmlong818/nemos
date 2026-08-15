import assert from "node:assert/strict";
import test from "node:test";

import { determinePromotion, type Memory } from "../../src/index.js";

function memory(overrides: Partial<Memory> = {}): Memory {
  const now = "2026-08-15T00:00:00.000Z";
  return {
    id: "mem-test",
    layer: "semantic",
    type: "user",
    content: "用户在加班。",
    scope: "global",
    source: {
      authoritative: false,
      kind: "derived",
      origin: "llm-extract",
      chain_depth: 1,
      confidence: "high",
      subject_id: "user:cat-uncle",
      source_message_id: "message-1",
    },
    arousal: { value: 0.2, signal_sources: [] },
    surprise: { value: 0.1, basis: "ordinary" },
    ownership: { kind: "self" },
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 0.5,
    schema_version: "0.8",
    subject_id: "user:cat-uncle",
    predicate: "user.current_activity",
    claim_key: "user:cat-uncle|user.current_activity|global",
    source_event_ids: ["message-1"],
    utterance_mode: "literal",
    specificity: "contextual",
    ...overrides,
  };
}

test("临时事实和模型推断先保留为候选，独立证据后才晋升", () => {
  assert.deepEqual(determinePromotion(memory({ specificity: "temporary" })), {
    state: "candidate",
    reason: "temporary_fact",
  });
  assert.deepEqual(determinePromotion(memory({
    source: {
      ...memory().source,
      confidence: "medium",
    },
  })), {
    state: "candidate",
    reason: "low_confidence_inference",
  });
  assert.deepEqual(determinePromotion(memory(), { state: "corroborated", count: 2 }), {
    state: "promoted",
    reason: "independent_evidence",
  });
});

test("用户在记忆界面明确修正的事实直接成为可召回版本", () => {
  const corrected = memory({
    source: {
      ...memory().source,
      origin: "clownfish-memory-ui",
      confidence: "high",
    },
  });
  assert.deepEqual(determinePromotion(corrected), {
    state: "promoted",
    reason: "explicit_user_preference",
  });
});
