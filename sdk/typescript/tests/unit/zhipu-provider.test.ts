// zhipu-provider.test.ts — ZhipuProvider（GLM，OpenAI 兼容端点）

import { test } from "node:test";
import assert from "node:assert/strict";
import { ZhipuProvider, makeProvider } from "../../src/llm.js";

interface CapturedReq {
  url: string;
  headers: Record<string, string>;
  body: { model: string; messages: Array<{ role: string; content: string }>; response_format?: { type: string } };
}

function mockFetch(reply: string): { restore: () => void; captured: () => CapturedReq | null } {
  const orig = globalThis.fetch;
  let cap: CapturedReq | null = null;
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    cap = { url, headers: init.headers, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: reply } }] }),
      text: async () => reply,
    };
  }) as unknown as typeof fetch;
  return { restore: () => { globalThis.fetch = orig; }, captured: () => cap };
}

test("ZhipuProvider：打智谱端点 + Bearer + 默认 glm-5.1 + JSON mode", async () => {
  const m = mockFetch('{"ok":true}');
  try {
    const p = new ZhipuProvider("test-key");
    const out = await p.chat("sys", "usr");
    assert.equal(out, '{"ok":true}');
    const req = m.captured()!;
    assert.match(req.url, /open\.bigmodel\.cn\/api\/paas\/v4\/chat\/completions/);
    assert.equal(req.headers.Authorization, "Bearer test-key");
    assert.equal(req.body.model, "glm-5.1", "默认模型 glm-5.1");
    assert.equal(req.body.response_format?.type, "json_object");
    assert.equal(req.body.messages[0].role, "system");
    assert.equal(req.body.messages[1].role, "user");
  } finally {
    m.restore();
  }
});

test("ZhipuProvider：可覆盖 model", async () => {
  const m = mockFetch("{}");
  try {
    const p = new ZhipuProvider("k", "glm-4.7");
    await p.chat("s", "u");
    assert.equal(m.captured()!.body.model, "glm-4.7");
  } finally {
    m.restore();
  }
});

test("ZhipuProvider：缺 apiKey 抛错", () => {
  assert.throws(() => new ZhipuProvider(""), /缺少 apiKey/);
});

test("makeProvider：provider=zhipu → ZhipuProvider", () => {
  const p = makeProvider({ provider: "zhipu", apiKey: "k" });
  assert.equal(p.name, "zhipu");
});

test("ZhipuProvider：name 标识为 zhipu", () => {
  assert.equal(new ZhipuProvider("k").name, "zhipu");
});
