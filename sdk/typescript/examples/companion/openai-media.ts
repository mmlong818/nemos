import { fetch as undiciFetch, FormData } from "undici";
import type { CompanionModelConnection } from "./model-connection.js";
import { CompanionModelHttpError, safeProviderRequestId } from "./model-connection.js";

export type OpenAIMediaCapability = "vision" | "speech_to_text" | "text_to_speech" | "image_generation";
const OFFICIAL = "https://api.openai.com/v1";
const AUDIO_TYPES = new Map([["audio/webm", "webm"], ["audio/wav", "wav"], ["audio/mpeg", "mp3"], ["audio/mp4", "m4a"], ["audio/ogg", "ogg"]]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function assertOfficial(connection: CompanionModelConnection): void {
  if (connection.provider !== "openai" || connection.baseUrl.replace(/\/+$/, "") !== OFFICIAL) throw new Error("此能力仅对 OpenAI 官方端点开放；兼容服务需要分别验证适配器。");
}
async function request(connection: CompanionModelConnection, path: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  assertOfficial(connection);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await undiciFetch(`${OFFICIAL}${path}`, {
      ...init, signal: controller.signal, dispatcher: connection.transportDispatcher,
      headers: { Authorization: `Bearer ${connection.apiKey}`, ...(init.headers || {}) },
    });
    if (!response.ok) throw new CompanionModelHttpError(response.status, "OpenAI 能力请求", safeProviderRequestId(response.headers));
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

export async function openAITranscribe(connection: CompanionModelConnection, model: string, audio: Buffer, mime: string, language?: string): Promise<string> {
  const type = String(mime).split(";")[0]!.toLowerCase();
  const ext = AUDIO_TYPES.get(type);
  if (!ext || !audio.length || audio.length > 12 * 1024 * 1024 || !validAudioSignature(audio, type)) throw new Error("音频格式不支持、文件签名无效、为空或超过 12MB 限制。");
  const form = new FormData();
  form.set("model", model);
  form.set("file", new Blob([new Uint8Array(audio)], { type }), `audio.${ext}`);
  if (language && language !== "auto" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) form.set("language", language);
  const response = await request(connection, "/audio/transcriptions", { method: "POST", body: form as never }, 60_000);
  const json = await response.json() as { text?: string };
  const text = String(json.text || "").trim();
  if (!text) throw new Error("OpenAI 语音识别响应格式无效。");
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
    quality: ["low", "medium", "high"].includes(String(options.quality)) ? options.quality : "medium", response_format: "b64_json", n: 1,
  }) }, 120_000);
  const json = await response.json() as { data?: Array<{ b64_json?: string }> };
  const encoded = String(json.data?.[0]?.b64_json || "");
  if (!encoded || encoded.length > 28 * 1024 * 1024) throw new Error("OpenAI 图片响应为空或超过安全限制。");
  const data = Buffer.from(encoded, "base64");
  if (!data.length || data.length > 20 * 1024 * 1024) throw new Error("OpenAI 图片响应无效或过大。");
  return { data, mime: "image/png" };
}
