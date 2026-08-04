import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos, type Memory, type WriteMemoryInput } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

function createNemos(): Nemos {
  return new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  });
}

function assertion(
  content: string,
  object: unknown,
  options: Partial<WriteMemoryInput> = {},
): WriteMemoryInput {
  return {
    layer: "personal_semantic",
    content,
    source: { authoritative: false, origin: "test:user-statement", chain_depth: 1, extractor: "user_typed" },
    subject: "user:self",
    predicate: "residence.current",
    object,
    trustTier: 1,
    utteranceMode: "literal",
    ...options,
  };
}

test("v0.7.1 claim identity: predicate alias and normalized object converge to one fact", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const first = await user.write(assertion("我住在福州", " 福州 ", { predicate: "居住地" }));
  const confirmed = await user.write(assertion("我现居福州", "福州"));
  const all = await user.listByLayer("personal_semantic", { limit: 20 });
  assert.equal(all.length, 1);
  assert.equal(confirmed.id, first.id);
  assert.match(first.claim_key ?? "", /^ck:1:/);
  assert.deepEqual((await user.listOperations(first.claim_key)).map((item) => item.kind), ["ADD", "CONFIRM"]);
  assert.equal(nemos.raw().storage.findById("default", "alice", first.id)?.source_event_ids?.length, 2);
  await nemos.close();
});

test("v0.7.1 reconcile: a newer equal-trust single-valued fact supersedes the old value", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const oldFact = await user.write(assertion("我住在上海", "上海", { validFrom: "2026-01-01" }));
  const current = await user.write(assertion("我搬到福州", "福州", { validFrom: "2026-02-01" }));
  const storedOld = nemos.raw().storage.findById("default", "alice", oldFact.id)!;
  assert.equal(storedOld.belief_state, "superseded");
  assert.equal(current.belief_state, undefined);
  assert.equal((await user.search("上海")).length, 0);
  assert.equal((await user.search("福州"))[0]?.id, current.id);
  assert.equal((await user.listOperations(current.claim_key)).at(-1)?.kind, "SUPERSEDE");
  await nemos.close();
});

test("v0.7.4 reconcile: event time is the validity fallback for structured facts", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const oldFact = await user.write(assertion("I currently live in Fuzhou.", "Fuzhou", {
    eventAt: "2026-06-01T09:00:00+08:00",
  }));
  const current = await user.write(assertion("I moved to Xiamen and now live there.", "Xiamen", {
    eventAt: "2026-07-10T09:00:00+08:00",
  }));

  assert.equal(oldFact.valid_at, "2026-06-01T09:00:00+08:00");
  assert.equal(current.valid_at, "2026-07-10T09:00:00+08:00");
  assert.equal(nemos.raw().storage.findById("default", "alice", oldFact.id)?.belief_state, "superseded");
  assert.equal(nemos.raw().storage.findById("default", "alice", current.id)?.belief_state, undefined);
  assert.equal((await user.listOperations(current.claim_key)).at(-1)?.kind, "SUPERSEDE");
  await nemos.close();
});

test("v0.7.4 reconcile: late extraction still follows event time without validFrom", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const current = await user.write(assertion("I currently live in Xiamen.", "Xiamen", {
    eventAt: "2026-07-10T09:00:00+08:00",
  }));
  const lateOld = await user.write(assertion("I lived in Fuzhou before that.", "Fuzhou", {
    eventAt: "2026-06-01T09:00:00+08:00",
  }));

  assert.equal(nemos.raw().storage.findById("default", "alice", current.id)?.belief_state, undefined);
  assert.equal(nemos.raw().storage.findById("default", "alice", lateOld.id)?.belief_state, "superseded");
  await nemos.close();
});

test("v0.7.1 reconcile: an older event arriving later cannot overwrite the current fact", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const current = await user.write(assertion("我现在住在福州", "福州", { validFrom: "2026-02-01" }));
  const lateOld = await user.write(assertion("补录：我以前住在上海", "上海", { validFrom: "2025-01-01" }));
  assert.equal(nemos.raw().storage.findById("default", "alice", current.id)?.belief_state, undefined);
  assert.equal(nemos.raw().storage.findById("default", "alice", lateOld.id)?.belief_state, "superseded");
  assert.equal((await user.search("福州"))[0]?.id, current.id);
  await nemos.close();
});

test("v0.7.1 dispute: same-time same-trust conflict is hidden until explicit resolution", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const left = await user.write(assertion("我的居住地是上海", "上海", { validFrom: "2026-01-01" }));
  const right = await user.write(assertion("我的居住地是福州", "福州", { validFrom: "2026-01-01" }));
  assert.equal(nemos.raw().storage.findById("default", "alice", left.id)?.belief_state, "disputed");
  assert.equal(nemos.raw().storage.findById("default", "alice", right.id)?.belief_state, "disputed");
  assert.equal((await user.search("上海 福州")).length, 0);
  const resolved = await user.resolveDispute(left.claim_key!, right.id);
  assert.equal(resolved.kind, "RESOLVE_DISPUTE");
  assert.equal(nemos.raw().storage.findById("default", "alice", right.id)?.belief_state, undefined);
  assert.equal(nemos.raw().storage.findById("default", "alice", left.id)?.belief_state, "superseded");
  await nemos.close();
});

test("v0.7.1 trust: lower-trust external conflict cannot replace a user fact", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const userFact = await user.write(assertion("我住在福州", "福州", { validFrom: "2026-01-01" }));
  const external = await user.write(assertion("网页说用户住在上海", "上海", {
    validFrom: "2026-01-01",
    trustTier: 7,
    source: { authoritative: false, origin: "external:web", chain_depth: 1, extractor: "llm_summary" },
  }));
  assert.equal(nemos.raw().storage.findById("default", "alice", userFact.id)?.belief_state, undefined);
  assert.equal(nemos.raw().storage.findById("default", "alice", external.id)?.belief_state, "invalidated");
  assert.equal((await user.listOperations(userFact.claim_key)).at(-1)?.kind, "IGNORE");
  await nemos.close();
});

test("v0.7.1 utterance mode: roleplay text cannot become a durable personal fact", async () => {
  const nemos = createNemos();
  const memory = await nemos.forUser("alice").write(assertion("剧情里我住在火星", "火星", { utteranceMode: "roleplay" }));
  assert.equal(memory.layer, "episodic");
  assert.equal(memory.claim_key, undefined);
  await nemos.close();
});

test("v0.7.1 correct: correction supersedes the target and taints transitive dependents", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const target = await user.write(assertion("我住在上海", "上海"));
  const dependent = await user.write({
    layer: "semantic", content: "基于上海居住地生成的摘要",
    source: { authoritative: false, origin: "reflect", chain_depth: 2 },
  });
  nemos.raw().storage.insertProvenanceEdge({
    tenant_id: "default", user_id: "alice", source_id: target.id, derived_id: dependent.id,
    relation: "consolidated_from", created_at: new Date().toISOString(),
  });
  const operation = await user.correct(target.id, { content: "更正：我现在住在福州", object: "福州" });
  assert.equal(operation.kind, "SUPERSEDE");
  assert.equal(nemos.raw().storage.findById("default", "alice", target.id)?.belief_state, "superseded");
  assert.equal(nemos.raw().storage.findById("default", "alice", dependent.id)?.belief_state, "stale");
  assert.equal((await user.search("摘要")).length, 0);
  await nemos.close();
});

test("v0.7.1 invalidate: explicit invalidation is audited and hidden from recall", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const fact = await user.write(assertion("我住在福州", "福州"));
  const operation = await user.invalidate(fact.id, "这条信息已经不正确");
  assert.equal(operation.kind, "INVALIDATE");
  assert.equal(nemos.raw().storage.findById("default", "alice", fact.id)?.belief_state, "invalidated");
  assert.equal((await user.search("福州")).length, 0);
  await nemos.close();
});

test("v0.7.1 correction propagation preserves a dependent with independent active evidence", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const target = await user.write(assertion("我住在上海", "上海"));
  const independent = await user.write({
    layer: "episodic", content: "另一条独立证据",
    source: { authoritative: false, origin: "test", chain_depth: 1 },
  });
  const dependent = await user.write({
    layer: "semantic", content: "由两条证据支持的结论",
    source: { authoritative: false, origin: "reflect", chain_depth: 2 },
  });
  for (const sourceId of [target.id, independent.id]) {
    nemos.raw().storage.insertProvenanceEdge({
      tenant_id: "default", user_id: "alice", source_id: sourceId, derived_id: dependent.id,
      relation: "consolidated_from", created_at: new Date().toISOString(),
    });
  }
  await user.correct(target.id, { content: "更正：我现在住在福州", object: "福州" });
  assert.equal(nemos.raw().storage.findById("default", "alice", dependent.id)?.belief_state, undefined);
  await nemos.close();
});

test("v0.7.1 re-key: old keys resolve through an auditable canonical alias", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const fact = await user.write(assertion("我住在福州", "福州"));
  const oldKey = fact.claim_key!;
  const nextKey = `ck:2:${oldKey.split(":").at(-1)}`;
  const operation = await user.rekeyClaim(oldKey, nextKey, "claim key v2 migration");
  assert.equal(operation.kind, "MERGE");
  assert.equal(nemos.raw().storage.resolveCanonicalClaimKey(oldKey), nextKey);
  assert.equal(nemos.raw().storage.listClaimEntries("default", "alice", "global", oldKey)[0]?.claim_key, nextKey);
  await nemos.close();
});
test("v0.7.1 legacy: a deterministic structured fact retires a conflicting legacy text fact", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const now = new Date().toISOString();
  const legacy: Memory = {
    id: "legacy-residence", layer: "personal_semantic", type: "user", scope: "global",
    content: "我住在上海",
    source: { authoritative: false, kind: "derived", origin: "legacy", chain_depth: 1 },
    arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "legacy" },
    ownership: { kind: "self" }, created_at: now, last_accessed: now,
    access_count: 0, stability: 1, schema_version: "0.6", legacy_unstructured: true,
  };
  nemos.raw().storage.insert("default", "alice", legacy);
  const current = await user.write(assertion("我搬到福州", "福州"));
  assert.equal(nemos.raw().storage.findById("default", "alice", legacy.id)?.belief_state, "superseded");
  assert.equal((await user.listOperations(current.claim_key)).at(-1)?.kind, "SUPERSEDE");
  await nemos.close();
});
test("v0.7.1 identity: merge creates one canonical claim slot and split restores distinct keys", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const first = await user.write(assertion("妈妈住在福州", "福州", { subject: "contact:mom" }));
  const second = await user.write(assertion("张阿姨住在上海", "上海", { subject: "contact:zhang-aunt" }));
  assert.notEqual(first.claim_key, second.claim_key);
  const merged = await user.mergeIdentity(["contact:mom", "contact:zhang-aunt"], "contact:mother");
  const mergedFirst = nemos.raw().storage.findById("default", "alice", first.id)!;
  const mergedSecond = nemos.raw().storage.findById("default", "alice", second.id)!;
  assert.equal(mergedFirst.claim_key, mergedSecond.claim_key);
  assert.equal(mergedFirst.belief_state, "disputed");
  assert.equal(mergedSecond.belief_state, "disputed");
  await user.splitIdentity(merged.id);
  const splitFirst = nemos.raw().storage.findById("default", "alice", first.id)!;
  const splitSecond = nemos.raw().storage.findById("default", "alice", second.id)!;
  assert.notEqual(splitFirst.claim_key, splitSecond.claim_key);
  await nemos.close();
});
test("v0.7.3 common personal states get deterministic claim identity without LLM predicate output", async () => {
  const cases = [
    ["I recently started working at TechCorp Inc.", "I just joined GreenTech Industries recently.", "employment.organization", "GreenTech Industries"],
    ["I remember moving to New York a few years ago.", "I relocated to San Francisco.", "residence.current", "San Francisco"],
    ["I've been sticking to a vegetarian diet.", "I've decided to go fully vegan now.", "preference.diet", "vegan"],
    ["I've been single for quite some time now.", "We just got married last month.", "relationship.status", "married"],
    ["I just started my new job as a Junior Developer.", "I've moved up to Senior Software Engineer.", "employment.role", "Senior Software Engineer"],
    ["I've been going to Planet Fitness for a while now.", "I've joined Equinox.", "membership.gym", "Equinox"],
    ["I just got a new Samsung phone.", "I decided to try out an Apple phone.", "device.phone_brand", "Apple"],
    ["I used to bike to work every day.", "I decided to drive my car to work.", "commute.mode", "car"],
    ["I used to drive a Toyota Corolla.", "I got myself a Tesla Model 3.", "possession.vehicle", "Tesla Model 3"],
  ] as const;

  for (const [oldText, newText, predicate, expected] of cases) {
    const nemos = createNemos();
    const user = nemos.forUser("alice");
    const source = { authoritative: false, origin: "test:user-statement", chain_depth: 1, extractor: "user_typed" } as const;
    const oldFact = await user.write({
      layer: "personal_semantic", content: oldText, source, validFrom: "2026-01-01",
    });
    const current = await user.write({
      layer: "personal_semantic", content: newText, source, validFrom: "2026-02-01",
    });

    assert.equal(current.predicate, predicate, newText);
    assert.equal(current.object_json, expected, newText);
    assert.equal(current.claim_key, oldFact.claim_key, newText);
    assert.equal(nemos.raw().storage.findById("default", "alice", oldFact.id)?.belief_state, "superseded", oldText);
    await nemos.close();
  }
});
test("v0.7.3 ingest persists controlled claims from raw user text even when the LLM omits them", async () => {
  const cases = [
    ["I recently started working at TechCorp Inc.", "I just joined GreenTech Industries recently.", "Where are you currently employed?", "employment.organization", "GreenTech Industries"],
    ["I remember moving to New York a few years ago.", "I relocated to San Francisco.", "Where do you currently live?", "residence.current", "San Francisco"],
    ["I've been sticking to a vegetarian diet.", "I've decided to go fully vegan now.", "What is your current diet preference?", "preference.diet", "vegan"],
    ["I've been single for quite some time now.", "We just got married last month.", "What's your current relationship status?", "relationship.status", "married"],
    ["I just started my new job as a Junior Developer.", "I've moved up to Senior Software Engineer.", "What is your current job title?", "employment.role", "Senior Software Engineer"],
    ["I've been going to Planet Fitness for a while now.", "I've joined Equinox.", "Which gym are you currently going to?", "membership.gym", "Equinox"],
    ["I just got a new Samsung phone.", "I decided to try out an Apple phone.", "What brand of phone are you currently using?", "device.phone_brand", "Apple"],
    ["I used to bike to work every day.", "I decided to drive my car to work.", "How do you currently commute to work?", "commute.mode", "car"],
    ["I used to drive a Toyota Corolla.", "I got myself a Tesla Model 3.", "What car are you currently driving?", "possession.vehicle", "Tesla Model 3"],
  ] as const;

  for (const [oldText, newText, query, predicate, expected] of cases) {
    const nemos = createNemos();
    const user = nemos.forUser("alice");
    const oldResult = await user.ingest(oldText);
    const currentResult = await user.ingest(newText);
    const oldFact = oldResult.derived.find((memory) => memory.predicate === predicate);
    const current = currentResult.derived.find((memory) => memory.predicate === predicate);

    assert.ok(oldFact, oldText);
    assert.ok(current, newText);
    assert.equal(current.object_json, expected, newText);
    assert.equal(nemos.raw().storage.findById("default", "alice", oldFact.id)?.belief_state, "superseded", oldText);
    const packet = await user.recall(query, { subjectIds: ["user:self"] });
    assert.equal(packet.items.find((item) => item.memory.predicate === predicate)?.memory.object_json, expected, JSON.stringify(packet.items.map((item) => ({ content: item.memory.content, predicate: item.memory.predicate, object: item.memory.object_json, state: item.memory.belief_state }))));
    await nemos.close();
  }
});
test("v0.7.4 deterministic Chinese residence updates do not depend on LLM claim fields", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const oldResult = await user.ingest("我现在住在福州。", {
    contentDate: "2026-06-01T09:00:00+08:00",
  });
  const currentResult = await user.ingest("我已经从福州搬到厦门，现在常住厦门。", {
    contentDate: "2026-07-10T09:00:00+08:00",
  });
  const oldFact = oldResult.derived.find((memory) => memory.predicate === "residence.current");
  const current = currentResult.derived.find((memory) =>
    memory.predicate === "residence.current" && memory.object_json === "厦门"
  );

  assert.ok(oldFact);
  assert.ok(current);
  assert.equal(nemos.raw().storage.findById("default", "alice", oldFact.id)?.belief_state, "superseded");
  assert.equal(nemos.raw().storage.findById("default", "alice", current.id)?.belief_state, undefined);
  await nemos.close();
});

test("v0.7.5 deterministic workplace claims respect event time when extraction finishes out of order", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const currentResult = await user.ingest("我现在的办公地点是成都高新区。", {
    contentDate: "2026-07-20T09:00:00+08:00",
  });
  const oldResult = await user.ingest("年初时我的办公室还在北京朝阳区。", {
    contentDate: "2026-01-05T09:00:00+08:00",
  });
  const current = currentResult.derived.find((memory) => memory.predicate === "workplace.location");
  const old = oldResult.derived.find((memory) => memory.predicate === "workplace.location");

  assert.equal(current?.object_json, "成都高新区");
  assert.equal(old?.object_json, "北京朝阳区");
  assert.equal(nemos.raw().storage.findById("default", "alice", old!.id)?.belief_state, "superseded");
  const packet = await user.recall("我现在在哪里办公？");
  assert.equal(packet.items[0]?.memory.object_json, "成都高新区");
  await nemos.close();
});

test("v0.7.5 deterministic extraction keeps high-value facts from dense text", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const result = await user.ingest("今天开会很吵，投影仪还坏了。顺便记一下真正有用的信息：我的护照将在2028年4月到期；紧急联系人是姐姐林岚；午饭的汤有点咸。", {
    contentDate: "2026-07-18T14:00:00+08:00",
  });

  assert.equal(result.derived.find((memory) => memory.predicate === "document.passport_expiry")?.object_json, "2028年4月");
  assert.equal(result.derived.find((memory) => memory.predicate === "contact.emergency")?.object_json, "姐姐林岚");
  assert.equal((await user.recall("我的护照什么时候到期？")).items[0]?.memory.object_json, "2028年4月");
  assert.equal((await user.recall("我的紧急联系人是谁？")).items[0]?.memory.object_json, "姐姐林岚");
  await nemos.close();
});

test("v0.7.5 deterministic camera claim keeps the current model above legacy text", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const oldResult = await user.ingest("我以前使用佳能相机。", {
    contentDate: "2022-03-01T09:00:00+08:00",
  });
  const currentResult = await user.ingest("四年后我已经换成富士相机，现在主力机是富士X-T6。", {
    contentDate: "2026-06-01T09:00:00+08:00",
  });
  const old = oldResult.derived.find((memory) => memory.predicate === "device.camera.primary");
  const current = currentResult.derived.find((memory) => memory.predicate === "device.camera.primary");

  assert.equal(old?.object_json, "佳能相机");
  assert.equal(current?.object_json, "富士X-T6");
  assert.equal(nemos.raw().storage.findById("default", "alice", old!.id)?.belief_state, "superseded");
  const packet = await user.recall("我现在使用的主力相机是什么？");
  assert.equal(packet.items[0]?.memory.object_json, "富士X-T6");
  await nemos.close();
});
test("v0.7.4 deterministic color preferences remain isolated by user", async () => {
  const nemos = createNemos();
  const alice = await nemos.forUser("alice").ingest("我最喜欢的颜色是绿色。");
  const bob = await nemos.forUser("bob").ingest("我最喜欢的颜色是橙色。");

  assert.equal(alice.derived.find((memory) => memory.predicate === "preference.color")?.object_json, "绿色");
  assert.equal(bob.derived.find((memory) => memory.predicate === "preference.color")?.object_json, "橙色");
  assert.ok(!(await nemos.forUser("alice").listByLayer("personal_semantic", { limit: 20 }))
    .some((memory) => memory.object_json === "橙色"));
  await nemos.close();
});

test("v0.7.4 deterministic ingest preserves first-person allergy constraints", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const result = await user.ingest("我对花生严重过敏，平时喝无糖美式。", {
    contentDate: "2026-07-02T10:00:00+08:00",
  });
  const allergy = result.derived.find((memory) => memory.predicate === "constraint.health");

  assert.ok(allergy);
  assert.deepEqual(allergy.object_json, ["花生"]);
  assert.equal(allergy.event_at, "2026-07-02T10:00:00+08:00");
  assert.equal(allergy.valid_at, "2026-07-02T10:00:00+08:00");
  await nemos.close();
});

test("v0.7.4 deterministic allergy extraction ignores quoted third-party facts", async () => {
  const nemos = createNemos();
  const result = await nemos.forUser("alice").ingest("小林告诉我，他对花生过敏。至于我，我没有任何食物过敏。");

  assert.ok(!result.derived.some((memory) =>
    memory.predicate === "constraint.health" && JSON.stringify(memory.object_json).includes("花生")
  ));
  await nemos.close();
});

test("v0.7.3 deterministic ingest rejects hypothetical and research-document claims", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const hypothetical = await user.ingest("If I moved to Mars, I would need a new home.");
  const research = await user.ingest("I relocated to Atlantis.", { scenario: "doc-research" });

  assert.ok(!hypothetical.derived.some((memory) => memory.predicate === "residence.current"));
  assert.ok(!research.derived.some((memory) => memory.predicate === "residence.current"));
  await nemos.close();
});

test("v0.7.5 personal-best metrics reconcile by activity context", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const oldResult = await user.ingest(
    "My personal best in the charity 5K run was 27:12.",
    { contentDate: "2023-05-25T09:00:00Z" },
  );
  const currentResult = await user.ingest(
    "If you could help with endurance, that would be useful. By the way, I am hoping to beat my personal best time of 25:50 in another charity 5K run.",
    { contentDate: "2023-05-27T09:00:00Z" },
  );
  const oldClaim = oldResult.derived.find((memory) => memory.predicate === "achievement.personal_best");
  const currentClaim = currentResult.derived.find((memory) => memory.predicate === "achievement.personal_best");

  assert.ok(oldClaim);
  assert.ok(currentClaim);
  assert.equal(oldClaim.claim_key, currentClaim.claim_key);
  assert.equal(nemos.raw().storage.findById("default", "alice", oldClaim.id)?.belief_state, "superseded");

  const hypothetical = await user.ingest("If my personal best in the charity 5K run were 24:00, I would celebrate.");
  assert.ok(!hypothetical.derived.some((memory) => memory.object_json === "24:00"));

  const packet = await user.recall("What was my personal best time in the charity 5K run?");
  assert.equal(packet.items[0]?.memory.object_json, "25:50");
  assert.ok(!packet.items.some((item) => item.memory.object_json === "27:12"));
  await nemos.close();
});
