import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import test from "node:test";

import { installOutboundProxy } from "../../examples/companion/proxy-dispatcher.js";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}

/**
 * 真实的本机代理夹具。绝对形式的请求与 CONNECT 隧道都记账，两条路都转发到目标夹具，
 * 这样无论 undici 对 http 源用哪一种，断言都成立；被请求的主机名本身不需要能解析。
 */
function startProxy(targetPort: number) {
  const seen: string[] = [];
  const sockets = new Set<Duplex>();
  const server = createServer((req, res) => {
    seen.push(`request ${req.url}`);
    const upstream = connect(targetPort, "127.0.0.1", () => {
      const path = req.url?.startsWith("http") ? new URL(req.url).pathname : req.url || "/";
      upstream.write(`GET ${path} HTTP/1.1\r\nHost: proxied\r\nConnection: close\r\n\r\n`);
    });
    sockets.add(upstream);
    let raw = "";
    upstream.on("data", (chunk) => { raw += chunk.toString("utf8"); });
    upstream.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(raw.split("\r\n\r\n").slice(1).join("\r\n\r\n"));
    });
    upstream.on("error", () => { res.writeHead(502); res.end("proxy upstream failed"); });
  });
  server.on("connect", (req, clientSocket, head) => {
    seen.push(`connect ${req.url}`);
    const upstream = connect(targetPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    sockets.add(upstream);
    sockets.add(clientSocket);
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  return {
    server,
    seen,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

test("装上代理后基于 fetch 的出站确实穿代理，而回环目标仍然直连", { timeout: 60_000 }, async () => {
  const model = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  const modelPort = await listen(model);
  const proxy = startProxy(modelPort);
  const proxyPort = await listen(proxy.server);
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  try {
    installOutboundProxy({ httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy: "localhost,127.0.0.1,::1" });

    // 目标主机名不需要能被解析：走代理时由代理负责解析，这也正是代理生效的证据。
    const throughProxy = await fetch("http://model.invalid/v1/ping");
    assert.equal(throughProxy.status, 200);
    assert.deepEqual(await throughProxy.json(), { ok: true });
    assert.ok(proxy.seen.some((entry) => entry.includes("model.invalid")),
      `代理应当看到这次请求，实际记录：${JSON.stringify(proxy.seen)}`);

    // 回环目标必须直连，否则配了代理的人用不了本机模型服务。
    const before = proxy.seen.length;
    const direct = await fetch(`http://127.0.0.1:${modelPort}/v1/ping`);
    assert.equal(direct.status, 200);
    assert.deepEqual(await direct.json(), { ok: true });
    assert.equal(proxy.seen.length, before, `回环请求不该经过代理，实际记录：${JSON.stringify(proxy.seen.slice(before))}`);
  } finally {
    installOutboundProxy(undefined);
    await proxy.close();
    model.closeAllConnections();
    await new Promise<void>((done) => model.close(() => done()));
  }
});

test("恢复后回环之外的地址也不再经过已关闭的代理", { timeout: 60_000 }, async () => {
  const model = createServer((_req, res) => { res.end("{}"); });
  const modelPort = await listen(model);
  try {
    installOutboundProxy(undefined);
    const response = await fetch(`http://127.0.0.1:${modelPort}/v1/ping`);
    assert.equal(response.status, 200);
    await response.text();
  } finally {
    model.closeAllConnections();
    await new Promise<void>((done) => model.close(() => done()));
  }
});

test("接口默认关闭、拒绝带凭据的地址并把可操作提示原样透出", { timeout: 90_000 }, async () => {
  const h = await startModelHarness();
  const get = async () => await (await fetch(h.base + "/api/outbound-proxy")).json() as any;
  const post = async (body: unknown) => {
    const response = await fetch(h.base + "/api/outbound-proxy", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const initial = await get();
    assert.equal(initial.settings.mode, "off");
    assert.equal(initial.status.installed, false, "默认不得安装 dispatcher");

    // send() 会把 4xx 的 error 换成通用文案，除非路由显式给出 userMessage。
    // 这条断言钉住"提示要能指导用户下一步做什么"。
    const credentialed = await post({ mode: "explicit", url: "http://user:secret@127.0.0.1:7897" });
    assert.equal(credentialed.status, 400);
    assert.match(credentialed.body.error, /不能内嵌用户名或密码/);
    assert.match(credentialed.body.error, /环境变量/);
    assert.ok(!JSON.stringify(credentialed.body).includes("secret"), "报错不得回显凭据");
    assert.equal((await get()).settings.mode, "off", "校验失败不得改动已保存的设置");

    // 显式地址保存后立刻生效，且回环无条件进入直连名单。
    const saved = await post({ mode: "explicit", url: "http://127.0.0.1:7897", noProxy: ["example.com"] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.status.installed, true);
    assert.equal(saved.body.status.host, "http://127.0.0.1:7897");
    for (const host of ["localhost", "127.0.0.1", "::1", "example.com"]) {
      assert.ok(saved.body.status.bypass.includes(host), `${host} 应在直连名单里`);
    }

    const off = await post({ mode: "off" });
    assert.equal(off.status, 200);
    assert.equal(off.body.status.installed, false, "关回去必须真的卸掉");
  } finally { await h.stop(); }
});
