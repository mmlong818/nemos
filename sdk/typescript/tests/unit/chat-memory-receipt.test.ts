import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { memoryTurnReceipt, userMemoryPrompt, type UserMemoryEvidence } from "../../examples/companion/memory-evidence.js";

function records(count: number): UserMemoryEvidence[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `memory-${i}`, content: `private text ${i}`, layer: "personal_semantic", confidence: "high",
    contentTruncated: false, contentIsExcerpt: true, source: { source_message_id: "private-source" },
  } as UserMemoryEvidence));
}

test("receipt references exactly the bounded model block and never duplicates memory text", () => {
  const context = { userFacts: "", memoryEvidence: records(15) };
  const receipt = memoryTurnReceipt(context)!;
  const prompt = JSON.parse(userMemoryPrompt(context).match(/<user_memory_evidence>(.*?)<\/user_memory_evidence>/s)![1]);
  assert.deepEqual(receipt.records.map(x => x.id), prompt.map((x: UserMemoryEvidence) => x.id));
  assert.equal(receipt.records.length, 12);
  assert.doesNotMatch(JSON.stringify(receipt), /private text|private-source|content"/);
  context.memoryEvidence[0].id = "changed";
  assert.equal(receipt.records[0].id, "memory-0");
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receipt, "existing chat JSON persistence preserves references");
});

test("legacy, empty and disabled contexts are distinct", () => {
  assert.equal(memoryTurnReceipt({}), undefined);
  assert.deepEqual(memoryTurnReceipt({ memoryEvidence: [] })?.records, []);
  assert.equal(memoryTurnReceipt({ memoryEvidence: [], memoryMode: "off" })?.mode, "off");
  assert.equal(memoryTurnReceipt({ memoryEvidence: records(1), memoryMode: "preferences" })?.mode, "preferences");
});

class Element {
  children: Element[] = [];
  textContent = "";
  href = "";
  className = "";
  open = false;
  isConnected = true;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners: Array<() => void> = [];
  onclick?: () => void;
  constructor(public tag: string) {}
  appendChild(child: Element) { this.children.push(child); return child; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(event: string, listener: () => void) { if (event === "toggle") this.listeners.push(listener); }
  toggle(open: boolean) { this.open = open; this.listeners.forEach(listener => listener()); }
  focus() {}
  text(): string { return [this.textContent, ...this.children.map(child => child.text())].join(" "); }
}

type FetchStub = (url: string, options: { cache: string; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function renderer(fetch: FetchStub = async () => { throw new Error("unexpected request"); }) {
  const window: any = {};
  runInNewContext(readFileSync(join(__dirname, "../../examples/companion/web/assets/chat-memory-evidence.js"), "utf8"), {
    window, fetch, AbortController, document: { createElement: (tag: string) => new Element(tag) },
  });
  return window.ClownfishChatMemoryEvidence.append as (root: Element, receipt: unknown) => void;
}

test("opening one record makes one uncached request and renders source text and a safe management link", async () => {
  const root = new Element("div");
  const receipt = memoryTurnReceipt({ memoryEvidence: records(1) })!;
  const id = receipt.records[0].id = "a&b/<script>";
  const calls: string[] = [];
  const append = renderer(async (url, options) => {
    calls.push(url);
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ status: "active", fact: { id, content: "当前正文", source: { excerpt: "<script>plain source text</script>" } } }) };
  });
  append(root, receipt);
  const box = root.children[0];
  assert.equal(box.tag, "details");
  assert.match(root.text(), /回复开始前载入的个人记忆/);
  assert.match(root.text(), /范围不含后续工具查询或对话历史/);
  assert.doesNotMatch(root.text(), /private text/);
  assert.deepEqual(calls, []);
  box.toggle(true);
  assert.deepEqual(calls, []);
  const row = box.children.find(node => node.className === "chat-memory-item")!;
  row.toggle(true);
  row.toggle(true);
  await flush();
  assert.deepEqual(calls, ["/api/memory/item?id=a%26b%2F%3Cscript%3E"]);
  const body = row.children[1];
  assert.equal(body.dataset.memoryDetailState, "active");
  assert.equal(body.children.find(x => x.tag === "blockquote")?.textContent, "来源摘录：<script>plain source text</script>");
  assert.equal(body.children.find(x => x.tag === "a")?.href, "/memory?memoryId=a%26b%2F%3Cscript%3E");
  box.toggle(false);
  assert.equal(row.open, false);
  assert.doesNotMatch(row.text(), /当前正文|plain source text/);
});

test("closing and reopening a row skips the late response and reads its current state", async () => {
  const root = new Element("div");
  let settleOld!: (value: { ok: boolean; json(): Promise<unknown> }) => void;
  let oldSignal!: AbortSignal;
  let calls = 0;
  const append = renderer(async (_url, { signal }) => {
    if (++calls === 2) return { ok: true, json: async () => ({ status: "inactive" }) };
    oldSignal = signal;
    return new Promise(resolve => { settleOld = resolve; });
  });
  append(root, memoryTurnReceipt({ memoryEvidence: records(1) }));
  const box = root.children[0], row = box.children.find(node => node.className === "chat-memory-item")!;
  box.toggle(true);
  row.toggle(true);
  row.toggle(false);
  assert.equal(oldSignal.aborted, true);
  row.toggle(true);
  await flush();
  settleOld({ ok: true, json: async () => ({ status: "active", fact: { id: "memory-0", content: "旧正文不应出现" } }) });
  await flush();
  assert.equal(row.children[1].dataset.memoryDetailState, "inactive");
  assert.doesNotMatch(row.text(), /旧正文不应出现/);
  assert.equal(calls, 2);
});

test("a temporary failure can be retried without fetching another record", async () => {
  const root = new Element("div");
  const urls: string[] = [];
  const append = renderer(async url => {
    urls.push(url);
    return { ok: urls.length > 1, json: async () => ({ status: "unavailable" }) };
  });
  append(root, memoryTurnReceipt({ memoryEvidence: records(2) }));
  const box = root.children[0], [first, second] = box.children.filter(node => node.className === "chat-memory-item");
  box.toggle(true);
  first.toggle(true);
  await flush();
  const body = first.children[1];
  assert.equal(body.dataset.memoryDetailState, "error");
  body.children.find(node => node.tag === "button")?.onclick?.();
  await flush();
  assert.deepEqual(urls, ["/api/memory/item?id=memory-0", "/api/memory/item?id=memory-0"]);
  assert.equal(body.dataset.memoryDetailState, "unavailable");
  assert.equal(second.children[1].dataset.memoryDetailState, undefined);
});

test("legacy messages do not fabricate recall; disabled differs from empty", () => {
  const append = renderer();
  const legacy = new Element("div"); append(legacy, undefined);
  assert.match(legacy.text(), /未记录/);
  assert.match(legacy.text(), /不能从当前记忆反推/);
  const off = new Element("div"); append(off, memoryTurnReceipt({ memoryEvidence: [], memoryMode: "off" }));
  assert.match(off.text(), /已关闭/);
  const empty = new Element("div"); append(empty, memoryTurnReceipt({ memoryEvidence: [] }));
  assert.match(empty.text(), /没有提供可用/);
  const local = new Element("div"); append(local, memoryTurnReceipt({ memoryEvidence: records(1) }, "local"));
  assert.match(local.text(), /在本地生成/);
  const earlier = new Element("div"); append(earlier, null);
  assert.equal(earlier.children.length, 0);
});
