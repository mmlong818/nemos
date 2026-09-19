import assert from "node:assert/strict";
import test from "node:test";

import { assertLoopbackProxyReady, parseWindowsProxyBypass, parseWindowsProxyServer, readWindowsSystemProxy } from "../../examples/companion/windows-system-proxy.js";

test("Windows 固定代理解析支持单地址与按协议地址，拒绝带凭据地址", () => {
  assert.deepEqual(parseWindowsProxyServer("127.0.0.1:7897"), {
    httpProxy: "http://127.0.0.1:7897", httpsProxy: "http://127.0.0.1:7897",
  });
  assert.deepEqual(parseWindowsProxyServer("http=proxy.local:8080;https=secure.local:8443"), {
    httpProxy: "http://proxy.local:8080", httpsProxy: "http://secure.local:8443",
  });
  assert.deepEqual(parseWindowsProxyServer("http://user:secret@proxy.local:8080"), {});
  assert.deepEqual(parseWindowsProxyBypass("<local>;*.example.com;127.0.0.1:80"), [".example.com", "127.0.0.1"]);
});

test("读取 Internet Settings 只返回固定元数据，PAC 只标记不读取", { skip: process.platform !== "win32" }, () => {
  const values: Record<string, string> = {
    ProxyEnable: "0x1", ProxyServer: "127.0.0.1:7897", ProxyOverride: "<local>;*.example.com", AutoConfigURL: "",
  };
  const run = ((_file: string, args: string[]) => {
    const name = args.at(-1) || "";
    return `${name}    REG_SZ    ${values[name] || ""}`;
  }) as any;
  assert.deepEqual(readWindowsSystemProxy(run), {
    httpProxy: "http://127.0.0.1:7897", httpsProxy: "http://127.0.0.1:7897",
    bypass: [".example.com"], source: "internet-settings",
  });
  values.AutoConfigURL = "https://config.invalid/proxy.pac";
  assert.deepEqual(readWindowsSystemProxy(run), {
    bypass: [".example.com"], source: "internet-settings", pacUrl: "configured",
  });
  values.AutoConfigURL = "";
  values.AutoDetect = "0x1";
  assert.deepEqual(readWindowsSystemProxy(run), {
    bypass: [".example.com"], source: "internet-settings", autoDetect: true,
  });
});

test("loopback 代理未监听时 fail-closed", async () => {
  await assert.rejects(assertLoopbackProxyReady({
    httpProxy: "http://127.0.0.1:1", httpsProxy: "http://127.0.0.1:1", noProxy: "localhost",
  }, 100), /代理端口未监听/);
});
