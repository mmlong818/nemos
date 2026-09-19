(function (root) {
  "use strict";
  function create(options = {}) {
    const AudioCtor = options.AudioCtor || root.Audio;
    const URLApi = options.URLApi || root.URL;
    let audio = null;
    let objectUrl = "";
    function cleanup() {
      const currentAudio = audio;
      const currentUrl = objectUrl;
      audio = null;
      objectUrl = "";
      if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.onerror = null;
        try { currentAudio.pause(); } catch { /* already stopped */ }
        try { currentAudio.removeAttribute?.("src"); currentAudio.load?.(); } catch { /* detached audio */ }
      }
      if (currentUrl) URLApi.revokeObjectURL(currentUrl);
    }
    async function play(blob, handlers = {}) {
      cleanup();
      objectUrl = URLApi.createObjectURL(blob);
      audio = new AudioCtor(objectUrl);
      const current = audio;
      current.onended = () => { cleanup(); handlers.onEnded?.(); };
      current.onerror = () => { cleanup(); handlers.onError?.(new Error("音频播放失败。")); };
      try { await current.play(); }
      catch (error) { cleanup(); throw error; }
    }
    return { play, stop: cleanup, active: () => Boolean(audio || objectUrl) };
  }
  function createWorkbench(options) {
    const player = options.player;
    const query = options.query;
    async function handleClick(target) {
      const stopButton = target.closest?.("[data-tts-stop]");
      if (stopButton) { player.stop(); stopButton.disabled = true; const status = query("[data-tts-status]"); if (status) status.textContent = "已停止。"; return true; }
      const playButton = target.closest?.("[data-tts-preview]");
      if (playButton) {
        const status = query("[data-tts-status]"); const stop = query("[data-tts-stop]"); playButton.disabled = true; if (status) status.textContent = "正在生成朗读音频…";
        try {
          player.stop();
          const response = await options.fetchFn("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: query("[data-tts-preview-text]")?.value || "", voice: "alloy", format: "mp3", speed: 1 }) });
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "朗读失败");
          await player.play(await response.blob(), { onEnded: () => { if (stop) stop.disabled = true; if (status) status.textContent = "播放完成。"; }, onError: (error) => { if (stop) stop.disabled = true; if (status) status.textContent = error.message; } });
          if (stop) stop.disabled = false; if (status) status.textContent = "正在播放。";
        } catch (error) { player.stop(); if (stop) stop.disabled = true; if (status) status.textContent = error.message; }
        finally { playButton.disabled = false; }
        return true;
      }
      const generate = target.closest?.("[data-image-generate]");
      if (generate) {
        const status = query("[data-image-status]"); const result = query("[data-image-result]"); generate.disabled = true; if (status) status.textContent = "正在生成并保存图片…";
        try {
          const response = await options.api("/api/image-generation", { method: "POST", body: JSON.stringify({ prompt: query("[data-image-prompt]")?.value || "", size: "1024x1024", quality: "medium" }) });
          if (result) result.innerHTML = `<img src="${options.escapeHtml(response.artifact.previewUrl)}" alt="${options.escapeHtml(response.artifact.title)}" loading="lazy"><a href="${options.escapeHtml(response.artifact.downloadUrl)}">下载图片</a><a href="/artifacts">查看成果</a>`;
          if (status) status.textContent = "图片已保存到成果。";
        } catch (error) { if (status) status.textContent = error.message; }
        finally { generate.disabled = false; }
        return true;
      }
      return false;
    }
    return { handleClick };
  }
  root.ClownfishTtsPreviewPlayer = { create, createWorkbench };
})(typeof window !== "undefined" ? window : globalThis);
