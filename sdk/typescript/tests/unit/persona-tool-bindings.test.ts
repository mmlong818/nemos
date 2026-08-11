// persona-tool-bindings.test.ts — v0.8 每角色独立工具集
//
// 验证：绑定能按工具 id 或整个工具集收窄；deny 压过 allow；
//       执行层也拦（不只是不暴露）；没配绑定的角色保持升级前的行为。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  capabilityAgentToolName,
  createDefaultCapabilityToolRegistry,
  isToolAllowedForPersona,
  type PersonaToolBinding,
} from "../../examples/companion/capability-tools.js";
import { PersonaToolBindings } from "../../examples/companion/persona-tool-bindings.js";

function registry() {
  return createDefaultCapabilityToolRegistry(".", {
    hasLiveSearch: () => true,
    hasVision: () => true,
    hasVoice: () => true,
  });
}

const REQUEST = "帮我核实明天上海到杭州的高铁余票来源";

test("没有绑定时行为与升级前一致", () => {
  const binding: PersonaToolBinding | undefined = undefined;
  assert.equal(isToolAllowedForPersona({ id: "web.search", toolset: "web" }, binding), true);
  const names = registry().toAgentTools(REQUEST).map((tool) => tool.definition.name);
  assert.ok(names.length > 0);
  assert.deepEqual(registry().toAgentTools(REQUEST, undefined).map((t) => t.definition.name), names);
});

test("allow 可以按工具集整体授权", () => {
  const onlySource: PersonaToolBinding = { allow: ["source"] };
  assert.equal(isToolAllowedForPersona({ id: "source.discovery", toolset: "source" }, onlySource), true);
  assert.equal(isToolAllowedForPersona({ id: "web.search", toolset: "web" }, onlySource), false);

  const tools = registry().toAgentTools(REQUEST, onlySource).map((tool) => tool.definition.name);
  assert.ok(tools.length > 0, "按工具集授权后仍应有可用工具");
  assert.ok(tools.every((name) => name.includes("source")), JSON.stringify(tools));
});

test("deny 压过 allow", () => {
  const binding: PersonaToolBinding = { allow: ["source"], deny: ["source.discovery"] };
  assert.equal(isToolAllowedForPersona({ id: "source.discovery", toolset: "source" }, binding), false);
  const names = registry().toAgentTools(REQUEST, binding).map((tool) => tool.definition.name);
  assert.ok(!names.includes(capabilityAgentToolName("source.discovery")), JSON.stringify(names));
});

test("执行层也拦：拿到工具名也绕不过绑定", async () => {
  const blocked: PersonaToolBinding = { deny: ["source"] };
  const result = await registry().run("source.discovery", { query: "高铁余票" }, {}, blocked);
  assert.equal(result.ok, false);
  assert.match(result.text, /not available to this persona/);

  // 同一个调用在不带绑定时是通的，说明上面的失败来自绑定而不是工具本身不可用。
  const allowed = await registry().run("source.discovery", { query: "高铁余票" }, {});
  assert.equal(allowed.ok, true);
});

test("提示块里也不会列出角色用不了的工具", () => {
  const onlyWeb: PersonaToolBinding = { allow: ["web"] };
  const block = registry().buildPromptBlock(REQUEST, onlyWeb);
  assert.ok(!block.includes("source.discovery"), block.slice(0, 600));
});

test("绑定跨重启存活，清除后回到不限制", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-persona-tools-"));
  try {
    const store = new PersonaToolBindings(dir);
    store.set("researcher", { allow: ["source"], deny: ["source.discovery"] });
    assert.equal(store.get("writer"), undefined, "没配过的角色应当不限制");

    const reopened = new PersonaToolBindings(dir);
    assert.deepEqual(reopened.get("researcher"), { allow: ["source"], deny: ["source.discovery"] });
    assert.equal(reopened.clear("researcher"), true);
    assert.equal(new PersonaToolBindings(dir).get("researcher"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("空 allow 不等于全禁用，而是不限制", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-persona-tools-empty-"));
  try {
    const store = new PersonaToolBindings(dir);
    store.set("writer", { allow: [], deny: [] });
    // 存下来是空数组，取出时应当收敛成「没有限制」，否则会悄悄把角色的工具全砍掉。
    assert.equal(store.get("writer"), undefined);
    assert.equal(isToolAllowedForPersona({ id: "web.search", toolset: "web" }, { allow: [] }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
