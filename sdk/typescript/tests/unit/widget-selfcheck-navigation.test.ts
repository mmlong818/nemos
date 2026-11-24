import assert from "node:assert/strict";
import test from "node:test";
import { runWidgetCheckSession } from "../../examples/companion/widget-selfcheck.js";

const SESSION = "widget-session";
const ROOT_FRAME = "widget-frame";
const INITIAL_LOADER = "first-document";
const RELOAD_LOADER = "reloaded-document";
const WIDGET_URL = "http://clownfish-self-check.invalid/widget.html";
const NAVIGATION_NOTE = /页面刷新或跳转/;

interface Command {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

class FakeCdp {
  onmessage: WebSocket["onmessage"] = null;
  onerror: WebSocket["onerror"] = null;
  onclose: WebSocket["onclose"] = null;
  private commands: Command[] = [];
  private commandWaiters = new Map<string, (command: Command) => void>();

  send(raw: string) {
    const command = JSON.parse(raw) as Command;
    this.commands.push(command);
    this.commandWaiters.get(command.method)?.(command);
    this.commandWaiters.delete(command.method);
    if (command.method === "Target.createTarget") this.reply(command, { targetId: "widget-target" });
    else if (command.method === "Target.attachToTarget") this.reply(command, { sessionId: SESSION });
    else if (command.method !== "Page.navigate" && command.method !== "Runtime.evaluate") this.reply(command, {});
  }

  waitForCommand(method: string): Promise<Command> {
    const command = this.commands.find((item) => item.method === method);
    if (command) return Promise.resolve(command);
    return new Promise((resolve) => this.commandWaiters.set(method, resolve));
  }

  reply(command: Command, result: Record<string, unknown>) {
    this.receive({ id: command.id, sessionId: command.sessionId, result });
  }

  reject(command: Command, message: string) {
    this.receive({ id: command.id, sessionId: command.sessionId, error: { message } });
  }

  emit(method: string, params: Record<string, unknown>, sessionId = SESSION) {
    this.receive({ method, params, sessionId });
  }

  commit(loaderId = RELOAD_LOADER, frameId = ROOT_FRAME, sessionId = SESSION, parentId?: string) {
    this.emit("Page.frameNavigated", { frame: { id: frameId, parentId, loaderId, url: WIDGET_URL } }, sessionId);
  }

  load(loaderId = INITIAL_LOADER, frameId = ROOT_FRAME, sessionId = SESSION) {
    this.emit("Page.lifecycleEvent", { name: "load", frameId, loaderId }, sessionId);
  }

  private receive(message: unknown) {
    this.onmessage?.call(this as unknown as WebSocket, { data: JSON.stringify(message) } as MessageEvent);
  }
}

class ManualPauses {
  private pauses = new Map<number, () => void>();
  private waiters = new Map<number, () => void>();

  pause = (ms: number): Promise<void> => new Promise((resolve) => {
    this.pauses.set(ms, resolve);
    this.waiters.get(ms)?.();
    this.waiters.delete(ms);
  });

  has(ms: number) {
    return this.pauses.has(ms);
  }

  waitUntilPaused(ms: number): Promise<void> {
    if (this.has(ms)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.set(ms, resolve));
  }

  release(ms: number) {
    const resume = this.pauses.get(ms);
    assert.ok(resume, `expected a pending ${ms} ms pause`);
    this.pauses.delete(ms);
    resume();
  }
}

function setup() {
  const cdp = new FakeCdp();
  const time = new ManualPauses();
  const finished = runWidgetCheckSession(cdp, () => "<!doctype html><button>测试</button>", time.pause);
  // The assertions may attach after a simulated browser failure has already arrived.
  void finished.catch(() => {});
  return { cdp, time, finished };
}

async function readyToClick() {
  const env = setup();
  const { cdp, time } = env;
  const navigate = await cdp.waitForCommand("Page.navigate");
  cdp.commit(INITIAL_LOADER);
  cdp.load(); // CDP may deliver a load event before it replies to Page.navigate.
  cdp.reply(navigate, { frameId: ROOT_FRAME, loaderId: INITIAL_LOADER });
  await time.waitUntilPaused(600);
  time.release(600);
  const evaluate = await cdp.waitForCommand("Runtime.evaluate");
  return { ...env, evaluate };
}

const clickedSummary = { result: { value: { controls: 6, clicked: 4, text: 29 } } };

for (const when of ["before evaluate replies", "after evaluate replies"] as const) {
  test(`same-URL reload ${when} is reported with the real click count`, async () => {
    const { cdp, time, evaluate, finished } = await readyToClick();
    if (when === "before evaluate replies") cdp.commit();
    cdp.reply(evaluate, clickedSummary);
    await time.waitUntilPaused(400);
    if (when === "after evaluate replies") cdp.commit();
    cdp.commit(); // Repeat delivery of the same document commit.
    time.release(400);

    const check = await finished;
    assert.equal(check.status, "passed", check.detail);
    assert.equal(check.clicked, 4);
    assert.equal(check.controls, 6);
    assert.match(check.detail, NAVIGATION_NOTE);
    assert.equal(check.detail.match(/页面刷新或跳转/g)?.length, 1);
    assert.doesNotMatch(check.detail, /之后的控件没点到/);
  });
}

test("context loss while evaluating is a reload when a main document commit follows", async () => {
  const { cdp, time, evaluate, finished } = await readyToClick();
  cdp.reject(evaluate, "Execution context was destroyed.");
  await time.waitUntilPaused(400);
  cdp.commit();
  time.release(400);

  const check = await finished;
  assert.equal(check.status, "passed", check.detail);
  assert.match(check.detail, NAVIGATION_NOTE);
  assert.equal(check.clicked, 0, "interrupted evaluation must not invent a successful click count");
});

test("context loss and target closure without a document commit are not reloads", async () => {
  for (const error of ["Execution context was destroyed.", "Target closed."]) {
    const { cdp, time, evaluate, finished } = await readyToClick();
    cdp.reject(evaluate, error);
    // An implementation may reject a clearly closed target without an observation pause.
    await Promise.race([
      time.waitUntilPaused(400),
      finished.then(() => {}, () => {}),
    ]);
    if (time.has(400)) time.release(400);

    await assert.rejects(finished, (reason: unknown) => {
      assert.ok(reason instanceof Error);
      assert.ok(reason.message.includes(error), "the outer self-check must retain the failure reason");
      assert.doesNotMatch(reason.message, NAVIGATION_NOTE);
      return true;
    });
  }
});

test("initial loading waits for the expected root document instead of another loader or frame", async () => {
  const { cdp, time, finished } = setup();
  const navigate = await cdp.waitForCommand("Page.navigate");
  cdp.load("old-document");
  cdp.load(INITIAL_LOADER, "child-frame");
  cdp.load(INITIAL_LOADER, ROOT_FRAME, "other-session");
  cdp.emit("Page.loadEventFired", { timestamp: 1 });
  cdp.reply(navigate, { frameId: ROOT_FRAME, loaderId: INITIAL_LOADER });
  await time.waitUntilPaused(8000);
  assert.equal(time.has(600), false, "an unrelated load must not start the warmup");
  cdp.load();
  await time.waitUntilPaused(600);
  time.release(600);
  cdp.reply(await cdp.waitForCommand("Runtime.evaluate"), clickedSummary);
  await time.waitUntilPaused(400);
  time.release(400);
  assert.doesNotMatch((await finished).detail, NAVIGATION_NOTE);
});

test("unrelated load events cannot bypass the initial deadline", async () => {
  const { cdp, time, finished } = setup();
  const navigate = await cdp.waitForCommand("Page.navigate");
  cdp.emit("Page.loadEventFired", { timestamp: 1 });
  cdp.load("wrong-loader");
  cdp.load(INITIAL_LOADER, "child-frame");
  cdp.load(INITIAL_LOADER, ROOT_FRAME, "other-session");
  cdp.reply(navigate, { frameId: ROOT_FRAME, loaderId: INITIAL_LOADER });
  await time.waitUntilPaused(8000);
  time.release(8000);

  await assert.rejects(finished);
  assert.equal(time.has(600), false, "timed-out initial loading must not begin warmup or clicking");
});

test("non-root, same-document and late events cannot report a reload", async () => {
  const { cdp, time, evaluate, finished } = await readyToClick();
  cdp.commit(INITIAL_LOADER);
  cdp.commit(RELOAD_LOADER, "child-frame", SESSION, ROOT_FRAME);
  cdp.commit(RELOAD_LOADER, ROOT_FRAME, "other-session");
  cdp.emit("Page.navigatedWithinDocument", { frameId: ROOT_FRAME, url: `${WIDGET_URL}#position`, navigationType: "fragment" });
  cdp.emit("Page.loadEventFired", { timestamp: 1 });
  cdp.reply(evaluate, clickedSummary);
  await time.waitUntilPaused(400);
  time.release(400);

  const check = await finished;
  assert.equal(cdp.onmessage, null, "completed checks must detach their protocol handler");
  assert.equal(cdp.onerror, null);
  assert.equal(cdp.onclose, null);
  cdp.commit(); // After finalization.
  assert.equal(check.status, "passed", check.detail);
  assert.doesNotMatch(check.detail, NAVIGATION_NOTE);
});

test("script and network errors are still reported alongside a confirmed reload", async () => {
  const { cdp, time, evaluate, finished } = await readyToClick();
  cdp.emit("Runtime.exceptionThrown", { exceptionDetails: { text: "widget script failed" } });
  cdp.emit("Network.requestWillBeSent", { requestId: "external-resource", request: { url: "https://example.invalid/resource.js" } });
  cdp.emit("Network.loadingFailed", { requestId: "external-resource", blockedReason: "csp" });
  cdp.commit();
  cdp.reply(evaluate, clickedSummary);
  await time.waitUntilPaused(400);
  time.release(400);

  const check = await finished;
  assert.equal(check.status, "failed", check.detail);
  assert.match(check.detail, NAVIGATION_NOTE);
  assert.deepEqual(check.errors, ["widget script failed", "页面想加载外部资源：https://example.invalid/resource.js"]);
  assert.equal(check.clicked, 4);
});
