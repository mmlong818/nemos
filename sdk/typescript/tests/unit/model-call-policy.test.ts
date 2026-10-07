import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeConnectionAgentModel, resolveLLM, storedAgentContext } from "../../examples/companion/llm.js";
import { MODEL_CALL_POLICY, reserveModelOutputTokens } from "../../examples/companion/model-call-policy.js";
import type { CompanionModelConnection } from "../../examples/companion/model-connection.js";
import { ModelBudgetStore } from "../../examples/companion/model-budget-store.js";

const connection: CompanionModelConnection = {
  provider: "custom", protocol: "openai-compatible", model: "unknown-fixture",
  baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-only",
};
const request = () => ({ messages: [{ role: "user" as const, content: "synthetic" }], tools: [], signal: new AbortController().signal });
const reply = (content: string, finish_reason = "stop") => Response.json({ choices: [{ finish_reason, message: { content } }] });

test("persistent gateway binds owner before transport and charges every retry across reopen", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-gateway-budget-"));
  const path = join(dir, "policy.db");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply(""); };
  const identity = randomUUID();
  const make = (store: ModelBudgetStore, declaredIdentity = identity) => makeConnectionAgentModel({
    connection, model: connection.model, budgetIdentity: declaredIdentity, budgetOwnerKey: "team:request-1",
    budgetStore: store, purpose: "tool_text", maxTokens: 2600, temperature: 0, stream: false,
  });
  const first = new ModelBudgetStore(path);
  try {
    await assert.rejects(make(first).complete(request()), /没有返回正文/);
    assert.equal(calls, 2);
    first.close();
    const reopened = new ModelBudgetStore(path);
    try {
      await assert.rejects(make(reopened).complete(request()), /预算已用完/);
      await assert.rejects(make(reopened, randomUUID()).complete(request()), /不同预算身份/);
      assert.equal(calls, 2);
      assert.equal(reopened.stats().attempts, 2);
    } finally { reopened.close(); }
  } finally { globalThis.fetch = original; }
});

test("versioned policy reserves concurrent output before admission and rejects an exhausted task", () => {
  assert.equal(MODEL_CALL_POLICY.schema, "nemos.model-call-policy");
  assert.equal(MODEL_CALL_POLICY.version, 1);
  const identity = randomUUID();
  const first = reserveModelOutputTokens(identity, "feed", 5000);
  const second = reserveModelOutputTokens(identity, "feed", 5000);
  assert.equal(first.tokens, 2048);
  assert.equal(second.tokens, 2048);
  first.start(); second.start();
  reserveModelOutputTokens(identity, "feed", 5000).start();
  reserveModelOutputTokens(identity, "feed", 5000).start();
  assert.throws(() => reserveModelOutputTokens(identity, "feed", 1), /预算已用完/);
  const queued = reserveModelOutputTokens(randomUUID(), "chat", 4096);
  queued.releaseIfUnstarted();
});

test("concurrent gateway calls sharing an opaque identity cannot overbook the task", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply("done"); };
  try {
    const model = makeConnectionAgentModel({ connection, model: connection.model, runId: "reusable-display-id", budgetIdentity: randomUUID(), purpose: "feed", maxTokens: 2048, temperature: 0, stream: false });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => model.complete(request())));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 4);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(calls, 4);
  } finally { globalThis.fetch = original; }
});

test("reused display id does not merge separate task budgets, while the same identity survives a new adapter", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply("done"); };
  const make = (budgetIdentity: string) => makeConnectionAgentModel({
    connection, model: connection.model, runId: "same-display-id", budgetIdentity,
    purpose: "feed", maxTokens: 2048, temperature: 0, stream: false,
  });
  try {
    const first = randomUUID();
    await Promise.all(Array.from({ length: 2 }, () => make(first).complete(request())));
    await Promise.all(Array.from({ length: 2 }, () => make(first).complete(request())));
    await assert.rejects(make(first).complete(request()), /预算已用完/);
    assert.equal((await make(randomUUID()).complete(request())).text, "done");
    assert.equal(calls, 5);
  } finally { globalThis.fetch = original; }
});

test("anonymous adapters are isolated and still enforce a bounded budget", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply("done"); };
  const make = () => makeConnectionAgentModel({ connection, model: connection.model, runId: "reusable-display-id", purpose: "feed", maxTokens: 2048, temperature: 0, stream: false });
  try {
    const anonymous = make();
    await Promise.all(Array.from({ length: 4 }, () => anonymous.complete(request())));
    await assert.rejects(anonymous.complete(request()), /预算已用完/);
    assert.equal((await make().complete(request())).text, "done");
    assert.equal(calls, 5);
  } finally { globalThis.fetch = original; }
});

test("Agent run metadata records an opaque identity separate from its display run id", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => reply("done");
  try {
    const llm = resolveLLM(connection);
    const seen: string[] = [];
    llm.configureAgentObserver({ onEvent: (_runId, event) => {
      if (event.type === "run_start") seen.push(event.metadata?.budgetIdentity ?? "");
    } });
    for (let i = 0; i < 2; i++) await llm.chat("system", "synthetic", connection.model, 32, {
      runId: "same-display-id", sessionId: "same-conversation", userId: "fixture", personaId: "fixture",
      instruction: "synthetic", scope: "fixture", memoryScopes: [], mode: "chat", toolMode: "off",
    });
    assert.equal(seen.length, 2);
    assert.match(seen[0]!, /^[a-f0-9-]{36}$/i);
    assert.notEqual(seen[0], seen[1]);
    const resumed = storedAgentContext({ runId: "same-display-id", sessionId: "same-conversation", prompt: "synthetic", metadata: {
      userId: "fixture", personaId: "fixture", scope: "fixture", mode: "chat", budgetIdentity: seen[0]!,
    } });
    assert.equal(resumed?.budgetIdentity, seen[0]);
  } finally { globalThis.fetch = original; }
});

test("unknown model omits unsupported effort, clamps each call and reaches the chat gateway", async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return reply("hello"); };
  try {
    const llm = resolveLLM(connection);
    const result = await llm.chat("system", "synthetic", connection.model, 10000, {
      sessionId: randomUUID(), userId: "fixture", personaId: "fixture", instruction: "synthetic",
      scope: "fixture", memoryScopes: [], mode: "chat", toolMode: "off",
    });
    assert.equal(result, "hello");
    assert.equal(bodies.at(-1).reasoning_effort, undefined);
    assert.equal(bodies.at(-1).max_tokens, MODEL_CALL_POLICY.purposes.chat.perCallOutputTokens);
  } finally { globalThis.fetch = original; }
});

test("empty non-stream text retries once, then errors; visible partial text succeeds", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply("", "length"); };
  try {
    const model = makeConnectionAgentModel({ connection, model: connection.model, maxTokens: 40, temperature: 0, stream: false });
    await assert.rejects(model.complete(request()), /没有返回正文/);
    assert.equal(calls, 2);
    globalThis.fetch = async () => { calls++; return reply("partial", "length"); };
    assert.equal((await model.complete(request())).text, "partial");
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test("streaming and tool-bearing empty responses do not retry", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply(""); };
  try {
    const tools = [{ name: "action", description: "fixture", inputSchema: { type: "object" as const, properties: {} } }];
    const model = makeConnectionAgentModel({ connection, model: connection.model, maxTokens: 40, temperature: 0, stream: false });
    await assert.rejects(model.complete({ ...request(), tools }), /没有返回正文/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return new Response(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`); };
    const stream = makeConnectionAgentModel({ connection, model: connection.model, maxTokens: 40, temperature: 0, stream: true });
    await assert.rejects(stream.complete(request()), /没有返回正文/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
