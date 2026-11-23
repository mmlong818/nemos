(() => {
  const dialog = document.getElementById("artifactReviewDialog");
  if (!dialog) return;

  const title = document.getElementById("artifactReviewTitle");
  const metadata = document.getElementById("artifactReviewMeta");
  const preview = document.getElementById("artifactReviewPreview");
  const openPreview = document.getElementById("artifactReviewOpen");
  const status = document.getElementById("artifactReviewStatus");
  const retry = document.getElementById("artifactReviewRetry");
  const prepare = document.getElementById("artifactReviewPrepare");
  const confirm = document.getElementById("artifactReviewConfirm");
  const exportButton = document.getElementById("artifactReviewExport");
  const close = document.getElementById("closeArtifactReview");
  const note = document.getElementById("artifactReviewNote");
  const endpoint = "/api/capabilities/artifact/review";
  const contentTypes = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  let current;

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }

  function showActions() {
    const needsPreview = current?.info?.format === "pptx" && !current.info.preview;
    prepare.hidden = !needsPreview;
    prepare.disabled = !needsPreview || current.busy;
    confirm.hidden = Boolean(current?.receipt) || needsPreview;
    confirm.disabled = !current?.ready || current.busy;
    exportButton.hidden = !current?.receipt;
    exportButton.disabled = !current?.ready || current.busy;
  }

  function clearPreview(session) {
    clearTimeout(session?.previewTimer);
    if (session?.previewPort) {
      session.previewPort.close();
      session.previewPort = undefined;
    }
    preview.replaceChildren();
    preview.hidden = true;
    openPreview.hidden = true;
    openPreview.removeAttribute("href");
    if (session?.previewUrl) {
      URL.revokeObjectURL(session.previewUrl);
      session.previewUrl = undefined;
    }
  }

  function isCurrent(session) {
    return current === session && dialog.open && !session.controller.signal.aborted;
  }

  function matchesReceipt(receipt, info) {
    return typeof receipt?.reviewId === "string" && Boolean(receipt.reviewId)
      && receipt.artifactId === info.artifactId && receipt.format === info.format
      && receipt.sha256 === info.sha256 && receipt.byteLength === info.byteLength
      && (info.format !== "pptx" || (validSlidePreview(receipt.preview) && validSlidePreview(info.preview)
        && receipt.preview.sha256 === info.preview.sha256 && receipt.preview.byteLength === info.preview.byteLength
        && receipt.preview.pages === info.preview.pages));
  }

  function validFingerprint(info) {
    return typeof info?.sha256 === "string" && /^[a-f0-9]{64}$/.test(info.sha256)
      && Number.isSafeInteger(info.byteLength) && info.byteLength > 0;
  }

  function validSlidePreview(info) {
    return validFingerprint(info) && Number.isSafeInteger(info.pages) && info.pages > 0;
  }

  async function fetchChecked(path, session, options) {
    const response = await fetch(path, { cache: "no-store", ...options, signal: session.controller.signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error(data.error || `无法读取审阅文件（${response.status}）`), { status: response.status });
    }
    return response;
  }

  async function verifiedFile(response, info) {
    const name = info.format.toUpperCase();
    const contentType = contentTypes[info.format];
    if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== contentType) {
      throw Object.assign(new Error(`响应不是 ${name}，无法使用此版本。`), { status: 409 });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const matchesHeader = info.format === "pdf"
      ? new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-"
      : bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
    if (bytes.length !== info.byteLength || !matchesHeader) {
      throw Object.assign(new Error(`${name} 文件与显示的版本不一致，请重新加载。`), { status: 409 });
    }
    if (!globalThis.crypto?.subtle) throw new Error("当前页面无法校验文件，请从本机应用打开审阅。");
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (sha256 !== info.sha256) throw Object.assign(new Error(`${name} 文件指纹已变化，请重新加载。`), { status: 409 });
    return new Blob([bytes], { type: contentType });
  }

  function formattedTime(value) {
    return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "";
  }

  function readyMessage(session) {
    if (!session.receipt && session.info.format === "pptx") return "待审阅 · 查看静态幻灯片后，确认此版本。";
    if (!session.receipt) return `待审阅 · 查看 ${session.info.format.toUpperCase()} 后，确认此版本。`;
    const time = formattedTime(session.receipt.reviewedAt);
    return time ? `此版本已审阅 · ${time}` : "此版本已审阅";
  }

  function previewReady(session) {
    if (!isCurrent(session)) return;
    clearTimeout(session.previewTimer);
    session.ready = true;
    showActions();
    message(readyMessage(session));
    if (session.focusAfterPreview) {
      session.focusAfterPreview = false;
      confirm.focus();
    }
  }

  function previewFailed(session) {
    if (!isCurrent(session)) return;
    session.ready = false;
    clearPreview(session);
    showActions();
    retry.hidden = false;
    message(`${session.info.format.toUpperCase()} 预览未能加载，请重新加载。`, true);
  }

  function showPdf(session, blob) {
    const slides = session.info.format === "pptx";
    session.previewUrl = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.title = `审阅 ${slides ? "PPTX 静态预览" : "PDF"}：${session.info.filename}`;
    frame.referrerPolicy = "no-referrer";
    frame.addEventListener("load", () => previewReady(session), { once: true });
    frame.addEventListener("error", () => previewFailed(session), { once: true });
    frame.src = session.previewUrl;
    preview.replaceChildren(frame);
    preview.hidden = false;
    openPreview.textContent = slides ? "在新标签查看同一份静态预览" : "在新标签查看同一份 PDF";
    openPreview.href = session.previewUrl;
    openPreview.hidden = false;
  }

  function showDocx(session, blob) {
    const frame = document.createElement("iframe");
    frame.title = `审阅 DOCX：${session.info.filename}`;
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.addEventListener("load", () => {
      if (!isCurrent(session) || !frame.isConnected || !frame.contentWindow) return;
      const { port1, port2 } = new MessageChannel();
      session.previewPort = port1;
      port1.onmessage = ({ data }) => {
        if (!isCurrent(session) || session.previewPort !== port1) return;
        port1.close();
        session.previewPort = undefined;
        if (data?.ready === true) previewReady(session);
        else previewFailed(session);
      };
      // The bundled viewer's sandbox has an opaque origin. Its reply is scoped to this port.
      frame.contentWindow.postMessage(blob, "*", [port2]);
    }, { once: true });
    frame.addEventListener("error", () => previewFailed(session), { once: true });
    session.previewTimer = setTimeout(() => previewFailed(session), 15_000);
    frame.src = "/assets/artifact-docx-preview.html";
    preview.replaceChildren(frame);
    preview.hidden = false;
    message("正在排版 DOCX 预览…");
  }

  function fileIdentity({ artifactId: id, format, sha256, byteLength }) {
    return { id, format, sha256, byteLength };
  }

  function previewIdentity(info) {
    return info.format === "pptx"
      ? { previewSha256: info.preview.sha256, previewByteLength: info.preview.byteLength }
      : {};
  }

  async function loadPreview(session) {
    const { info } = session;
    const query = new URLSearchParams({ ...fileIdentity(info), ...previewIdentity(info) });
    const fingerprint = info.format === "pptx" ? { format: "pdf", ...info.preview } : info;
    const blob = await verifiedFile(await fetchChecked(`${endpoint}/preview?${query}`, session), fingerprint);
    if (!isCurrent(session)) return;
    if (info.format === "docx") showDocx(session, blob);
    else showPdf(session, blob);
  }

  async function openReview(id, trigger) {
    current?.controller.abort();
    clearPreview(current);
    const session = { id, trigger, controller: new AbortController(), ready: false, busy: false };
    current = session;
    title.textContent = "";
    metadata.textContent = "";
    note.textContent = "";
    retry.hidden = true;
    message("正在读取成果原件…");
    showActions();
    if (!dialog.open) dialog.showModal();
    close.focus();

    try {
      const query = new URLSearchParams({ id });
      const response = await fetchChecked(`${endpoint}?${query}`, session);
      const info = await response.json();
      if (!isCurrent(session)) return;
      if (info.artifactId !== id || !Object.hasOwn(contentTypes, info.format) || !validFingerprint(info) || !info.filename
          || (info.format === "pptx" && info.preview !== null && !validSlidePreview(info.preview))
          || (info.review && !matchesReceipt(info.review, info))) {
        throw new Error("找不到可核对的成果版本。");
      }
      session.info = info;
      session.receipt = info.review || null;
      title.textContent = info.title || info.filename;
      metadata.textContent = [info.filename, info.version ? `第 ${info.version} 版` : "生成原件", formattedTime(info.createdAt), `SHA-256 ${info.sha256.slice(0, 12)}`].filter(Boolean).join(" · ");
      if (info.format === "docx") {
        note.textContent = "浏览器预览生成时的 DOCX 原件，字体和分页可能与桌面 Word 不同。工作台中的修改和备注仍在工作台。";
      } else if (info.format === "pptx") {
        note.textContent = "静态预览显示幻灯片，不含动画和演讲者备注。导出生成时的 PPTX 原件。";
      } else {
        note.textContent = "审阅生成时的 PDF 原件。工作台中尚未重新生成的修改和备注保留在工作台。";
      }
      showActions();

      if (info.format === "pptx" && !info.preview) {
        message("待生成静态预览。");
        return;
      }
      await loadPreview(session);
    } catch (error) {
      if (!isCurrent(session)) return;
      retry.hidden = false;
      message(error.message || "审阅预览不可用，请重试。", true);
    }
  }

  async function runAction(session, progress, action) {
    if (!session?.ready || session.busy || !isCurrent(session)) return;
    session.busy = true;
    retry.hidden = true;
    showActions();
    message(progress);
    let focusAfter;
    try {
      focusAfter = await action();
    } catch (error) {
      if (!isCurrent(session)) return;
      if ([404, 409, 422].includes(error.status)) {
        session.ready = false;
        clearPreview(session);
        retry.hidden = false;
      }
      message(error.message || "操作未完成，请重试。", true);
    } finally {
      if (isCurrent(session)) {
        session.busy = false;
        showActions();
        focusAfter?.focus();
      }
    }
  }

  prepare.addEventListener("click", () => {
    const session = current;
    if (!session || session.busy || session.info?.format !== "pptx" || session.info.preview || !isCurrent(session)) return;
    void prepareSlides(session);
  });

  async function prepareSlides(session) {
    session.busy = true;
    showActions();
    message("正在生成静态预览…");
    try {
      const response = await fetchChecked(`${endpoint}/prepare`, session, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fileIdentity(session.info)),
      });
      const { preview: prepared } = await response.json();
      if (!isCurrent(session)) return;
      if (!validSlidePreview(prepared)) throw new Error("无法核对生成的静态预览，请重试。");
      session.info.preview = prepared;
      session.focusAfterPreview = true;
      session.busy = false;
      showActions();
      message("正在读取静态预览…");
      await loadPreview(session);
    } catch (error) {
      if (!isCurrent(session)) return;
      retry.hidden = !session.info.preview && ![404, 409, 422].includes(error.status);
      message(error.message || "静态预览生成失败，请重试。", true);
    } finally {
      if (isCurrent(session)) {
        session.busy = false;
        showActions();
      }
    }
  }

  confirm.addEventListener("click", () => {
    const session = current;
    if (!session || session.receipt) return;
    void runAction(session, "正在确认此版本…", async () => {
      const response = await fetchChecked(endpoint, session, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fileIdentity(session.info), ...previewIdentity(session.info) }),
      });
      const { review } = await response.json();
      if (!isCurrent(session)) return;
      if (!matchesReceipt(review, session.info)) throw new Error("确认回执与当前预览不一致，请重试。");
      session.receipt = review;
      message(readyMessage(session));
      return exportButton;
    });
  });

  exportButton.addEventListener("click", () => {
    const session = current;
    if (!session?.receipt) return;
    void runAction(session, "正在校验并导出已审版本…", async () => {
      const query = new URLSearchParams({ reviewId: session.receipt.reviewId });
      const blob = await verifiedFile(await fetchChecked(`${endpoint}/export?${query}`, session), session.info);
      if (!isCurrent(session)) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = session.info.filename;
      dialog.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message(`已开始下载此已审 ${session.info.format.toUpperCase()} 版本。`);
    });
  });

  retry.addEventListener("click", () => {
    if (current) void openReview(current.id, current.trigger);
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (dialog.open || !current) return;
    const { trigger, id, controller } = current;
    controller.abort();
    clearPreview(current);
    current = undefined;
    const target = trigger?.isConnected ? trigger : [...document.querySelectorAll("[data-review-artifact]")]
      .find((button) => button.dataset.reviewArtifact === id);
    target?.focus();
  });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-review-artifact]");
    if (trigger?.dataset.reviewArtifact) void openReview(trigger.dataset.reviewArtifact, trigger);
  });
})();
