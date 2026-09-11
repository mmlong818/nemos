// files 域从 if 链搬到路由表之后的端到端回归。
// 盯两件搬运后才成立的事：带 query 的请求能命中；不合规的 body 被挡在处理函数之外。
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(__dirname, "..", "..");
const serverEntry = join(root, "examples", "companion", "server.ts");
const tsxEntry = join(root, "node_modules", "tsx", "dist", "cli.mjs");

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((ok, fail) => { probe.once("error", fail); probe.listen(0, "127.0.0.1", ok); });
  const address = probe.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((ok, fail) => { probe.close((error) => error ? fail(error) : ok()); });
  return port;
}

async function call(baseUrl: string, method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, data };
}

test("files 域路由表：query 命中、body 校验、未迁移路由不受影响", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "clownfish-route-table-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = "";
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [tsxEntry, serverEntry], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NEMOS_COMPANION_HOME: home, ZHIPU_API_KEY: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const append = (chunk: Buffer) => { logs = (logs + chunk.toString("utf8")).slice(-20_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        new Promise<void>((ok) => child.once("exit", () => ok())),
        new Promise<void>((ok) => setTimeout(ok, 5_000)),
      ]);
    }
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    } catch {
      // Windows 上刚停掉的服务进程可能还攥着 SQLite 句柄，临时目录留到本进程退出即可。
    }
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("小丑鱼启动即退出：\n" + logs);
    if (Date.now() > deadline) throw new Error("小丑鱼启动超时：\n" + logs);
    try { if ((await fetch(baseUrl + "/api/runtime")).ok) break; } catch { /* 还在初始化本机数据库 */ }
    await new Promise((ok) => setTimeout(ok, 100));
  }

  // 搬到表里之后，pathname 是唯一匹配口径。
  assert.equal((await call(baseUrl, "GET", "/api/files")).status, 200, "GET /api/files 应可用");
  const withQuery = await call(baseUrl, "GET", "/api/files?ownerKind=task&ownerId=abc");
  assert.equal(withQuery.status, 200, "带 query 的 GET /api/files 必须命中——原来 `url ===` 写法会 404");
  assert.equal(withQuery.data.ok, true);
  assert.equal((await call(baseUrl, "GET", "/api/files/workbench")).status, 200);

  // 处理函数自己的错误路径仍然照旧。
  assert.equal((await call(baseUrl, "GET", "/api/files/session?id=不存在")).status, 404);

  // body 形状校验：不合规一律 400，且给出可读说明。
  for (const [label, bad] of [
    ["取值不在枚举内", { id: "x", status: "nope" }],
    ["多了未声明字段", { id: "x", status: "active", extra: 1 }],
    ["字段类型不对", { id: 5, status: "active" }],
  ] as const) {
    const rejected = await call(baseUrl, "POST", "/api/files/status", bad);
    assert.equal(rejected.status, 400, `${label} 应被挡下`);
    // send() 对 4xx 只放行 userMessage，并把它顶替到 error 字段上。
    assert.ok(String(rejected.data.error || "").length > 0, `${label} 应给出说明`);
    assert.doesNotMatch(String(rejected.data.error), /must be|schema is false/, `${label} 不该透出校验器英文原文`);
  }
  const restoreRejected = await call(baseUrl, "POST", "/api/files/session/restore", { id: 5 });
  assert.equal(restoreRejected.status, 400);

  // 仍在 if 链里的路由不受影响。
  assert.equal((await call(baseUrl, "GET", "/api/health")).status, 200);
  assert.equal((await call(baseUrl, "GET", "/api/state")).status, 200);
});
