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

class FakeElement {
  hidden = false;
  disabled = false;
  open = false;
  isConnected = true;
  textContent = "";
  href = "";
  download = "";
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  listeners = new Map<string, (event?: { target: FakeElement }) => void>();
  classList = { toggle() {} };
  constructor(readonly focused: (node: FakeElement) => void, readonly clicked?: (node: FakeElement) => void) {}
  addEventListener(type: string, listener: (event?: { target: FakeElement }) => void) { this.listeners.set(type, listener); }
  emit(type: string, target: FakeElement = this) { this.listeners.get(type)?.({ target }); }
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

function harness(fetchHandler: (path: string, opts: RequestInit) => Promise<Response> | Response) {
  const ids = new Map<string, FakeElement>();
  const urls = new Map<string, Blob>();
  const revoked: string[] = [];
  const downloads: Array<{ href: string; filename: string; blob?: Blob }> = [];
  const requests: Array<{ path: string; opts: RequestInit }> = [];
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
    document, URLSearchParams, AbortController, Blob, crypto: webcrypto, TextDecoder,
    URL: {
      createObjectURL(blob: Blob) { const url = `blob:${++counter}`; urls.set(url, blob); return url; },
      revokeObjectURL(url: string) { urls.delete(url); revoked.push(url); },
    },
    setTimeout: (callback: () => void) => callback(),
    fetch: async (path: string, opts: RequestInit) => { requests.push({ path, opts }); return fetchHandler(path, opts); },
  });
  return { get, open, trigger, requests, downloads, revoked, focused: () => active };
}

async function until(condition: () => unknown) {
  for (let i = 0; !condition() && i < 200; i++) await delay(5);
  assert.ok(condition(), "review mode did not reach the expected state");
}

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
  assert.deepEqual(JSON.parse(String(view.requests[2].opts.body)), { id: info.artifactId, sha256: info.sha256, byteLength: info.byteLength });
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
