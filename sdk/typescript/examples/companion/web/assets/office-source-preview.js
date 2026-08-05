"use strict";

(() => {
  const DATABASE_NAME = "clownfish-office-sources-v1";
  const STORE_NAME = "sources";
  let activeObjectUrl = "";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开原文件存储"));
    });
  }

  async function withStore(mode, action) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("原文件存储失败"));
        transaction.onabort = () => reject(transaction.error || new Error("原文件存储已中止"));
      });
    } finally {
      database.close();
    }
  }

  async function save(documentId, file) {
    if (!documentId || !(file instanceof Blob)) return false;
    await withStore("readwrite", (store) => store.put({
      documentId,
      blob: file,
      name: String(file.name || "原文件"),
      type: String(file.type || "application/octet-stream"),
      savedAt: new Date().toISOString(),
    }));
    return true;
  }

  async function get(documentId) {
    if (!documentId) return null;
    return (await withStore("readonly", (store) => store.get(documentId))) || null;
  }

  async function remove(documentId) {
    if (!documentId) return;
    await withStore("readwrite", (store) => store.delete(documentId));
  }

  function release() {
    if (!activeObjectUrl) return;
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function sourceHeading(current, record, sourceUrl) {
    const notice = record
      ? current.kind === "pdf"
        ? "正在显示原始 PDF，页面、图片和排版均保留。"
        : "原文件已保留在本机；页面按可读取结构展示，可随时打开原文件核对完整格式。"
      : "这份旧工作副本没有保留原文件。重新打开文件后，可查看原始版式。";
    const action = sourceUrl
      ? `<a class="source-original-link" href="${sourceUrl}" download="${escapeHtml(record.name || current.name)}">打开原文件</a>`
      : "";
    return `<header class="source-preview-heading"><div><strong>${current.kind === "pdf" && record ? "原始版式" : "文件预览"}</strong><span>${escapeHtml(notice)}</span></div>${action}</header>`;
  }

  function renderPdf(current, record, sourceUrl) {
    if (record && sourceUrl) {
      return `<section class="source-preview-shell is-pdf">${sourceHeading(current, record, sourceUrl)}<iframe class="source-pdf-frame" src="${sourceUrl}#view=FitH&toolbar=1" title="${escapeHtml(current.name)} 原始 PDF"></iframe></section>`;
    }
    return `<section class="source-preview-shell">${sourceHeading(current, record, sourceUrl)}<div class="page-preview-list">${current.blocks.map((block, index) => `<article class="page-preview"><span>${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.text)}</p></article>`).join("")}</div></section>`;
  }

  function renderSlides(current, record, sourceUrl) {
    const slides = current.blocks.map((block, index) => {
      const lines = String(block.text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 10);
      return `<article class="slide-preview"><span class="slide-preview-number">${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(block.title)}</h2><div>${lines.map((line) => `<p>${escapeHtml(line.replace(/^[-*•]\s*/, ""))}</p>`).join("") || "<p>此页没有可提取的文字。</p>"}</div></article>`;
    }).join("");
    return `<section class="source-preview-shell">${sourceHeading(current, record, sourceUrl)}<div class="slide-preview-list">${slides}</div></section>`;
  }

  function columnNumber(reference) {
    let value = 0;
    for (const character of reference) value = value * 26 + character.charCodeAt(0) - 64;
    return value - 1;
  }

  function columnLabel(index) {
    let value = index + 1;
    let label = "";
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  }

  function sheetTable(block) {
    const cells = new Map();
    let maxRow = 0;
    let maxColumn = 0;
    for (const line of String(block.text || "").split(/\n+/).slice(0, 120)) {
      for (const item of line.split(/\s*\|\s*/)) {
        const match = item.match(/^([A-Z]+)(\d+):\s*([\s\S]*)$/i);
        if (!match) continue;
        const row = Math.max(0, Number(match[2]) - 1);
        const column = Math.max(0, columnNumber(match[1].toUpperCase()));
        if (row > 79 || column > 23) continue;
        cells.set(`${row}:${column}`, match[3]);
        maxRow = Math.max(maxRow, row);
        maxColumn = Math.max(maxColumn, column);
      }
    }
    if (!cells.size) {
      const rows = String(block.text || "").split(/\n+/).filter(Boolean).slice(0, 80);
      return `<table><tbody>${rows.map((row, index) => `<tr><th>${index + 1}</th><td>${escapeHtml(row)}</td></tr>`).join("")}</tbody></table>`;
    }
    const columns = Array.from({ length: maxColumn + 1 }, (_, index) => `<th>${columnLabel(index)}</th>`).join("");
    const rows = Array.from({ length: maxRow + 1 }, (_, row) => `<tr><th>${row + 1}</th>${Array.from({ length: maxColumn + 1 }, (_, column) => `<td>${escapeHtml(cells.get(`${row}:${column}`) || "")}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr><th></th>${columns}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderWorkbook(current, record, sourceUrl) {
    return `<section class="source-preview-shell">${sourceHeading(current, record, sourceUrl)}<div class="sheet-preview-list">${current.blocks.map((block) => `<article class="sheet-preview"><h2>${escapeHtml(block.title)}</h2><div class="sheet-table-wrap">${sheetTable(block)}</div></article>`).join("")}</div></section>`;
  }

  function renderDocument(current, record, sourceUrl) {
    const pages = [];
    for (let index = 0; index < current.blocks.length; index += 12) pages.push(current.blocks.slice(index, index + 12));
    return `<section class="source-preview-shell">${sourceHeading(current, record, sourceUrl)}<div class="word-preview-list">${pages.map((blocks, pageIndex) => `<article class="word-preview"><span class="word-preview-number">${pageIndex + 1}</span>${blocks.map((block) => `<section><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.text)}</p></section>`).join("")}</article>`).join("")}</div></section>`;
  }

  async function render(root, current) {
    if (!root || !current) return;
    const renderToken = crypto.randomUUID();
    root.dataset.renderToken = renderToken;
    root.innerHTML = '<div class="source-preview-loading">正在读取原文件…</div>';
    release();
    let record = null;
    try {
      record = await get(current.id);
    } catch {
      record = null;
    }
    if (root.dataset.renderToken !== renderToken) return;
    const sourceUrl = record?.blob instanceof Blob ? URL.createObjectURL(record.blob) : "";
    activeObjectUrl = sourceUrl;
    if (current.kind === "pdf") root.innerHTML = renderPdf(current, record, sourceUrl);
    else if (current.kind === "pptx") root.innerHTML = renderSlides(current, record, sourceUrl);
    else if (current.kind === "xlsx") root.innerHTML = renderWorkbook(current, record, sourceUrl);
    else root.innerHTML = renderDocument(current, record, sourceUrl);
  }

  window.ClownfishOfficeSource = Object.freeze({ save, get, remove, render, release });
})();
