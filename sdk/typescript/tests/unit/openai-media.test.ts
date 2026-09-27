import assert from "node:assert/strict";
import test from "node:test";
import { MockAgent } from "undici";
import { openAIImage, openAISpeech, openAITranscribe, openAIVision, normalizePcmWav, speechProbeWav, validateImageDataUrl } from "../../examples/companion/openai-media.js";
import { CompanionModelHttpError, companionModelFailureDiagnostic, type CompanionModelConnection } from "../../examples/companion/model-connection.js";

function connection(dispatcher: MockAgent): CompanionModelConnection {
  return { provider: "openai", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", apiKey: "test-secret", transportDispatcher: dispatcher };
}

// 真实账号里 gpt-image-2.5-sunburst / flare 的验证都回 HTTP 400：请求带了 GPT 图片型号不接受的 response_format。
test("GPT 图片型号不发送 response_format；400 时只保留出错的参数名", async () => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const api = mock.get("https://api.openai.com");
  const bodies: Array<Record<string, unknown>> = [];
  const capture = (body: string) => { bodies.push(JSON.parse(body)); return true; };
  const png = { data: [{ b64_json: Buffer.from("png").toString("base64") }] };
  api.intercept({ path: "/v1/images/generations", method: "POST", body: capture }).reply(200, png, { headers: { "content-type": "application/json" } });
  const c = connection(mock);
  await openAIImage(c, "gpt-image-2.5-sunburst", "blue dot", { size: "1024x1024", quality: "low" });
  assert.equal("response_format" in bodies[0]!, false, JSON.stringify(bodies[0]));
  assert.deepEqual({ model: bodies[0]!.model, size: bodies[0]!.size, quality: bodies[0]!.quality, n: bodies[0]!.n }, { model: "gpt-image-2.5-sunburst", size: "1024x1024", quality: "low", n: 1 });

  api.intercept({ path: "/v1/images/generations", method: "POST" }).reply(400, {
    error: { message: "Unknown parameter: 'response_format'. echoed sk-leaked-secret", type: "invalid_request_error", param: "response_format", code: "unknown_parameter" },
  }, { headers: { "content-type": "application/json", "x-request-id": "req_param" } });
  await assert.rejects(() => openAIImage(c, "gpt-image-2.5-flare", "blue dot"), (error: unknown) => {
    assert.ok(error instanceof CompanionModelHttpError);
    assert.equal(error.status, 400);
    assert.equal(error.providerParam, "response_format");
    assert.equal(companionModelFailureDiagnostic(error)?.providerParam, "response_format");
    assert.doesNotMatch(`${error.message}${JSON.stringify(companionModelFailureDiagnostic(error))}`, /sk-leaked|Unknown parameter/, "服务商原文不保留");
    return true;
  });
  api.intercept({ path: "/v1/images/generations", method: "POST" }).reply(400, { error: { message: "bad", param: "prompt with spaces; injected" } }, { headers: { "content-type": "application/json" } });
  await assert.rejects(() => openAIImage(c, "gpt-image-2.5-flare", "blue dot"), (error: unknown) => {
    assert.ok(error instanceof CompanionModelHttpError);
    assert.equal(error.providerParam, undefined, "不是简短标识符的 param 一律丢弃");
    return true;
  });
});

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

// 只配智谱的用户原来用不了语音输入：请求层写死了 OpenAI 地址。智谱官方端点只放行语音识别这一条路径。
test("智谱官方端点：语音识别走 /api/paas/v4/audio/transcriptions 并带 Bearer；其他能力和兼容网关照旧拒绝", async () => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const zhipu: CompanionModelConnection = { provider: "zhipu", protocol: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4/", model: "glm-5.3", apiKey: "zp-secret", transportDispatcher: mock };
  let auth = "";
  mock.get("https://open.bigmodel.cn").intercept({ path: "/api/paas/v4/audio/transcriptions", method: "POST" })
    .reply(200, (opts) => { auth = String((opts.headers as Record<string, string>)?.authorization ?? (opts.headers as Record<string, string>)?.Authorization ?? ""); return { text: "明天下午三点提醒我" }; }, { headers: { "content-type": "application/json" } });
  assert.equal(await openAITranscribe(zhipu, "glm-asr-2512", speechProbeWav(), "audio/wav"), "明天下午三点提醒我");
  assert.equal(auth, "Bearer zp-secret");
  await assert.rejects(() => openAISpeech(zhipu, "glm-tts", "你好"), /已接入的官方端点/);
  await assert.rejects(() => openAITranscribe({ ...zhipu, baseUrl: "https://proxy.example.com/v4" }, "glm-asr-2512", speechProbeWav(), "audio/wav"), /已接入的官方端点/);
  assert.equal(mock.pendingInterceptors().length, 0);
  await mock.close();
});

test("验证探针音频有真实采样；识别为空时默认报错，验证用 allowEmpty 算通过；响应没有 text 字段算格式无效", async () => {
  const wav = speechProbeWav();
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.ok(wav.readUInt32LE(40) > 16_000, "至少半秒采样，不是只有文件头");
  assert.ok(wav.subarray(44).some((byte) => byte !== 0), "不是静音");
  const mock = new MockAgent();
  mock.disableNetConnect();
  const api = mock.get("https://api.openai.com");
  api.intercept({ path: "/v1/audio/transcriptions", method: "POST" }).reply(200, { text: "" }, { headers: { "content-type": "application/json" } });
  api.intercept({ path: "/v1/audio/transcriptions", method: "POST" }).reply(200, { text: "  " }, { headers: { "content-type": "application/json" } });
  api.intercept({ path: "/v1/audio/transcriptions", method: "POST" }).reply(200, { result: "x" }, { headers: { "content-type": "application/json" } });
  await assert.rejects(() => openAITranscribe(connection(mock), "gpt-transcribe", wav, "audio/wav"), /没有识别出文字/);
  assert.equal(await openAITranscribe(connection(mock), "gpt-transcribe", wav, "audio/wav", undefined, { allowEmpty: true }), "");
  await assert.rejects(() => openAITranscribe(connection(mock), "gpt-transcribe", wav, "audio/wav", undefined, { allowEmpty: true }), /响应格式无效/);
  await mock.close();
});

// 真实调用：Windows 语音合成写出的 WAV 格式块是 18 字节，智谱直接回 400；改成标准 16 字节头后同一段音频识别正确。
// ffmpeg 转出来的 WAV 还常带 LIST 元数据块。发给服务商前统一规整成"fmt 16 字节 + data"。
test("PCM WAV 规整成标准头：扩展格式块和 LIST 块去掉，音频数据不变；不是 PCM 或结构坏的原样返回", () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  const chunk = (id: string, body: Buffer) => { const head = Buffer.alloc(8); head.write(id, 0, "ascii"); head.writeUInt32LE(body.length, 4); return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const fmt18 = Buffer.alloc(18); fmt18.writeUInt16LE(1, 0); fmt18.writeUInt16LE(1, 2); fmt18.writeUInt32LE(16000, 4); fmt18.writeUInt32LE(32000, 8); fmt18.writeUInt16LE(2, 12); fmt18.writeUInt16LE(16, 14);
  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), chunk("fmt ", fmt18), chunk("LIST", Buffer.from("INFOISFT", "ascii")), chunk("data", pcm)]);
  const riff = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), body]); riff.writeUInt32LE(body.length, 4);
  const normalized = normalizePcmWav(riff);
  assert.equal(normalized.length, 44 + pcm.length);
  assert.equal(normalized.readUInt32LE(16), 16, "格式块 16 字节");
  assert.equal(normalized.toString("ascii", 36, 40), "data");
  assert.deepEqual(normalized.subarray(44), pcm);
  assert.equal(normalized.readUInt32LE(24), 16000);
  const probe = speechProbeWav();
  assert.deepEqual(normalizePcmWav(probe), probe, "已经是标准头的不变");
  const float = Buffer.from(riff); float.writeUInt16LE(3, 20);
  assert.deepEqual(normalizePcmWav(float), float, "不是 PCM 不动");
  assert.deepEqual(normalizePcmWav(Buffer.from("RIFF....WAVE")), Buffer.from("RIFF....WAVE"), "结构坏的不动");
});
