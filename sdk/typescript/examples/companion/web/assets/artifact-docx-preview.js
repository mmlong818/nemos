(() => {
  const root = document.getElementById("document");
  const appOrigin = new URL(location.href).origin;
  let rendering = false;

  function fitPages() {
    const wrapper = root.querySelector(".review-docx-wrapper");
    if (!wrapper) return;
    const pageWidth = Math.max(0, ...Array.from(wrapper.querySelectorAll("section.review-docx"), (page) => page.offsetWidth));
    const style = getComputedStyle(wrapper);
    const width = pageWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    if (pageWidth) root.style.setProperty("--preview-scale", Math.min(1, document.documentElement.clientWidth / width));
  }

  window.addEventListener("resize", fitPages);
  window.addEventListener("message", async (event) => {
    const port = event.ports[0];
    if (rendering || event.source !== window.parent || event.origin !== appOrigin || !port) return;
    rendering = true;
    try {
      if (!(event.data instanceof Blob) || typeof window.docx?.renderAsync !== "function") throw new Error("DOCX unavailable");
      await window.docx.renderAsync(event.data, root, root, {
        className: "review-docx",
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderAltChunks: false,
        renderComments: false,
        useBase64URL: true,
      });
      const pages = [...root.querySelectorAll("section.review-docx")];
      if (!pages.some((page) => page.textContent.trim() || page.querySelector("img, svg"))) throw new Error("DOCX empty");
      for (const link of root.querySelectorAll("a")) link.removeAttribute("href");
      fitPages();
      port.postMessage({ ready: true });
    } catch {
      root.replaceChildren();
      port.postMessage({ ready: false });
    } finally {
      port.close();
    }
  });
})();
