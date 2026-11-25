import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const asset = readFileSync("examples/companion/web/assets/chat-project-progress.js", "utf8");
const now = "2026-11-24T09:14:00.000Z";
const markup = "<img src=x onerror=alert(1)>";
const sample = {
  ok: true,
  version: 1,
  capturedAt: now,
  space: { id: "space-a", title: markup, status: "active", description: "exclude full description" },
  counts: { tasks: 5, materials: 2, artifacts: 1 },
  tasks: [
    { id: "task-a", title: "等待标题", status: "waiting", updatedAt: now, instruction: "exclude instructions" },
    { id: "task-b", title: "进行标题", status: "active", updatedAt: now },
    { id: "task-c", title: "归档标题", status: "completed", updatedAt: now, archivedAt: now },
  ],
  artifacts: [{ id: "artifact-a", title: "报告", format: "pdf", createdAt: now, file: "exclude path" }],
  nextAction: { taskId: "task-a", text: "安排下一步" },
  material: "exclude raw content",
};

type TestEvent = { preventDefault(): void };
type Scope = { conversationId: string };

class Element {
  className = "";
  classList = { add: (name: string) => { this.className = [this.className, name].filter(Boolean).join(" "); } };
  children: Element[] = [];
  textContent = "";
  href = "";
  target = "";
  rel = "";
  value = "";
  disabled = false;
  hidden = false;
  dateTime = "";
  attrs: Record<string, string> = {};
  listeners: Record<string, (event: TestEvent) => unknown> = {};

  constructor(readonly tag: string) {}
  get options() { return this.children; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addEventListener(name: string, listener: (event: TestEvent) => unknown) { this.listeners[name] = listener; }
  emit(name: string) { return this.listeners[name]?.({ preventDefault() {} }); }
  focus() {}
  findAll(tag: string): Element[] {
    return [...(this.tag === tag ? [this] : []), ...this.children.flatMap(child => child.findAll(tag))];
  }
}

class PickerDialog extends Element {
  open = false;
  nodes = new Map([
    ["form", new Element("form")],
    ["select", new Element("select")],
    ['[role="status"]', new Element("p")],
    ['[type="submit"]', new Element("button")],
    ["[data-retry-projects]", new Element("button")],
    ["[data-close-projects]", new Element("button")],
  ]);
  constructor() { super("dialog"); }
  querySelector(selector: string) { return this.nodes.get(selector)!; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
}

function renderer() {
  const window = {
    document: { createElement: (tag: string) => new Element(tag) },
    ClownfishChatProjectProgress: null as null | {
      snapshot: (value: unknown) => unknown;
      render: (container: Element, value: unknown, fallback?: string) => void;
      createPicker: (dialog: PickerDialog, options: {
        read(path: string): Promise<unknown>;
        current(scope: Scope): boolean;
        insert(scope: Scope, snapshot: typeof sample, summary: string): void;
        restoreFocus(): void;
      }) => { open(scope: Scope): void; closeIfStale(): void };
    },
  };
  runInNewContext(asset, { window, URLSearchParams });
  return window.ClownfishChatProjectProgress!;
}

test("project progress stores a bounded snapshot, with only fields used by the card", () => {
  const { snapshot } = renderer();
  const result = JSON.parse(JSON.stringify(snapshot(sample)));
  assert.doesNotMatch(JSON.stringify(result), /exclude|description|instruction|"ok"|"file"/);
  assert.deepEqual(result.counts, { tasks: 5, materials: 2, artifacts: 1 });
  assert.deepEqual(result.nextAction, { taskId: "task-a", text: "安排下一步" });
  assert.equal(result.tasks[2].archivedAt, now);
  assert.equal(result.space.title, markup);
  const limited = JSON.parse(JSON.stringify(snapshot({ ...sample, nextAction: { taskId: "task-a", text: "长".repeat(400) } })));
  assert.equal(limited.nextAction.text.length, 320);
});

test("invalid, oversized, and unsupported project snapshots fail validation", () => {
  const { snapshot } = renderer();
  for (const invalid of [
    { ...sample, version: 2 },
    { ...sample, capturedAt: "invalid" },
    { ...sample, space: { ...sample.space, id: "space\nname" } },
    { ...sample, tasks: [...sample.tasks, sample.tasks[0]] },
    { ...sample, artifacts: [...sample.artifacts, ...sample.artifacts, ...sample.artifacts] },
    { ...sample, counts: { ...sample.counts, tasks: -1 } },
    { ...sample, nextAction: { taskId: "task-a", text: "" } },
    { ...sample, space: { ...sample.space, status: "archived" } },
  ]) assert.equal(snapshot(invalid), null);
  assert.ok(snapshot({
    ...sample, space: { ...sample.space, status: "archived" },
    tasks: [], artifacts: [], nextAction: null, counts: { tasks: 0, materials: 0, artifacts: 0 },
  }));
});

test("the native card uses text and same-origin links, and filters only its captured tasks", () => {
  const { render } = renderer();
  const bubble = new Element("div");
  render(bubble, sample);
  assert.equal(bubble.findAll("h3")[0].textContent, markup);
  assert.equal(bubble.findAll("img").length, 0);
  assert.equal(bubble.findAll("time")[0].dateTime, now);
  assert.deepEqual(bubble.findAll("a").map(link => link.href), [
    "/spaces?space=space-a",
    "/tasks?space=space-a&task=task-a",
    "/tasks?space=space-a&task=task-a",
    "/tasks?space=space-a&task=task-b",
    "/tasks?space=space-a&task=task-c",
    "/api/capabilities/artifact/preview?id=artifact-a",
  ]);
  const artifactLink = bubble.findAll("a").at(-1)!;
  assert.equal(artifactLink.target, "_blank");
  assert.equal(artifactLink.rel, "noopener");
  const filter = bubble.findAll("select")[0];
  assert.deepEqual(filter.options.map(option => option.value), ["", "waiting", "active", "archived"]);
  filter.value = "archived";
  filter.emit("change");
  assert.deepEqual(bubble.findAll("a").map(link => link.textContent), ["查看项目", "安排下一步", "归档标题", "报告"]);
  assert.deepEqual(bubble.findAll("dd").map(node => node.textContent), ["5", "2", "1"]);
  const encoded = new Element("div");
  render(encoded, { ...sample, space: { ...sample.space, id: "项目&来源" } });
  assert.equal(encoded.findAll("a")[0].href, "/spaces?space=%E9%A1%B9%E7%9B%AE%26%E6%9D%A5%E6%BA%90");
});

test("legacy card rendering leaves an unsupported snapshot as non-interactive plain text", () => {
  const { render } = renderer();
  const bubble = new Element("div");
  render(bubble, { ...sample, version: 99 }, markup);
  assert.equal(bubble.findAll("p")[0].textContent, markup);
  assert.equal(bubble.findAll("a").length, 0);
  assert.equal(bubble.findAll("img").length, 0);
});

test("duplicate confirmation and a late response cannot insert into a different conversation", async () => {
  const { createPicker } = renderer();
  const dialog = new PickerDialog();
  const select = dialog.querySelector("select");
  const form = dialog.querySelector("form");
  const first = Promise.withResolvers<unknown>();
  const second = Promise.withResolvers<unknown>();
  const reads: string[] = [];
  const saved: Array<[string, string, string]> = [];
  let current = "first";
  let details = 0;
  const picker = createPicker(dialog, {
    async read(path) {
      reads.push(path);
      if (path === "/api/capabilities") {
        return { spaces: [sample.space, { ...sample.space, id: "space-b" }] };
      }
      return ++details === 1 ? first.promise : second.promise;
    },
    current: ({ conversationId }) => conversationId === current,
    insert: ({ conversationId }, card, text) => saved.push([conversationId, card.space.id, text]),
    restoreFocus() {},
  });
  picker.open({ conversationId: "first" });
  await setImmediate();
  assert.notEqual(select.options[1].textContent, select.options[2].textContent);
  select.value = "space-a";
  select.emit("change");
  const late = form.emit("submit");
  await form.emit("submit");
  assert.equal(details, 1);

  current = "second";
  picker.closeIfStale();
  picker.open({ conversationId: "second" });
  await setImmediate();
  select.value = "space-b";
  select.emit("change");
  const latest = form.emit("submit");
  first.resolve(sample);
  await late;
  assert.equal(dialog.open, true);
  assert.deepEqual(saved, []);
  second.resolve({ ...sample, space: { ...sample.space, id: "space-b" } });
  await latest;

  assert.equal(dialog.open, false);
  assert.deepEqual(reads, [
    "/api/capabilities",
    "/api/capabilities/space?id=space-a&view=chat-progress",
    "/api/capabilities",
    "/api/capabilities/space?id=space-b&view=chat-progress",
  ]);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].slice(0, 2), ["second", "space-b"]);
  assert.match(saved[0][2], /项目进展[\s\S]*安排下一步/);
});
