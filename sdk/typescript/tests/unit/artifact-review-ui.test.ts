import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const script = readFileSync("examples/companion/web/assets/artifact-review.js", "utf8");
const receiptPath = "/api/capabilities/artifact/review";
const pdfBytes = new TextEncoder().encode("%PDF-1.7\nmock content");
const info = {
  artifactId: "report & A", title: "项目交付", filename: "报告.pdf", format: "pdf", version: 3,
  sha256: createHash("sha256").update(pdfBytes).digest("hex"), byteLength: pdfBytes.length,
};
const review = { reviewId: "receipt-1", ...info, reviewedAt: "2026-11-19T12:00:00.000Z" };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const pdf = (bytes = pdfBytes) => new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
const docxBytes = Uint8Array.of(0x50, 0x4b, 3, 4, 5, 6);
const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const docxInfo = {
  ...info,
  artifactId: "report B",
  filename: "报告.docx",
  format: "docx",
  sha256: createHash("sha256").update(docxBytes).digest("hex"),
  byteLength: docxBytes.length,
};
const docxReview = { ...review, ...docxInfo, reviewId: "receipt-2" };
const docx = (bytes = docxBytes) => new Response(bytes, { headers: { "Content-Type": docxType } });
const pptxBytes = Uint8Array.of(0x50, 0x4b, 3, 4, 7, 8, 9);
const pptxType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const pptxIdentity = {
  id: "report C",
  format: "pptx",
  sha256: createHash("sha256").update(pptxBytes).digest("hex"),
  byteLength: pptxBytes.length,
};
const slides = { sha256: info.sha256, byteLength: info.byteLength, pages: 2 };
const pptxInfo = { ...review, ...pptxIdentity, artifactId: pptxIdentity.id, filename: "报告.pptx", preview: slides };
const pptxReview = { ...pptxInfo, reviewId: "receipt-3" };
const pptx = () => new Response(pptxBytes, { headers: { "Content-Type": pptxType } });

class FakeElement {
  hidden = false;
  disabled = false;
  open = false;
  isConnected = true;
  textContent = "";
  href = "";
  download = "";
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  contentWindow = {
    postMessage: (blob: Blob, origin: string, [port]: MessagePort[]) => {
      this.frameMessage = { blob, origin, port };
    },
  };
  frameMessage?: { blob: Blob; origin: string; port: MessagePort };
  children: FakeElement[] = [];
  listeners = new Map<string, (event?: { target: FakeElement }) => void>();
  classList = { toggle() {} };
  constructor(readonly focused: (node: FakeElement) => void, readonly clicked?: (node: FakeElement) => void) {}
  addEventListener(type: string, listener: (event?: { target: FakeElement }) => void) { this.listeners.set(type, listener); }
  emit(type: string, target: FakeElement = this) { this.listeners.get(type)?.({ target }); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  removeAttribute(key: "href") { this[key] = ""; }
  replaceChildren(...nodes: FakeElement[]) { this.children = nodes; }
  append(node: FakeElement) { this.children.push(node); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
  focus() { if (!this.disabled) this.focused(this); }
  click() { this.clicked?.(this); this.emit("click"); }
  remove() {}
  closest() { return this; }
}

function harness(fetchHandler: (path: string, opts: RequestInit) => Promise<Response> | Response, initialUrl = "/artifacts") {
  const ids = new Map<string, FakeElement>();
  const urls = new Map<string, Blob>();
  const revoked: string[] = [];
  const downloads: Array<{ href: string; filename: string; blob?: Blob }> = [];
  const requests: Array<{ path: string; opts: RequestInit }> = [];
  const location = new URL(initialUrl, "http://localhost");
  const urlUpdates: string[] = [];
  let active: FakeElement | undefined;
  let counter = 0;
  const create = () => new FakeElement((node) => { active = node; }, (node) => {
    if (node.download) downloads.push({ href: node.href, filename: node.download, blob: urls.get(node.href) });
  });
  const get = (id: string) => {
    if (!ids.has(id)) ids.set(id, create());
    return ids.get(id)!;
  };
  const document = Object.assign(create(), {
    getElementById: get,
    createElement: create,
    querySelectorAll: () => [],
  });
  const trigger = create();
  function open(id = info.artifactId) {
    trigger.dataset.reviewArtifact = id;
    document.emit("click", trigger);
  }
  runInNewContext(script, {
    document, location, URLSearchParams, AbortController, Blob, MessageChannel, crypto: webcrypto, TextDecoder,
    history: { replaceState(_state: unknown, _title: string, href: string) {
      urlUpdates.push(href);
      location.href = new URL(href, location.origin).href;
    } },
    URL: {
      createObjectURL(blob: Blob) { const url = `blob:${++counter}`; urls.set(url, blob); return url; },
      revokeObjectURL(url: string) { urls.delete(url); revoked.push(url); },
    },
    setTimeout: (callback: () => void, ms: number) => { if (ms === 1_000) callback(); },
    clearTimeout() {},
    fetch: async (path: string, opts: RequestInit) => { requests.push({ path, opts }); return fetchHandler(path, opts); },
  });
  return { get, open, trigger, requests, downloads, revoked, urlUpdates, focused: () => active };
}

async function until(condition: () => unknown) {
  for (let i = 0; !condition() && i < 200; i++) await delay(5);
  assert.ok(condition(), "review mode did not reach the expected state");
}

test("saved-version artifact links open the exact review without a file-list row", async () => {
  const url = "/artifacts?" + new URLSearchParams({ kind: "artifact", review: info.artifactId }) + "#files";
  const view = harness((path) => path.includes("/preview?") ? pdf() : json({ ...info, review: null }), url);
  await until(() => view.get("artifactReviewPreview").children.length);
  assert.equal(view.get("artifactReviewDialog").open, true);
  assert.equal(view.requests[0].path, receiptPath + "?" + new URLSearchParams({ id: info.artifactId }));
  assert.equal(view.requests.length, 2);
  assert.equal(view.requests.some(({ opts }) => opts.method === "POST"), false);
  view.get("closeArtifactReview").click();
  assert.deepEqual(view.urlUpdates, ["/artifacts?kind=artifact#files"]);
  assert.equal(view.focused(), view.get("workSearchToggle"));
});

test("review confirmation and export use the exact verified preview fingerprint and receipt", async () => {
  const view = harness((path, opts) => {
    if (opts.method === "POST") return json({ review });
    if (path.startsWith(`${receiptPath}/`)) return pdf();
    return json({ ...info, review: null });
  });
  const confirm = view.get("artifactReviewConfirm");
  const exportButton = view.get("artifactReviewExport");
  view.open();
  await until(() => view.get("artifactReviewPreview").children.length === 1);
  assert.equal(confirm.disabled, true);
  confirm.click();
  assert.equal(view.requests.length, 2);
  assert.match(view.requests[1].path, new RegExp(`sha256=${info.sha256}&byteLength=${pdfBytes.length}$`));
  view.get("artifactReviewPreview").children[0].emit("load");
  assert.equal(confirm.disabled, false);
  confirm.click();
  await until(() => !exportButton.hidden && !exportButton.disabled);
  assert.equal(view.focused(), exportButton);
  assert.deepEqual(JSON.parse(String(view.requests[2].opts.body)), { id: info.artifactId, format: "pdf", sha256: info.sha256, byteLength: info.byteLength });
  assert.equal(confirm.hidden, true);
  exportButton.click();
  await until(() => view.downloads.length);
  assert.equal(view.requests[3].path, `${receiptPath}/export?reviewId=receipt-1`);
  assert.equal(view.downloads[0].filename, info.filename);
  assert.deepEqual(new Uint8Array(await view.downloads[0].blob!.arrayBuffer()), pdfBytes);
  view.get("closeArtifactReview").click();
  assert.deepEqual(view.revoked.sort(), ["blob:1", "blob:2"]);
  assert.equal(view.focused(), view.trigger);
});

test("HTML and mismatched same-length PDF responses cannot unlock approval", async () => {
  const otherBytes = pdfBytes.map((byte, index) => index === pdfBytes.length - 1 ? byte ^ 1 : byte);
  for (const badPreview of [new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } }), pdf(otherBytes)]) {
    const view = harness((path) => path.includes("/preview?") ? badPreview : json({ ...info, review: null }));
    view.open();
    await until(() => !view.get("artifactReviewRetry").hidden);
    assert.match(view.get("artifactReviewStatus").textContent, /不是 PDF|指纹已变化/);
    assert.equal(view.get("artifactReviewConfirm").disabled, true);
    assert.equal(view.get("artifactReviewPreview").children.length, 0);
    view.get("artifactReviewConfirm").click();
    assert.equal(view.requests.length, 2);
  }
});

test("a stale response from a closed review cannot replace the next artifact", async () => {
  let completeFirst: (value: Response) => void = () => {};
  const view = harness((path) => {
    if (path.includes("id=old")) return new Promise((resolve) => { completeFirst = resolve; });
    if (path.includes("/preview?")) return pdf();
    return json({ ...info, review: null });
  });
  view.open("old");
  assert.equal(view.requests.length, 1);
  view.get("closeArtifactReview").click();
  assert.equal(view.requests[0].opts.signal?.aborted, true);
  view.open();
  await until(() => view.get("artifactReviewPreview").children.length === 1);
  completeFirst(json({ ...info, artifactId: "old", title: "stale title", review: null }));
  await delay(5);
  assert.equal(view.get("artifactReviewTitle").textContent, info.title);
  assert.equal(view.requests.length, 3);
});

test("a persisted receipt unlocks the reviewed export, whose failure never downloads the original", async () => {
  const view = harness((path) => {
    if (path.includes("/export?")) return json({ error: "原件已变化" }, 409);
    if (path.includes("/preview?")) return pdf();
    return json({ ...info, review });
  });
  view.open();
  await until(() => view.get("artifactReviewPreview").children.length === 1);
  view.get("artifactReviewPreview").children[0].emit("load");
  assert.equal(view.get("artifactReviewConfirm").hidden, true);
  const exportButton = view.get("artifactReviewExport");
  assert.equal(exportButton.disabled, false);
  exportButton.click();
  await until(() => !view.get("artifactReviewRetry").hidden);
  assert.equal(exportButton.disabled, true);
  assert.equal(view.downloads.length, 0);
  assert.equal(view.requests.filter(({ opts }) => opts.method === "POST").length, 0);
  assert.match(view.get("artifactReviewStatus").textContent, /原件已变化/);
});

test("DOCX sends the verified original to an isolated viewer and waits before confirming", async () => {
  const view = harness((path, opts) => {
    if (opts.method === "POST") return json({ review: docxReview });
    if (path.startsWith(`${receiptPath}/`)) return docx();
    return json({ ...docxInfo, review: null });
  });
  const preview = view.get("artifactReviewPreview");
  const confirm = view.get("artifactReviewConfirm");
  view.open(docxInfo.artifactId);
  await until(() => preview.children.length);
  const frame = preview.children[0];
  assert.equal(frame.attributes.sandbox, "allow-scripts");
  frame.emit("load");
  assert.equal(view.get("artifactReviewOpen").hidden, true);
  assert.equal(confirm.disabled, true);
  assert.equal(frame.frameMessage?.blob.type, docxType);
  assert.deepEqual(new Uint8Array(await frame.frameMessage!.blob.arrayBuffer()), docxBytes);
  frame.frameMessage!.port.postMessage({ ready: true });
  frame.frameMessage!.port.close();
  await until(() => !confirm.disabled);
  confirm.click();
  const exportButton = view.get("artifactReviewExport");
  await until(() => !exportButton.hidden && !exportButton.disabled);
  assert.deepEqual(JSON.parse(String(view.requests[2].opts.body)), {
    id: docxInfo.artifactId, format: "docx", sha256: docxInfo.sha256, byteLength: docxInfo.byteLength,
  });
  exportButton.click();
  await until(() => view.downloads.length);
  assert.equal(view.requests[3].path, `${receiptPath}/export?reviewId=receipt-2`);
  assert.equal(view.downloads[0].filename, docxInfo.filename);
  assert.deepEqual(new Uint8Array(await view.downloads[0].blob!.arrayBuffer()), docxBytes);
});

test("a failed DOCX renderer disables confirmation and reloads the same review target", async () => {
  const view = harness((path) => path.includes("/preview?") ? docx() : json({ ...docxInfo, review: null }));
  const preview = view.get("artifactReviewPreview");
  const retry = view.get("artifactReviewRetry");
  view.open(docxInfo.artifactId);
  await until(() => preview.children.length);
  preview.children[0].emit("load");
  const port = preview.children[0].frameMessage!.port;
  port.postMessage({ ready: false });
  port.close();
  await until(() => !retry.hidden);
  assert.equal(view.get("artifactReviewConfirm").disabled, true);
  assert.equal(preview.children.length, 0);
  retry.click();
  await until(() => preview.children.length);
  assert.equal(view.requests[0].path, view.requests[2].path);
  assert.equal(view.requests[1].path, view.requests[3].path);
  assert.equal(view.requests.filter(({ opts }) => opts.method === "POST").length, 0);
});

test("an altered DOCX package or normal preview MIME cannot arm the reviewed format", async () => {
  const altered = docxBytes.map((byte, index) => index === docxBytes.length - 1 ? byte ^ 1 : byte);
  for (const response of [docx(altered), pdf()]) {
    const view = harness((path) => path.includes("/preview?") ? response : json({ ...docxInfo, review: null }));
    view.open(docxInfo.artifactId);
    await until(() => !view.get("artifactReviewRetry").hidden);
    assert.match(view.get("artifactReviewStatus").textContent, /不是 DOCX|指纹已变化/);
    assert.equal(view.get("artifactReviewConfirm").disabled, true);
    assert.equal(view.get("artifactReviewPreview").children.length, 0);
  }
});

test("PPTX prepares a version-bound PDF explicitly and reviewed export downloads the source package", async () => {
  const view = harness((path, opts) => {
    if (path.endsWith("/prepare")) return json({ preview: slides });
    if (opts.method === "POST") return json({ review: pptxReview });
    if (path.includes("/preview?")) return pdf();
    if (path.includes("/export?")) return pptx();
    return json({ ...pptxInfo, preview: null, review: null });
  });
  const prepare = view.get("artifactReviewPrepare");
  const confirm = view.get("artifactReviewConfirm");
  const preview = view.get("artifactReviewPreview");
  view.open(pptxIdentity.id);
  await until(() => !prepare.hidden && !prepare.disabled);
  assert.equal(view.requests.length, 1);
  assert.equal(confirm.hidden, true);
  assert.equal(confirm.disabled, true);
  assert.match(view.get("artifactReviewNote").textContent, /不含动画和演讲者备注/);
  prepare.click();
  await until(() => preview.children.length);
  assert.equal(view.requests[1].path, `${receiptPath}/prepare`);
  assert.deepEqual(JSON.parse(String(view.requests[1].opts.body)), pptxIdentity);
  assert.deepEqual(Object.fromEntries(new URL(view.requests[2].path, "http://localhost").searchParams), {
    id: pptxIdentity.id, format: "pptx", sha256: pptxIdentity.sha256, byteLength: String(pptxIdentity.byteLength),
    previewSha256: slides.sha256, previewByteLength: String(slides.byteLength),
  });
  assert.equal(confirm.disabled, true);
  preview.children[0].emit("load");
  assert.equal(confirm.disabled, false);
  assert.equal(view.focused(), confirm);
  confirm.click();
  const exportButton = view.get("artifactReviewExport");
  await until(() => !exportButton.hidden && !exportButton.disabled);
  assert.deepEqual(JSON.parse(String(view.requests[3].opts.body)), {
    ...pptxIdentity, previewSha256: slides.sha256, previewByteLength: slides.byteLength,
  });
  exportButton.click();
  await until(() => view.downloads.length);
  assert.equal(view.requests[4].path, `${receiptPath}/export?reviewId=receipt-3`);
  assert.equal(view.downloads[0].filename, pptxInfo.filename);
  assert.equal(view.downloads[0].blob?.type, pptxType);
  assert.deepEqual(new Uint8Array(await view.downloads[0].blob!.arrayBuffer()), pptxBytes);
});

test("a failed PPTX renderer allows explicit retry and does not open a placeholder", async () => {
  let prepared = false;
  const view = harness((path) => {
    if (path.endsWith("/prepare")) {
      if (!prepared) {
        prepared = true;
        return json({ error: "请先关闭 PowerPoint 再重试" }, 409);
      }
      return json({ preview: slides });
    }
    if (path.includes("/preview?")) return pdf();
    return json({ ...pptxInfo, preview: null, review: null });
  });
  view.open(pptxIdentity.id);
  const prepare = view.get("artifactReviewPrepare");
  await until(() => !prepare.hidden && !prepare.disabled);
  prepare.click();
  await until(() => /请先关闭 PowerPoint/.test(view.get("artifactReviewStatus").textContent));
  assert.equal(view.requests.length, 2);
  assert.equal(view.get("artifactReviewConfirm").disabled, true);
  assert.equal(view.get("artifactReviewPreview").children.length, 0);
  assert.equal(prepare.disabled, false);
  prepare.click();
  await until(() => view.get("artifactReviewPreview").children.length);
  assert.equal(view.requests.length, 4);
});

test("PPTX rejects mismatching slide bytes or a receipt linked to another rendering", async () => {
  const altered = pdfBytes.map((byte, index) => index === pdfBytes.length - 1 ? byte ^ 1 : byte);
  const cases = [
    { review: null, count: 2 },
    { review: { ...pptxReview, preview: { ...slides, sha256: "0".repeat(64) } }, count: 1 },
  ];
  for (const scenario of cases) {
    const view = harness((path) => path.includes("/preview?") ? pdf(altered) : json({ ...pptxInfo, review: scenario.review }));
    view.open(pptxIdentity.id);
    await until(() => !view.get("artifactReviewRetry").hidden);
    assert.equal(view.get("artifactReviewConfirm").disabled, true);
    assert.equal(view.get("artifactReviewPreview").children.length, 0);
    assert.equal(view.requests.length, scenario.count);
    assert.equal(view.requests.filter(({ opts }) => opts.method === "POST").length, 0);
  }
});
