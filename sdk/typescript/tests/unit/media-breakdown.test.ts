import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMediaUpload, buildMediaBreakdown, isMediaFileName, keyFrameTimestamps, mediaToolsAvailable, parseProbeOutput, renderMediaBreakdown } from "../../examples/companion/media-breakdown.js";

test("key frames are dense in the hook window and spread afterwards, never past the end", () => {
  assert.deepEqual(keyFrameTimestamps(2.5, 10), [0, 1, 2]);
  const long = keyFrameTimestamps(55, 10);
  assert.deepEqual(long.slice(0, 4), [0, 1, 2, 3]);
  assert.equal(long.length, 10);
  assert.ok(long.every((t, i) => i === 0 || t > long[i - 1]!), "strictly increasing");
  assert.ok(long[long.length - 1]! < 55);
  assert.deepEqual(keyFrameTimestamps(0), [0]);
});

test("ffprobe JSON becomes a compact probe with duration, streams and dimensions", () => {
  const probe = parseProbeOutput(JSON.stringify({ format: { duration: "55.04", format_name: "mov,mp4" }, streams: [{ codec_type: "video", width: 1080, height: 1920 }, { codec_type: "audio" }] }));
  assert.deepEqual(probe, { durationSec: 55.04, hasVideo: true, hasAudio: true, width: 1080, height: 1920, container: "mov,mp4" });
  assert.equal(parseProbeOutput(JSON.stringify({ streams: [{ codec_type: "audio", duration: "12" }] })).hasVideo, false);
});

test("the report says what was not done instead of leaving gaps for the model to fill", () => {
  const report = renderMediaBreakdown({ name: "clip.mp4", probe: { durationSec: 12, hasVideo: true, hasAudio: true, width: 720, height: 1280 }, frames: [{ atSec: 0, description: "创作者面对镜头，屏幕文字：3 things" }, { atSec: 3 }], degraded: ["语音识别未接入：没有转写文字。"] });
  assert.match(report, /^媒体拆解：clip\.mp4\n时长：00:12（12s） · 720×1280/);
  assert.match(report, /- 00:00：创作者面对镜头/);
  assert.match(report, /- 00:03：（无画面描述）/);
  assert.match(report, /转写：（无）/);
  assert.match(report, /语音识别未接入/);
  assert.match(report, /不要推测画面或台词内容/);
  assert.equal(isMediaFileName("a.MP4"), true);
  assert.equal(isMediaFileName("a.docx"), false);
  assert.throws(() => assertMediaUpload("a.txt", 10), /只支持/);
  assert.throws(() => assertMediaUpload("a.mp4", 0), /200 MB/);
});

const tools = mediaToolsAvailable();
const FFMPEG_ONLY = tools.ffmpeg && tools.ffprobe ? false : "本机没有 ffmpeg/ffprobe，跳过真实抽帧测试";

test("a real clip is probed, framed and transcribed through the injected tools; missing tools degrade explicitly", { skip: FFMPEG_ONLY, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-media-test-"));
  const clip = join(dir, "clip.mp4");
  try {
    const made = spawnSync(tools.ffmpeg!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    assert.equal(made.status, 0, made.stderr);

    const bare = await buildMediaBreakdown(clip, "clip.mp4", {}, { frameCount: 6 });
    assert.ok(Math.abs(bare.probe.durationSec - 6) < 0.6, `duration ${bare.probe.durationSec}`);
    assert.equal(bare.probe.hasVideo, true);
    assert.equal(bare.probe.hasAudio, true);
    assert.equal(bare.frames.length, 6);
    assert.deepEqual(bare.frames.slice(0, 4).map((frame) => frame.atSec), [0, 1, 2, 3]);
    assert.ok(bare.frames.every((frame) => !frame.description));
    assert.equal(bare.transcript, undefined);
    assert.ok(bare.degraded.some((item) => item.includes("视觉模型未接入")));
    assert.ok(bare.degraded.some((item) => item.includes("语音识别未接入")));

    const seen: number[] = [];
    let wavBytes = 0;
    const full = await buildMediaBreakdown(clip, "clip.mp4", {
      describeFrame: async (dataUrl, atSec) => { assert.match(dataUrl, /^data:image\/png;base64,iVBOR/); seen.push(atSec); return `第 ${atSec} 秒：测试图卡`; },
      transcribe: async (wav) => { wavBytes = wav.byteLength; assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF"); return "合成转写"; },
    }, { frameCount: 5 });
    assert.equal(seen.length, 5);
    assert.equal(full.frames[0]!.description, "第 0 秒：测试图卡");
    assert.equal(full.transcript, "合成转写");
    assert.ok(wavBytes > 16_000 * 2 * 4, "16k mono 16-bit audio for ~6 seconds");
    assert.equal(full.degraded.length, 0);
    assert.match(renderMediaBreakdown(full), /关键帧：5 个[\s\S]*转写：\n合成转写/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
