import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { listPredicates, Nemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

function cleanup(path: string): void {
  for (const target of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(target)) rmSync(target, { force: true });
  }
}

test("v0.7.1 sqlite: claim state, operation log and predicate registry survive restart", async () => {
  const path = join(tmpdir(), `nemos-v071-claim-${process.pid}-${Date.now()}.db`);
  cleanup(path);
  const config = {
    storage: { type: "sqlite" as const, path },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  };
  let nemos = new Nemos(config);
  let user = nemos.forUser("alice");
  const oldFact = await user.write({
    layer: "personal_semantic", content: "我住在上海",
    source: { authoritative: false, origin: "test", chain_depth: 1, extractor: "user_typed" },
    subject: "user:self", predicate: "residence.current", object: "上海",
    trustTier: 1, utteranceMode: "literal", validFrom: "2026-01-01",
  });
  const current = await user.write({
    layer: "personal_semantic", content: "我住在福州",
    source: { authoritative: false, origin: "test", chain_depth: 1, extractor: "user_typed" },
    subject: "user:self", predicate: "residence.current", object: "福州",
    trustTier: 1, utteranceMode: "literal", validFrom: "2026-02-01",
  });
  await nemos.close();
  const db = new Database(path, { readonly: true });
  const predicateCount = (db.prepare("SELECT COUNT(*) AS count FROM nemos_predicates").get() as { count: number }).count;
  db.close();
  assert.equal(predicateCount, listPredicates().length);

  nemos = new Nemos(config);
  user = nemos.forUser("alice");
  assert.equal(nemos.raw().storage.findById("default", "alice", oldFact.id)?.belief_state, "superseded");
  assert.equal(nemos.raw().storage.findById("default", "alice", current.id)?.claim_key, current.claim_key);
  assert.deepEqual((await user.listOperations(current.claim_key)).map((item) => item.kind), ["ADD", "SUPERSEDE"]);
  const nextKey = `ck:2:${current.claim_key!.split(":").at(-1)}`;
  await user.rekeyClaim(current.claim_key!, nextKey, "sqlite re-key persistence");
  await nemos.close();

  nemos = new Nemos(config);
  assert.equal(nemos.raw().storage.resolveCanonicalClaimKey(current.claim_key!), nextKey);
  assert.equal(nemos.raw().storage.listClaimEntries("default", "alice", "global", current.claim_key!)[0]?.claim_key, nextKey);
  await nemos.close();
  cleanup(path);
});