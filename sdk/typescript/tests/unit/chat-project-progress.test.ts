import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const asset = readFileSync("examples/companion/web/assets/chat-project-progress.js", "utf8");
const chatPage = readFileSync("examples/companion/web/index.html", "utf8");
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
      parseProgressQuery: (text: string) => { projectTitle: string | null } | null;
      snapshot: (value: unknown) => unknown;
      render: (container: Element, value: unknown, fallback?: string) => void;
      createPicker: (dialog: PickerDialog, options: {
        read(path: string): Promise<unknown>;
        current(scope: Scope): boolean;
        insert(scope: Scope, snapshot: typeof sample, summary: string): void;
        restoreFocus(): void;
        notify?(message: string): void;
      }) => {
        open(scope: Scope, options?: { projectTitle?: string | null; onInserted?: () => void }): void;
        closeIfStale(): void;
      };
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("natural-language project progress recognizes complete questions and only explicit quoted names", () => {
  const { parseProgressQuery } = renderer();
  for (const text of ["这个项目现在进展如何？", "看看项目进展", "  这个项目现在进展如何？  "]) {
    assert.equal(parseProgressQuery(text)?.projectTitle, null, text);
  }
  for (const text of ["查看『星河』项目的进展", "查看《星河》项目的进展"]) {
    assert.equal(parseProgressQuery(text)?.projectTitle, "星河", text);
  }
  for (const text of [
    "/项目进展", "你好", "查看星河项目的进展", "查看『星河》项目的进展",
    "他说：“这个项目现在进展如何？”", "查看『星河』项目的进展，然后启动任务",
    "这个项目现在进展如何？\n同时启动任务", "怎么实现一个项目进展卡？", "> 看看项目进展",
  ]) assert.equal(parseProgressQuery(text), null, text);
});

test("the real manual composer dispatcher preserves slash, ordinary, attachment, and blocked-mode behavior", () => {
  const dispatcher = chatPage.match(/^function sendComposerInput\(input\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(dispatcher, "manual composer dispatch must stay separate from automatic sends");
  const ordinarySend = chatPage.match(/^async function sendMsg\([\s\S]*?^\}/m)?.[0];
  assert.ok(ordinarySend);
  assert.doesNotMatch(ordinarySend, /sendComposerInput|parseProgressQuery/);
  const availability = chatPage.match(/^const projectProgress(?:NaturalLanguage)?Available = [^\r\n]+/gm);
  assert.equal(availability?.length, 2);

  const input = { id: "txt", value: "" };
  const hero = { id: "heroTxt", value: "" };
  const state = { target: { kind: "persona" }, pendingFile: null as object | null, pendingImage: null as object | null };
  const messages: string[] = [];
  const opened: Array<{ projectTitle?: string | null; onInserted?: (previousInput: typeof input) => void }> = [];
  let effectiveKind = "persona";
  let activeInput = input;
  let flushed = 0;
  const send = runInNewContext(availability!.join("\n") + "\n" + dispatcher + "\nsendComposerInput", {
    window: { ClownfishChatProjectProgress: renderer() },
    state,
    sending: false,
    $: (selector: string) => selector === "#txt" ? input : hero,
    document: { getElementById: (id: string) => id === "txt" ? input : hero },
    runTypedProjectProgress: (node: typeof input) => {
      if (node.value !== "/项目进展") return false;
      messages.push("slash");
      return true;
    },
    effectiveConversationTarget: () => ({ kind: effectiveKind }),
    currentComposerInput: () => activeInput,
    setProjectProgressStatus: () => messages.push("local"),
    logKey: () => "persona:test",
    activeConversationId: () => "conversation-a",
    chatProjectPicker: {
      open(scope: { key: string; conversationId: string }, options: typeof opened[number]) {
        assert.equal(scope.key, "persona:test");
        assert.equal(scope.conversationId, "conversation-a");
        opened.push(options);
      },
    },
    flushConversationDraft: () => { flushed++; },
    scheduleSaveConversationDraft: () => { flushed++; },
    sendMsg: () => messages.push("chat"),
  }) as (node: typeof input) => void;

  input.value = "/项目进展";
  send(input);
  input.value = "我们聊聊项目进展卡的技术方案";
  send(input);
  state.pendingFile = {};
  input.value = "看看项目进展";
  send(input);
  state.pendingFile = null;
  state.pendingImage = {};
  send(input);
  state.pendingImage = null;
  assert.deepEqual(messages, ["slash", "chat", "chat", "chat"]);
  assert.equal(opened.length, 0);

  state.target.kind = "group";
  send(input);
  state.target.kind = "persona";
  effectiveKind = "group";
  send(input);
  assert.deepEqual(messages.slice(-2), ["local", "local"]);
  assert.equal(opened.length, 0);
  assert.equal(input.value, "看看项目进展");

  effectiveKind = "persona";
  send(input);
  hero.value = "查看『星河』项目的进展";
  send(hero);
  assert.deepEqual(opened.map(option => option.projectTitle), [null, "星河"]);
  assert.equal(input.value, "看看项目进展");
  assert.equal(hero.value, "查看『星河』项目的进展");
  input.value = "我随后输入的其他内容";
  opened[0]!.onInserted?.(input);
  assert.equal(input.value, "我随后输入的其他内容");
  // Insertion removes the hero composer and retains its draft in the regular input.
  activeInput = input;
  input.value = hero.value;
  opened[1]!.onInserted?.(hero);
  assert.equal(input.value, "");
  assert.equal(flushed, 3);
  assert.deepEqual(messages, ["slash", "chat", "chat", "chat", "local", "local"]);
});

test("actual chat button and Enter listeners share the dispatcher, preserve slash priority and ignore IME and Shift+Enter", () => {
  const clickListeners = chatPage.match(/^\$\("#send"\)\.onclick = [^\n]+\ndocument\.addEventListener\("click", \(e\) => \{[\s\S]*?^\}\);/m)?.[0];
  const keyboardListeners = chatPage.match(/^document\.addEventListener\("keydown", \(e\) => \{\s+if \(!isSlashInput\(e\.target\)[\s\S]*?^\}, true\);\s+^document\.addEventListener\("keydown", \(e\) => \{[\s\S]*?^\}\);/m)?.[0];
  assert.ok(clickListeners);
  assert.ok(keyboardListeners);
  const input = { id: "txt", value: "看看项目进展" };
  const hero = { id: "heroTxt", value: "看看项目进展" };
  const button = { onclick: () => {} };
  type KeyEvent = { target: typeof input; key: string; keyCode: number; isComposing: boolean; shiftKey: boolean };
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const calls: string[] = [];
  runInNewContext(clickListeners + "\n" + keyboardListeners, {
    document: {
      addEventListener(name: string, listener: (event: unknown) => void) {
        (listeners[name] ??= []).push(listener);
      },
    },
    $: (selector: string) => ({ "#txt": input, "#heroTxt": hero, "#send": button }[selector]),
    isSlashInput: (node: typeof input) => node === input || node === hero,
    slashMenu: { items: [] },
    window: { ClownfishSlashCommands: { exactSlashCommand: (value: string) => value === "/项目进展" } },
    runSlashCommand: () => calls.push("slash"),
    sendComposerInput: (node: typeof input) => calls.push(node.id),
  });
  const press = (target: typeof input, options: Partial<KeyEvent> = {}) => {
    let stopped = false;
    const event = { target, key: "Enter", keyCode: 13, isComposing: false, shiftKey: false, ...options,
      preventDefault() {}, stopPropagation() { stopped = true; } };
    for (const listener of listeners.keydown!) {
      if (stopped) break;
      listener(event);
    }
  };
  button.onclick();
  listeners.click![0]!({ target: { closest: (selector: string) => selector === "#heroSend" } });
  press(input);
  press(hero);
  assert.deepEqual(calls, ["txt", "heroTxt", "txt", "heroTxt"]);
  for (const composer of [input, hero]) {
    press(composer, { shiftKey: true });
    press(composer, { isComposing: true });
    press(composer, { keyCode: 229 });
    composer.value = "/项目进展";
    press(composer, { isComposing: true });
    press(composer);
  }
  assert.deepEqual(calls, ["txt", "heroTxt", "txt", "heroTxt", "slash", "slash"]);
});

const listedProject = { id: "space-a", title: "星河", status: "active" };
const progressPath = (id: string) =>
  "/api/capabilities/space?" + new URLSearchParams({ id, view: "chat-progress" });
const progressFor = (space: { id: string; title: string; status: string }) => ({ ...sample, space });

test("one exact named project reads one snapshot and a single successful insertion clears its draft", async () => {
  const { createPicker } = renderer();
  const project = { ...listedProject, id: "项目&来源" };
  const dialog = new PickerDialog();
  const reads: string[] = [];
  const saved: string[] = [];
  let cleared = 0;
  const response = deferred<unknown>();
  const picker = createPicker(dialog, {
    async read(path) {
      reads.push(path);
      if (path === "/api/capabilities") return { spaces: [{ ...listedProject, title: "旧星河" }, project] };
      assert.equal(path, progressPath(project.id));
      return response.promise;
    },
    current: () => true,
    insert: (_scope, card) => saved.push(card.space.id),
    restoreFocus() {},
  });
  const scope = { conversationId: "first" };
  const options = { projectTitle: "星河", onInserted: () => { cleared++; } };
  picker.open(scope, options);
  await setImmediate();
  picker.open(scope, options);
  assert.equal(dialog.open, false);
  assert.deepEqual(reads, ["/api/capabilities", progressPath(project.id)]);
  assert.equal(cleared, 0);
  response.resolve(progressFor(project));
  await setImmediate();
  assert.deepEqual(saved, [project.id]);
  assert.equal(cleared, 1);
});

test("unnamed, ambiguous, and missing names require confirmation and cancellation leaves the draft", async () => {
  const { createPicker } = renderer();
  const archived = { ...listedProject, id: "space-archived", status: "archived" };
  for (const title of [null, "星河", "不存在"]) {
    const dialog = new PickerDialog();
    const select = dialog.querySelector("select");
    const reads: string[] = [];
    const picker = createPicker(dialog, {
      async read(path) {
        reads.push(path);
        return { spaces: [listedProject, archived] };
      },
      current: () => true,
      insert: () => assert.fail("the selector requires an explicit confirmation"),
      restoreFocus() {},
    });
    picker.open({ conversationId: "first" }, {
      projectTitle: title,
      onInserted: () => assert.fail("draft cleared before successful insertion"),
    });
    await setImmediate();
    assert.equal(dialog.open, true);
    assert.equal(select.value, "");
    assert.deepEqual(select.options.map(option => option.value), ["", listedProject.id, archived.id]);
    assert.notEqual(select.options[1].textContent, select.options[2].textContent);
    assert.match(select.options[2].textContent, /已归档/);
    await dialog.querySelector("form").emit("submit");
    dialog.querySelector("[data-close-projects]").emit("click");
    assert.deepEqual(reads, ["/api/capabilities"]);
  }
});

test("a deleted named project reloads the choices without substituting another ID", async () => {
  const { createPicker } = renderer();
  const replacement = { ...listedProject, id: "space-replacement" };
  const dialog = new PickerDialog();
  const select = dialog.querySelector("select");
  const reads: string[] = [];
  let listReads = 0;
  const picker = createPicker(dialog, {
    async read(path) {
      reads.push(path);
      if (path === "/api/capabilities") return { spaces: [listReads++ ? replacement : listedProject] };
      throw Object.assign(new Error("missing"), { status: 404 });
    },
    current: () => true,
    insert: () => assert.fail("a same-title replacement is not a validated selection"),
    restoreFocus() {},
  });
  picker.open({ conversationId: "first" }, {
    projectTitle: listedProject.title,
    onInserted: () => assert.fail("a missing project cannot consume the draft"),
  });
  await setImmediate();
  assert.equal(dialog.open, true);
  assert.equal(select.value, "");
  assert.deepEqual(select.options.map(option => option.value), ["", replacement.id]);
  assert.deepEqual(reads, ["/api/capabilities", progressPath(listedProject.id), "/api/capabilities"]);
});

test("a failed or mismatched detail response never inserts a card or consumes the draft", async () => {
  const { createPicker } = renderer();
  for (const mismatch of [false, true]) {
    const dialog = new PickerDialog();
    const reads: string[] = [];
    const notices: string[] = [];
    let saved = 0;
    let cleared = 0;
    const picker = createPicker(dialog, {
      async read(path) {
        reads.push(path);
        if (path === "/api/capabilities") return { spaces: [listedProject] };
        if (mismatch) return progressFor({ ...listedProject, id: "different-space" });
        throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
      },
      current: () => true,
      insert: () => { saved++; },
      restoreFocus() {},
      notify: (message) => notices.push(message),
    });
    picker.open({ conversationId: "first" }, {
      projectTitle: listedProject.title,
      onInserted: () => { cleared++; },
    });
    await setImmediate();
    assert.deepEqual(reads, ["/api/capabilities", progressPath(listedProject.id)]);
    assert.equal(saved, 0);
    assert.equal(cleared, 0);
    assert.equal(dialog.open, false);
    assert.match(notices.at(-1)!, /读取.*重试/);
  }
});

test("a late named query cannot insert or consume a draft after its conversation was removed", async () => {
  const { createPicker } = renderer();
  const dialog = new PickerDialog();
  const late = deferred<unknown>();
  const next = { ...listedProject, id: "space-next", title: "远山" };
  const saved: Array<[string, string]> = [];
  let current = "old";
  const picker = createPicker(dialog, {
    async read(path) {
      if (path === "/api/capabilities") return { spaces: [listedProject, next] };
      return path === progressPath(listedProject.id) ? late.promise : progressFor(next);
    },
    current: ({ conversationId }) => conversationId === current,
    insert: ({ conversationId }, card) => saved.push([conversationId, card.space.id]),
    restoreFocus() {},
  });
  picker.open({ conversationId: "old" }, {
    projectTitle: listedProject.title,
    onInserted: () => assert.fail("late result cleared a deleted conversation's draft"),
  });
  await setImmediate();
  current = "new";
  picker.closeIfStale();
  picker.open({ conversationId: "new" }, { projectTitle: next.title });
  late.resolve(progressFor(listedProject));
  await setImmediate();
  assert.deepEqual(saved, [["new", next.id]]);
  assert.equal(dialog.open, false);
});

test("duplicate confirmation and a late response cannot insert into a different conversation", async () => {
  const { createPicker } = renderer();
  const dialog = new PickerDialog();
  const select = dialog.querySelector("select");
  const form = dialog.querySelector("form");
  const first = deferred<unknown>();
  const second = deferred<unknown>();
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
  assert.equal(saved.length, 0);
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
