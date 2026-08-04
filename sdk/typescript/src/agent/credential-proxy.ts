import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface AgentCredentialBinding {
  id: string;
  sourceEnv: string;
  allowedUrlPrefixes: string[];
  allowedMethods?: string[];
  header?: string;
  prefix?: string;
}

export interface AgentCredentialProxyOptions {
  credentialProvider?: (sourceEnv: string) => string | undefined;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  allowHttpLocalhost?: boolean;
}

export interface AgentCredentialLease {
  env: Record<string, string>;
  close: () => void;
}

interface CompiledBinding {
  source: AgentCredentialBinding;
  prefixes: URL[];
  methods: Set<string>;
}

interface ProxyRequest {
  credentialId?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
}

const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_FORWARD_HEADERS = new Set([
  "authorization", "cookie", "host", "content-length", "connection",
  "proxy-authorization", "proxy-connection", "transfer-encoding",
]);

export function validateAgentCredentialBinding(binding: AgentCredentialBinding): string[] {
  try {
    validateBinding(binding, false);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

/**
 * Loopback credential broker for extension processes.
 * The child receives a short-lived proxy token, never the upstream credential.
 */
export class AgentCredentialProxy {
  private readonly bindings: Map<string, CompiledBinding>;
  private readonly credentialProvider: (sourceEnv: string) => string | undefined;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly allowHttpLocalhost: boolean;
  private readonly leases = new Map<string, { runId: string }>();
  private server?: Server;
  private endpoint?: string;
  private startPromise?: Promise<void>;

  constructor(bindings: readonly AgentCredentialBinding[], options: AgentCredentialProxyOptions = {}) {
    this.allowHttpLocalhost = options.allowHttpLocalhost ?? false;
    this.bindings = new Map(bindings.map((binding) => {
      validateBinding(binding, this.allowHttpLocalhost);
      return [binding.id, {
        source: structuredClone(binding),
        prefixes: binding.allowedUrlPrefixes.map((prefix) => new URL(prefix)),
        methods: new Set((binding.allowedMethods?.length ? binding.allowedMethods : ["GET", "POST"])
          .map((method) => method.toUpperCase())),
      }];
    }));
    if (this.bindings.size !== bindings.length) throw new Error("Credential binding ids must be unique");
    this.credentialProvider = options.credentialProvider ?? ((name) => process.env[name]);
    this.maxRequestBytes = boundedSize(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES);
    this.maxResponseBytes = boundedSize(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
  }

  async acquire(runId: string): Promise<AgentCredentialLease> {
    if (!runId.trim()) throw new Error("Credential proxy leases require a runId");
    await this.start();
    const token = randomBytes(32).toString("base64url");
    this.leases.set(token, { runId });
    let active = true;
    return {
      env: {
        NEMOS_CREDENTIAL_PROXY_URL: this.endpoint!,
        NEMOS_CREDENTIAL_PROXY_TOKEN: token,
      },
      close: () => {
        if (!active) return;
        active = false;
        this.leases.delete(token);
      },
    };
  }

  async close(): Promise<void> {
    this.leases.clear();
    const server = this.server;
    this.server = undefined;
    this.endpoint = undefined;
    this.startPromise = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private async start(): Promise<void> {
    if (this.endpoint) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res).catch((error) => {
          if (!res.headersSent) sendError(res, 502, error instanceof Error ? error.message : String(error));
          else res.destroy();
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Credential proxy failed to bind a loopback port"));
          return;
        }
        this.server = server;
        this.endpoint = "http://127.0.0.1:" + address.port;
        resolve();
      });
    }).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST" || req.url !== "/v1/fetch") {
      sendError(res, 404, "Credential proxy route not found");
      return;
    }
    const token = bearerToken(req.headers.authorization);
    if (!token || !this.leases.has(token)) {
      sendError(res, 401, "Credential proxy token is invalid or expired");
      return;
    }

    const request = JSON.parse(await readRequest(req, this.maxRequestBytes)) as ProxyRequest;
    const binding = this.bindings.get(String(request.credentialId || ""));
    if (!binding) {
      sendError(res, 403, "Credential binding is not allowed for this extension");
      return;
    }
    const target = parseTarget(request.url, this.allowHttpLocalhost);
    if (!binding.prefixes.some((prefix) => matchesPrefix(target, prefix))) {
      sendError(res, 403, "Target URL is outside the credential binding scope");
      return;
    }
    const method = String(request.method || "GET").toUpperCase();
    if (!binding.methods.has(method)) {
      sendError(res, 405, "HTTP method is outside the credential binding scope");
      return;
    }
    if (request.body !== undefined && request.bodyBase64 !== undefined) {
      sendError(res, 400, "Specify body or bodyBase64, not both");
      return;
    }
    const credential = this.credentialProvider(binding.source.sourceEnv);
    if (!credential) {
      sendError(res, 424, "Required credential is not configured");
      return;
    }

    const headers = sanitizeHeaders(request.headers);
    const credentialHeader = (binding.source.header || "Authorization").trim();
    headers[credentialHeader] = (binding.source.prefix ?? "Bearer ") + credential;
    const body = request.bodyBase64 !== undefined
      ? Buffer.from(request.bodyBase64, "base64")
      : request.body;
    const upstream = await fetch(target, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
    });
    const bytes = await readResponse(upstream, this.maxResponseBytes);
    const responseHeaders: Record<string, string> = {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "cache-control": "no-store",
      "x-nemos-upstream-status": String(upstream.status),
    };
    res.writeHead(upstream.status, responseHeaders);
    res.end(bytes);
  }
}

function validateBinding(binding: AgentCredentialBinding, allowHttpLocalhost: boolean): void {
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/.test(binding.id)) throw new Error("Credential binding id is invalid");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(binding.sourceEnv)) throw new Error("Credential sourceEnv is invalid");
  if (!binding.allowedUrlPrefixes.length || binding.allowedUrlPrefixes.length > 32) {
    throw new Error("Credential binding requires 1-32 URL prefixes");
  }
  for (const raw of binding.allowedUrlPrefixes) parseTarget(raw, allowHttpLocalhost);
  for (const method of binding.allowedMethods ?? []) {
    if (!/^[A-Z]{3,10}$/i.test(method)) throw new Error("Credential binding method is invalid");
  }
  const header = (binding.header || "Authorization").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(header) || FORBIDDEN_FORWARD_HEADERS.has(header) && header !== "authorization") {
    throw new Error("Credential binding header is invalid");
  }
  if ((binding.prefix ?? "Bearer ").length > 80) throw new Error("Credential binding prefix is too long");
}

function parseTarget(value: string | undefined, allowHttpLocalhost: boolean): URL {
  let target: URL;
  try {
    target = new URL(String(value || ""));
  } catch {
    throw new Error("Credential proxy target URL is invalid");
  }
  const isLocalHttp = allowHttpLocalhost && target.protocol === "http:" &&
    (target.hostname === "127.0.0.1" || target.hostname === "localhost");
  if (target.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Credential proxy targets must use HTTPS");
  }
  if (target.username || target.password) throw new Error("Credential proxy targets cannot contain URL credentials");
  return target;
}

function matchesPrefix(target: URL, prefix: URL): boolean {
  return target.origin === prefix.origin && target.pathname.startsWith(prefix.pathname);
}

function sanitizeHeaders(input: Record<string, string> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    const normalized = name.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(normalized) || FORBIDDEN_FORWARD_HEADERS.has(normalized)) continue;
    if (typeof value !== "string" || value.length > 8_192) continue;
    output[normalized] = value;
  }
  return output;
}

function bearerToken(value: string | undefined): string | undefined {
  const match = value?.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/);
  return match?.[1];
}

async function readRequest(req: IncomingMessage, maximum: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximum) throw new Error("Credential proxy request exceeds the size limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readResponse(response: Response, maximum: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new Error("Upstream response exceeds the credential proxy limit");
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maximum) {
      await response.body.cancel().catch(() => undefined);
      throw new Error("Upstream response exceeds the credential proxy limit");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: message }));
}

function boundedSize(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.min(52_428_800, Math.max(65_536, Math.floor(value!))) : fallback;
}
