// 同步服务的第一份测试。它是暴露在网络上的服务，此前既没有测试也不在 typecheck 范围内。
//
// 盯的核心是错误返回的边界：自己写死的消息照常外传，没预料到的异常一律换成通用文案——
// JSON.parse 的报错会带出正文片段与位置，fs 的报错会带出 dataDir 下的真实路径。
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const service = resolve(__dirname, "..", "..", "..", "..", "sync-service", "server.mjs");
const TOKEN = "token-with-at-least-24-characters";

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((ok, fail) => { probe.once("error", fail); probe.listen(0, "127.0.0.1", ok); });
  const address = probe.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((ok, fail) => { probe.close((error) => error ? fail(error) : ok()); });
  return port;
}

interface Harness {
  base: string;
  dataDir: string;
  call: (method: string, path: string, options?: { token?: string; user?: string; body?: string; ifMatch?: string })
    => Promise<{ status: number; data: Record<string, unknown>; text: string }>;
}

async function withService(run: (h: Harness) => Promise<void>, maxBytes?: number): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "clownfish-sync-"));
  const port = await freePort();
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [service], {
    env: {
      ...process.env,
      PORT: String(port),
      CLOWNFISH_SYNC_DATA: dataDir,
      CLOWNFISH_SYNC_TOKEN: TOKEN,
      ...(maxBytes ? { CLOWNFISH_SYNC_MAX_BYTES: String(maxBytes) } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (c: Buffer) => { logs += c.toString("utf8"); });
  child.stderr.on("data", (c: Buffer) => { logs += c.toString("utf8"); });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error("同步服务启动即退出：" + logs);
      if (Date.now() > deadline) throw new Error("同步服务启动超时：" + logs);
      try { if ((await fetch(base + "/health")).ok) break; } catch { /* 还没监听 */ }
      await new Promise((ok) => setTimeout(ok, 100));
    }
    await run({
      base,
      dataDir,
      call: async (method, path, options = {}) => {
        const headers: Record<string, string> = {
          authorization: "Bearer " + (options.token ?? TOKEN),
          "x-clownfish-user": options.user ?? "me",
        };
        if (options.ifMatch) headers["if-match"] = options.ifMatch;
        if (options.body !== undefined) headers["content-type"] = "application/json";
        const response = await fetch(base + path, { method, headers, body: options.body });
        const text = await response.text();
        let data: Record<string, unknown> = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
        return { status: response.status, data, text };
      },
    });
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise<void>((ok) => child.once("exit", () => ok())),
        new Promise<void>((ok) => setTimeout(ok, 5_000)),
      ]);
    }
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
}

const snapshot = JSON.stringify({ version: 1, ciphertext: "AAAA", sha256: "x", salt: "s", iv: "i", tag: "t" });

test("自己写死的拒绝消息照常外传，状态码不变", async () => {
  await withService(async (h) => {
    assert.equal((await h.call("GET", "/nope")).status, 404);
    assert.equal((await h.call("GET", "/v1/snapshots/latest", { token: "wrong-token-but-same-length!" })).status, 401);
    assert.deepEqual(await h.call("DELETE", "/v1/snapshots/latest").then((r) => [r.status, r.data.error]), [405, "method not allowed"]);
    assert.deepEqual(await h.call("GET", "/v1/snapshots/latest", { user: "../escape" }).then((r) => [r.status, r.data.error]),
      [400, "invalid sync user"]);
    assert.deepEqual(await h.call("PUT", "/v1/snapshots/latest", { body: '{"version":2}' }).then((r) => [r.status, r.data.error]),
      [400, "invalid encrypted snapshot"]);
  });
});

test("请求体不是合法 JSON：回自写文案，不带解析位置也不带正文片段", async () => {
  await withService(async (h) => {
    const bad = await h.call("PUT", "/v1/snapshots/latest", { body: '{"version":1,"secret":"SHOULD-NOT-ECHO",' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, "request body is not valid JSON");
    assert.doesNotMatch(bad.text, /SHOULD-NOT-ECHO/, "不能把请求正文回显给调用方");
    assert.doesNotMatch(bad.text, /position|Unexpected|JSON\.parse/i, "不能把解析器报错外传");
  });
});

test("服务端自身故障不外泄路径：损坏的快照只回通用文案", async () => {
  await withService(async (h) => {
    assert.equal((await h.call("PUT", "/v1/snapshots/latest", { body: snapshot })).status, 200);
    const stored = readdirSync(h.dataDir).find((name) => name.endsWith(".json"));
    assert.ok(stored, "应当已经落盘一个快照文件");
    writeFileSync(join(h.dataDir, stored), "{ 这不是 JSON");

    const broken = await h.call("GET", "/v1/snapshots/latest");
    assert.equal(broken.status, 500, "服务端自己的问题应当是 5xx，不是 400");
    assert.equal(broken.data.error, "internal failure; see the service log");
    assert.equal(broken.text.includes("/") || broken.text.includes("\\"), false, "响应里不能出现任何路径分隔符");
    assert.doesNotMatch(broken.text, /clownfish-sync-|JSON|token/i, "不能泄漏 dataDir、解析器细节或令牌");
  });
});

test("超出体积上限回 413，且是自写文案", async () => {
  await withService(async (h) => {
    // 上限设成 64 字节，正文远超它——服务端在读流时就该中断，不等到解析。
    const huge = await h.call("PUT", "/v1/snapshots/latest", { body: '{"version":1,"ciphertext":"' + "A".repeat(400) + '"}' });
    assert.equal(huge.status, 413);
    assert.equal(huge.data.error, "snapshot is too large");
    assert.equal(huge.text.includes("A".repeat(40)), false, "不能把超限的正文回显出来");
  }, 64);
});

test("正常读写与并发冲突：ETag 比对保持原有语义", async () => {
  await withService(async (h) => {
    const empty = await h.call("GET", "/v1/snapshots/latest");
    assert.deepEqual([empty.status, empty.data.snapshot, empty.data.revision], [200, null, ""]);

    const first = await h.call("PUT", "/v1/snapshots/latest", { body: snapshot });
    assert.equal(first.status, 200);
    const revision = String(first.data.revision);
    assert.ok(revision.length > 2);

    const conflict = await h.call("PUT", "/v1/snapshots/latest", { body: snapshot });
    assert.deepEqual([conflict.status, conflict.data.error],
      [409, "server already has data; pull it before the first upload"]);

    const stale = await h.call("PUT", "/v1/snapshots/latest", { body: snapshot, ifMatch: '"stale"' });
    assert.deepEqual([stale.status, stale.data.error],
      [409, "server data changed on another device; pull before uploading"]);

    const ok = await h.call("PUT", "/v1/snapshots/latest", { body: snapshot, ifMatch: revision });
    assert.equal(ok.status, 200);

    // 不同用户各自隔离
    const other = await h.call("GET", "/v1/snapshots/latest", { user: "someone-else" });
    assert.equal(other.data.snapshot, null);
  });
});
