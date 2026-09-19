import assert from "node:assert/strict";
import test from "node:test";
import { MockAgent } from "undici";
import { openAIImage, openAISpeech, openAITranscribe, openAIVision, validateImageDataUrl } from "../../examples/companion/openai-media.js";
import type { CompanionModelConnection } from "../../examples/companion/model-connection.js";

function connection(dispatcher: MockAgent): CompanionModelConnection {
  return { provider: "openai", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", apiKey: "test-secret", transportDispatcher: dispatcher };
}

test("official OpenAI media adapters use four exact endpoints and validate response types", async () => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const api = mock.get("https://api.openai.com");
  api.intercept({ path: "/v1/responses", method: "POST" }).reply(200, { output_text: "one pixel" }, { headers: { "content-type": "application/json" } });
  api.intercept({ path: "/v1/audio/transcriptions", method: "POST" }).reply(200, { text: "hello" }, { headers: { "content-type": "application/json" } });
  api.intercept({ path: "/v1/audio/speech", method: "POST" }).reply(200, Buffer.from("audio"), { headers: { "content-type": "audio/mpeg" } });
  api.intercept({ path: "/v1/images/generations", method: "POST" }).reply(200, { data: [{ b64_json: Buffer.from("png").toString("base64") }] }, { headers: { "content-type": "application/json" } });
  const c = connection(mock);
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  assert.equal(await openAIVision(c, "gpt-5.4", "describe", pixel), "one pixel");
  assert.equal(await openAITranscribe(c, "gpt-transcribe", Buffer.from("RIFF....WAVE"), "audio/wav"), "hello");
  assert.deepEqual(await openAISpeech(c, "gpt-4o-mini-tts", "hello"), { data: Buffer.from("audio"), contentType: "audio/mpeg" });
  assert.deepEqual(await openAIImage(c, "gpt-image-2.5-flare", "blue dot", { quality: "low" }), { data: Buffer.from("png"), mime: "image/png" });
  assert.equal(mock.pendingInterceptors().length, 0);
  await mock.close();
});

test("media adapters reject untrusted endpoints, unsafe images and non-audio speech responses", async () => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const custom = { ...connection(mock), provider: "custom" as const };
  await assert.rejects(() => openAIVision(custom, "model", "x", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), /官方端点/);
  assert.throws(() => validateImageDataUrl("data:image/heif;base64,AA=="), /ICNS、JXL、HEIF/);
  assert.throws(() => validateImageDataUrl("data:image/png;base64,AAAA"), /MIME|截断/);
  assert.throws(() => validateImageDataUrl("data:image/png;base64,AAA"), /Base64|仅支持/);
  await assert.rejects(() => openAITranscribe(connection(mock), "gpt-transcribe", Buffer.from("not audio"), "audio/wav"), /签名无效/);
  mock.get("https://api.openai.com").intercept({ path: "/v1/audio/speech", method: "POST" }).reply(200, "not audio", { headers: { "content-type": "text/plain" } });
  await assert.rejects(() => openAISpeech(connection(mock), "gpt-4o-mini-tts", "hello"), /不是音频/);
  await mock.close();
});

test("provider failures stay classified without leaking provider bodies or keys", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const mock = new MockAgent(); mock.disableNetConnect();
    mock.get("https://api.openai.com").intercept({ path: "/v1/audio/speech", method: "POST" }).reply(status, "provider echoed sk-secret and private input");
    await assert.rejects(() => openAISpeech(connection(mock), "gpt-4o-mini-tts", "hello"), (error: any) => {
      assert.equal(error.status, status); assert.doesNotMatch(error.message, /sk-secret|private input/); return true;
    });
    await mock.close();
  }
  const malformed = new MockAgent(); malformed.disableNetConnect();
  malformed.get("https://api.openai.com").intercept({ path: "/v1/responses", method: "POST" }).reply(200, "not-json", { headers: { "content-type": "application/json" } });
  await assert.rejects(() => openAIVision(connection(malformed), "gpt-5.4", "x", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="));
  await malformed.close();
});
