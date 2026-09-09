import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultOutboundProxySettings,
  normalizeOutboundProxySettings,
  publicOutboundProxy,
  resolveOutboundProxy,
  OutboundProxyError,
  OUTBOUND_PROXY_LIMITS,
} from "../../examples/companion/outbound-proxy.js";
import { installOutboundProxy, outboundProxyInstalled } from "../../examples/companion/proxy-dispatcher.js";

const bypassOf = (value: { noProxy: string } | undefined) => new Set((value?.noProxy || "").split(",").filter(Boolean));

test("默认关闭；关闭时不读环境变量，也解析不出任何代理", () => {
  const settings = defaultOutboundProxySettings();
  assert.equal(settings.mode, "off");
  assert.deepEqual(settings.noProxy, []);
  assert.equal(resolveOutboundProxy(settings, { HTTPS_PROXY: "http://127.0.0.1:7897" }), undefined,
    "关闭状态即使环境里有代理也必须解析为空，否则等于替用户改了出站路径");
});

test("跟随环境变量：没有代理变量就解析为空，等于不安装", () => {
  const settings = normalizeOutboundProxySettings({ mode: "environment" });
  assert.equal(resolveOutboundProxy(settings, {}), undefined);
  assert.equal(resolveOutboundProxy(settings, { NO_PROXY: "example.com" }), undefined,
    "只有 NO_PROXY 而没有代理地址时不算配了代理");
  const resolved = resolveOutboundProxy(settings, { HTTPS_PROXY: "http://proxy.internal:8080" });
  assert.equal(resolved?.httpsProxy, "http://proxy.internal:8080");
  assert.equal(resolved?.httpProxy, "http://proxy.internal:8080", "只给了 https 时 http 沿用同一个地址");
});

test("回环与私网无条件直连，即使用户一条直连规则都没写", () => {
  const settings = normalizeOutboundProxySettings({ mode: "explicit", url: "http://127.0.0.1:7897" });
  const resolved = resolveOutboundProxy(settings, {}, [
    "http://127.0.0.1:1234/v1",
    "http://192.168.1.50:11434/v1",
    "https://api.openai.com/v1",
  ]);
  const bypass = bypassOf(resolved);
  for (const host of ["localhost", "127.0.0.1", "::1", "192.168.1.50"]) {
    assert.ok(bypass.has(host), `${host} 必须直连`);
  }
  assert.ok(!bypass.has("api.openai.com"), "公网模型地址不能因为是模型地址就绕过代理");
});

test("显式地址拒绝内嵌凭据与多余成分，需要登录的代理只能走环境变量模式", () => {
  const bad = [
    { mode: "explicit", url: "http://user:secret@proxy.internal:8080" },
    { mode: "explicit", url: "socks5://127.0.0.1:1080" },
    { mode: "explicit", url: "http://127.0.0.1:7897/path" },
    { mode: "explicit", url: "http://127.0.0.1:7897/?a=1" },
    { mode: "explicit", url: "not-a-url" },
    { mode: "explicit", url: "" },
    { mode: "explicit" },
  ];
  for (const value of bad) assert.throws(() => normalizeOutboundProxySettings(value), OutboundProxyError, JSON.stringify(value));
  assert.throws(() => normalizeOutboundProxySettings({ mode: "socks" }), OutboundProxyError);
  assert.throws(() => normalizeOutboundProxySettings({ version: 2, mode: "off" }), OutboundProxyError);
  assert.throws(() => normalizeOutboundProxySettings({ mode: "off", noProxy: "example.com" }), OutboundProxyError);
  assert.throws(() => normalizeOutboundProxySettings({ mode: "off", noProxy: ["a.com,b.com"] }), OutboundProxyError);
  assert.throws(() => normalizeOutboundProxySettings({
    mode: "off", noProxy: Array.from({ length: OUTBOUND_PROXY_LIMITS.maxNoProxyEntries + 1 }, (_, i) => `h${i}.example.com`),
  }), OutboundProxyError);

  // 环境变量模式可以承载带凭据的地址，但那是用户自己的环境，本程序不持久化它。
  const env = resolveOutboundProxy(normalizeOutboundProxySettings({ mode: "environment" }), {
    HTTPS_PROXY: "http://user:secret@proxy.internal:8080",
  });
  assert.equal(env?.httpsProxy, "http://user:secret@proxy.internal:8080");
});

test("对外状态不回显凭据，只给出协议与主机", () => {
  const settings = normalizeOutboundProxySettings({ mode: "environment" });
  const resolved = resolveOutboundProxy(settings, { HTTPS_PROXY: "http://user:secret@proxy.internal:8080" });
  const shown = publicOutboundProxy(settings, resolved);
  assert.equal(shown.effective, true);
  assert.equal(shown.host, "http://proxy.internal:8080");
  const serialized = JSON.stringify(shown);
  assert.ok(!serialized.includes("secret") && !serialized.includes("user:"), serialized);
  assert.deepEqual(publicOutboundProxy(defaultOutboundProxySettings(), undefined), {
    mode: "off", effective: false, host: "", bypass: [],
  });
});

test("解析不出代理就完全不碰全局 dispatcher；安装后可恢复", () => {
  assert.equal(outboundProxyInstalled(), false);
  assert.equal(installOutboundProxy(undefined), false, "没有代理时不安装");
  assert.equal(outboundProxyInstalled(), false);
  try {
    assert.equal(installOutboundProxy({ httpProxy: "http://127.0.0.1:7897", httpsProxy: "http://127.0.0.1:7897", noProxy: "localhost" }), true);
    assert.equal(outboundProxyInstalled(), true);
  } finally {
    installOutboundProxy(undefined);
  }
  assert.equal(outboundProxyInstalled(), false, "恢复后不应残留代理 dispatcher");
});
