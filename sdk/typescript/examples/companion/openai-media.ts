import { fetch as undiciFetch, FormData } from "undici";
import type { CompanionModelConnection } from "./model-connection.js";
import { CompanionModelHttpError, safeOpenAIErrorParam, safeProviderRequestId } from "./model-connection.js";

export type OpenAIMediaCapability = "vision" | "speech_to_text" | "text_to_speech" | "image_generation";
const OFFICIAL = "https://api.openai.com/v1";
const AUDIO_TYPES = new Map([["audio/webm", "webm"], ["audio/wav", "wav"], ["audio/mpeg", "mp3"], ["audio/mp4", "m4a"], ["audio/ogg", "ogg"]]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** 智谱官方端点：只接了语音识别，接口与 OpenAI 的 /audio/transcriptions 同形。 */
export const ZHIPU_OFFICIAL = "https://open.bigmodel.cn/api/paas/v4";
/** 每个官方端点放行哪些路径：兼容网关与未验证的能力一律不放行。 */
const OFFICIAL_MEDIA_PATHS: ReadonlyArray<{ provider: string; base: string; paths: readonly string[] }> = [
  { provider: "openai", base: OFFICIAL, paths: ["/responses", "/audio/transcriptions", "/audio/speech", "/images/generations"] },
  { provider: "zhipu", base: ZHIPU_OFFICIAL, paths: ["/audio/transcriptions"] },
];

function officialBase(connection: CompanionModelConnection, path: string): string {
  const base = connection.baseUrl.replace(/\/+$/, "");
  const entry = OFFICIAL_MEDIA_PATHS.find((item) => item.provider === connection.provider && item.base === base);
  if (!entry || !entry.paths.includes(path)) throw new Error("此能力仅对已接入的官方端点开放；兼容服务需要分别验证适配器。");
  return entry.base;
}
async function request(connection: CompanionModelConnection, path: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const base = officialBase(connection, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await undiciFetch(`${base}${path}`, {
      ...init, signal: controller.signal, dispatcher: connection.transportDispatcher,
      headers: { Authorization: `Bearer ${connection.apiKey}`, ...(init.headers || {}) },
    });
    if (!response.ok) {
      const param = connection.provider === "openai" && response.status === 400 ? await safeOpenAIErrorParam(response as unknown as Response) : undefined;
      throw new CompanionModelHttpError(response.status, connection.provider === "zhipu" ? "智谱能力请求" : "OpenAI 能力请求", safeProviderRequestId(response.headers), undefined, param);
    }
    return response as unknown as Response;
  } finally { clearTimeout(timer); }
}

export function validateImageDataUrl(value: string, maxBytes = 10 * 1024 * 1024): { mime: string; dataUrl: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ""));
  if (!match || !IMAGE_TYPES.has(match[1]!.toLowerCase())) throw new Error("仅支持 PNG、JPEG、WebP 或 GIF 图片；ICNS、JXL、HEIF 不处理。");
  if (match[2]!.length % 4 !== 0 || /=/.test(match[2]!.slice(0, -2))) throw new Error("图片 Base64 编码无效。");
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > maxBytes) throw new Error("图片为空或超过 10MB 限制。");
  const mime = match[1]!.toLowerCase();
  const detected = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
    : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp"
    : bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) ? "image/gif" : "";
  if (!detected || detected !== mime) throw new Error("图片内容与声明的 MIME 类型不一致或文件已截断。");
  return { mime, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

function validAudioSignature(data: Buffer, mime: string): boolean {
  if (mime === "audio/wav") return data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE";
  if (mime === "audio/webm") return data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime === "audio/mpeg") return data.length >= 3 && (data.toString("ascii", 0, 3) === "ID3" || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0));
  if (mime === "audio/mp4") return data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp";
  if (mime === "audio/ogg") return data.length >= 4 && data.toString("ascii", 0, 4) === "OggS";
  return false;
}

export async function openAIVision(connection: CompanionModelConnection, model: string, prompt: string, image: string): Promise<string> {
  const safe = validateImageDataUrl(image);
  const response = await request(connection, "/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    model, max_output_tokens: 180, input: [{ role: "user", content: [{ type: "input_text", text: prompt || "请简要描述这张图片。" }, { type: "input_image", image_url: safe.dataUrl }] }],
  }) });
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const text = String(json.output_text || json.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text || "").trim();
  if (!text) throw new Error("OpenAI 视觉响应格式无效。");
  return text;
}

/**
 * 连接验证用的合成音频：16kHz 单声道 16 位、0.6 秒低音量正弦波。
 * 原来用的是只有文件头、没有一个采样点的 WAV，服务商会当成空音频直接拒绝，验证永远过不了。
 */
export function speechProbeWav(): Buffer {
  const rate = 16_000, samples = Math.round(rate * 0.6);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii"); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * PCM WAV 规整成标准 44 字节头（fmt 16 字节 + data）。
 * 真实调用：Windows 语音合成的 WAV 格式块是 18 字节，智谱直接回 400；ffmpeg 转出的 WAV 还带 LIST 元数据块。
 * 不是 PCM、或块结构读不通的原样返回，交给服务商自己判断。
 */
export function normalizePcmWav(audio: Buffer): Buffer {
  if (audio.length < 12 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return audio;
  let fmt: Buffer | undefined, data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString("ascii", offset, offset + 4), size = audio.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > audio.length) { if (id === "data") data = audio.subarray(offset + 8); break; }
    if (id === "fmt ") fmt = audio.subarray(offset + 8, end);
    else if (id === "data") data = audio.subarray(offset + 8, end);
    offset = end + (size % 2);
  }
  if (!fmt || fmt.length < 16 || !data || fmt.readUInt16LE(0) !== 1) return audio;
  if (audio.length === 44 + data.length && audio.readUInt32LE(16) === 16) return audio;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); fmt.copy(header, 20, 0, 16);
  header.write("data", 36, "ascii"); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * 语音识别：OpenAI 与智谱官方端点同一接口形状（multipart 的 model + file，返回 { text }）。
 * allowEmpty 只给连接验证用：验证用的是极短的合成音频，识别不出字不代表接口不通。
 */
export async function openAITranscribe(connection: CompanionModelConnection, model: string, audio: Buffer, mime: string, language?: string, options: { allowEmpty?: boolean } = {}): Promise<string> {
  const type = String(mime).split(";")[0]!.toLowerCase();
  const ext = AUDIO_TYPES.get(type);
  if (!ext || !audio.length || audio.length > 12 * 1024 * 1024 || !validAudioSignature(audio, type)) throw new Error("音频格式不支持、文件签名无效、为空或超过 12MB 限制。");
  const form = new FormData();
  form.set("model", model);
  const payload = type === "audio/wav" ? normalizePcmWav(audio) : audio;
  form.set("file", new Blob([new Uint8Array(payload)], { type }), `audio.${ext}`);
  if (language && language !== "auto" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) form.set("language", language);
  const response = await request(connection, "/audio/transcriptions", { method: "POST", body: form as never }, 60_000);
  const json = await response.json() as { text?: unknown };
  if (typeof json.text !== "string") throw new Error("语音识别响应格式无效。");
  const text = json.text.trim();
  if (!text && !options.allowEmpty) throw new Error("没有识别出文字。");
  return text;
}

export async function openAISpeech(connection: CompanionModelConnection, model: string, text: string, options: { voice?: string; format?: string; speed?: number } = {}): Promise<{ data: Buffer; contentType: string }> {
  const input = String(text || "").trim();
  if (!input || input.length > 4_000) throw new Error("朗读文字需为 1–4000 个字符。");
  const format = ["mp3", "wav", "opus", "aac", "flac"].includes(String(options.format)) ? String(options.format) : "mp3";
  const voice = /^[A-Za-z0-9_-]{1,40}$/.test(String(options.voice || "")) ? String(options.voice) : "alloy";
  const speed = Math.max(0.25, Math.min(4, Number(options.speed) || 1));
  const response = await request(connection, "/audio/speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input, voice, response_format: format, speed }) }, 60_000);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("audio/")) throw new Error("OpenAI 朗读响应不是音频。");
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > 20 * 1024 * 1024) throw new Error("朗读音频为空或超过 20MB 限制。");
  return { data, contentType };
}

export async function openAIImage(connection: CompanionModelConnection, model: string, prompt: string, options: { size?: string; quality?: string } = {}): Promise<{ data: Buffer; mime: "image/png" }> {
  const text = String(prompt || "").trim();
  if (!text || text.length > 4_000) throw new Error("图片描述需为 1–4000 个字符。");
  const response = await request(connection, "/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    model, prompt: text, size: ["1024x1024", "1536x1024", "1024x1536"].includes(String(options.size)) ? options.size : "1024x1024",
    quality: ["low", "medium", "high"].includes(String(options.quality)) ? options.quality : "medium", n: 1,
    // GPT 图片型号总是返回 base64，不接受 response_format（传了会 HTTP 400）。
  }) }, 120_000);
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const encoded = String(json.data?.[0]?.b64_json || "");
  if (!encoded || encoded.length > 28 * 1024 * 1024) throw new Error("OpenAI 图片响应为空或超过安全限制。");
  const data = Buffer.from(encoded, "base64");
  if (!data.length || data.length > 20 * 1024 * 1024) throw new Error("OpenAI 图片响应无效或过大。");
  return { data, mime: "image/png" };
}
