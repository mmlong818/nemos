// tests/v04/unit/multi-scope-search.test.ts — scopes 多 scope OR 过滤

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mnemos } from "../../../src/index.js";
import { resetMockCount, makeMockLLMConfig } from "../../helpers.js";

function makeInstance() {
  resetMockCount();
  return new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    defaultScope: "global",
    features: { doubleCheck: false, autoLinking: false },
  });
}

test("v0.4 scopes: ['project:foo', 'global'] 同时命中两个 scope", async () => {
  const mem = makeInstance().forUser("u1");

  await mem.ingest("项目专属内容", { scope: "project:foo", skipAnalysis: true });
  await mem.ingest("全局通用内容", { scope: "global", skipAnalysis: true });
  await mem.ingest("另一个项目内容", { scope: "project:bar", skipAnalysis: true });

  const results = await mem.search("内容", {
    layers: ["archival"],
    scopes: ["project:foo", "global"],
    includeSensitive: true,
  });

  const scopes = results.map((m) => m.scope);
  assert.ok(scopes.includes("project:foo"), "应命中 project:foo");
  assert.ok(scopes.includes("global"), "应命中 global");
  assert.ok(!scopes.includes("project:bar"), "不应命中 project:bar");
});

test("v0.4 scope 单值过滤不受 scopes 影响", async () => {
  const mem = makeInstance().forUser("u2");

  await mem.ingest("项目内容", { scope: "project:foo", skipAnalysis: true });
  await mem.ingest("全局内容", { scope: "global", skipAnalysis: true });

  const results = await mem.search("内容", {
    layers: ["archival"],
    scope: "project:foo",
    includeSensitive: true,
  });

  assert.ok(results.every((m) => m.scope === "project:foo"), "单 scope 只返回 project:foo");
});

test("v0.4 scopes 优先于 scope（同时传时）", async () => {
  const mem = makeInstance().forUser("u3");

  await mem.ingest("项目内容", { scope: "project:foo", skipAnalysis: true });
  await mem.ingest("全局内容", { scope: "global", skipAnalysis: true });

  const results = await mem.search("内容", {
    layers: ["archival"],
    scope: "project:foo",
    scopes: ["project:foo", "global"],
    includeSensitive: true,
  });

  const scopes = results.map((m) => m.scope);
  assert.ok(scopes.includes("global"), "scopes 优先，global 应被命中");
});

test("v0.4 scopes 空数组等价于无过滤（返回全部）", async () => {
  const mem = makeInstance().forUser("u4");

  await mem.ingest("项目内容 A", { scope: "project:foo", skipAnalysis: true });
  await mem.ingest("项目内容 B", { scope: "global", skipAnalysis: true });

  const results = await mem.search("内容", {
    layers: ["archival"],
    scopes: [],
    includeSensitive: true,
  });

  assert.ok(results.length >= 2, "scopes=[] 不过滤，应返回全部");
});
