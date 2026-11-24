import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

const sdkRoot = resolve(__dirname, "../..");
const readyPrefix = "CLOWNFISH_READY ";
const pollMs = 100;
const maxProbeMs = 1_000;

type Phase = "spawn_error" | "early_exit" | "waiting_ready" | "runtime_probe" | "runtime_identity" | "stop";

export class CompanionTestLaunchError extends Error {
  constructor(readonly phase: Phase, message: string, readonly cleanupIncomplete = false) {
    super(message);
    this.name = "CompanionTestLaunchError";
  }
}

type LaunchOptions = { home: string; timeoutMs: number; port?: number };
type Dependencies = {
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  fetch?: typeof fetch;
  now?: () => number;
  stopTimeoutMs?: number;
};
type RunningCompanion = {
  base: string;
  port: number;
  pid: number;
  stop: (signal?: NodeJS.Signals) => Promise<void>;
};

/** Owns the child, not the caller's temporary home or mock provider. */
export async function launchCompanionForTest(options: LaunchOptions, dependencies: Dependencies = {}): Promise<RunningCompanion> {
  const now = dependencies.now ?? (() => performance.now());
  const request = dependencies.fetch ?? fetch;
  const startedAt = now();
  const deadline = startedAt + options.timeoutMs;
  const requestedPort = options.port ?? 0;
  const home = resolve(options.home);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !(
    /^COMPANION_|^CLOWNFISH_(HOME|CLIENT_TOKEN|CLIENT_SESSION)$|^NEMOS_COMPANION_HOME$|^ZHIPU_API_KEY$|^NODE_USE_ENV_PROXY$|^PORT$/i.test(key)
  )));
  let child: ChildProcess;
  try {
    child = (dependencies.spawn ?? spawn)(process.execPath, ["--import", "tsx", "examples/companion/server.ts"], {
      cwd: sdkRoot,
      env: { ...env, CLOWNFISH_HOME: home, PORT: String(requestedPort), ZHIPU_API_KEY: "", NODE_USE_ENV_PROXY: "0" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new CompanionTestLaunchError("spawn_error", `Companion startup phase=spawn_error pid=unknown port=${requestedPort} elapsed=${Math.round(now() - startedAt)}ms: ${describeError(error)}`);
  }

  let phase: Phase = "waiting_ready";
  let actualPort: number | undefined;
  let markerProblem = "";
  let lastProbe = "";
  let stdout = "";
  let stderr = "";
  let spawnObserved = false;
  let exited = false;
  let closed = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let startupDone = false;
  const startup = new AbortController();
  let noteClosed!: () => void;
  const pipesClosed = new Promise<void>((done) => { noteClosed = done; });
  let noteReady!: (value: { pid: number; port: number }) => void;
  const ready = new Promise<{ pid: number; port: number }>((done) => { noteReady = done; });
  let rejectStartup!: (error: CompanionTestLaunchError) => void;
  const failed = new Promise<never>((_done, reject) => { rejectStartup = reject; });
  // Keep an early failure handled even between the marker and the first HTTP probe.
  void failed.catch(() => {});
  function fail(failurePhase: Phase, reason: string): void {
    if (startupDone || startup.signal.aborted) return;
    const error = new CompanionTestLaunchError(failurePhase, reason);
    rejectStartup(error);
    startup.abort(error);
  }
  const timeout = setTimeout(() => fail(phase, "startup deadline exceeded"), Math.max(0, deadline - now()));
  function finishStartup(): void {
    startupDone = true;
    clearTimeout(timeout);
    startup.abort();
  }
  child.once("spawn", () => { spawnObserved = true; });
  child.on("error", (error) => fail("spawn_error", describeError(error)));
  child.once("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    fail("early_exit", "process exited before readiness");
  });
  child.once("close", (code, signal) => {
    closed = true;
    exitCode = code;
    exitSignal = signal;
    noteClosed();
    fail("early_exit", "process output closed before readiness");
  });
  captureLines(child.stdout, (line) => {
    if (!line.startsWith(readyPrefix)) {
      stdout = appendTail(stdout, line);
      return;
    }
    // Never include the raw marker (it can carry the client session) in diagnostic tails.
    if (startupDone || actualPort !== undefined) return;
    try {
      const marker = JSON.parse(line.slice(readyPrefix.length)) as { pid?: unknown; port?: unknown } | null;
      if (!marker || !child.pid || marker.pid !== child.pid) {
        markerProblem = "ignored ready marker: pid mismatch";
      } else if (typeof marker.port !== "number" || !Number.isInteger(marker.port) || marker.port < 1
        || marker.port > 65_535 || (requestedPort !== 0 && marker.port !== requestedPort)) {
        markerProblem = "ignored ready marker: port mismatch";
      } else {
        markerProblem = "";
        actualPort = marker.port;
        noteReady({ pid: child.pid, port: marker.port });
      }
    } catch {
      markerProblem = "ignored ready marker: invalid JSON";
    }
  });
  captureLines(child.stderr, (line) => {
    if (!line.startsWith(readyPrefix)) stderr = appendTail(stderr, line);
  });

  function diagnostics(failurePhase: Phase, reason: string, cleanup = "", elapsed = now() - startedAt): string {
    return `Companion test launch phase=${failurePhase} pid=${child.pid ?? "unknown"} port=${actualPort ?? requestedPort}`
      + ` elapsed=${Math.round(elapsed)}ms: ${reason}; spawned=${spawnObserved}; exited=${exited}; closed=${closed}`
      + `; exitCode=${exitCode ?? "none"}; signal=${exitSignal ?? "none"}`
      + (markerProblem ? `; ${markerProblem}` : "")
      + (lastProbe ? `; last probe: ${lastProbe}` : "")
      + (cleanup ? `; ${cleanup}` : "")
      + (stdout ? `\nstdout tail:\n${stdout}` : "")
      + (stderr ? `\nstderr tail:\n${stderr}` : "");
  }

  let stopping: Promise<void> | undefined;
  function stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    stopping ??= stopProcess(signal);
    return stopping;
  }
  function sendSignal(signal: NodeJS.Signals): void {
    if (!exited && !closed && child.pid) {
      try { child.kill(signal); } catch { /* The close acknowledgement decides cleanup. */ }
    }
  }
  async function waitClosed(ms: number): Promise<boolean> {
    if (closed) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pipesClosed.then(() => true),
        new Promise<false>((done) => { timer = setTimeout(() => done(false), ms); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function stopProcess(signal: NodeJS.Signals): Promise<void> {
    const budget = dependencies.stopTimeoutMs ?? 5_000;
    sendSignal(signal);
    if (await waitClosed(budget)) return;
    // A forced fallback can release resources, but is not a successful graceful stop.
    if (signal !== "SIGKILL") {
      sendSignal("SIGKILL");
      await waitClosed(Math.min(1_000, budget));
    }
    throw new CompanionTestLaunchError("stop", diagnostics("stop", `timed out waiting for ${signal} exit and output closure`), !closed);
  }

  try {
    const { pid, port } = await Promise.race([ready, failed]);
    phase = "runtime_probe";
    const base = `http://127.0.0.1:${port}`;
    for (;;) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new CompanionTestLaunchError(phase, "startup deadline exceeded");
      const probe = new AbortController();
      if (!lastProbe) lastProbe = "GET /api/runtime pending";
      let rejectProbe!: (error: Error) => void;
      const stuckProbe = new Promise<never>((_done, reject) => { rejectProbe = reject; });
      const alarm = setTimeout(() => {
        const error = new Error("HTTP probe timed out");
        probe.abort(error);
        rejectProbe(error);
      }, Math.min(remaining, maxProbeMs));
      try {
        const done = (async () => {
          const response = await request(base + "/api/runtime", {
            redirect: "error", signal: AbortSignal.any([startup.signal, probe.signal]),
          });
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            throw new Error(`HTTP ${response.status}`);
          }
          lastProbe = `HTTP ${response.status}`;
          const payload: unknown = await response.json();
          const dataDir = (payload as { dataDir?: unknown } | null)?.dataDir;
          if (typeof dataDir !== "string" || directoryKey(dataDir) !== directoryKey(home)) {
            throw new CompanionTestLaunchError("runtime_identity", "runtime returned a different data directory");
          }
        })();
        await Promise.race([done, failed, stuckProbe]);
        if (now() >= deadline) throw new CompanionTestLaunchError(phase, "startup deadline exceeded");
        return { base, port, pid, stop };
      } catch (error) {
        if (error instanceof CompanionTestLaunchError) throw error;
        lastProbe = describeError(error);
      } finally {
        clearTimeout(alarm);
      }
      await Promise.race([failed, new Promise<void>((done) => setTimeout(done, Math.min(pollMs, Math.max(0, deadline - now()))))]);
    }
  } catch (error) {
    const elapsed = now() - startedAt;
    finishStartup();
    const failure = error instanceof CompanionTestLaunchError ? error : new CompanionTestLaunchError(phase, describeError(error));
    let cleanup = "";
    try { await stop("SIGKILL"); }
    catch { cleanup = "cleanup could not confirm process and output closure"; }
    throw new CompanionTestLaunchError(failure.phase, diagnostics(failure.phase, failure.message, cleanup, elapsed), !closed);
  } finally {
    finishStartup();
  }
}

function directoryKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function describeError(value: unknown): string {
  if (!(value instanceof Error)) return "unknown error";
  const { code } = (value.cause ?? value) as { code?: unknown };
  return redact(value.message).slice(0, 400) + (typeof code === "string" && /^[\w-]+$/.test(code) ? ` [${code}]` : "");
}

function redact(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(["']?(?:authorization|api[_-]?key|x[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?session|token|passphrase|password|secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, "$1[REDACTED]");
}

function appendTail(tail: string, line: string): string {
  return (tail + redact(line) + "\n").slice(-4_000);
}

function captureLines(stream: Readable | null, accept: (line: string) => void): void {
  if (!stream) return;
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let truncated = false;
  function append(text: string): void {
    const lines = text.split("\n");
    for (const [index, part] of lines.entries()) {
      if (!truncated && buffer.length + part.length <= 8_192) buffer += part;
      else { buffer = ""; truncated = true; }
      if (index === lines.length - 1) break;
      accept(truncated ? "[oversized output line omitted]" : buffer.replace(/\r$/, ""));
      buffer = "";
      truncated = false;
    }
  }
  stream.on("data", (chunk: Buffer | string) => append(decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk)));
  stream.on("end", () => {
    append(decoder.end());
    if (buffer || truncated) accept(truncated ? "[oversized output line omitted]" : buffer.replace(/\r$/, ""));
  });
}
