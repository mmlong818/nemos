import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const source = readFileSync("examples/companion/web/assets/office-version-review.js", "utf8");
const endpoint = "/api/files/workbench/review";
const versionA = { id: "history-A", name: "版本 1", documentName: "A 历史名称" };
const resultA = { ok: true, artifactId: "exact A & output", filename: "A 历史名称.docx", format: "docx" };
const draftB = {
  id: "document-A", name: "B 当前名称", blocks: [{ text: "B 尚在编辑" }],
  versions: [versionA, { id: "legacy", name: "自动保存" }],
};

type Api = (path: string, options: RequestInit) => Promise<unknown> | unknown;

class Element {
  hidden = false;
  disabled = false;
  open = false;
  href = "";
  textContent = "";
  isConnected = true;
  dataset: Record<string, string> = {};
  classList = { toggle() {} };
  private listeners = new Map<string, () => void>();
  constructor(readonly focused: (element: Element) => void) {}
  addEventListener(name: string, handler: () => void) { this.listeners.set(name, handler); }
  click() { this.listeners.get("click")?.(); }
  close() { this.open = false; this.listeners.get("close")?.(); }
  showModal() { this.open = true; }
  removeAttribute() { this.href = ""; }
  focus() { if (!this.disabled && !this.hidden) this.focused(this); }
}

function harness(handle: Api, { wait = Promise.resolve(), conflict = false } = {}) {
  const ids = new Map<string, Element>();
  const calls: Array<{ path: string; options: RequestInit }> = [];
  let active: Element;
  const create = () => new Element((element) => { active = element; });
  const get = (id: string) => {
    if (!ids.has(id)) ids.set(id, create());
    return ids.get(id)!;
  };
  const word = create();
  const slides = create();
  const trigger = create();
  word.dataset.officeReviewFormat = "docx";
  slides.dataset.officeReviewFormat = "pptx";
  trigger.dataset.generateVersion = versionA.id;
  const dialog = Object.assign(get("#officeVersionReviewDialog"), { querySelectorAll: () => [word, slides] });
  const document = { querySelector: get, querySelectorAll: () => [] };
  const window = {} as { ClownfishOfficeVersionReview: { bind(input: object): { open(versionId: string, trigger: Element): void } } };
  const state = { revision: 4, document: structuredClone(draftB) };
  runInNewContext(source, { window, document, AbortController, URLSearchParams });
  const { open } = window.ClownfishOfficeVersionReview.bind({
    api: (path: string, options: RequestInit) => { calls.push({ path, options }); return handle(path, options); },
    currentDocument: () => state.document, saveQueue: () => wait, revision: () => state.revision,
    hasSaveConflict: () => conflict,
  });
  return { dialog, get, calls, state, word, slides, trigger, open, focused: () => active };
}

async function until(check: () => unknown) {
  for (let index = 0; !check() && index < 200; index++) await delay(5);
  assert.ok(check(), "the review interface did not reach the expected state");
}

test("generating saved A while B is open sends only the persisted identity and opens the exact result", async () => {
  let afterSave!: () => void;
  const wait = new Promise<void>((resolve) => { afterSave = resolve; });
  const view = harness((path) => path === endpoint ? resultA : { pptxReviewAvailable: true }, { wait });
  view.open(versionA.id, view.trigger);
  assert.match(view.get("#officeVersionReviewSelection").textContent, /A 历史名称/);
  view.word.click();
  view.word.click();
  assert.equal(view.calls.filter(({ path }) => path === endpoint).length, 0);
  view.state.revision = 5;
  afterSave();
  const resultLink = view.get("#openOfficeVersionReview");
  await until(() => !resultLink.hidden);
  const calls = view.calls.filter(({ path }) => path === endpoint);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    documentId: draftB.id, versionId: versionA.id, format: "docx", expectedRevision: 5,
  });
  assert.equal(new URL(resultLink.href, "http://localhost").searchParams.get("review"), resultA.artifactId);
  assert.equal(view.focused(), resultLink);
  assert.deepEqual(view.state.document, draftB);
  view.dialog.close();
  assert.equal(view.focused(), view.trigger);
});

test("a settled save queue cannot bypass a missing saved version, and a legacy name is explicit", async () => {
  const view = harness((path) => {
    if (path === endpoint) throw Object.assign(new Error("missing"), { status: 404 });
    return { pptxReviewAvailable: false };
  });
  view.open("legacy", view.trigger);
  assert.match(view.get("#officeVersionReviewLegacyName").textContent, /版本标签「自动保存」/);
  assert.doesNotMatch(view.get("#officeVersionReviewSelection").textContent, /B 当前名称/);
  view.word.click();
  await until(() => /尚未同步/.test(view.get("#officeVersionReviewStatus").textContent));
  assert.equal(view.get("#openOfficeVersionReview").hidden, true);
  assert.equal(view.word.disabled, false);
  assert.equal(view.slides.disabled, true);
  assert.deepEqual(view.state.document, draftB);
});

test("a save conflict or a stale cross-document result cannot present an artifact link", async () => {
  const conflict = harness(() => ({}), { conflict: true });
  conflict.open(versionA.id, conflict.trigger);
  conflict.word.click();
  await until(() => /另一个窗口/.test(conflict.get("#officeVersionReviewStatus").textContent));
  assert.equal(conflict.calls.filter(({ path }) => path === endpoint).length, 0);

  let finish!: (result: object) => void;
  const response = new Promise<object>((resolve) => { finish = resolve; });
  const view = harness((path) => path === endpoint ? response : { pptxReviewAvailable: true });
  view.open(versionA.id, view.trigger);
  await until(() => !view.slides.disabled);
  view.slides.click();
  await until(() => view.calls.some(({ path }) => path === endpoint));
  view.state.document = { ...view.state.document, id: "new-document" };
  finish({ ...resultA, format: "pptx", filename: "old.pptx" });
  await until(() => !view.dialog.open);
  assert.equal(view.get("#openOfficeVersionReview").hidden, true);
  assert.equal(view.calls.find(({ path }) => path === endpoint)?.options.signal?.aborted, true);
});
