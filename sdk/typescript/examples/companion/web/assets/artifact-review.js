(() => {
  const dialog = document.getElementById("artifactReviewDialog");
  if (!dialog) return;

  const title = document.getElementById("artifactReviewTitle");
  const metadata = document.getElementById("artifactReviewMeta");
  const preview = document.getElementById("artifactReviewPreview");
  const openPreview = document.getElementById("artifactReviewOpen");
  const status = document.getElementById("artifactReviewStatus");
  const retry = document.getElementById("artifactReviewRetry");
  const confirm = document.getElementById("artifactReviewConfirm");
  const exportButton = document.getElementById("artifactReviewExport");
  const close = document.getElementById("closeArtifactReview");
  const endpoint = "/api/capabilities/artifact/review";
  let current;

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }

  function showActions() {
    confirm.hidden = Boolean(current?.receipt);
    confirm.disabled = !current?.ready || current.busy;
    exportButton.hidden = !current?.receipt;
    exportButton.disabled = !current?.ready || current.busy;
  }

  function clearPreview(session) {
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
      && receipt.sha256 === info.sha256 && receipt.byteLength === info.byteLength;
  }

  async function fetchChecked(path, session, options) {
    const response = await fetch(path, { cache: "no-store", ...options, signal: session.controller.signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error(data.error || `无法读取审阅文件（${response.status}）`), { status: response.status });
    }
    return response;
  }

  async function verifiedPdf(response, info) {
    if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/pdf") {
      throw Object.assign(new Error("响应不是 PDF，无法使用此版本。"), { status: 409 });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const header = new TextDecoder().decode(bytes.subarray(0, 5));
    if (bytes.length !== info.byteLength || header !== "%PDF-") {
      throw Object.assign(new Error("PDF 文件与显示的版本不一致，请重新加载。"), { status: 409 });
    }
    if (!globalThis.crypto?.subtle) throw new Error("当前页面无法校验文件，请从本机应用打开审阅。");
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (sha256 !== info.sha256) throw Object.assign(new Error("PDF 文件指纹已变化，请重新加载。"), { status: 409 });
    return new Blob([bytes], { type: "application/pdf" });
  }

  function formattedTime(value) {
    return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "";
  }

  function readyMessage(session) {
    if (!session.receipt) return "待审阅 · 查看 PDF 后，确认此版本。";
    const time = formattedTime(session.receipt.reviewedAt);
    return time ? `此版本已审阅 · ${time}` : "此版本已审阅";
  }

  async function openReview(id, trigger) {
    current?.controller.abort();
    clearPreview(current);
    const session = { id, trigger, controller: new AbortController(), ready: false, busy: false };
    current = session;
    title.textContent = "";
    metadata.textContent = "";
    retry.hidden = true;
    message("正在读取 PDF 原件…");
    showActions();
    if (!dialog.open) dialog.showModal();
    close.focus();

    try {
      const query = new URLSearchParams({ id });
      const response = await fetchChecked(`${endpoint}?${query}`, session);
      const info = await response.json();
      if (!isCurrent(session)) return;
      if (info.artifactId !== id || info.format !== "pdf" || !/^[a-f0-9]{64}$/.test(info.sha256)
          || !Number.isSafeInteger(info.byteLength) || info.byteLength <= 0 || !info.filename
          || (info.review && !matchesReceipt(info.review, info))) {
        throw new Error("找不到可核对的 PDF 版本。");
      }
      session.info = info;
      session.receipt = info.review || null;
      title.textContent = info.title || info.filename;
      metadata.textContent = [info.filename, info.version ? `第 ${info.version} 版` : "生成原件", formattedTime(info.createdAt), `SHA-256 ${info.sha256.slice(0, 12)}`].filter(Boolean).join(" · ");
      showActions();

      query.set("sha256", info.sha256);
      query.set("byteLength", String(info.byteLength));
      const pdf = await verifiedPdf(await fetchChecked(`${endpoint}/preview?${query}`, session), info);
      if (!isCurrent(session)) return;
      session.previewUrl = URL.createObjectURL(pdf);
      const frame = document.createElement("iframe");
      frame.title = `审阅 PDF：${info.filename}`;
      frame.referrerPolicy = "no-referrer";
      frame.addEventListener("load", () => {
        if (!isCurrent(session)) return;
        session.ready = true;
        showActions();
        message(readyMessage(session));
      }, { once: true });
      frame.addEventListener("error", () => {
        if (!isCurrent(session)) return;
        session.ready = false;
        clearPreview(session);
        showActions();
        retry.hidden = false;
        message("PDF 预览未能加载，请重新加载。", true);
      }, { once: true });
      frame.src = session.previewUrl;
      preview.replaceChildren(frame);
      preview.hidden = false;
      openPreview.href = session.previewUrl;
      openPreview.hidden = false;
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

  confirm.addEventListener("click", () => {
    const session = current;
    if (!session || session.receipt) return;
    void runAction(session, "正在确认此 PDF 版本…", async () => {
      const { artifactId: id, sha256, byteLength } = session.info;
      const response = await fetchChecked(endpoint, session, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, sha256, byteLength }),
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
      const pdf = await verifiedPdf(await fetchChecked(`${endpoint}/export?${query}`, session), session.info);
      if (!isCurrent(session)) return;
      const url = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = url;
      link.download = session.info.filename;
      dialog.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message("已开始下载此已审 PDF 版本。");
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
