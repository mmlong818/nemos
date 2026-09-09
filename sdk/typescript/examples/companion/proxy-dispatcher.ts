/**
 * 把解析出来的代理装到全局 fetch 上。
 *
 * 纯逻辑在 `outbound-proxy.ts`，这里只做有副作用的那一步，便于测试分开。
 * 解析不出代理就完全不碰全局 dispatcher：没有代理的用户看不到任何行为变化。
 */

import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import type { ResolvedOutboundProxy } from "./outbound-proxy.js";

let installed: Dispatcher | undefined;
let original: Dispatcher | undefined;

/**
 * 幂等安装。传 undefined 表示恢复安装前的 dispatcher。
 *
 * 用 EnvHttpProxyAgent 而不是 ProxyAgent，是因为前者自带 no_proxy 的后缀与端口
 * 匹配；三个值全部显式传入，它就不会再去读环境变量，于是 explicit 与 environment
 * 两种模式的行为都由 resolveOutboundProxy 决定，而不是一半由 undici 决定。
 */
export function installOutboundProxy(resolved: ResolvedOutboundProxy | undefined): boolean {
  if (!resolved) {
    if (installed && original) setGlobalDispatcher(original);
    installed = undefined;
    original = undefined;
    return false;
  }
  if (!installed) original = getGlobalDispatcher();
  const agent = new EnvHttpProxyAgent({
    httpProxy: resolved.httpProxy,
    httpsProxy: resolved.httpsProxy,
    noProxy: resolved.noProxy,
  });
  setGlobalDispatcher(agent);
  installed = agent;
  return true;
}

/** 供状态接口与测试判断当前是否装着代理 dispatcher。 */
export function outboundProxyInstalled(): boolean {
  return Boolean(installed);
}
