import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CompanionEngine, convScope, type ChatFn } from "../../examples/companion/engine.js";
import { Nemos } from "../../src/index.js";
import { makeMockLLMConfig } from "../helpers.js";

const persona = {
  id: "feifei",
  name: "菲菲",
  persona: "自然、可靠的朋友。",
};

function makeMemory(dir: string): Nemos {
  return new Nemos({
    storage: { type: "sqlite", path: join(dir, "memory.db") },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
}

test("one-on-one user messages stay in the user namespace without persona attribution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-owner-"));
  const memory = makeMemory(dir);
  const engine = new CompanionEngine(memory, [persona], async () => "知道了，你今晚在加班。", { asyncIngest: false });

  try {
    await engine.send("me", "feifei", "我今晚在加班");
    const entries = await memory.forUser("me").listByLayer("archival", {
      scope: convScope("me", "feifei"),
      limit: 10,
    });
    const entry = entries.find((item) => item.content === "我今晚在加班");
    assert.ok(entry);
    assert.equal((entry.source as Record<string, unknown>).origin_agent, undefined);

    const personaStore = memory.forUser("persona:feifei");
    const personaArchives = await personaStore.listByLayer("archival", {
      scope: convScope("me", "feifei"),
      limit: 10,
    });
    assert.equal(personaArchives.some((item) => item.content === "知道了，你今晚在加班。"), true);
    for (const layer of ["personal_semantic", "semantic", "episodic", "procedural"] as const) {
      assert.equal((await personaStore.listByLayer(layer, { scope: convScope("me", "feifei"), limit: 10 })).length, 0);
    }
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a rebuilt engine restores recent turns and keeps persona names canonical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-continuity-"));
  const memory = makeMemory(dir);
  const firstEngine = new CompanionEngine(memory, [persona], async () => "你在加班，我记住了。", { asyncIngest: false });
  let secondPrompt = "";
  const secondChat: ChatFn = async (_system, user) => {
    secondPrompt = user;
    return "记得，你还在加班。";
  };

  try {
    await firstEngine.send("me", "feifei", "我今晚在加班");
    await memory.forUser("me").write({
      layer: "semantic",
      content: "feifei 和飞飞都指同一个角色名字",
      scope: convScope("me", "feifei"),
      source: { authoritative: false, origin: "legacy-test" },
    });
    const personaStore = memory.forUser("persona:feifei");
    await personaStore.ingest("这句关心不要重复", { scope: convScope("me", "feifei"), originAgent: "feifei" });
    await personaStore.ingest("这句关心不要重复", { scope: convScope("me", "feifei"), originAgent: "feifei" });

    const rebuilt = new CompanionEngine(memory, [persona], secondChat, { asyncIngest: false });
    const normalized = await rebuilt.recall("me", "feifei", "角色名字 feifei 飞飞");
    assert.match(normalized.userFacts, /菲菲/);
    assert.doesNotMatch(normalized.userFacts, /feifei|飞飞/);
    assert.equal(normalized.selfState.split("这句关心不要重复").length - 1, 1);

    await rebuilt.send("me", "feifei", "你还记得我在做什么吗");
    assert.match(secondPrompt, /对方：我今晚在加班/);
    assert.match(secondPrompt, /菲菲：你在加班，我记住了/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
