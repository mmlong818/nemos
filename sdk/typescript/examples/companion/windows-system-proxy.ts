import { execFileSync } from "node:child_process";
import { connect, isIP } from "node:net";
import type { ResolvedOutboundProxy, WindowsSystemProxySnapshot } from "./outbound-proxy.js";

const INTERNET_SETTINGS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

function queryRegistryValue(name: string, run = execFileSync): string {
  try {
    const text = run("reg.exe", ["query", INTERNET_SETTINGS, "/v", name], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 2_000,
    });
    const match = String(text).match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, "mi"));
    return match?.[1]?.trim() || "";
  } catch { return ""; }
}

function proxyUrl(value: string, scheme: "http" | "https"): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${scheme}://${text}`;
  try {
    const url = new URL(withScheme);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return `${url.protocol}//${url.host}`;
  } catch { return undefined; }
}

export function parseWindowsProxyServer(value: string): Pick<WindowsSystemProxySnapshot, "httpProxy" | "httpsProxy"> {
  const entries = value.split(";").map((item) => item.trim()).filter(Boolean);
  if (!entries.length) return {};
  if (entries.length === 1 && !entries[0]!.includes("=")) {
    const url = proxyUrl(entries[0]!, "http");
    return url ? { httpProxy: url, httpsProxy: url } : {};
  }
  const result: Pick<WindowsSystemProxySnapshot, "httpProxy" | "httpsProxy"> = {};
  for (const entry of entries) {
    const split = entry.indexOf("=");
    if (split < 1) continue;
    const protocol = entry.slice(0, split).trim().toLowerCase();
    const target = entry.slice(split + 1).trim();
    if (protocol === "http") result.httpProxy = proxyUrl(target, "http");
    if (protocol === "https") result.httpsProxy = proxyUrl(target, "http");
  }
  return result;
}

export function parseWindowsProxyBypass(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.split(/[;,]/)) {
    let host = raw.trim().toLowerCase();
    if (!host || host === "<local>") continue;
    host = host.replace(/^\*\./, ".").replace(/:\d+$/, "").replace(/\.$/, "");
    if (/^[a-z0-9._:-]{1,253}$/i.test(host)) seen.add(host);
  }
  return [...seen];
}

function readWinHttpFallback(run = execFileSync): WindowsSystemProxySnapshot | undefined {
  try {
    try {
      const advanced = String(run("netsh.exe", ["winhttp", "show", "advproxy"], {
        encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 2_000,
      }));
      if (/auto.?detect\s*[:=]\s*(?:true|yes|1|enabled)|自动检测\s*[:：]\s*(?:是|启用)/i.test(advanced)
        || /auto.?config(?:uration)?(?:url)?\s*[:=]\s*https?:\/\//i.test(advanced)) {
        return { bypass: [], source: "winhttp", autoDetect: true };
      }
    } catch { /* older Windows has no advproxy command */ }
    const text = String(run("netsh.exe", ["winhttp", "show", "proxy"], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 2_000,
    }));
    if (/direct access|直接访问/i.test(text)) return undefined;
    const candidates = [...text.matchAll(/(?:https?:\/\/)?(?:\[[0-9a-f:]+\]|[a-z0-9.-]+):\d{1,5}/gi)].map((match) => match[0]);
    const parsed = parseWindowsProxyServer(candidates[0] || "");
    if (!parsed.httpProxy && !parsed.httpsProxy) return undefined;
    return { ...parsed, bypass: [], source: "winhttp" };
  } catch { return undefined; }
}

/** Reads fixed per-user proxy metadata only. PAC/WPAD content is never downloaded or executed. */
export function readWindowsSystemProxy(run = execFileSync): WindowsSystemProxySnapshot {
  if (process.platform !== "win32") return { bypass: [], source: "none" };
  const enabled = /(?:0x)?1$/i.test(queryRegistryValue("ProxyEnable", run));
  const autoDetect = /(?:0x)?1$/i.test(queryRegistryValue("AutoDetect", run));
  const pacUrl = queryRegistryValue("AutoConfigURL", run);
  const bypass = parseWindowsProxyBypass(queryRegistryValue("ProxyOverride", run));
  if (pacUrl || autoDetect) return { bypass, source: "internet-settings", ...(pacUrl ? { pacUrl: "configured" } : {}), ...(autoDetect ? { autoDetect: true } : {}) };
  if (enabled) {
    const parsed = parseWindowsProxyServer(queryRegistryValue("ProxyServer", run));
    if (parsed.httpProxy || parsed.httpsProxy) return { ...parsed, bypass, source: "internet-settings" };
  }
  return readWinHttpFallback(run) || { bypass, source: "none" };
}

function loopbackProxyEndpoint(resolved: ResolvedOutboundProxy): { host: string; port: number } | undefined {
  try {
    const url = new URL(resolved.httpsProxy || resolved.httpProxy);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!(host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127.")))) return undefined;
    return { host, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)) };
  } catch { return undefined; }
}

/** A configured loopback proxy must be listening; callers fail closed instead of trying direct. */
export async function assertLoopbackProxyReady(resolved: ResolvedOutboundProxy | undefined, timeoutMs = 800): Promise<void> {
  if (!resolved) return;
  const endpoint = loopbackProxyEndpoint(resolved);
  if (!endpoint) return;
  await new Promise<void>((resolve, reject) => {
    const socket = connect(endpoint.port, endpoint.host);
    const finish = (error?: Error) => { socket.destroy(); error ? reject(error) : resolve(); };
    socket.setTimeout(timeoutMs, () => finish(new Error("系统代理端口未监听")));
    socket.once("connect", () => finish());
    socket.once("error", () => finish(new Error("系统代理端口未监听")));
  });
}
