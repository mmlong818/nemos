import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolZhipuKey, zhipuToolChat, zhipuToolChatOrSource } from "../../examples/companion/tool-text-model.js";
import { CompanionModelHttpError } from "../../examples/companion/model-connection.js";
import { MODEL_CALL_POLICY } from "../../examples/companion/model-call-policy.js";
import type { FileLlmCallLedger, LlmCallLedgerInput, LlmCallOutcome } from "../../examples/companion/llm-call-ledger.js";

const reply = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });

test("tool key precedence stays saved, tool environment, then legacy Zhipu environment", () => {
  assert.deepEqual(resolveToolZhipuKey("saved", "tool-env", "llm-env"), { key: "saved", source: "tool" });
  assert.deepEqual(resolveToolZhipuKey(null, "tool-env", "llm-env"), { key: "tool-env", source: "env" });
  assert.deepEqual(resolveToolZhipuKey(null, undefined, "llm-env"), { key: "llm-env", source: "llm" });
  assert.deepEqual(resolveToolZhipuKey(null, "  ", "  llm-env  "), { key: "llm-env", source: "llm" });
  assert.deepEqual(resolveToolZhipuKey(null, undefined, undefined), { key: null, source: "none" });
});

test("tool text calls use an isolated Zhipu connection, disabled thinking and a fresh request budget", async () => {
  const original = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tool-only-key");
    bodies.push(JSON.parse(String(init?.body)));
    return reply(" translated ");
  };
  try {
    for (let i = 0; i < 2; i++) assert.equal(await zhipuToolChat("tool-only-key", "glm-5-flash", "instructions", "input", 9999), "translated");
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      assert.equal(body.model, "glm-5-flash");
      assert.equal(body.max_tokens, MODEL_CALL_POLICY.purposes.tool_text.perCallOutputTokens);
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.tools, undefined);
      assert.deepEqual(body.messages, [{ role: "system", content: "instructions" }, { role: "user", content: "input" }]);
    }
  } finally { globalThis.fetch = original; }
});

test("empty tool text retries once and ASR correction keeps the transcript after empty output", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply(""); };
  try {
    await assert.rejects(zhipuToolChat("key", "glm-5-flash", "system", "text", 1200), /没有返回正文/);
    assert.equal(calls, 2);
    assert.equal(await zhipuToolChatOrSource("key", "glm-5-flash", "system", "original transcript", 1200), "original transcript");
    assert.equal(calls, 4);
  } finally { globalThis.fetch = original; }
});

test("one empty attempt may safely retry to a visible result", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => reply(++calls === 1 ? "" : "corrected");
  try {
    assert.equal(await zhipuToolChat("key", "glm-5-flash", "system", "source", 2600), "corrected");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("tool attempts enter the shared metadata ledger, including a safe retry", async () => {
  const original = globalThis.fetch;
  const rows: Array<{ input: LlmCallLedgerInput; outcome?: LlmCallOutcome }> = [];
  const ledger = { start: (input: LlmCallLedgerInput) => {
    const row: { input: LlmCallLedgerInput; outcome?: LlmCallOutcome } = { input };
    rows.push(row);
    return { id: String(rows.length), finish: (outcome: LlmCallOutcome) => { row.outcome = outcome; } };
  } } as unknown as FileLlmCallLedger;
  let calls = 0;
  globalThis.fetch = async () => reply(++calls === 1 ? "" : "corrected");
  try {
    assert.equal(await zhipuToolChat("private-tool-key", "glm-5-flash", "system secret", "user secret", 1200, ledger), "corrected");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.outcome?.status), ["failed", "completed"]);
    assert.equal(rows[0].input.runId, rows[1].input.runId);
    assert.equal(rows[0].input.purpose, "tool_text");
    assert.equal(rows[0].input.provider, "zhipu");
    assert.equal(rows[0].input.model, "glm-5-flash");
    assert.doesNotMatch(JSON.stringify(rows), /private-tool-key|system secret|user secret/);
  } finally { globalThis.fetch = original; }
});

test("provider HTTP errors stay safe and ASR does not conceal them", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 1213, message: "secret key and user prompt" } }), { status: 401 });
  try {
    await assert.rejects(zhipuToolChatOrSource("key", "glm-5-flash", "system", "source", 1200), (error: unknown) => {
      assert.ok(error instanceof CompanionModelHttpError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /secret|prompt/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("invalid provider JSON cannot surface provider text", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("secret prompt: {", { status: 200 });
  try {
    await assert.rejects(zhipuToolChat("key", "glm-5-flash", "system", "source", 1200), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "工具模型返回格式无效。");
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("a tool call in a text-only response is rejected", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "", tool_calls: [{ id: "call-1", function: { name: "unexpected", arguments: "{}" } }] } }] });
  try {
    await assert.rejects(zhipuToolChat("key", "glm-5-flash", "system", "source", 1200), /未请求的工具调用/);
  } finally { globalThis.fetch = original; }
});
