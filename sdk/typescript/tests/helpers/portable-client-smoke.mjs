import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";

const portableArgument = process.argv[2];
if (!portableArgument) throw new Error("usage: portable-client-smoke.mjs <portable-root>");
const portableRoot = resolvePath(portableArgument);
const smokeRoot = mkdtempSync(join(tmpdir(), "clownfish-portable-client-"));
const pidFile = join(smokeRoot, "companion-server.pid");
const logFile = join(smokeRoot, "logs", "client-server.log");
const startedHosts = [];
const observedSidecars = new Set();

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readyCount() {
  if (!existsSync(logFile)) return 0;
  return (readFileSync(logFile, "utf8").match(/^CLOWNFISH_READY /gm) ?? []).length;
}

function readPidRecord() {
  return JSON.parse(readFileSync(pidFile, "utf8").replace(/^\uFEFF/, ""));
}

function startHost() {
  const host = spawn(join(portableRoot, "小丑鱼.exe"), [], {
    cwd: portableRoot,
    windowsHide: true,
    env: { ...process.env, CLOWNFISH_HOME: smokeRoot },
    stdio: "ignore",
  });
  startedHosts.push(host);
  return host;
}

async function waitForLaunch(host, previousSidecarPid, previousReadyCount) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (host.exitCode !== null) throw new Error(`desktop host exited before sidecar readiness (${host.exitCode})`);
    if (existsSync(pidFile) && existsSync(logFile)) {
      try {
        const record = readPidRecord();
        if (Number.isInteger(record.pid) && record.pid !== previousSidecarPid
          && isAlive(record.pid) && readyCount() > previousReadyCount) {
          observedSidecars.add(record.pid);
          return record.pid;
        }
      } catch {
        // Atomic startup writes may be observed between replacement steps.
      }
    }
    await delay(200);
  }
  throw new Error("desktop host sidecar readiness timeout");
}

async function terminateHostAndWaitForJob(host, sidecarPid) {
  if (isAlive(host.pid)) host.kill();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && (isAlive(host.pid) || isAlive(sidecarPid))) await delay(100);
  if (isAlive(host.pid)) throw new Error("desktop host did not terminate");
  if (isAlive(sidecarPid)) throw new Error(`Job Object did not terminate sidecar ${sidecarPid}`);
}

try {
  const firstHost = startHost();
  const firstSidecar = await waitForLaunch(firstHost, 0, 0);
  const firstReadyCount = readyCount();
  await terminateHostAndWaitForJob(firstHost, firstSidecar);

  const stalePidBeforeRestart = readPidRecord().pid;
  const secondHost = startHost();
  const secondSidecar = await waitForLaunch(secondHost, firstSidecar, firstReadyCount);
  const secondReadyCount = readyCount();
  const currentPid = readPidRecord().pid;
  await terminateHostAndWaitForJob(secondHost, secondSidecar);

  const result = {
    firstHostPid: firstHost.pid,
    firstSidecarPid: firstSidecar,
    firstJobCleanup: !isAlive(firstSidecar),
    stalePidBeforeRestart,
    secondHostPid: secondHost.pid,
    secondSidecarPid: secondSidecar,
    stalePidReplaced: currentPid === secondSidecar && secondSidecar !== firstSidecar,
    secondJobCleanup: !isAlive(secondSidecar),
    readyCount: secondReadyCount,
    webViewProfileCreated: existsSync(join(smokeRoot, "webview-profile")),
    smokeRoot,
  };
  console.log(JSON.stringify(result));
  if (!result.firstJobCleanup || !result.stalePidReplaced || !result.secondJobCleanup
    || result.readyCount < 2 || !result.webViewProfileCreated) process.exitCode = 1;
} finally {
  for (const host of startedHosts) {
    if (isAlive(host.pid)) host.kill();
  }
  for (const pid of observedSidecars) {
    if (isAlive(pid)) process.kill(pid);
  }
}
