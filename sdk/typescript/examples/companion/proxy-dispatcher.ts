/**
 * 把解析出来的代理装到全局 fetch 上。
 *
 * 纯逻辑在 `outbound-proxy.ts`，这里只做有副作用的那一步，便于测试分开。
 * 解析不出代理就完全不碰全局 dispatcher：没有代理的用户看不到任何行为变化。
 */

import { Agent, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { OutboundProxyError, type ResolvedOutboundProxy } from "./outbound-proxy.js";

let installed: Dispatcher | undefined;
let original: Dispatcher | undefined;

export function createOutboundDispatcher(resolved: ResolvedOutboundProxy | undefined, failClosed = false): Dispatcher {
  if (!resolved && !failClosed) return new Agent();
  const effective = resolved || {
    httpProxy: "http://127.0.0.1:9", httpsProxy: "http://127.0.0.1:9", noProxy: "",
  };
  return new EnvHttpProxyAgent({
    httpProxy: effective.httpProxy,
    httpsProxy: effective.httpsProxy,
    noProxy: effective.noProxy,
  });
}

/** Resolves one immutable route snapshot for each outbound HTTP request. */
export function createDynamicOutboundDispatcher(
  snapshot: () => { fingerprint: string; resolved: ResolvedOutboundProxy | undefined; error: string },
): Dispatcher & { closeRoutes(): Promise<void> } {
  class DynamicDispatcher extends Agent {
    private readonly routes = new Map<string, Dispatcher>();

    override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
      const state = snapshot();
      let route = this.routes.get(state.fingerprint);
      if (!route) {
        route = createOutboundDispatcher(state.resolved, Boolean(state.error));
        this.routes.set(state.fingerprint, route);
      }
      const guarded = state.resolved || state.error ? new Proxy(handler, {
        get(target, property, receiver) {
          if (property === "onResponseError") return (controller: Dispatcher.DispatchController) => target.onResponseError?.(controller, new OutboundProxyError(state.error || "系统代理连接失败；已阻止模型请求，未回退直连"));
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) : handler;
      return route.dispatch(options, guarded);
    }

    async closeRoutes(): Promise<void> {
      const routes = [...this.routes.values()];
      this.routes.clear();
      await Promise.allSettled(routes.map(async (route) => route.destroy()));
      await super.destroy();
    }
  }
  return new DynamicDispatcher();
}

/**
 * 幂等安装。传 undefined 表示恢复安装前的 dispatcher。
 *
 * 用 EnvHttpProxyAgent 而不是 ProxyAgent，是因为前者自带 no_proxy 的后缀与端口
 * 匹配；三个值全部显式传入，它就不会再去读环境变量，于是 explicit 与 environment
 * 两种模式的行为都由 resolveOutboundProxy 决定，而不是一半由 undici 决定。
 */
export function installOutboundProxy(resolved: ResolvedOutboundProxy | undefined, failClosed = false): boolean {
  if (!resolved) {
    if (failClosed) {
      if (!installed) original = getGlobalDispatcher();
      const blocked = createOutboundDispatcher(undefined, true);
      setGlobalDispatcher(blocked);
      installed = blocked;
      return true;
    }
    if (installed && original) setGlobalDispatcher(original);
    installed = undefined;
    original = undefined;
    return false;
  }
  if (!installed) original = getGlobalDispatcher();
  const agent = createOutboundDispatcher(resolved);
  setGlobalDispatcher(agent);
  installed = agent;
  return true;
}

/** 供状态接口与测试判断当前是否装着代理 dispatcher。 */
export function outboundProxyInstalled(): boolean {
  return Boolean(installed);
}
