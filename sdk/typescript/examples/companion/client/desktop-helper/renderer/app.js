(async function () {
  const text = {
    booting: "\u542f\u52a8\u4e2d",
    saved: "\u5df2\u4fdd\u5b58",
    saving: "\u4fdd\u5b58\u4e2d",
    selectText: "\u8bf7\u5148\u8f93\u5165\u6216\u9009\u4e2d\u4e00\u6bb5\u8981\u7ffb\u8bd1\u7684\u6587\u5b57\u3002",
    translating: "\u7ffb\u8bd1\u4e2d...",
    noTranslation: "\u6ca1\u6709\u62ff\u5230\u7ffb\u8bd1\u7ed3\u679c\u3002",
    translateFailed: "\u7ffb\u8bd1\u63a5\u53e3\u6682\u65f6\u4e0d\u53ef\u7528\uff1a",
    emptyClips: "\u6682\u5b58\u533a\u8fd8\u6ca1\u6709\u5185\u5bb9\u3002",
    copy: "\u590d\u5236",
    delete: "\u5220\u9664",
    startRecord: "\u5f00\u59cb\u5f55\u97f3",
    stopRecord: "\u505c\u6b62\u5f55\u97f3",
    recording: "\u6b63\u5728\u5f55\u97f3\uff0c\u4f1a\u6839\u636e\u8bed\u901f\u548c\u505c\u987f\u81ea\u52a8\u5206\u6bb5\u8ffd\u52a0\u8f6c\u5199\u3002",
    transcribing: "\u6b63\u5728\u8f6c\u5199\u6700\u65b0\u8bed\u97f3...",
    transcribed: "\u6700\u65b0\u8bed\u97f3\u5df2\u5199\u5165\u6587\u672c\u6846\u3002",
    stopped: "\u5f55\u97f3\u5df2\u505c\u6b62\uff0c\u6700\u540e\u4e00\u6bb5\u5df2\u5904\u7406\u5b8c\u3002",
    noSpeech: "\u8fd9\u4e00\u6bb5\u6ca1\u6709\u8bc6\u522b\u5230\u53ef\u5199\u5165\u7684\u5185\u5bb9\u3002",
    micUnavailable: "\u5f53\u524d\u73af\u5883\u65e0\u6cd5\u8bbf\u95ee\u9ea6\u514b\u98ce\u3002",
    aliyunMissing: "\u8bf7\u5148\u5728\u8bbe\u7f6e\u91cc\u586b\u5165\u963f\u91cc\u4e91\u767e\u70bc API Key\u3002",
    transcribeFailed: "\u8f6c\u5199\u5931\u8d25\uff1a",
    cloudFailed: "\u4e91\u7aef\u5904\u7406\u5931\u8d25\uff1a",
    cloudPolishing: "\u6b63\u5728\u6da6\u8272...",
    cloudPolished: "\u6da6\u8272\u5b8c\u6210\u3002",
    settingsSaved: "\u8bbe\u7f6e\u5df2\u4fdd\u5b58\u3002",
    statusOk: "\u72b6\u6001\u6b63\u5e38\uff1a\u5f53\u524d\u8bed\u97f3\u6a21\u5f0f\u53ef\u7528\u3002",
    statusNoKey: "\u72b6\u6001\uff1a\u5f53\u524d\u8bed\u97f3\u6a21\u5f0f\u8fd8\u672a\u5c31\u7eea\uff0c\u8bf7\u68c0\u67e5\u8bbe\u7f6e\u6216\u6570\u636e\u76ee\u5f55\u3002"
  };

  const api = window.desktopHelper;
  const $ = (id) => document.getElementById(id);

  let state = await api.loadData();
  let settings = await api.loadSettings();
  let saveTimer = null;
  let activeStream = null;
  let audioContext = null;
  let audioSource = null;
  let audioProcessor = null;
  let silentGain = null;
  let segmentTimer = null;
  let segmentSamples = [];
  let segmentSampleRate = 16000;
  let segmentStartedAt = 0;
  let segmentHasSpeech = false;
  let trailingSilenceMs = 0;
  let adaptiveSilenceMs = 1800;
  let waveformLevels = new Array(48).fill(0);
  let recordStartedAt = 0;
  let recordTimer = null;
  let recording = false;
  let pendingTranscription = Promise.resolve();

  const els = {
    saveState: $("saveState"),
    tabs: document.querySelectorAll(".tab"),
    panels: document.querySelectorAll(".panel"),
    pinBtn: $("pinBtn"),
    minBtn: $("minBtn"),
    closeBtn: $("closeBtn"),
    translateBtn: $("translateBtn"),
    translateSource: $("translateSource"),
    pasteTranslateBtn: $("pasteTranslateBtn"),
    copyTranslationBtn: $("copyTranslationBtn"),
    translationBox: $("translationBox"),
    recordBtn: $("recordBtn"),
    recordTimer: $("recordTimer"),
    polishBtn: $("polishBtn"),
    waveCanvas: $("waveCanvas"),
    speechText: $("speechText"),
    copySpeechBtn: $("copySpeechBtn"),
    speechStatus: $("speechStatus"),
    saveSettingsBtn: $("saveSettingsBtn"),
    testSettingsBtn: $("testSettingsBtn"),
    speechModeSelect: $("speechModeSelect"),
    aliyunApiKeyInput: $("aliyunApiKeyInput"),
    aliyunFunasrPythonInput: $("aliyunFunasrPythonInput"),
    aliyunFunasrModelInput: $("aliyunFunasrModelInput"),
    aliyunFunasrWebSocketInput: $("aliyunFunasrWebSocketInput"),
    polishModelInput: $("polishModelInput"),
    dataDirText: $("dataDirText"),
    openDataDirBtn: $("openDataDirBtn"),
    settingsStatus: $("settingsStatus")
  };

  bindEvents();
  renderSettings();
  drawWaveform(0, false);
  els.saveState.textContent = text.saved;

  function bindEvents() {
    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    els.pinBtn.addEventListener("click", async () => {
      const pinned = await api.toggleAlwaysOnTop();
      els.pinBtn.classList.toggle("active", pinned);
    });
    els.minBtn.addEventListener("click", () => api.minimize());
    els.closeBtn.addEventListener("click", () => api.close());

    els.translateBtn.addEventListener("click", translateText);
    els.pasteTranslateBtn.addEventListener("click", pasteTranslateSource);
    els.copyTranslationBtn.addEventListener("click", () => api.writeClipboard(els.translationBox.textContent));
    els.recordBtn.addEventListener("click", toggleRecording);
    els.polishBtn.addEventListener("click", polishCloud);
    els.copySpeechBtn.addEventListener("click", () => api.writeClipboard(els.speechText.value));
    els.saveSettingsBtn.addEventListener("click", saveSettings);
    els.testSettingsBtn.addEventListener("click", showSettingsStatus);
    els.speechModeSelect.addEventListener("change", saveSettings);
    els.openDataDirBtn.addEventListener("click", async () => {
      const selected = await api.openDataDir();
      els.settingsStatus.textContent = `${selected}`;
    });
  }

  function switchTab(name) {
    els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === name));
  }

  function normalizeState() {
    state.notes = Array.isArray(state.notes)
      ? state.notes.filter((note) => String(note?.text || "").trim() || !isPlaceholderTitle(note?.title))
      : [];
    if (!state.notes.some((note) => note.id === currentNoteId)) {
      currentNoteId = state.notes[0]?.id || "";
      state.currentNoteId = currentNoteId;
    }
  }

  function activeNote() {
    return state.notes.find((note) => note.id === currentNoteId) || null;
  }

  function ensureActiveNote() {
    return activeNote() || createNote("");
  }

  function createNote(initialText) {
    const id = crypto.randomUUID();
    const note = { id, text: initialText || "", updatedAt: Date.now() };
    state.notes.unshift(note);
    currentNoteId = id;
    state.currentNoteId = id;
    return note;
  }

  function isPlaceholderTitle(value) {
    return /^(临时便签|新便签|未命名便签|涓存椂渚跨|鏂颁究绛|未命名)/.test(String(value || ""));
  }

  async function scheduleSave() {
    els.saveState.textContent = text.saving;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await api.saveData(state);
      els.saveState.textContent = text.saved;
    }, 220);
  }

  function renderNotes() {
    const note = activeNote();
    els.noteText.value = note?.text || "";
    els.copyNoteBtn.disabled = !note;
    els.deleteNoteBtn.disabled = !note;
    renderNotePickerOnly();
    renderNoteListOnly();
    renderNoteMeta();
  }

  function renderNotePickerOnly() {
    els.notePicker.innerHTML = "";
    state.notes.forEach((note) => {
      const option = document.createElement("option");
      option.value = note.id;
      option.textContent = notePreview(note);
      option.selected = note.id === currentNoteId;
      els.notePicker.appendChild(option);
    });
  }

  function renderNoteListOnly() {
    els.noteCountText.textContent = `便签 · ${state.notes.length}`;
    els.noteList.innerHTML = "";
    if (!state.notes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "还没有便签，点新建或直接在下方输入。";
      els.noteList.appendChild(empty);
      return;
    }
    state.notes
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .forEach((note) => {
        const item = document.createElement("article");
        item.className = `note-item${note.id === currentNoteId ? " active" : ""}`;
        item.addEventListener("click", () => {
          currentNoteId = note.id;
          state.currentNoteId = note.id;
          renderNotes();
          scheduleSave();
        });

        const body = document.createElement("div");
        body.className = "note-item-body";

        const preview = document.createElement("p");
        preview.textContent = notePreview(note);

        const meta = document.createElement("span");
        meta.textContent = noteTime(note.updatedAt);

        body.append(preview, meta);

        const actions = document.createElement("div");
        actions.className = "note-item-actions";

        const copyBtn = document.createElement("button");
        copyBtn.className = "icon-only";
        copyBtn.title = text.copy;
        copyBtn.textContent = "\u29c9";
        copyBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          api.writeClipboard(note.text || "");
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "icon-only";
        deleteBtn.title = text.delete;
        deleteBtn.textContent = "\ud83d\uddd1";
        deleteBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteNote(note.id);
        });

        actions.append(copyBtn, deleteBtn);
        item.append(body, actions);
        els.noteList.appendChild(item);
      });
  }

  function renderNoteMeta() {
    const note = activeNote();
    els.noteMeta.textContent = note ? `${note.text.length} 字 · ${noteTime(note.updatedAt)}` : "0 字";
  }

  function notePreview(note) {
    const value = String(note.text || "").trim().replace(/\s+/g, " ");
    return value ? value.slice(0, 48) : "空白便签";
  }

  function noteTime(value) {
    if (!value) return "";
    const date = new Date(value);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function copyActiveNote() {
    const note = activeNote();
    if (note) api.writeClipboard(note.text || "");
  }

  function deleteActiveNote() {
    deleteNote(currentNoteId);
  }

  function deleteNote(noteId) {
    state.notes = state.notes.filter((note) => note.id !== noteId);
    currentNoteId = state.notes[0]?.id || "";
    state.currentNoteId = currentNoteId;
    renderNotes();
    scheduleSave();
  }

  async function pasteTranslateSource() {
    els.translateSource.value = await api.readClipboard();
    els.translateSource.focus();
  }

  async function translateText() {
    const selected = els.translateSource.value
      .slice(els.translateSource.selectionStart, els.translateSource.selectionEnd)
      .trim();
    const source = selected || els.translateSource.value.trim();
    if (!source) {
      els.translationBox.textContent = text.selectText;
      return;
    }

    els.translationBox.textContent = text.translating;
    const hasChinese = /[\u3400-\u9fff]/.test(source);
    const langPair = hasChinese ? "zh-CN|en" : "en|zh-CN";
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(source)}&langpair=${langPair}`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      els.translationBox.textContent = data?.responseData?.translatedText || text.noTranslation;
    } catch (error) {
      els.translationBox.textContent = `${text.translateFailed}${error.message}`;
    }
  }

  async function captureClipboard() {
    const value = await api.readClipboard();
    addClip(value, false);
  }

  function addClip(value, clearDraft) {
    const clipText = String(value || "").trim();
    if (!clipText) return;

    state.clips = state.clips.filter((clip) => clip.text !== clipText);
    state.clips.unshift({ id: crypto.randomUUID(), text: clipText, createdAt: Date.now() });
    state.clips = state.clips.slice(0, 60);
    if (clearDraft) els.clipDraft.value = "";
    renderClips();
    scheduleSave();
  }

  function renderClips() {
    els.clipList.innerHTML = "";
    if (!state.clips.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = text.emptyClips;
      els.clipList.appendChild(empty);
      return;
    }

    state.clips.forEach((clip) => {
      const item = document.createElement("article");
      item.className = "clip-item";

      const clipBody = document.createElement("div");
      clipBody.className = "clip-text";
      clipBody.textContent = clip.text;

      const meta = document.createElement("div");
      meta.className = "clip-meta";
      meta.textContent = new Date(clip.createdAt).toLocaleString();

      const actions = document.createElement("div");
      actions.className = "clip-actions";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = text.copy;
      copyBtn.addEventListener("click", () => api.writeClipboard(clip.text));

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = text.delete;
      deleteBtn.className = "secondary";
      deleteBtn.addEventListener("click", () => {
        state.clips = state.clips.filter((item) => item.id !== clip.id);
        renderClips();
        scheduleSave();
      });

      actions.append(copyBtn, deleteBtn);
      item.append(clipBody, meta, actions);
      els.clipList.appendChild(item);
    });
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording();
      return;
    }

    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext({ sampleRate: 16000 });
      segmentSampleRate = audioContext.sampleRate;
      audioSource = audioContext.createMediaStreamSource(activeStream);
      audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      audioProcessor.onaudioprocess = (event) => {
        if (!recording) return;
        handleAudioChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      audioSource.connect(audioProcessor);
      audioProcessor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      recording = true;
      recordStartedAt = Date.now();
      startRecordTimer();
      waveformLevels = new Array(48).fill(0);
      drawWaveform(0, true);
      focusSpeechText();
      els.recordBtn.textContent = text.stopRecord;
      els.recordBtn.classList.add("recording");
      els.speechStatus.classList.add("recording");
      els.speechStatus.textContent = text.recording;
      resetSegment();
    } catch (error) {
      els.speechStatus.textContent = `${text.micUnavailable} ${error.message}`;
    }
  }

  function resetSegment() {
    segmentSamples = [];
    segmentStartedAt = performance.now();
    segmentHasSpeech = false;
    trailingSilenceMs = 0;
  }

  function startRecordTimer() {
    stopRecordTimer(false);
    updateRecordTimer();
    recordTimer = setInterval(updateRecordTimer, 500);
  }

  function stopRecordTimer(resetText = true) {
    clearInterval(recordTimer);
    recordTimer = null;
    if (resetText && els.recordTimer) els.recordTimer.textContent = "00:00";
  }

  function updateRecordTimer() {
    if (!els.recordTimer || !recordStartedAt) return;
    const totalSeconds = Math.max(0, Math.floor((Date.now() - recordStartedAt) / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    els.recordTimer.textContent = `${minutes}:${seconds}`;
  }

  function handleAudioChunk(chunk) {
    segmentSamples.push(chunk);
    const chunkMs = (chunk.length / segmentSampleRate) * 1000;
    const level = rms(chunk);
    const speaking = level > 0.01;
    drawWaveform(level, speaking);
    if (speaking) {
      segmentHasSpeech = true;
      trailingSilenceMs = 0;
    } else if (segmentHasSpeech) {
      trailingSilenceMs += chunkMs;
    }

    const elapsedMs = performance.now() - segmentStartedAt;
    const shouldFlushAfterPause = segmentHasSpeech && trailingSilenceMs >= adaptiveSilenceMs && elapsedMs >= 1200;
    const shouldFlushByLimit = elapsedMs >= maxSegmentMs();
    if (shouldFlushAfterPause || shouldFlushByLimit) {
      flushSegment();
      resetSegment();
    }
  }

  function maxSegmentMs() {
    return Math.max(6200, adaptiveSilenceMs * 3.2);
  }

  async function stopRecording() {
    recording = false;
    clearTimeout(segmentTimer);
    els.recordBtn.textContent = text.startRecord;
    els.recordBtn.classList.remove("recording");
    els.speechStatus.classList.remove("recording");
    els.speechStatus.textContent = text.transcribing;
    flushSegment();
    audioProcessor?.disconnect();
    silentGain?.disconnect();
    audioSource?.disconnect();
    await audioContext?.close();
    audioContext = null;
    audioProcessor = null;
    silentGain = null;
    audioSource = null;
    activeStream?.getTracks().forEach((track) => track.stop());
    activeStream = null;
    stopRecordTimer();
    drawWaveform(0, false);
    await pendingTranscription;
    els.speechStatus.textContent = text.stopped;
  }

  function flushSegment() {
    const samples = mergeSamples(segmentSamples);
    segmentSamples = [];
    if (samples.length < segmentSampleRate * 0.35) return;
    if (!hasSpeech(samples)) {
      if (recording) els.speechStatus.textContent = text.noSpeech;
      return;
    }
    queueTranscription(encodeWav(samples, segmentSampleRate));
  }

  function hasSpeech(samples) {
    return rms(samples) > 0.012;
  }

  function chunkHasSpeech(samples) {
    return rms(samples) > 0.01;
  }

  function rms(samples) {
    let total = 0;
    for (let index = 0; index < samples.length; index += 1) {
      total += samples[index] * samples[index];
    }
    return Math.sqrt(total / samples.length);
  }

  function drawWaveform(level, active) {
    const canvas = els.waveCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    waveformLevels.push(Math.min(1, level * 18));
    waveformLevels = waveformLevels.slice(-48);

    const ctx = canvas.getContext("2d");
    const styles = getComputedStyle(document.body);
    const waveColor = styles.getPropertyValue("--wave-color").trim() || "#8b5cf6";
    const borderColor = styles.getPropertyValue("--border").trim() || "rgba(139, 92, 246, 0.14)";
    const bgColor = styles.getPropertyValue("--card-bg").trim() || "rgba(255, 255, 255, 0.65)";
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const gap = 3 * ratio;
    const barWidth = Math.max(2 * ratio, (width - gap * (waveformLevels.length - 1)) / waveformLevels.length);
    waveformLevels.forEach((item, index) => {
      const barHeight = Math.max(3 * ratio, item * height * 0.86);
      const x = index * (barWidth + gap);
      const y = (height - barHeight) / 2;
      ctx.fillStyle = active ? waveColor : "rgba(139, 92, 246, 0.22)";
      ctx.fillRect(x, y, barWidth, barHeight);
    });
  }

  function queueTranscription(blob) {
    pendingTranscription = pendingTranscription
      .catch(() => undefined)
      .then(() => transcribeBlob(blob));
  }

  async function transcribeBlob(blob) {
    if (!blob.size) return;
    els.speechStatus.textContent = text.transcribing;
    try {
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const result = await api.transcribe({ bytes, mimeType: "audio/wav" });
      tuneSpeechPace(result);
      if (appendSpeechText(result)) {
        if (recording) els.speechStatus.textContent = text.transcribed;
      } else if (recording) {
        els.speechStatus.textContent = text.noSpeech;
      }
    } catch (error) {
      els.speechStatus.textContent = `${text.transcribeFailed}${cleanError(error)}`;
    }
  }

  function mergeSamples(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Float32Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result;
  }

  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  function appendSpeechText(value) {
    const next = String(value || "").trim();
    if (!next) return false;
    const current = els.speechText.value.trimEnd();
    els.speechText.value = current ? `${current}\n${next}` : next;
    focusSpeechText();
    return true;
  }

  function tuneSpeechPace(value) {
    const writtenLength = String(value || "").replace(/\s+/g, "").length;
    if (writtenLength > 0 && writtenLength <= 6) {
      adaptiveSilenceMs = Math.min(3000, adaptiveSilenceMs + 350);
      return;
    }
    if (writtenLength >= 18) {
      adaptiveSilenceMs = Math.max(1300, adaptiveSilenceMs - 180);
    }
  }

  function focusSpeechText() {
    els.speechText.focus();
    const end = els.speechText.value.length;
    els.speechText.setSelectionRange(end, end);
  }

  async function polishCloud() {
    const value = els.speechText.value.trim();
    if (!value) return;
    els.speechStatus.textContent = text.cloudPolishing;

    try {
      els.speechText.value = await api.polish(value);
      els.speechStatus.textContent = text.cloudPolished;
    } catch (error) {
      els.speechStatus.textContent = `${text.cloudFailed}${cleanError(error)}`;
      els.speechText.value = localPolish(value);
    }
  }

  function localPolish(input) {
    let value = String(input || "").trim();
    if (!value) return "";
    value = value
      .replace(/\s+/g, " ")
      .replace(/\s*([，。！？；：、,.!?;:])\s*/g, "$1")
      .replace(/,/g, "，")
      .replace(/\?/g, "？")
      .replace(/!/g, "！")
      .replace(/;/g, "；")
      .replace(/:/g, "：");
    if (!/[。！？]$/.test(value)) value += "。";
    return value
      .split(/(?<=[。！？])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .join("\n");
  }

  function renderSettings() {
    els.dataDirText.textContent = settings.dataDir;
    els.speechModeSelect.value = "aliyun-funasr";
    els.aliyunFunasrPythonInput.value = settings.aliyunFunasrPython || `${settings.dataDir}\\funasr-env\\Scripts\\python.exe`;
    els.aliyunFunasrModelInput.value = settings.aliyunFunasrModel || "fun-asr-realtime";
    els.aliyunFunasrWebSocketInput.value = settings.aliyunFunasrWebSocketUrl || "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
    els.polishModelInput.value = settings.polishModel || "qwen-plus";
    els.settingsStatus.textContent = currentSpeechModeReady() ? text.statusOk : text.statusNoKey;
  }

  async function saveSettings() {
    try {
      settings = await api.saveSettings({
        aliyunApiKey: els.aliyunApiKeyInput.value,
        speechMode: "aliyun-funasr",
        aliyunFunasrPython: els.aliyunFunasrPythonInput.value.trim(),
        aliyunFunasrModel: els.aliyunFunasrModelInput.value.trim(),
        aliyunFunasrWebSocketUrl: els.aliyunFunasrWebSocketInput.value.trim(),
        polishModel: els.polishModelInput.value.trim()
      });
      els.aliyunApiKeyInput.value = "";
      renderSettings();
      els.settingsStatus.textContent = text.settingsSaved;
    } catch (error) {
      els.settingsStatus.textContent = cleanError(error);
    }
  }

  function showSettingsStatus() {
    els.settingsStatus.textContent = currentSpeechModeReady() ? text.statusOk : text.statusNoKey;
  }

  function currentSpeechModeReady() {
    return Boolean(settings.aliyunFunasrReady);
  }

  function cleanError(error) {
    const value = String(error?.message || error).replace(/^Error:\s*/, "");
    if (value.includes("ALIYUN_API_KEY_MISSING")) return text.aliyunMissing;
    if (value.includes("ALIYUN_FUNASR_PYTHON_MISSING")) return "\u963f\u91cc\u4e91 FunASR Python \u8def\u5f84\u4e0d\u5b58\u5728\u3002";
    if (value.includes("LOCAL_TRANSCRIBE_TIMEOUT")) return "\u672c\u5730\u8f6c\u5199\u8d85\u65f6\uff0c\u53ef\u4ee5\u6362 base \u6a21\u578b\u6216\u7f29\u77ed\u5f55\u97f3\u6bb5\u3002";
    if (value.includes("LOCAL_TRANSCRIBE_FAILED")) return value.replace("LOCAL_TRANSCRIBE_FAILED:", "").trim();
    return value;
  }
})();
