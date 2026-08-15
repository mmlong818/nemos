"use strict";

(() => {
  function bind(options) {
    const dialog = document.querySelector(options.dialog);
    const trigger = document.querySelector(options.trigger);
    const input = document.querySelector(options.input);
    const close = document.querySelector(options.close);
    if (!dialog || !trigger || !input || !close) return null;

    const render = () => options.render(String(input.value || "").trim());
    const open = () => {
      if (!dialog.open) dialog.showModal();
      trigger.setAttribute("aria-expanded", "true");
      render();
      requestAnimationFrame(() => input.focus());
    };
    const dismiss = () => {
      if (dialog.open) dialog.close();
    };

    trigger.addEventListener("click", open);
    close.addEventListener("click", dismiss);
    input.addEventListener("input", render);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dismiss();
    });
    dialog.addEventListener("close", () => {
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus({ preventScroll: true });
    });

    return { open, close: dismiss, refresh: render };
  }

  window.AppSearchOverlay = Object.freeze({ bind });
})();
