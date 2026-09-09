/**
 * 出站代理设置。
 *
 * 与 `network-policy.ts` 分开保存，因为两者管的范围不同，混在一个文件里会让人
 * 把允许／拒绝名单的保证当成覆盖模型调用：
 * - 网络策略按主机名判允许与拒绝，只作用于**应用自身的网页读取**；
 * - 本设置换的是**传输通道**，作用于进程内基于 `fetch` 的出站调用，模型调用属于这一类。
 *
 * ## 它管不到什么
 *
 * `local-http-security.ts` 的网页读取走 `node:https`，并且把连接钉在 DNS 解析出的
 * 地址上（那是它的 SSRF 防线）。它不用 `fetch`，所以既不会被代理，也不会因为这里
 * 装了代理而被削弱。被 spawn 出去的 MCP 子进程同样不受影响。
 *
 * ## 为什么不用 NODE_USE_ENV_PROXY
 *
 * 那个环境变量只有 Node 24 以上才认，而本包 `engines` 允许 22.19，便携包里的
 * node.exe 又是打包机上的版本（`Build-Clownfish.ps1` 直接从 PATH 复制），
 * 于是它会在一部分用户那里静默无效。改用 undici 的 dispatcher，22 以上都工作。
 */

import { isIP } from "node:net";

export type OutboundProxyMode = "off" | "environment" | "explicit";

export interface OutboundProxySettings {
  version: 1;
  mode: OutboundProxyMode;
  /** 仅 explicit 模式使用。禁止内嵌凭据，原因见 normalizeOutboundProxySettings。 */
  url?: string;
  /** 用户附加的直连主机。回环与私网由 resolveOutboundProxy 无条件排除，不依赖此项。 */
  noProxy: string[];
}

export interface ResolvedOutboundProxy {
  httpProxy: string;
  httpsProxy: string;
  /** 逗号分隔，交给 undici 的 EnvHttpProxyAgent 做后缀与端口匹配。 */
  noProxy: string;
}

export class OutboundProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundProxyError";
  }
}

export const OUTBOUND_PROXY_LIMITS = {
  maxNoProxyEntries: 100,
  maxUrlLength: 512,
  maxHostLength: 253,
} as const;

/**
 * 回环一律直连。少了这条，配了代理又用本机模型服务的人会把请求发给代理然后失败，
 * 而自定义服务商的预设地址正是 `http://127.0.0.1:1234/v1`（LM Studio、Ollama）。
 * undici 的 no_proxy 只认主机名与后缀，不认网段，所以私网地址必须由我们逐个并入。
 */
const ALWAYS_BYPASS = ["localhost", "127.0.0.1", "::1"] as const;

export function defaultOutboundProxySettings(): OutboundProxySettings {
  return { version: 1, mode: "off", noProxy: [] };
}

export function normalizeOutboundProxySettings(value: unknown): OutboundProxySettings {
  if (value === undefined || value === null) return defaultOutboundProxySettings();
  if (typeof value !== "object" || Array.isArray(value)) throw new OutboundProxyError("代理设置格式不正确");
  const raw = value as Partial<OutboundProxySettings>;
  if (raw.version !== undefined && raw.version !== 1) throw new OutboundProxyError("代理设置版本不受支持");
  const mode = raw.mode ?? "off";
  if (mode !== "off" && mode !== "environment" && mode !== "explicit") {
    throw new OutboundProxyError("代理模式只能是 off、environment 或 explicit");
  }
  const noProxy = normalizeNoProxyList(raw.noProxy);
  if (mode !== "explicit") return { version: 1, mode, noProxy };
  return { version: 1, mode, url: normalizeProxyUrl(raw.url), noProxy };
}

/**
 * 显式地址禁止内嵌凭据：带密码的代理地址是密钥级数据，落盘就该像模型密钥那样受
 * DPAPI 保护，而 DPAPI 只有 Windows，等于给别的平台造一个存不了的设置。需要登录的
 * 代理请用 environment 模式，凭据留在用户自己的环境变量里，本程序不持久化它。
 */
function normalizeProxyUrl(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) throw new OutboundProxyError("请填写代理地址");
  if (text.length > OUTBOUND_PROXY_LIMITS.maxUrlLength) throw new OutboundProxyError("代理地址过长");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new OutboundProxyError("代理地址不是合法的 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundProxyError("代理地址只支持 http 或 https");
  }
  if (url.username || url.password) {
    throw new OutboundProxyError("代理地址不能内嵌用户名或密码；需要登录的代理请改用跟随环境变量模式");
  }
  if (url.search || url.hash) throw new OutboundProxyError("代理地址不能带查询串或片段");
  if (url.pathname !== "/" && url.pathname !== "") throw new OutboundProxyError("代理地址不能带路径");
  if (!url.hostname) throw new OutboundProxyError("代理地址缺少主机");
  return `${url.protocol}//${url.host}`;
}

function normalizeNoProxyList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OutboundProxyError("直连名单必须是数组");
  if (value.length > OUTBOUND_PROXY_LIMITS.maxNoProxyEntries) {
    throw new OutboundProxyError(`直连名单最多 ${OUTBOUND_PROXY_LIMITS.maxNoProxyEntries} 条`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const host = String(item ?? "").trim().toLowerCase().replace(/\.$/, "");
    if (!host) continue;
    if (host.length > OUTBOUND_PROXY_LIMITS.maxHostLength) throw new OutboundProxyError("直连名单里的主机过长");
    if (/[\s,]/.test(host)) throw new OutboundProxyError("直连名单每条只能写一个主机，不要用逗号或空格分隔");
    if (seen.has(host)) continue;
    seen.add(host);
    result.push(host);
  }
  return result;
}

/**
 * 解析本次实际生效的代理。off 一律返回 undefined，environment 模式才读环境变量。
 *
 * `directHosts` 传当前保存的模型地址等本机可能指向的地址；其中的回环与私网 IP
 * 字面量会被并入直连名单。传入的主机名不做 DNS 解析：解析一次等于把访问意图
 * 泄露给 DNS，与 `local-http-security.ts` 里"策略先于解析"的顺序保持一致。
 */
export function resolveOutboundProxy(
  settings: OutboundProxySettings,
  env: Record<string, string | undefined> = {},
  directHosts: readonly string[] = [],
): ResolvedOutboundProxy | undefined {
  if (settings.mode === "off") return undefined;
  const bypass = new Set<string>([...ALWAYS_BYPASS, ...settings.noProxy]);
  for (const host of directHosts) {
    const value = normalizeBypassHost(host);
    if (value) bypass.add(value);
  }
  if (settings.mode === "explicit") {
    const url = settings.url ? normalizeProxyUrl(settings.url) : "";
    if (!url) return undefined;
    return { httpProxy: url, httpsProxy: url, noProxy: [...bypass].join(",") };
  }
  const httpProxy = String(env.http_proxy ?? env.HTTP_PROXY ?? "").trim();
  const httpsProxy = String(env.https_proxy ?? env.HTTPS_PROXY ?? "").trim();
  if (!httpProxy && !httpsProxy) return undefined;
  for (const entry of String(env.no_proxy ?? env.NO_PROXY ?? "").split(/[\s,]+/)) {
    const value = entry.trim().toLowerCase().replace(/\.$/, "");
    if (value) bypass.add(value);
  }
  return {
    httpProxy: httpProxy || httpsProxy,
    httpsProxy: httpsProxy || httpProxy,
    noProxy: [...bypass].join(","),
  };
}

/** 只接受回环与私网的 IP 字面量或主机名；公网地址不该因为是模型地址就绕过代理。 */
function normalizeBypassHost(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  let host = raw;
  if (raw.includes("://")) {
    try {
      host = new URL(raw).hostname;
    } catch {
      return "";
    }
  }
  host = host.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return "";
  if (!isIP(host)) return host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") ? host : "";
  return isPrivateOrLoopbackAddress(host) ? host : "";
}

function isPrivateOrLoopbackAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  return address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd")
    || /^fe[89ab]/.test(address);
}

/** 对外形态。不含凭据，也不回显环境变量里的地址密码部分。 */
export function publicOutboundProxy(
  settings: OutboundProxySettings,
  resolved: ResolvedOutboundProxy | undefined,
): { mode: OutboundProxyMode; effective: boolean; host: string; bypass: string[] } {
  return {
    mode: settings.mode,
    effective: Boolean(resolved),
    host: resolved ? safeProxyHost(resolved.httpsProxy || resolved.httpProxy) : "",
    bypass: resolved ? resolved.noProxy.split(",").filter(Boolean) : [],
  };
}

function safeProxyHost(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}
