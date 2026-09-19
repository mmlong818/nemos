import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

test("TTS preview cleans up exactly once when play rejects and can play again", async () => {
  const script = readFileSync(resolve(__dirname, "../../examples/companion/web/assets/tts-preview-player.js"), "utf8");
  const revoked: string[] = [];
  let sequence = 0;
  class FakeAudio {
    onended: null | (() => void) = null;
    onerror: null | (() => void) = null;
    paused = 0;
    removed = 0;
    loaded = 0;
    constructor(readonly src: string) {}
    pause() { this.paused += 1; }
    removeAttribute(name: string) { if (name === "src") this.removed += 1; }
    load() { this.loaded += 1; }
    async play() { if (this.src === "blob:1") throw new Error("autoplay blocked"); }
  }
  const context: any = { window: {}, globalThis: {}, Error };
  runInNewContext(script, context);
  const player = context.window.ClownfishTtsPreviewPlayer.create({ AudioCtor: FakeAudio, URLApi: { createObjectURL: () => `blob:${++sequence}`, revokeObjectURL: (url: string) => revoked.push(url) } });
  const button = { disabled: false }; const status = { textContent: "" };
  button.disabled = true;
  try { await player.play({}); status.textContent = "正在播放。"; }
  catch (error: any) { player.stop(); button.disabled = false; status.textContent = error.message; }
  assert.deepEqual(revoked, ["blob:1"]);
  assert.equal(player.active(), false);
  assert.equal(button.disabled, false);
  assert.equal(status.textContent, "autoplay blocked");
  await player.play({});
  assert.equal(player.active(), true, "a later play is not poisoned by the rejected attempt");
  player.stop(); player.stop();
  assert.deepEqual(revoked, ["blob:1", "blob:2"], "cleanup remains idempotent");
  assert.equal(player.active(), false);
});

test("media workbench wires TTS and image buttons to their real API paths", async () => {
  const script = readFileSync(resolve(__dirname, "../../examples/companion/web/assets/tts-preview-player.js"), "utf8");
  const context: any = { window: {}, globalThis: {}, Error };
  runInNewContext(script, context);
  const elements: any = {
    "[data-tts-status]": { textContent: "" }, "[data-tts-stop]": { disabled: true }, "[data-tts-preview-text]": { value: "测试朗读" },
    "[data-image-status]": { textContent: "" }, "[data-image-result]": { innerHTML: "" }, "[data-image-prompt]": { value: "蓝色圆点" },
  };
  const calls: string[] = [];
  const player = { stop() {}, async play() { throw new Error("autoplay blocked"); } };
  const workbench = context.window.ClownfishTtsPreviewPlayer.createWorkbench({
    player, query: (selector: string) => elements[selector], escapeHtml: (value: string) => value,
    fetchFn: async (path: string) => { calls.push(path); return { ok: true, blob: async () => ({}) }; },
    api: async (path: string) => { calls.push(path); return { artifact: { previewUrl: "/preview", downloadUrl: "/download", title: "结果" } }; },
  });
  const target = (selector: string) => ({ disabled: false, closest: (wanted: string) => wanted === selector ? targetObject : null });
  let targetObject: any = target("[data-tts-preview]");
  assert.equal(await workbench.handleClick(targetObject), true);
  assert.equal(targetObject.disabled, false); assert.equal(elements["[data-tts-stop]"].disabled, true); assert.equal(elements["[data-tts-status]"].textContent, "autoplay blocked");
  targetObject = target("[data-image-generate]");
  assert.equal(await workbench.handleClick(targetObject), true);
  assert.deepEqual(calls, ["/api/tts", "/api/image-generation"]);
  assert.equal(targetObject.disabled, false); assert.equal(elements["[data-image-status]"].textContent, "图片已保存到成果。");
  assert.match(elements["[data-image-result]"].innerHTML, /\/preview.*\/download.*查看成果/);
});
