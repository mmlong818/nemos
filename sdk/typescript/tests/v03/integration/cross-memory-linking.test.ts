import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeEntityMockLLMConfig } from "../../helpers.js";

test("two derived memories sharing an entity receive bidirectional related links", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeEntityMockLLMConfig(["Project X", "Team Alpha"]),
    features: { perspectives: ["fact"], autoLinking: true },
    worker: { manualWorker: true },
  });
  try {
    const userMem = mem.forUser("alice");
    const first = await userMem.ingest("The first message mentions Project X and Team Alpha", { background: true });
    await mem.runWorkerTick();
    const second = await userMem.ingest("The second message also mentions Project X", { background: true });
    await mem.runWorkerTick();

    const archival = await userMem.listByLayer("archival");
    assert.equal(archival.length, 2);
    for (const memory of archival) {
      assert.equal(memory.entities, undefined, `archival ${memory.id} must remain immutable`);
      assert.equal(memory.related, undefined, `archival ${memory.id} must remain immutable`);
    }

    const derived = await userMem.listByLayer("semantic");
    assert.equal(derived.length, 2);
    for (const memory of derived) {
      assert.ok(Array.isArray(memory.entities) && memory.entities.length > 0, `derived ${memory.id} is missing entities`);
    }
    const firstDerived = derived.find((memory) => memory.archival_ref === first.archival.id);
    const secondDerived = derived.find((memory) => memory.archival_ref === second.archival.id);
    assert.ok(firstDerived?.related?.includes(secondDerived!.id), "first derived memory should link to the second");
    assert.ok(secondDerived?.related?.includes(firstDerived!.id), "second derived memory should link to the first");
  } finally {
    await mem.close();
  }
});

test("entity links never cross user namespaces", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeEntityMockLLMConfig(["Shared Entity"]),
    features: { perspectives: ["fact"], autoLinking: true },
    worker: { manualWorker: true },
  });
  try {
    await mem.forUser("alice").ingest("Alice mentions Shared Entity", { background: true });
    await mem.runWorkerTick();
    await mem.forUser("bob").ingest("Bob also mentions Shared Entity", { background: true });
    await mem.runWorkerTick();

    const aliceDerived = await mem.forUser("alice").listByLayer("semantic");
    const bobDerived = await mem.forUser("bob").listByLayer("semantic");
    for (const aliceMemory of aliceDerived) {
      for (const bobMemory of bobDerived) {
        assert.ok(!(aliceMemory.related ?? []).includes(bobMemory.id));
        assert.ok(!(bobMemory.related ?? []).includes(aliceMemory.id));
      }
    }
  } finally {
    await mem.close();
  }
});

test("autoLinking=false does not write entities or related links", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeEntityMockLLMConfig(["Project X"]),
    features: { perspectives: ["fact"], autoLinking: false },
    worker: { manualWorker: true },
  });
  try {
    const userMem = mem.forUser("alice");
    await userMem.ingest("first Project X", { background: true });
    await mem.runWorkerTick();
    await userMem.ingest("second Project X", { background: true });
    await mem.runWorkerTick();

    const memories = [
      ...(await userMem.listByLayer("archival")),
      ...(await userMem.listByLayer("semantic")),
    ];
    for (const memory of memories) {
      assert.ok(!memory.related || memory.related.length === 0, `${memory.id} should not have related links`);
      assert.ok(!memory.entities || memory.entities.length === 0, `${memory.id} should not have entities`);
    }
  } finally {
    await mem.close();
  }
});