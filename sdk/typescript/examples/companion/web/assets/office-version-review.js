(() => {
  function bind({ api, currentDocument, saveQueue, revision, hasSaveConflict }) {
    const dialog = document.querySelector("#officeVersionReviewDialog");
    const description = document.querySelector("#officeVersionReviewSelection");
    const legacyName = document.querySelector("#officeVersionReviewLegacyName");
    const close = document.querySelector("#closeOfficeVersionReview");
    const status = document.querySelector("#officeVersionReviewStatus");
    const openResult = document.querySelector("#openOfficeVersionReview");
    const pptxHint = document.querySelector("#officeVersionReviewPowerPointHint");
    const formats = [...dialog.querySelectorAll("[data-office-review-format]")];
    let selected;

    function isActive(session) {
      if (selected !== session || !dialog.open || session.controller.signal.aborted) return false;
      if (currentDocument()?.id === session.documentId) return true;
      dialog.close();
      return false;
    }

    function showStatus(message, error = false) {
      status.textContent = message;
      status.classList.toggle("is-error", error);
    }

    function updateButtons(session) {
      for (const button of formats) {
        button.disabled = session.busy || session.completed
          || (button.dataset.officeReviewFormat === "pptx" && !session.pptxAvailable);
      }
    }

    async function checkPowerPoint(session) {
      try {
        const capabilities = await api("/api/capabilities", { signal: session.controller.signal });
        if (!isActive(session)) return;
        session.pptxAvailable = capabilities.pptxReviewAvailable === true;
        pptxHint.textContent = session.pptxAvailable ? "" : "本机没有可用的 PowerPoint 预览，暂时只能生成 DOCX。";
      } catch {
        if (!isActive(session)) return;
        pptxHint.textContent = "无法确认本机 PowerPoint 预览。重新打开可再检查。";
      }
      updateButtons(session);
    }

    function open(versionId, trigger) {
      const current = currentDocument();
      const version = current?.versions.find((item) => item.id === versionId);
      if (!version) return;
      selected?.controller.abort();
      const session = {
        documentId: current.id, versionId: version.id, trigger, controller: new AbortController(),
        pptxAvailable: false, busy: false, completed: false,
      };
      selected = session;
      const name = version.documentName || version.name;
      description.textContent = version.documentName ? `${name} · ${version.name}` : version.name;
      legacyName.hidden = Boolean(version.documentName);
      legacyName.textContent = version.documentName ? "" : `这个旧版本未记录文稿名。生成的文件将使用版本标签「${name}」。`;
      pptxHint.textContent = "正在检查本机 PowerPoint 预览…";
      openResult.removeAttribute("href");
      openResult.hidden = true;
      showStatus("");
      updateButtons(session);
      if (!dialog.open) dialog.showModal();
      formats[0]?.focus();
      void checkPowerPoint(session);
    }

    async function generate(format) {
      const session = selected;
      if (!session || !isActive(session) || session.busy || session.completed
        || (format !== "docx" && (format !== "pptx" || !session.pptxAvailable))) return;
      session.busy = true;
      updateButtons(session);
      showStatus("正在核对保存版本并生成审阅稿…");
      try {
        await saveQueue();
        if (!isActive(session)) return;
        if (hasSaveConflict()) throw new Error("另一个窗口有新修改。请重新载入并核对这个保存版本。");
        // Resolving the queue is not a save acknowledgment. The server must find the exact
        // persisted version in this revision before it is allowed to generate anything.
        const result = await api("/api/files/workbench/review", {
          method: "POST",
          body: JSON.stringify({ documentId: session.documentId, versionId: session.versionId, format, expectedRevision: revision() }),
          signal: session.controller.signal,
        });
        if (!isActive(session)) return;
        if (result.ok !== true || result.format !== format
          || typeof result.artifactId !== "string" || !result.artifactId
          || typeof result.filename !== "string" || !result.filename) {
          throw new Error("没有收到可核对的成果编号，请重试。");
        }
        session.completed = true;
        showStatus(result.reused ? `已找到对应成果「${result.filename}」。` : `已生成「${result.filename}」，待审阅。`);
        openResult.href = "/artifacts?" + new URLSearchParams({ review: result.artifactId });
        openResult.hidden = false;
        openResult.focus();
      } catch (error) {
        if (!isActive(session)) return;
        showStatus(error.status === 404 ? "找不到该保存版本。可能尚未同步，或已从工作区移除。"
          : error.message || "生成失败，请重试。", true);
      } finally {
        if (isActive(session)) {
          session.busy = false;
          updateButtons(session);
          if (!session.completed) formats.find((button) => button.dataset.officeReviewFormat === format)?.focus();
        }
      }
    }

    for (const button of formats) button.addEventListener("click", () => void generate(button.dataset.officeReviewFormat));
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (dialog.open || !selected) return;
      const { trigger, versionId, controller } = selected;
      selected = undefined;
      controller.abort();
      const target = trigger?.isConnected ? trigger : [...document.querySelectorAll("[data-generate-version]")]
        .find((button) => button.dataset.generateVersion === versionId);
      (target || document.querySelector("#saveVersion"))?.focus();
    });
    return { open };
  }

  window.ClownfishOfficeVersionReview = Object.freeze({ bind });
})();
