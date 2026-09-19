import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";

const portableArgument = process.argv[2];
if (!portableArgument) throw new Error("usage: portable-sidecar-smoke.mjs <portable-root>");
const portableRoot = resolvePath(portableArgument);

const smokeRoot = mkdtempSync(join(tmpdir(), "clownfish-portable-sidecar-"));
const token = "sidecar-smoke-token-never-log-7b235d";
const session = "sidecarsmoke7b235d";
const child = spawn(join(portableRoot, "node", "node.exe"), ["examples\\companion\\portable-launcher.js"], {
  cwd: join(portableRoot, "app"),
  windowsHide: true,
  env: {
    ...process.env,
    PORT: "0",
    CLOWNFISH_HOME: smokeRoot,
    CLOWNFISH_MANIFEST: join(portableRoot, "manifest.json"),
    CLOWNFISH_CLIENT_TOKEN: token,
    CLOWNFISH_CLIENT_SESSION: session,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

function waitForReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`sidecar READY timeout: ${stderr}`)), 45_000);
    const inspect = () => {
      const line = stdout.split(/\r?\n/).find((value) => value.startsWith("CLOWNFISH_READY "));
      if (!line) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line.slice("CLOWNFISH_READY ".length)));
    };
    child.stdout.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`sidecar exited before READY (${code}): ${stderr}`));
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    inspect();
  });
}

function waitForExit() {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timeout = setTimeout(() => reject(new Error("sidecar graceful shutdown timeout")), 10_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

function readTree(directory) {
  let combined = "";
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) combined += readTree(path);
    else combined += readFileSync(path).toString("utf8");
  }
  return combined;
}

try {
  const ready = await waitForReady();
  const baseUrl = `http://127.0.0.1:${ready.port}`;
  const unauthenticated = await fetch(`${baseUrl}/api/health`);
  const headers = { "X-Clownfish-Client": token };
  const authenticated = await fetch(`${baseUrl}/api/health`, { headers });
  const health = await authenticated.json();
  const shutdown = await fetch(`${baseUrl}/api/shutdown`, { method: "POST", headers });
  const exitCode = await waitForExit();
  const credentialLeak = `${stdout}\n${stderr}\n${readTree(smokeRoot)}`.includes(token);
  const result = {
    readyPort: ready.port,
    readyPid: ready.pid,
    childPid: child.pid,
    appId: ready.appId,
    version: ready.version,
    sessionMatches: ready.clientSession === session,
    unauthenticatedStatus: unauthenticated.status,
    authenticatedStatus: authenticated.status,
    authenticatedHealth: health.ok === true && health.appId === "clownfish" && health.version === "0.7.6",
    shutdownStatus: shutdown.status,
    exitCode,
    credentialLeak,
    smokeRoot,
  };
  console.log(JSON.stringify(result));
  if (ready.pid !== child.pid || !result.sessionMatches || unauthenticated.status !== 401
    || authenticated.status !== 200 || !result.authenticatedHealth || shutdown.status !== 202
    || exitCode !== 0 || credentialLeak) process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill();
}
