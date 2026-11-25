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
type ListedSpace = { id: string; title: string; status: string };

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
      parseProgressQuery: (text: string) => { projectTitle: string | null; useBoundProject?: boolean } | null;
      normalizeProjectId: (value: unknown) => string;
      snapshot: (value: unknown) => unknown;
      render: (container: Element, value: unknown, fallback?: string) => void;
      createPicker: (dialog: PickerDialog, options: {
        read(path: string): Promise<unknown>;
        current(scope: Scope): boolean;
        insert(scope: Scope, snapshot: typeof sample, summary: string): void;
        restoreFocus(): void;
        notify?(message: string): void;
        bind?(scope: Scope, space: ListedSpace): boolean;
        rememberProject?(scope: Scope, space: ListedSpace): void;
        markUnavailable?(scope: Scope, projectId: string): void;
      }) => {
        open(scope: Scope, options?: { projectTitle?: string | null; projectId?: string;
          mode?: "binding" | "progress"; onInserted?: () => void }): void;
        closeIfStale(): void;
        invalidate(): void;
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
    assert.equal(parseProgressQuery(text)?.useBoundProject, undefined, text);
  }
  assert.equal(parseProgressQuery("这个项目现在进展如何？")?.useBoundProject, true);
  assert.equal(parseProgressQuery("看看项目进展")?.useBoundProject, undefined);
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
  const opened: Array<{ projectTitle?: string | null; projectId?: string; onInserted?: (previousInput: typeof input) => void }> = [];
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
    projectScope: () => ({ key: "persona:test", conversationId: "conversation-a", generation: 0 }),
    currentProjectScope: () => true,
    boundProjectId: (node: { projectSpaceId?: string }) => node?.projectSpaceId || "",
    conversationTrees: { "persona:test": { nodes: { "conversation-a": { projectSpaceId: "bound-id" } } } },
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
  input.value = "这个项目现在进展如何？";
  send(input);
  assert.deepEqual(opened.map(option => option.projectId), ["", "", "bound-id"]);
  assert.deepEqual(messages, ["slash", "chat", "chat", "chat", "local", "local"]);
});

function chatPageFunction(name: string) {
  const start = chatPage.indexOf("\nfunction " + name + "(");
  const end = chatPage.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, name);
  return chatPage.slice(start, end + 2);
}

test("the real conversation lifecycle scopes and persists a binding without adding it to model request options", () => {
  const oldCard = { kind: "project-progress", projectProgress: sample };
  type Node = { id: string; messages: typeof oldCard[]; projectSpaceId?: string };
  const first: Node = { id: "conversation-a", messages: [] };
  const second: Node = { id: "conversation-b", messages: [oldCard] };
  const tree = { activeId: first.id, nodes: { [first.id]: first, [second.id]: second } };
  const key = "persona:test";
  const conversationTrees = { [key]: tree };
  let saved = "";
  let storageUnavailable = false;
  const js = [
    "let projectBindingGeneration = 0; const projectBindingLabels = new Map();",
    ...["boundProjectId", "conversationHasContent", "projectScope", "currentProjectScope", "saveConversationTrees",
      "setConversationProject", "conversationRequestOptions", "createConversation", "deleteConversation"].map(chatPageFunction),
    "({ binding: boundProjectId, hasContent: conversationHasContent, scope: projectScope, current: currentProjectScope,",
    "set: setConversationProject, options: conversationRequestOptions, create: createConversation, remove: deleteConversation })",
  ].join("\n");
  type CapturedScope = { key: string; conversationId: string; naturalLanguage: boolean; generation: number };
  const actions = runInNewContext(js, {
    window: { ClownfishChatProjectProgress: renderer() },
    conversationTrees, conversationDrafts: {}, chatLogs: {}, CONVERSATION_TREE_KEY: "stored-trees", CONVERSATION_DRAFTS_KEY: "drafts",
    localStorage: { setItem(name: string, data: string) {
      if (storageUnavailable) throw new Error("storage unavailable");
      if (name === "stored-trees") saved = data;
    } },
    logKey: () => key,
    activeConversation: () => tree.nodes[tree.activeId],
    activeConversationId: () => tree.activeId,
    ensureConversationTree: () => tree,
    switchConversation: (id: string) => { tree.activeId = id; },
    projectProgressAvailable: () => true,
    projectProgressNaturalLanguageAvailable: () => true,
    renderConversationProject() {}, renderContacts() {}, renderConversationHeader() {}, openAppIfNeeded() {},
    renderLog() {}, restoreConversationDraft() {}, flushConversationDraft() {}, saveLogs() {},
    conversationTitle: () => "Conversation", confirm: () => true,
    modelConnectionState: null, conversationDefaults: () => ({}), normalizeWorkMode: () => "chat",
    APP_PERSONA_ID: "test", makeConversationNode: (): Node => ({ id: "new-conversation", messages: [] }),
    $: () => ({ focus() {} }),
  }) as {
    binding(node: Node): string;
    hasContent(node: Node): boolean;
    scope(naturalLanguage: boolean): CapturedScope;
    current(scope: CapturedScope): boolean;
    set(scope: CapturedScope, space: ListedSpace | null): boolean;
    options(key: string): object;
    create(): void;
    remove(id: string): void;
  };

  assert.equal(actions.hasContent(first), false);
  const original = actions.scope(true);
  assert.equal(actions.set(original, listedProject), true);
  assert.equal(actions.current(original), false);
  assert.equal(actions.hasContent(first), true);
  assert.match(chatPage, /nodes\.filter\(conversationHasContent\)/);
  assert.equal(actions.binding(second), "");
  const reloaded = JSON.parse(saved)[key].nodes as Record<string, Node>;
  assert.equal(actions.binding(reloaded[first.id]!), listedProject.id);
  assert.deepEqual(reloaded[second.id]!.messages, [oldCard]);
  assert.doesNotMatch(JSON.stringify(actions.options(key)), /projectSpaceId|space-a/);

  const originalBinding = actions.scope(true);
  const alternate = { ...listedProject, id: "space-b" };
  assert.equal(actions.set(originalBinding, alternate), true);
  const alternateBinding = actions.scope(true);
  assert.equal(actions.set(alternateBinding, listedProject), true);
  assert.equal(actions.current(originalBinding), false);
  assert.equal(actions.current(alternateBinding), false);
  storageUnavailable = true;
  const current = actions.scope(true);
  assert.equal(actions.set(current, null), false);
  assert.equal(actions.current(current), true);
  assert.equal(actions.binding(first), listedProject.id);
  storageUnavailable = false;

  actions.create();
  assert.equal(tree.activeId, "new-conversation");
  assert.equal(actions.binding(tree.nodes[tree.activeId]!), "");
  assert.equal(actions.binding(first), listedProject.id);
  assert.equal(actions.current(current), false);
  tree.activeId = first.id;
  const beforeClear = actions.scope(true);
  assert.equal(actions.set(beforeClear, null), true);
  assert.equal(actions.binding(first), "");
  assert.equal(actions.current(beforeClear), false);
  assert.equal(actions.set(actions.scope(true), listedProject), true);
  const beforeDelete = actions.scope(true);
  actions.remove(first.id);
  assert.equal(actions.current(beforeDelete), false);
  assert.equal(actions.set(beforeDelete, listedProject), false);
  assert.deepEqual(second.messages, [oldCard]);
  assert.equal(actions.binding(second), "");
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

test("binding mode uses a separate explicit confirmation, including archived projects with the same name", async () => {
  const dialog = new PickerDialog();
  const archived = { ...listedProject, id: "space-archived", status: "archived" };
  const reads: string[] = [];
  const bound: string[] = [];
  const picked: string[] = [];
  const picker = renderer().createPicker(dialog, {
    async read(path) {
      reads.push(path);
      if (path === "/api/capabilities") return { spaces: [listedProject, archived] };
      if (path === progressPath(listedProject.id)) return progressFor(listedProject);
      return { ...progressFor(archived), nextAction: null };
    },
    current: () => true,
    bind: (_scope, space) => { bound.push(space.id); return true; },
    insert: (_scope, card) => picked.push(card.space.id),
    restoreFocus() {},
  });
  const scope = { conversationId: "first" };
  const select = dialog.querySelector("select");
  picker.open(scope, { mode: "binding" });
  await setImmediate();
  const form = dialog.querySelector("form");
  await form.emit("submit");
  assert.deepEqual(bound, []);
  assert.notEqual(select.options[1].textContent, select.options[2].textContent);
  assert.match(select.options[2].textContent, /已归档/);
  select.value = listedProject.id;
  await form.emit("submit");

  picker.open(scope, { mode: "binding" });
  await setImmediate();
  select.value = archived.id;
  await form.emit("submit");
  picker.open(scope, { mode: "binding" });
  await setImmediate();
  select.value = listedProject.id;
  dialog.querySelector("[data-close-projects]").emit("click");
  assert.deepEqual(bound, [listedProject.id, archived.id]);
  assert.deepEqual(picked, []);
  assert.deepEqual(reads, [
    "/api/capabilities", progressPath(listedProject.id),
    "/api/capabilities", progressPath(archived.id),
    "/api/capabilities",
  ]);
});

test("a bound query reads one summary by ID and accepts its current renamed or archived label", async () => {
  const reads: string[] = [];
  const labels: Array<[string, string, string]> = [];
  const cards: unknown[] = [];
  const dialog = new PickerDialog();
  const renamed = { ...listedProject, title: "更名后的星河" };
  const archived = { ...renamed, status: "archived" };
  const picker = renderer().createPicker(dialog, {
    async read(path) {
      reads.push(path);
      return reads.length === 1 ? progressFor(renamed) : { ...progressFor(archived), nextAction: null };
    },
    current: () => true,
    insert: (_scope, card) => cards.push(card),
    rememberProject: (_scope, { id, title, status }) => labels.push([id, title, status]),
    restoreFocus() {},
  });
  const scope = { conversationId: "first" };
  picker.open(scope, { projectId: listedProject.id });
  await setImmediate();
  picker.open(scope, { projectId: listedProject.id });
  await setImmediate();
  assert.deepEqual(reads, [progressPath(listedProject.id), progressPath(listedProject.id)]);
  assert.deepEqual(labels, [[renamed.id, renamed.title, "active"], [archived.id, archived.title, "archived"]]);
  assert.deepEqual(cards.map(card => (card as typeof sample).space.status), ["active", "archived"]);
  assert.equal(dialog.open, false);
});

test("a project-specific 404 offers a temporary selection without rebinding to a same-name replacement", async () => {
  const dialog = new PickerDialog();
  const replacement = { ...listedProject, id: "space-replacement" };
  const reads: string[] = [];
  const bound: string[] = [];
  const unavailable: string[] = [];
  const picked: string[] = [];
  let draftClears = 0;
  const picker = renderer().createPicker(dialog, {
    async read(path) {
      reads.push(path);
      if (path === progressPath(listedProject.id)) {
        throw Object.assign(new Error("missing"), { status: 404, data: { error: "not found", code: "project_not_found" } });
      }
      if (path === "/api/capabilities") return { spaces: [replacement] };
      return progressFor(replacement);
    },
    current: () => true,
    bind: (_scope, space) => { bound.push(space.id); return true; },
    rememberProject: (_scope, space) => bound.push(space.id),
    markUnavailable: (_scope, id) => unavailable.push(id),
    insert: (_scope, card) => picked.push(card.space.id),
    restoreFocus() {},
  });
  picker.open({ conversationId: "first" }, { projectId: listedProject.id, onInserted: () => { draftClears++; } });
  await setImmediate();
  assert.deepEqual(reads, [progressPath(listedProject.id), "/api/capabilities"]);
  assert.deepEqual(unavailable, [listedProject.id]);
  assert.deepEqual(picked, []);
  assert.equal(draftClears, 0);
  const select = dialog.querySelector("select");
  assert.equal(select.value, "");
  select.value = replacement.id;
  await dialog.querySelector("form").emit("submit");
  assert.deepEqual(reads, [progressPath(listedProject.id), "/api/capabilities", progressPath(replacement.id)]);
  assert.deepEqual(bound, []);
  assert.deepEqual(picked, [replacement.id]);
  assert.equal(draftClears, 1);
});

test("unrelated HTTP failures and invalid summaries leave the current binding and draft untouched", async () => {
  for (const failure of [401, 403, 404, 503, "offline", "malformed", "mismatched"]) {
    const dialog = new PickerDialog();
    const reads: string[] = [];
    const changes: string[] = [];
    const notices: string[] = [];
    const picker = renderer().createPicker(dialog, {
      async read(path) {
        reads.push(path);
        if (typeof failure === "number") throw Object.assign(new Error("request error"), { status: failure });
        if (failure === "offline") throw new TypeError("failed to fetch");
        return failure === "malformed" ? { ok: true } : progressFor({ ...listedProject, id: "wrong-id" });
      },
      current: () => true,
      bind: () => { changes.push("bound"); return true; },
      rememberProject: () => changes.push("label"),
      markUnavailable: () => changes.push("unavailable"),
      insert: () => changes.push("inserted"),
      notify: (message) => notices.push(message),
      restoreFocus() {},
    });
    picker.open({ conversationId: "first" }, { projectId: listedProject.id, onInserted: () => changes.push("draft") });
    await setImmediate();
    assert.deepEqual(reads, [progressPath(listedProject.id)], String(failure));
    assert.deepEqual(changes, [], String(failure));
    assert.equal(dialog.open, false, String(failure));
    assert.match(notices.at(-1) ?? "", /访问|读取|重试/, String(failure));
  }
});

test("invalidation discards late successes and 404s even when the same conversation binds the original ID again", async () => {
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const changed: string[] = [];
  const reads: string[] = [];
  const picker = renderer().createPicker(new PickerDialog(), {
    async read(path) {
      reads.push(path);
      if (reads.length === 1) return first.promise;
      if (reads.length === 2) {
        await second.promise;
        throw Object.assign(new Error("missing"), { status: 404, data: { error: "not found", code: "project_not_found" } });
      }
      return progressFor(listedProject);
    },
    current: () => true,
    markUnavailable: () => changed.push("unavailable"),
    rememberProject: (_scope, space) => changed.push(space.id),
    insert: (_scope, card) => changed.push(card.space.id),
    restoreFocus() {},
  });
  const scope = { conversationId: "first" };
  picker.open(scope, { projectId: listedProject.id, onInserted: () => changed.push("stale draft") });
  picker.invalidate();
  picker.open(scope, { projectId: "space-b", onInserted: () => changed.push("stale draft") });
  picker.invalidate();
  picker.open(scope, { projectId: listedProject.id, onInserted: () => changed.push("current draft") });
  first.resolve(progressFor(listedProject));
  second.resolve(undefined);
  await setImmediate();
  assert.deepEqual(reads, [progressPath(listedProject.id), progressPath("space-b"), progressPath(listedProject.id)]);
  assert.deepEqual(changed, [listedProject.id, listedProject.id, "current draft"]);
});

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
