import assert from "node:assert/strict";
import test from "node:test";
import { MockAgent } from "undici";
import { openAIVision } from "../../examples/companion/openai-media.js";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// 聊天里发图曾经直接把看图模型的原始输出当回复，跳过人格、记忆与上下文。
test("聊天发图不再提前返回看图输出，而是把读图结果交给人格回复", () => {
  const server = readServerRouteSurface();
  for (const [start, end] of [['url === "/api/chat/stream"', "prepareChatTextWithReadableContext(b)"], ['url === "/api/chat"', "prepareChatTextWithReadableContext(b)"]] as const) {
    const from = server.indexOf(start);
    assert.ok(from > 0, start);
    const head = server.slice(from, server.indexOf(end, from));
    assert.match(head, /resolveMediaRoute\("vision"\)/, `${start} 仍要在没有看图型号时拒绝`);
    assert.doesNotMatch(head, /openAIVision\(/, `${start} 不应自己调用看图并直接回复`);
  }
  const prepare = server.slice(server.indexOf("async function prepareChatTextWithImage("), server.indexOf("async function prepareChatTextWithReadableContext("));
  assert.match(prepare, /resolveMediaRoute\("vision"\)/, "读图只走设置里验证过的看图型号");
  assert.doesNotMatch(prepare, /llm\.vision/);
});

test("看图输出上限可调：读图给人格用时不能只有 180 个 token", async () => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const bodies: Array<{ max_output_tokens?: number }> = [];
  const api = mock.get("https://api.openai.com");
  for (let i = 0; i < 2; i++) {
    api.intercept({ path: "/v1/responses", method: "POST" })
      .reply((options) => { bodies.push(JSON.parse(String(options.body))); return { statusCode: 200, data: { output_text: "ok" }, responseOptions: { headers: { "content-type": "application/json" } } }; });
  }
  const connection = { provider: "openai" as const, protocol: "openai-compatible" as const, baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", apiKey: "test-secret", transportDispatcher: mock };
  await openAIVision(connection, "gpt-5.4", "describe", PIXEL);
  await openAIVision(connection, "gpt-5.4", "describe", PIXEL, 2000);
  assert.deepEqual(bodies.map((body) => body.max_output_tokens), [180, 2000]);
  await mock.close();
});
