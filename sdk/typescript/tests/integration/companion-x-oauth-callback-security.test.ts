import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(__dirname, "..", "..");
const serverEntry = join(root, "examples", "companion", "server.ts");
const tsxEntry = join(root, "node_modules", "tsx", "dist", "cli.mjs");

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function request(input: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1",
      port: input.port,
      method: input.method,
      path: input.path,
      headers: input.headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => resolveRequest({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (input.body) req.write(input.body);
    req.end();
  });
}

const crossSiteNavigationHeaders = {
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-user": "?1",
};

test("X OAuth 回调只为合法一次性 state 的顶层 cross-site GET 导航开窄口", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "clownfish-oauth-security-"));
  const port = await freePort();
  const clientToken = "oauth-security-integration-token";
  let logs = "";
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [tsxEntry, serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      CLOWNFISH_HOME: home,
      CLOWNFISH_CLIENT_TOKEN: clientToken,
      CLOWNFISH_CLIENT_SESSION: "oauth-security-test-session",
      ZHIPU_API_KEY: "",
      X_CLIENT_SECRET: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const append = (chunk: Buffer) => { logs = (logs + chunk.toString("utf8")).slice(-20_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
      ]);
    }
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    } catch {
      // Windows 上服务刚退出时可能短暂持有 SQLite 文件；仅保留系统临时目录。
    }
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("Companion 启动即退出：\n" + logs);
    if (Date.now() > deadline) throw new Error("Companion 启动超时：\n" + logs);
    try {
      const health = await request({
        port,
        method: "GET",
        path: "/api/health",
        headers: { "x-clownfish-client": clientToken },
      });
      if (health.status === 200) break;
    } catch {
      // 初始化本机隔离数据库期间尚未监听。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  const startBody = JSON.stringify({ clientId: "oauth-security-test-client" });
  const started = await request({
    port,
    method: "POST",
    path: "/api/sources/x/oauth/start",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(startBody)),
      "x-clownfish-client": clientToken,
    },
    body: startBody,
  });
  assert.equal(started.status, 200, started.text);
  const state = String((JSON.parse(started.text) as { state?: string }).state || "");
  assert.match(state, /^[A-Za-z0-9_-]{20,}$/);
  const callback = `/api/sources/x/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`;

  const rejected = [
    await request({ port, method: "GET", path: `/api/health?state=${encodeURIComponent(state)}`, headers: crossSiteNavigationHeaders }),
    await request({ port, method: "GET", path: callback.replace("/callback?", "/callback/extra?"), headers: crossSiteNavigationHeaders }),
    await request({ port, method: "GET", path: "/api/sources/x/oauth/callback?error=access_denied", headers: crossSiteNavigationHeaders }),
    await request({ port, method: "GET", path: "/api/sources/x/oauth/callback?error=access_denied&state=invalid", headers: crossSiteNavigationHeaders }),
    await request({ port, method: "POST", path: callback, headers: crossSiteNavigationHeaders }),
    await request({ port, method: "GET", path: callback, headers: { ...crossSiteNavigationHeaders, "sec-fetch-mode": "cors" } }),
    await request({ port, method: "GET", path: callback, headers: { ...crossSiteNavigationHeaders, origin: "https://attacker.example" } }),
    await request({ port, method: "GET", path: callback, headers: { ...crossSiteNavigationHeaders, host: `attacker.example:${port}` } }),
    await request({ port, method: "GET", path: `http://attacker.example${callback}`, headers: crossSiteNavigationHeaders }),
    await request({ port, method: "GET", path: `//attacker.example${callback}`, headers: crossSiteNavigationHeaders }),
  ];
  for (const response of rejected) assert.equal(response.status, 403, response.text);

  // 上述恶意请求都不得消费 state；真实浏览器回跳头组合会穿过通用守卫并抵达路由。
  const validDenial = await request({ port, method: "GET", path: callback, headers: crossSiteNavigationHeaders });
  assert.equal(validDenial.status, 400, validDenial.text);
  assert.match(validDenial.headers["content-security-policy"] as string, /default-src 'none'/);
  assert.equal(validDenial.headers["referrer-policy"], "no-referrer");
  assert.equal(validDenial.headers["cache-control"], "no-store");
  assert.equal(validDenial.headers["x-content-type-options"], "nosniff");
  assert.equal(validDenial.headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(validDenial.headers["cross-origin-resource-policy"], "same-origin");
  assert.doesNotMatch(validDenial.text, /<script\b/i);

  // 路由处理过的 state 已唯一消费，重放在通用守卫处即被拒绝。
  const replay = await request({ port, method: "GET", path: callback, headers: crossSiteNavigationHeaders });
  assert.equal(replay.status, 403, replay.text);
});
