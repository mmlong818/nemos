import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Type } from "typebox";

import {
  describeRouteBodyError,
  route,
  RouteTable,
  runRoute,
  type RouteRequest,
} from "../../examples/companion/routes/table.js";

function context(pathname: string, url = pathname): RouteRequest {
  return {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url,
    pathname,
    query: new URL(url, "http://127.0.0.1").searchParams,
  };
}

test("路由按 方法+路径 精确匹配，方法不同不会误命中", () => {
  const table = new RouteTable()
    .add(route("GET", "/api/files", () => {}))
    .add(route("POST", "/api/files", Type.Object({}), () => {}));
  assert.equal(table.size, 2);
  assert.ok(table.find("GET", "/api/files"));
  assert.ok(table.find("POST", "/api/files"));
  assert.equal(table.find("DELETE", "/api/files"), undefined);
  assert.equal(table.find(undefined, "/api/files"), undefined);
  assert.equal(table.find("GET", "/api/files/session"), undefined);
});

test("同一 方法+路径 重复注册立刻报错，而不是被先注册的那条静默遮住", () => {
  const table = new RouteTable().add(route("GET", "/api/state", () => {}));
  assert.throws(() => table.add(route("GET", "/api/state", () => {})), /路由重复注册：GET \/api\/state/);
});

test("带 query 的请求仍按 pathname 命中——这正是原来 `url === ` 写法漏掉的情况", () => {
  const table = new RouteTable().add(route("GET", "/api/agent/runs", () => {}));
  const ctx = context("/api/agent/runs", "/api/agent/runs?limit=20");
  assert.ok(table.find("GET", ctx.pathname));
  assert.equal(ctx.query.get("limit"), "20");
});

test("声明了 body schema 时：合规才进处理函数，且处理函数拿到的是校验过的值", async () => {
  const schema = Type.Object(
    { id: Type.String({ minLength: 1 }), status: Type.Union([Type.Literal("active"), Type.Literal("trashed")]) },
    { additionalProperties: false },
  );
  let seen: unknown;
  const entry = route("POST", "/api/files/status", schema, (_ctx, body) => { seen = body; });
  let invalid: string | undefined;
  await runRoute(entry, context("/api/files/status"), {
    readBody: async () => ({ id: "f1", status: "trashed" }),
    sendInvalid: (_res, detail) => { invalid = detail; },
  });
  assert.equal(invalid, undefined);
  assert.deepEqual(seen, { id: "f1", status: "trashed" });
});

test("body 不合规时返回 400 说明，处理函数完全不执行", async () => {
  const schema = Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false });
  let called = false;
  const entry = route("POST", "/api/files/link", schema, () => { called = true; });
  for (const bad of [{}, { id: 5 }, { id: "a", extra: 1 }, "not-an-object", null]) {
    let invalid: string | undefined;
    await runRoute(entry, context("/api/files/link"), {
      readBody: async () => bad,
      sendInvalid: (_res, detail) => { invalid = detail; },
    });
    assert.equal(called, false, `${JSON.stringify(bad)} 不该进入处理函数`);
    assert.ok(invalid && invalid.length > 0, `${JSON.stringify(bad)} 应给出说明`);
  }
});

test("没声明 body schema 的路由不会去读 body", async () => {
  let read = false;
  const entry = route("GET", "/api/health", () => {});
  await runRoute(entry, context("/api/health"), {
    readBody: async () => { read = true; return {}; },
    sendInvalid: () => { throw new Error("不应触发"); },
  });
  assert.equal(read, false);
});

test("校验失败说明是自产中文，指名字段，且不带校验器英文原文", () => {
  const schema = Type.Object({ ownerId: Type.String({ minLength: 1 }) }, { additionalProperties: false });
  const wrongType = describeRouteBodyError(schema, { ownerId: 7 });
  assert.match(wrongType, /ownerId/);
  assert.doesNotMatch(wrongType, /must be|schema is false/);
  assert.equal(describeRouteBodyError(schema, {}), "缺少必填参数 ownerId");
  assert.equal(describeRouteBodyError(schema, { ownerId: "a", extra: 1 }), "请求包含未知参数 extra");
});
