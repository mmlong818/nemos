/**
 * 音视频感知管道：模型不看视频，本机先把视频"看"成结构化文字。
 *
 * ffprobe 读时长与流信息，ffmpeg 按时间点抽关键帧（前 3 秒密、其后稀），音轨转成 16k 单声道 WAV；
 * 有视觉模型就逐帧描述，有语音识别就转写，没有就明确写「未接入」，绝不编造画面或台词。
 * 产出是一份文字报告，作为附件走既有的对话与任务交接链路（回执、统计、契约都照常生效）。
 *
 * 这里只依赖本机已安装的 ffmpeg / ffprobe（环境变量 NEMOS_FFMPEG_PATH / NEMOS_FFPROBE_PATH 可指定），
 * 不下载任何东西，不访问网络。
 */
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter as pathDelimiter, extname, join } from "node:path";

export const MEDIA_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "mp3", "m4a", "wav", "aac", "ogg", "flac"]);
export const AUDIO_ONLY_EXTENSIONS = new Set(["mp3", "m4a", "wav", "aac", "ogg", "flac"]);
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

export interface MediaProbe {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  container?: string;
}

export interface FrameNote {
  atSec: number;
  description?: string;
  onScreenText?: string;
}

export interface MediaBreakdown {
  name: string;
  probe: MediaProbe;
  frames: FrameNote[];
  transcript?: string;
  degraded: string[];
}

export interface MediaBreakdownTools {
  /** 有视觉模型时传入：输入 PNG data URL，返回一句话画面描述与屏幕文字。 */
  describeFrame?: (dataUrl: string, atSec: number) => Promise<string>;
  /** 有语音识别时传入：输入 WAV 音频，返回转写。 */
  transcribe?: (wav: Buffer) => Promise<string>;
}

export function findExecutable(name: "ffmpeg" | "ffprobe"): string | null {
  const override = process.env[name === "ffmpeg" ? "NEMOS_FFMPEG_PATH" : "NEMOS_FFPROBE_PATH"];
  if (override && existsSync(override)) return override;
  const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
  for (const dir of (process.env.PATH || "").split(pathDelimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, name + suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function mediaToolsAvailable(): { ffmpeg: string | null; ffprobe: string | null } {
  return { ffmpeg: findExecutable("ffmpeg"), ffprobe: findExecutable("ffprobe") };
}

/** 抽帧时间点：钩子在前 3 秒，密集采样；其后按时长均匀分布；不超过 count 个，不超出片长。 */
export function keyFrameTimestamps(durationSec: number, count = 10): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];
  const points = new Set<number>();
  for (const early of [0, 1, 2, 3]) if (early < durationSec) points.add(early);
  const remaining = Math.max(0, count - points.size);
  if (remaining > 0 && durationSec > 3.5) {
    const start = 3.5;
    const end = Math.max(start, durationSec - 0.5);
    for (let i = 0; i < remaining; i += 1) {
      const t = start + ((end - start) * (i + 1)) / (remaining + 1);
      points.add(Math.round(t * 10) / 10);
    }
  }
  return [...points].filter((t) => t < durationSec).sort((a, b) => a - b).slice(0, count);
}

export function parseProbeOutput(json: string): MediaProbe {
  const data = JSON.parse(json) as { format?: { duration?: string; format_name?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }> };
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    ...(video?.width ? { width: video.width } : {}),
    ...(video?.height ? { height: video.height } : {}),
    ...(data.format?.format_name ? { container: data.format.format_name } : {}),
  };
}

export function probeMedia(file: string): MediaProbe {
  const ffprobe = findExecutable("ffprobe");
  if (!ffprobe) throw new Error("本机没有找到 ffprobe；请安装 FFmpeg 或设置 NEMOS_FFPROBE_PATH。");
  const result = spawnSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffprobe 无法读取这个文件：${(result.stderr || "").trim().slice(0, 200) || "未知错误"}`);
  return parseProbeOutput(result.stdout);
}

function run(binary: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("ffmpeg 处理超时")); }, timeoutMs);
    const abort = () => { child.kill(); reject(new Error("已取消")); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (code === 0) resolve(); else reject(new Error(`ffmpeg 退出码 ${code}：${stderr.trim().slice(0, 200)}`));
    });
  });
}

export async function extractFrame(file: string, atSec: number, outFile: string, signal?: AbortSignal): Promise<void> {
  const ffmpeg = findExecutable("ffmpeg");
  if (!ffmpeg) throw new Error("本机没有找到 ffmpeg；请安装 FFmpeg 或设置 NEMOS_FFMPEG_PATH。");
  await run(ffmpeg, ["-v", "error", "-y", "-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", outFile], 60_000, signal);
}

export async function extractAudioWav(file: string, outFile: string, signal?: AbortSignal): Promise<void> {
  const ffmpeg = findExecutable("ffmpeg");
  if (!ffmpeg) throw new Error("本机没有找到 ffmpeg；请安装 FFmpeg 或设置 NEMOS_FFMPEG_PATH。");
  await run(ffmpeg, ["-v", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-t", "600", outFile], 120_000, signal);
}

export function isMediaFileName(name: string): boolean {
  return MEDIA_EXTENSIONS.has(extname(name).slice(1).toLowerCase());
}

/**
 * 端到端：探测 → 抽帧（可选描述）→ 抽音（可选转写）→ 结构化结果。
 * 每一步失败都记进 degraded 而不是中断整体；文件与临时帧在函数返回前删除。
 */
export async function buildMediaBreakdown(file: string, displayName: string, tools: MediaBreakdownTools = {}, options: { frameCount?: number; signal?: AbortSignal } = {}): Promise<MediaBreakdown> {
  const degraded: string[] = [];
  const probe = probeMedia(file);
  const frames: FrameNote[] = [];
  let transcript: string | undefined;
  const work = mkdtempSync(join(tmpdir(), "clownfish-media-"));
  try {
    if (probe.hasVideo) {
      const timestamps = keyFrameTimestamps(probe.durationSec, options.frameCount ?? 10);
      for (const atSec of timestamps) {
        const out = join(work, `frame-${String(Math.round(atSec * 10)).padStart(5, "0")}.png`);
        try {
          await extractFrame(file, atSec, out, options.signal);
          const note: FrameNote = { atSec };
          if (tools.describeFrame && existsSync(out)) {
            try {
              const dataUrl = `data:image/png;base64,${readFileSync(out).toString("base64")}`;
              note.description = (await tools.describeFrame(dataUrl, atSec)).trim().slice(0, 600);
            } catch (error) {
              degraded.push(`第 ${atSec}s 帧描述失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }
          frames.push(note);
        } catch (error) {
          degraded.push(`第 ${atSec}s 抽帧失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!tools.describeFrame) degraded.push("视觉模型未接入：只记录了帧的时间点，没有画面描述。");
    } else {
      degraded.push("文件没有视频流，跳过抽帧。");
    }
    if (probe.hasAudio) {
      if (tools.transcribe) {
        const wav = join(work, "audio.wav");
        try {
          await extractAudioWav(file, wav, options.signal);
          transcript = (await tools.transcribe(readFileSync(wav))).trim().slice(0, 20_000);
        } catch (error) {
          degraded.push(`转写失败：${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        degraded.push("语音识别未接入：没有转写文字。");
      }
    } else {
      degraded.push("文件没有音轨，跳过转写。");
    }
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结果 */ }
  }
  return { name: basename(displayName), probe, frames, ...(transcript ? { transcript } : {}), degraded };
}

const seconds = (value: number): string => {
  const total = Math.floor(value);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** 与文中管道同形的报告：VIDEO / DURATION / FRAMES / TRANSCRIPT，缺什么写什么，不留空白让模型脑补。 */
export function renderMediaBreakdown(breakdown: MediaBreakdown): string {
  const lines = [
    `媒体拆解：${breakdown.name}`,
    `时长：${seconds(breakdown.probe.durationSec)}（${breakdown.probe.durationSec}s）` + (breakdown.probe.width ? ` · ${breakdown.probe.width}×${breakdown.probe.height}` : "") + (breakdown.probe.container ? ` · ${breakdown.probe.container}` : ""),
    `关键帧：${breakdown.frames.length} 个（前 3 秒密集采样，其后均匀分布）`,
  ];
  for (const frame of breakdown.frames) {
    lines.push(`- ${seconds(frame.atSec)}${frame.atSec % 1 ? `.${Math.round((frame.atSec % 1) * 10)}` : ""}：${frame.description || "（无画面描述）"}`);
  }
  lines.push(`转写：${breakdown.transcript ? `\n${breakdown.transcript}` : "（无）"}`);
  if (breakdown.degraded.length) {
    lines.push("本机处理说明：");
    for (const item of breakdown.degraded) lines.push(`- ${item}`);
  }
  lines.push("以上由本机 ffmpeg 抽取；没有描述或转写的部分不要推测画面或台词内容。");
  return lines.join("\n");
}

export function assertMediaUpload(name: string, size: number): void {
  if (!isMediaFileName(name)) throw new Error("只支持常见视频（mp4、mov、webm、mkv、avi）和音频（mp3、m4a、wav、aac、ogg、flac）文件。");
  if (!size || size > MAX_MEDIA_BYTES) throw new Error("音视频文件不能超过 200 MB。");
}
