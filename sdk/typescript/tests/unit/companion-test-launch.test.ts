import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";
import test, { type TestContext } from "node:test";
import { launchCompanionForTest, CompanionTestLaunchError } from "../fixtures/companion-test-launch.js";

const home = resolve(__dirname, "../fixtures");
const differentHome = dirname(home);
const firstPort = 51_432;
const clientSession = "unit-only-client-session-value";
const bearer = "unit-only-bearer-value";
const timeoutMs = 25;

class FakeCompanion extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kills: NodeJS.Signals[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  finishOnKill = true;

  constructor(readonly pid: number) { super(); }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.kills.push(signal);
    this.killed = true;
    if (this.finishOnKill) this.finish(null, signal);
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }

  ready({ pid = this.pid, port = firstPort, fragments = false } = {}): void {
    const line = `CLOWNFISH_READY ${JSON.stringify({ pid, port, appId: "test", version: "1", clientSession })}\r\n`;
    if (fragments) {
      this.stdout.write(line.slice(0, 8));
      this.stdout.write(line.slice(8, -1));
      this.stdout.write(line.slice(-1));
    } else this.stdout.write(line);
  }
}

function runtime(dataDir = home): Response {
  return new Response(JSON.stringify({ dataDir }), { headers: { "Content-Type": "application/json" } });
}

function fakeClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  return { now: () => Date.now(), tick: (ms: number) => t.mock.timers.tick(ms) };
}

function setup(t: TestContext, fetch: typeof globalThis.fetch = async () => runtime()) {
  const clock = fakeClock(t);
  const child = new FakeCompanion(31415);
  const invocations: SpawnOptions[] = [];
  const launch = (port?: number) => launchCompanionForTest({ home, timeoutMs, port }, {
    spawn: (_command, _args, options) => {
      invocations.push(options);
      return child as unknown as ChildProcess;
    },
    fetch,
    now: clock.now,
    stopTimeoutMs: 10,
  });
  return { child, invocations, launch, ...clock };
}

function errorAt(phase: string, incomplete = false) {
  return (error: unknown) => {
    assert.ok(error instanceof CompanionTestLaunchError);
    assert.ok(!error.message.includes(clientSession), "diagnostics must redact the fixture session value");
    assert.ok(!error.message.includes(bearer), "diagnostics must redact the fixture bearer value");
    assert.equal(error.phase, phase);
    assert.equal(Boolean(error.cleanupIncomplete), incomplete);
    return true;
  };
}

test("uses the child READY port and verifies its runtime before exposing or reusing the loopback address", async (t) => {
  const probes: string[] = [];
  const { child, invocations, launch } = setup(t, async (input) => {
    probes.push(String(input));
    return runtime();
  });
  const launching = launch();
  assert.equal(invocations[0]?.env?.PORT, "0");
  assert.equal(invocations[0]?.env?.CLOWNFISH_HOME, home);
  child.ready({ fragments: true });
  const server = await launching;
  assert.equal(server.port, firstPort);
  assert.equal(server.pid, child.pid);
  assert.equal(server.base, `http://127.0.0.1:${firstPort}`);
  assert.deepEqual(probes, [`${server.base}/api/runtime`]);
  await server.stop("SIGTERM");
  assert.deepEqual(child.kills, ["SIGTERM"]);

  const next = new FakeCompanion(92653);
  const restarting = launchCompanionForTest({ home, port: server.port, timeoutMs }, {
    spawn: (_command, _args, options) => {
      assert.equal(options.env?.PORT, String(server.port));
      assert.equal(options.env?.CLOWNFISH_HOME, invocations[0]?.env?.CLOWNFISH_HOME);
      return next as unknown as ChildProcess;
    },
    fetch: async () => runtime(),
    now: () => Date.now(),
  });
  next.ready();
  const restarted = await restarting;
  assert.equal(restarted.base, server.base);
  assert.equal(restarted.pid, next.pid);
  await restarted.stop("SIGKILL");
  assert.deepEqual(next.kills, ["SIGKILL"]);
});

test("ignores a foreign PID and incompatible READY ports, without probing or logging the READY payload", async (t) => {
  let probes = 0;
  const { child, launch, tick } = setup(t, async () => { probes++; return runtime(); });
  const pending = assert.rejects(launch(firstPort), errorAt("waiting_ready"));
  child.ready({ pid: child.pid + 1 });
  child.ready({ port: 0 });
  child.ready({ port: firstPort + 1 });
  child.stderr.write(`Authorization: Bearer ${bearer}\n`);
  tick(timeoutMs);
  await pending;
  assert.equal(probes, 0);
  assert.equal(child.kills.length, 1);
});

test("an asynchronous spawn error and an early signal exit are distinguished from readiness timeouts", async (t) => {
  await t.test("spawn error", async (st) => {
    const { child, launch } = setup(st);
    const pending = assert.rejects(launch(), errorAt("spawn_error"));
    child.emit("error", new Error("injected create process failure"));
    await pending;
  });
  await t.test("SIGKILL before readiness", async (st) => {
    const { child, launch } = setup(st);
    const pending = assert.rejects(launch(), (error: unknown) => {
      errorAt("early_exit")(error);
      assert.ok(String(error).includes("SIGKILL"), "signal-based exits retain the signal in diagnostics");
      return true;
    });
    child.finish(null, "SIGKILL");
    await pending;
    assert.deepEqual(child.kills, []);
  });
});

test("no READY line never probes and cleans up the child at the fake deadline", async (t) => {
  let probes = 0;
  const { child, launch, tick } = setup(t, async () => { probes++; return runtime(); });
  const pending = assert.rejects(launch(), errorAt("waiting_ready"));
  child.stdout.write("unrelated startup output\n");
  tick(timeoutMs);
  await pending;
  assert.equal(probes, 0);
  assert.equal(child.kills.length, 1);
});

test("a different runtime dataDir is rejected even on a matching READY port (without retry or success)", async (t) => {
  let probes = 0;
  const { child, launch } = setup(t, async () => { probes++; return runtime(differentHome); });
  const pending = assert.rejects(launch(), errorAt("runtime_identity"));
  child.ready();
  await pending;
  assert.equal(probes, 1);
  assert.equal(child.kills.length, 1);
});

test("a stuck runtime request is aborted and the child is stopped when the shared budget expires", async (t) => {
  let probeStarted!: (signal: AbortSignal | null | undefined) => void;
  const entered = new Promise<AbortSignal | null | undefined>((resolveSignal) => { probeStarted = resolveSignal; });
  const { child, launch, tick } = setup(t, (_input, options) => {
    probeStarted(options?.signal);
    return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("synthetic aborted fetch")), { once: true }));
  });
  const pending = assert.rejects(launch(), errorAt("runtime_probe"));
  child.ready();
  const signal = await entered;
  assert.ok(signal && !signal.aborted);
  tick(timeoutMs);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(child.kills.length, 1);
});

test("the deadline also bounds a stalled runtime JSON body even if it ignores abort", async (t) => {
  let bodyStarted!: (signal: AbortSignal | null | undefined) => void;
  const entered = new Promise<AbortSignal | null | undefined>((r) => { bodyStarted = r; });
  const { child, launch, tick } = setup(t, async (_input, options) => ({
    ok: true,
    status: 200,
    json: () => {
      bodyStarted(options?.signal);
      return new Promise(() => {});
    },
  }) as Response);
  const pending = assert.rejects(launch(), errorAt("runtime_probe"));
  child.ready();
  const signal = await entered;
  assert.ok(signal && !signal.aborted);
  tick(timeoutMs);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(child.kills.length, 1);
});

test("a non-200 runtime response cannot pass readiness or extend the startup budget", async (t) => {
  let entered!: () => void;
  const called = new Promise<void>((r) => { entered = r; });
  const { child, launch, tick } = setup(t, async () => {
    entered();
    return new Response(`Authorization: Bearer ${bearer}`, { status: 502 });
  });
  const pending = assert.rejects(launch(), errorAt("runtime_probe"));
  child.ready();
  await called;
  tick(timeoutMs);
  await pending;
  assert.equal(child.kills.length, 1);
});

test("an incomplete close does not overwrite the original startup phase", async (t) => {
  const { child, launch, tick } = setup(t);
  child.finishOnKill = false;
  let cleanupStarted!: () => void;
  const cleanup = new Promise<void>((r) => { cleanupStarted = r; });
  const originalKill = child.kill.bind(child);
  child.kill = (signal) => { const result = originalKill(signal); cleanupStarted(); return result; };
  const pending = assert.rejects(launch(), errorAt("waiting_ready", true));
  tick(timeoutMs);
  await cleanup;
  tick(20);
  await pending;
  assert.ok(child.kills.length > 0);
});
