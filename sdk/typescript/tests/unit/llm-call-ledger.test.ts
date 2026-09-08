import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileLlmCallLedger } from "../../examples/companion/llm-call-ledger.js";
import { resolveLLM } from "../../examples/companion/llm.js";

test("ledger retains measured usage, preserves unknown usage, bounds records and marks restart work interrupted", () => {
  const file = join(mkdtempSync(join(tmpdir(), "clownfish-ledger-")), "calls.json");
  const ledger = new FileLlmCallLedger(file, 2);
  const one = ledger.start({ provider: "zhipu", model: "glm-5", purpose: "team_worker", taskId: "job-1", runId: "team/job-1/work:a/1", startedAt: "2026-01-01T00:00:00.000Z" });
  one.finish({ status: "completed", finishedAt: "2026-01-01T00:00:01.000Z", usage: { reported: true, inputTokens: 3, outputTokens: 4, totalTokens: 7 } });
  const two = ledger.start({ provider: "zhipu", model: "glm-5", purpose: "team_final", taskId: "job-1", runId: "team/job-1/final/2", startedAt: "2026-01-02T00:00:00.000Z" });
  two.finish({ status: "cancelled" });
  ledger.start({ provider: "zhipu", model: "glm-5", purpose: "other", startedAt: "2026-01-03T00:00:00.000Z" });
  const reloaded = new FileLlmCallLedger(file, 2);
  const calls = reloaded.list({ limit: 10 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.status, "interrupted");
  assert.equal(calls[0]?.usage.reported, false);
  assert.equal(reloaded.summarize({ taskId: "job-1" }).calls, 1);
  assert.equal(reloaded.summarize({ taskId: "job-1" }).unknownUsageCalls, 1);
  const disk = readFileSync(file, "utf8");
  assert.equal(disk.includes("api-key"), false);
});

test("actual admitted model HTTP calls are ledgered with task purpose and provider usage", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ZHIPU_API_KEY;
  const file = join(mkdtempSync(join(tmpdir(), "clownfish-ledger-")), "calls.json");
  let httpCalls = 0;
  process.env.ZHIPU_API_KEY = "test-key";
  globalThis.fetch = async () => {
    httpCalls++;
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "done" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const llm = resolveLLM();
    const ledger = new FileLlmCallLedger(file);
    llm.configureCallLedger(ledger);
    assert.equal(await llm.chat("system", "work", undefined, 100, { runId: "team/job-42/final/x", sessionId: "team/job-42/final", userId: "me", personaId: "clownfish", instruction: "work", scope: "team:job-42", memoryScopes: [], mode: "task", toolMode: "off" }), "done");
    const calls = ledger.list({ taskId: "job-42" });
    assert.equal(httpCalls, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.purpose, "team_final");
    assert.equal(ledger.summarize({ taskId: "unrelated-job" }).calls, 0, "unrelated jobs must not inherit a call count");
    assert.deepEqual(calls[0]?.usage, { reported: true, inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    assert.equal(existsSync(file), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = originalKey;
  }
});

test("failed model calls are ledgered without inventing usage", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ZHIPU_API_KEY;
  const file = join(mkdtempSync(join(tmpdir(), "clownfish-ledger-")), "calls.json");
  process.env.ZHIPU_API_KEY = "test-key";
  globalThis.fetch = async () => new Response("no", { status: 429 });
  try {
    const llm = resolveLLM(); const ledger = new FileLlmCallLedger(file); llm.configureCallLedger(ledger);
    await assert.rejects(() => llm.chat("system", "work", undefined, 100, { runId: "team/job-7/work:one/x", sessionId: "team/job-7/work:one", userId: "me", personaId: "worker", instruction: "work", scope: "team:job-7", memoryScopes: [], mode: "task", toolMode: "off" }));
    const call = ledger.list({ taskId: "job-7" })[0];
    assert.equal(call?.status, "failed");
    assert.deepEqual(call?.usage, { reported: false, inputTokens: null, outputTokens: null, totalTokens: null });
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = originalKey; }
});
