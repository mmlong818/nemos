import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const portableRoot = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: portable-x-oauth-security-smoke.mjs <portable-root>");
const smokeRoot = mkdtempSync(join(tmpdir(), "clownfish-portable-oauth-"));
const token = "portable-oauth-smoke-token-never-log-7f91c2";
const session = "portableoauth7f91c2";
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
    ZHIPU_API_KEY: "",
    X_CLIENT_SECRET: "",
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
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`OAuth packaged smoke READY timeout: ${stderr}`)), 45_000);
    const inspect = () => {
      const line = stdout.split(/\r?\n/).find((value) => value.startsWith("CLOWNFISH_READY "));
      if (!line) return;
      clearTimeout(timeout);
      resolveReady(JSON.parse(line.slice("CLOWNFISH_READY ".length)));
    };
    child.stdout.on("data", inspect);
    child.once("exit", (code) => reject(new Error(`OAuth packaged smoke exited before READY (${code}): ${stderr}`)));
    inspect();
  });
}

function request(port, method, path, headers = {}, body = "") {
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolveRequest({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function readTree(directory) {
  let combined = "";
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    combined += entry.isDirectory() ? readTree(path) : readFileSync(path).toString("utf8");
  }
  return combined;
}

const navigation = {
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-user": "?1",
};

try {
  const ready = await waitForReady();
  const port = ready.port;
  const body = JSON.stringify({ clientId: "portable-oauth-smoke-client" });
  const started = await request(port, "POST", "/api/sources/x/oauth/start", {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
    "x-clownfish-client": token,
  }, body);
  if (started.status !== 200) throw new Error(`OAuth start failed: ${started.status}`);
  const state = String(JSON.parse(started.text).state ?? "");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(state)) throw new Error("OAuth start returned no valid state");
  const callback = `/api/sources/x/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`;

  const malicious = [
    await request(port, "GET", `/api/health?state=${encodeURIComponent(state)}`, navigation),
    await request(port, "GET", callback.replace("/callback?", "/callback/extra?"), navigation),
    await request(port, "GET", "/api/sources/x/oauth/callback?error=access_denied&state=invalid", navigation),
    await request(port, "POST", callback, navigation),
    await request(port, "GET", callback, { ...navigation, "sec-fetch-mode": "cors" }),
    await request(port, "GET", callback, { ...navigation, origin: "https://attacker.example" }),
    await request(port, "GET", callback, { ...navigation, host: `attacker.example:${port}` }),
  ];
  const valid = await request(port, "GET", callback, navigation);
  const replay = await request(port, "GET", callback, navigation);
  const shutdown = await request(port, "POST", "/api/shutdown", { "x-clownfish-client": token });
  await new Promise((resolveExit) => child.once("exit", resolveExit));

  const result = {
    appId: ready.appId,
    version: ready.version,
    sessionMatches: ready.clientSession === session,
    maliciousStatuses: malicious.map((response) => response.status),
    validCallbackStatus: valid.status,
    replayStatus: replay.status,
    csp: String(valid.headers["content-security-policy"] || "").includes("default-src 'none'"),
    noReferrer: valid.headers["referrer-policy"] === "no-referrer",
    noStore: valid.headers["cache-control"] === "no-store",
    shutdownStatus: shutdown.status,
    credentialLeak: `${stdout}\n${stderr}\n${readTree(smokeRoot)}`.includes(token),
  };
  console.log(JSON.stringify(result));
  if (!result.sessionMatches || result.maliciousStatuses.some((status) => status !== 403)
    || result.validCallbackStatus !== 400 || result.replayStatus !== 403
    || !result.csp || !result.noReferrer || !result.noStore
    || result.shutdownStatus !== 202 || result.credentialLeak) process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill();
  try { rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); } catch { /* isolated temp only */ }
}
