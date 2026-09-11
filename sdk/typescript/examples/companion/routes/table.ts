// 本机 HTTP 接口的路由表。
//
// 取代原先在 server.ts 里按 `req.method === X && url === Y` 逐条排开的 if 链。换掉它解决三件事：
//   1. 匹配口径统一。原来同时存在 `url ===`（带 query 就匹配不上）、`pathname ===` 和
//      `url.split("?")[0] ===` 三种写法，第三种是撞到问题后一条条手工补的。这里一律用 pathname。
//   2. 入参有运行时校验。原来是 `(await readBody(req)) as { ... }`，断言编译后什么都不剩。
//   3. 路径重复注册会在启动时就报错，而不是被前面那条静默遮住。
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export type RouteMethod = "GET" | "POST" | "PUT" | "DELETE";

/** 路由层已经算好、处理函数常用的那几样。 */
export interface RouteRequest {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  /** 原始 req.url，含 query。 */
  readonly url: string;
  /** 已剥掉 query 的路径；匹配只用它。 */
  readonly pathname: string;
  readonly query: URLSearchParams;
}

export interface RouteEntry {
  readonly method: RouteMethod;
  readonly path: string;
  /** 声明了就先读 body 并校验，不合规直接 400，处理函数不会被调用。 */
  readonly body?: TSchema;
  readonly handler: (ctx: RouteRequest, body: unknown) => void | Promise<void>;
}

export function route<S extends TSchema>(
  method: RouteMethod,
  path: string,
  body: S,
  handler: (ctx: RouteRequest, body: Static<S>) => void | Promise<void>,
): RouteEntry;
export function route(
  method: RouteMethod,
  path: string,
  handler: (ctx: RouteRequest) => void | Promise<void>,
): RouteEntry;
export function route(
  method: RouteMethod,
  path: string,
  bodyOrHandler: TSchema | ((ctx: RouteRequest) => void | Promise<void>),
  maybeHandler?: unknown,
): RouteEntry {
  if (typeof bodyOrHandler === "function") {
    return { method, path, handler: bodyOrHandler as RouteEntry["handler"] };
  }
  return { method, path, body: bodyOrHandler, handler: maybeHandler as RouteEntry["handler"] };
}

export class RouteTable {
  private readonly entries = new Map<string, RouteEntry>();

  add(...routes: readonly RouteEntry[]): this {
    for (const entry of routes) {
      const key = `${entry.method} ${entry.path}`;
      if (this.entries.has(key)) throw new Error(`路由重复注册：${key}`);
      this.entries.set(key, entry);
    }
    return this;
  }

  find(method: string | undefined, pathname: string): RouteEntry | undefined {
    return method ? this.entries.get(`${method} ${pathname}`) : undefined;
  }

  get size(): number {
    return this.entries.size;
  }
}

interface ValueErrorLike {
  readonly keyword?: string;
  readonly instancePath?: string;
  readonly params?: Record<string, unknown>;
}

function fieldName(instancePath: string | undefined): string {
  return instancePath ? instancePath.replace(/^\//, "").split("/").join(".") : "";
}

function nameList(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join("、") : "";
}

/**
 * 校验失败时给用户看的一句话：只说哪个字段、哪类问题。
 *
 * 不透出校验器原文（英文、带 schema 路径）——send() 对 4xx 的既有规矩就是内部错误一律不外泄，
 * 只放行我们自己写、确认可展示的 userMessage。
 */
export function describeRouteBodyError(schema: TSchema, value: unknown): string {
  // additionalProperties 会同时报一条没有信息量的 "schema is false"，跳过它。
  const errors = [...Value.Errors(schema, value)] as readonly ValueErrorLike[];
  const first = errors.find((error) => error.keyword !== "boolean") ?? errors[0];
  if (!first) return "请求内容不符合要求";
  if (first.keyword === "required") {
    const missing = nameList(first.params?.requiredProperties);
    return missing ? `缺少必填参数 ${missing}` : "请求缺少必填参数";
  }
  if (first.keyword === "additionalProperties") {
    const extra = nameList(first.params?.additionalProperties);
    return extra ? `请求包含未知参数 ${extra}` : "请求包含未知参数";
  }
  const field = fieldName(first.instancePath);
  return field ? `参数 ${field} 不符合要求` : "请求内容不符合要求";
}

export async function runRoute(
  entry: RouteEntry,
  ctx: RouteRequest,
  deps: {
    readBody: (req: IncomingMessage) => Promise<unknown>;
    sendInvalid: (res: ServerResponse, detail: string) => void;
  },
): Promise<void> {
  if (!entry.body) {
    await entry.handler(ctx, undefined);
    return;
  }
  const raw = await deps.readBody(ctx.req);
  if (!Value.Check(entry.body, raw)) {
    deps.sendInvalid(ctx.res, describeRouteBodyError(entry.body, raw));
    return;
  }
  await entry.handler(ctx, raw);
}
