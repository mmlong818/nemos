import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeAddress(value: string): string {
  const address = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const address = normalizeAddress(value);
  if (LOOPBACK_HOSTS.has(address)) return true;
  if (isIP(address) !== 4) return false;
  return address.split(".")[0] === "127";
}

export function isAllowedLocalRequest(input: {
  remoteAddress?: string;
  host?: string;
  origin?: string;
  secFetchSite?: string;
  port: number;
}): boolean {
  if (!isLoopbackAddress(input.remoteAddress)) return false;
  if (input.secFetchSite?.toLowerCase() === "cross-site") return false;
  try {
    const host = new URL(`http://${input.host || ""}`);
    if (!LOOPBACK_HOSTS.has(normalizeAddress(host.hostname))) return false;
    if (host.port && host.port !== String(input.port)) return false;
    if (!input.origin) return true;
    const origin = new URL(input.origin);
    return origin.protocol === "http:"
      && LOOPBACK_HOSTS.has(normalizeAddress(origin.hostname))
      && (origin.port || "80") === String(input.port);
  } catch {
    return false;
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

export function isPrivateNetworkAddress(value: string): boolean {
  const address = normalizeAddress(value);
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;
  return address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd") || /^fe[89ab]/.test(address);
}

export async function assertPublicWebUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported web protocol");
  const hostname = normalizeAddress(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    throw new Error("local web address is not allowed");
  }
  if (isIP(hostname)) {
    if (isPrivateNetworkAddress(hostname)) throw new Error("private network address is not allowed");
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateNetworkAddress(item.address))) {
    throw new Error("web address resolves to a private network");
  }
  return url;
}
