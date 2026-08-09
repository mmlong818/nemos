import assert from "node:assert/strict";
import test from "node:test";

import { resolveLLM } from "../../examples/companion/llm.js";

test("live task chat forwards the requested long-output token budget", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ZHIPU_API_KEY;
  const requestBodies: Record<string, unknown>[] = [];

  process.env.ZHIPU_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "done" } }],
      usage: { prompt_tokens: 4, completion_tokens: 1 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const llm = resolveLLM();
    const reply = await llm.chat("system", "produce a local task result", undefined, 6000, {
      sessionId: "budget-test",
      userId: "me",
      personaId: "clownfish",
      instruction: "produce a local task result",
      scope: "conv:me:clownfish",
      memoryScopes: [],
      mode: "task",
    });

    assert.equal(reply, "done");
    assert.equal(requestBodies[0]?.max_tokens, 6000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = originalKey;
  }
});
