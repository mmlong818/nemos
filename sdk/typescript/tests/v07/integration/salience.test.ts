import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LONG_TERM_SALIENCE_THRESHOLD,
  Nemos,
  ensureMemoryQualityMetadata,
  type Memory,
} from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

function createMemoryNemos(): Nemos {
  return new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  });
}

function cleanup(path: string): void {
  for (const target of [path, path + "-wal", path + "-shm"]) {
    if (existsSync(target)) rmSync(target, { force: true });
  }
}

test("v0.7.4 salience is persisted as an explainable admission signal", async () => {
  const nemos = createMemoryNemos();
  const user = nemos.forUser("alice");
  const trivia = await user.ingest("I had a salad for lunch.", {
    skipAnalysis: true,
    contentDate: "2025-01-05",
  });
  const milestone = await user.ingest("I completed my first marathon in under 4 hours.", {
    skipAnalysis: true,
    contentDate: "2025-01-06",
  });

  assert.equal(trivia.archival.evidence_coverage, "direct");
  assert.equal(trivia.archival.evidence_count, 1);
  assert.ok(trivia.archival.salience);
  assert.ok(milestone.archival.salience);
  assert.ok(milestone.archival.salience.score >= LONG_TERM_SALIENCE_THRESHOLD);
  assert.ok(trivia.archival.salience.score < LONG_TERM_SALIENCE_THRESHOLD);
  assert.ok(milestone.archival.salience.signals.includes("milestone_language"));
  await nemos.close();
});

test("v0.7.4 evidence coverage and salience update when support grows", () => {
  const memory: Memory = {
    id: "semantic:test",
    layer: "semantic",
    type: "project",
    scope: "global",
    content: "A durable working preference",
    source: { authoritative: false, kind: "derived", origin: "test", chain_depth: 1 },
    arousal: { value: 0, signal_sources: [] },
    surprise: { value: 0, basis: "test" },
    ownership: { kind: "self" },
    created_at: "2026-07-25T00:00:00.000Z",
    last_accessed: "2026-07-25T00:00:00.000Z",
    access_count: 0,
    stability: 1,
    schema_version: "0.7",
  };

  ensureMemoryQualityMetadata(memory);
  const unverifiedScore = memory.salience!.score;
  assert.equal(memory.evidence_coverage, "unverified");

  memory.source_event_ids = ["event:1"];
  ensureMemoryQualityMetadata(memory);
  const supportedScore = memory.salience!.score;
  assert.equal(memory.evidence_coverage, "supported");
  assert.equal(memory.evidence_count, 1);
  assert.ok(supportedScore > unverifiedScore);

  memory.source_event_ids.push("event:2");
  ensureMemoryQualityMetadata(memory);
  assert.equal(memory.evidence_coverage, "corroborated");
  assert.equal(memory.evidence_count, 2);
  assert.ok(memory.salience!.score > supportedScore);
});

test("v0.7.4 sqlite preserves salience and evidence coverage across restart", async () => {
  const path = join(tmpdir(), "nemos-v074-salience-" + process.pid + "-" + Date.now() + ".db");
  cleanup(path);
  const config = {
    storage: { type: "sqlite" as const, path },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  };

  let nemos = new Nemos(config);
  const created = await nemos.forUser("alice").ingest(
    "I received a professional certification.",
    { skipAnalysis: true, contentDate: "2025-01-06" },
  );
  const expected = created.archival.salience;
  const supported = await nemos.forUser("alice").write({
    layer: "semantic",
    content: "The user prefers written project summaries.",
    source: { authoritative: false, origin: "test", chain_depth: 1 },
  });
  assert.equal(supported.evidence_coverage, "supported");
  nemos.raw().storage.addMemorySourceEvent(
    "default",
    "alice",
    supported.layer,
    supported.id,
    "archival:independent-evidence",
  );
  assert.equal(
    nemos.raw().storage.findById("default", "alice", supported.id)?.evidence_coverage,
    "corroborated",
  );
  await nemos.close();

  nemos = new Nemos(config);
  const rows = await nemos.forUser("alice").listByLayer("archival", { limit: 10 });
  const restored = rows.find((memory) => memory.id === created.archival.id);
  assert.deepEqual(restored?.salience, expected);
  assert.equal(restored?.evidence_coverage, "direct");
  assert.equal(restored?.evidence_count, 1);
  const restoredSupported = nemos.raw().storage.findById("default", "alice", supported.id);
  assert.equal(restoredSupported?.evidence_coverage, "corroborated");
  assert.equal(restoredSupported?.evidence_count, 2);
  await nemos.close();
  cleanup(path);
});