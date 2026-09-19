import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import test from "node:test";
import { fetch as undiciFetch } from "undici";

import { createDynamicOutboundDispatcher, installOutboundProxy } from "../../examples/companion/proxy-dispatcher.js";
import { fetchCompanionModelCatalog, type CompanionModelConnection } from "../../examples/companion/model-connection.js";
import { checkSingleCompanionModel } from "../../examples/companion/model-readiness.js";
import { DPAPI_ONLY, startModelHarness } from "../fixtures/companion-model-harness.js";
import { onboardModel } from "../helpers/onboard-model.js";

async function listen(server: Server): Promise<number> {
  for (;;) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    // WHATWG Fetch rejects a fixed list of unsafe ports before touching the
    // network; its highest entry is 10080. An OS-assigned test port in that
    // range makes the proxy fixture fail with `bad port` despite listening.
    if (port > 10080) return port;
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
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
    const path = req.url?.startsWith("http") ? new URL(req.url).pathname : req.url || "/";
    const upstream = httpRequest({ host: "127.0.0.1", port: targetPort, method: req.method, path,
      headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } }, (reply) => {
      res.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end("proxy upstream failed"); });
    req.pipe(upstream);
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

test("动态请求快照在 direct/PAC/proxy down/A-B 变化时 fail-closed 且可恢复", { timeout: 60_000 }, async () => {
  const seenA: string[] = [], seenB: string[] = [];
  const targetA = createServer(async (req, res) => { let body = ""; for await (const chunk of req) body += chunk; seenA.push(body); res.end("A"); });
  const targetB = createServer(async (req, res) => { let body = ""; for await (const chunk of req) body += chunk; seenB.push(body); res.end("B"); });
  const portA = await listen(targetA), portB = await listen(targetB);
  const proxyA = startProxy(portA), proxyB = startProxy(portB);
  const proxyPortA = await listen(proxyA.server), proxyPortB = await listen(proxyB.server);
  let state = { fingerprint: "direct-1", resolved: undefined as { httpProxy: string; httpsProxy: string; noProxy: string } | undefined, error: "" };
  const dynamic = createDynamicOutboundDispatcher(() => state);
  const endpoint = `http://127.0.0.1:${portA}/model`;
  try {
    assert.equal(await (await undiciFetch(endpoint, { method: "POST", body: "DIRECT", dispatcher: dynamic })).text(), "A");
    state = { fingerprint: "pac-2", resolved: undefined, error: "检测到 PAC/WPAD/自动代理" };
    await assert.rejects(undiciFetch(endpoint, { method: "POST", body: "MUST_NOT_LEAK", dispatcher: dynamic }), (error: unknown) => {
      const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
      return cause instanceof Error && /PAC\/WPAD/.test(cause.message);
    });
    assert.deepEqual(seenA, ["DIRECT"], "PAC 错误不得沿用旧 direct 发送正文");

    state = { fingerprint: "proxy-a-3", resolved: { httpProxy: `http://127.0.0.1:${proxyPortA}`, httpsProxy: `http://127.0.0.1:${proxyPortA}`, noProxy: "" }, error: "" };
    assert.equal(await (await undiciFetch(endpoint, { method: "POST", body: "VIA_A", dispatcher: dynamic })).text(), "A");
    await proxyA.close();
    await assert.rejects(undiciFetch(endpoint, { method: "POST", body: "DOWN_MUST_NOT_LEAK", dispatcher: dynamic }), (error: unknown) => {
      const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
      return cause instanceof Error && /系统代理连接失败/.test(cause.message);
    });

    state = { fingerprint: "proxy-b-4", resolved: { httpProxy: `http://127.0.0.1:${proxyPortB}`, httpsProxy: `http://127.0.0.1:${proxyPortB}`, noProxy: "" }, error: "" };
    assert.equal(await (await undiciFetch(endpoint, { method: "POST", body: "VIA_B", dispatcher: dynamic })).text(), "B");
    assert.deepEqual(seenB, ["VIA_B"]);
  } finally {
    await dynamic.closeRoutes();
    targetA.closeAllConnections(); targetB.closeAllConnections();
    await new Promise<void>((done) => targetA.close(() => done()));
    await new Promise<void>((done) => targetB.close(() => done()));
    await proxyB.close();
  }
});

test("动态连接池在缓存连接和挂起请求存在时可有界关闭", { timeout: 10_000 }, async () => {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const target = createServer((_req, _res) => { requestStarted(); });
  const port = await listen(target);
  const dispatcher = createDynamicOutboundDispatcher(() => ({ fingerprint: "shutdown-route", resolved: undefined, error: "" }));
  const pending = undiciFetch(`http://127.0.0.1:${port}/hang`, { dispatcher });
  void pending.catch(() => undefined);
  try {
    await started;
    const began = Date.now();
    await Promise.race([
      dispatcher.closeRoutes(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("dispatcher shutdown exceeded deadline")), 1500)),
    ]);
    assert.ok(Date.now() - began < 1500);
    await assert.rejects(pending);
  } finally {
    target.closeAllConnections();
    await new Promise<void>((done) => target.close(() => done()));
  }
});

test("已保存连接的目录与四轮高级检查在 direct→代理 A→B 时使用同一动态策略", { timeout: 90_000 }, async () => {
  const h = await startModelHarness();
  const targetPort = Number(new URL(h.modelBase).port);
  const proxyA = startProxy(targetPort), proxyB = startProxy(targetPort);
  const proxyPortA = await listen(proxyA.server), proxyPortB = await listen(proxyB.server);
  let state = { fingerprint: "direct", resolved: undefined as { httpProxy: string; httpsProxy: string; noProxy: string } | undefined, error: "" };
  const dispatcher = createDynamicOutboundDispatcher(() => state);
  const connection: CompanionModelConnection = {
    provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1",
    model: "ready", apiKey: "proxy-fixture-key", transportDispatcher: dispatcher,
  };
  try {
    assert.equal((await fetchCompanionModelCatalog(connection)).length, 4);
    assert.equal((await checkSingleCompanionModel(connection, "ready")).tools, "passed");
    assert.equal(proxyA.seen.length + proxyB.seen.length, 0, "direct 阶段不能误用代理");

    state = { fingerprint: "proxy-a", resolved: { httpProxy: `http://127.0.0.1:${proxyPortA}`, httpsProxy: `http://127.0.0.1:${proxyPortA}`, noProxy: "" }, error: "" };
    assert.equal((await fetchCompanionModelCatalog(connection)).length, 4);
    assert.equal((await checkSingleCompanionModel(connection, "ready")).tools, "passed");
    assert.equal(proxyA.seen.filter((entry) => entry.includes("/v1/models")).length, 1);
    assert.ok(proxyA.seen.filter((entry) => entry.includes("/v1/chat/completions")).length >= 4, JSON.stringify(proxyA.seen));
    const proxyAAfterItsRound = proxyA.seen.length;

    state = { fingerprint: "proxy-b", resolved: { httpProxy: `http://127.0.0.1:${proxyPortB}`, httpsProxy: `http://127.0.0.1:${proxyPortB}`, noProxy: "" }, error: "" };
    assert.equal((await fetchCompanionModelCatalog(connection)).length, 4);
    assert.equal((await checkSingleCompanionModel(connection, "ready")).tools, "passed");
    assert.equal(proxyA.seen.length, proxyAAfterItsRound, "切换到 B 后目录和检查正文都不得继续发给旧代理 A");
    assert.equal(proxyB.seen.filter((entry) => entry.includes("/v1/models")).length, 1);
    assert.ok(proxyB.seen.filter((entry) => entry.includes("/v1/chat/completions")).length >= 4, JSON.stringify(proxyB.seen));
  } finally {
    await dispatcher.closeRoutes();
    await h.stop();
    await proxyA.close();
    await proxyB.close();
  }
});

test("保存待验证修改不切换运行连接；并发 chat 继续使用旧代理", { timeout: 90_000, skip: DPAPI_ONLY }, async () => {
  const h = await startModelHarness();
  const targetPort = Number(new URL(h.modelBase).port);
  const oldProxy = startProxy(targetPort);
  const proxyPort = await listen(oldProxy.server);
  const post = async (path: string, body: unknown) => {
    const response = await fetch(h.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { response, value: await response.json() as any };
  };
  try {
    await post("/api/outbound-proxy", { mode: "explicit", url: `http://127.0.0.1:${proxyPort}` });
    await onboardModel(h.base, { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "chat-only", selectionMode: "manual", key: "old-route-key" });
    const active = await (await fetch(h.base + "/api/llm")).json() as any;
    const staged = await post("/api/llm-connection/save", {
      provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/no-catalog", model: "chat-only", key: "staged-key" });
    assert.equal(staged.response.status, 200, JSON.stringify(staged.value));
    assert.equal(staged.value.activationRequired, false);
    const concurrent = await post("/api/chat", { text: "MUST_NOT_ROUTE_DURING_SWITCH", target: { kind: "persona", id: "clownfish" }, sessionId: "proxy-concurrent", workMode: "task", model: "chat-only", toolMode: "off" });
    assert.equal(concurrent.response.status, 200, JSON.stringify(concurrent.value));
    const after = await post("/api/chat", { text: "OLD_PROXY_AFTER_ROLLBACK", target: { kind: "persona", id: "clownfish" }, sessionId: "proxy-after", workMode: "task", model: "chat-only", toolMode: "off" });
    assert.equal(after.response.status, 200, JSON.stringify(after.value));
    const proxyStatus = await (await fetch(h.base + "/api/outbound-proxy")).json() as any;
    assert.equal(proxyStatus.settings.mode, "explicit");
    assert.equal(proxyStatus.status.host, `http://127.0.0.1:${proxyPort}`);
    const restored = await (await fetch(h.base + "/api/llm")).json() as any;
    assert.equal(restored.connectionRevision, active.connectionRevision);
    assert.equal(restored.networkFingerprint, active.networkFingerprint);
  } finally {
    await h.stop();
    await oldProxy.close();
  }
});

test("接口默认自动、拒绝带凭据的地址并把可操作提示原样透出", { timeout: 90_000 }, async () => {
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
    assert.equal(initial.settings.mode, process.platform === "win32" ? "auto" : "direct");

    // send() 会把 4xx 的 error 换成通用文案，除非路由显式给出 userMessage。
    // 这条断言钉住"提示要能指导用户下一步做什么"。
    const credentialed = await post({ mode: "explicit", url: "http://user:secret@127.0.0.1:7897" });
    assert.equal(credentialed.status, 400);
    assert.match(credentialed.body.error, /不能内嵌用户名或密码/);
    assert.match(credentialed.body.error, /环境变量/);
    assert.ok(!JSON.stringify(credentialed.body).includes("secret"), "报错不得回显凭据");
    assert.equal((await get()).settings.mode, initial.settings.mode, "校验失败不得改动已保存的设置");

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
