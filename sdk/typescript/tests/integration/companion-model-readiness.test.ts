import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("v2/v3 checks bind once during migration and revisions remain stable across restart", { timeout: 90_000 }, async () => {
  const h = await startModelHarness(); const path = join(h.dir, "llm-key.dpapi.json");
  const saved = () => JSON.parse(readFileSync(path, "utf8")) as any;
  const record = () => saved().connections.find((item: any) => item.id === saved().activeConnectionId);
  const status = async () => await (await fetch(h.base + "/api/llm")).json() as any;
  try {
    await h.restart(() => writeFileSync(path, JSON.stringify({ version: 3, encryption: "windows-dpapi", provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual", modelChecks: { manual: { checkedAt: new Date().toISOString(), chat: "passed", streaming: "passed", tools: "passed", detail: "legacy fixture" } }, models: [{ id: "manual", created: 10 }], modelsFetchedAt: new Date().toISOString() }, null, 2), "utf8"));
    assert.equal(saved().version, 9); const revision = record().connectionRevision;
    assert.match(revision, /^[0-9a-f-]{36}$/); assert.equal(record().modelChecks.manual.connectionRevision, revision);
    await h.restart(); assert.equal(record().connectionRevision, revision); assert.equal((await status()).modelChecks.manual.chat, "passed");
    await h.restart(() => { const file = saved(); file.connections.find((item: any) => item.id === file.activeConnectionId).modelChecks.manual.connectionRevision = "00000000-0000-0000-0000-000000000000"; writeFileSync(path, JSON.stringify(file), "utf8"); });
    assert.deepEqual((await status()).modelChecks, {}); assert.equal((await status()).connectionRevision, revision);
  } finally { await h.stop(); }
});
