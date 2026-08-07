import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
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
  return (await resolvePublicWebTarget(raw)).url;
}

async function resolvePublicWebTarget(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported web protocol");
  const hostname = normalizeAddress(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    throw new Error("local web address is not allowed");
  }
  if (isIP(hostname)) {
    if (isPrivateNetworkAddress(hostname)) throw new Error("private network address is not allowed");
    return { url, address: hostname, family: isIP(hostname) as 4 | 6 };
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateNetworkAddress(item.address))) {
    throw new Error("web address resolves to a private network");
  }
  const selected = addresses[0]!;
  return { url, address: normalizeAddress(selected.address), family: selected.family as 4 | 6 };
}

export interface PublicWebResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export async function readPublicWebUrl(input: {
  url: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  maxBytes: number;
}): Promise<PublicWebResponse> {
  const target = await resolvePublicWebTarget(input.url);
  const transport = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport({
      hostname: target.address,
      family: target.family,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: "GET",
      servername: target.url.hostname,
      signal: input.signal,
      headers: { ...input.headers, Host: target.url.host },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.byteLength;
        if (size > input.maxBytes) {
          response.destroy(new Error("web response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}
