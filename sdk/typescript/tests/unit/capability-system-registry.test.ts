import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapabilitySystemRegistry,
  CapabilitySurfaceRegistry,
  companionRuntimeToolSummaries,
  filterCompanionRuntimeToolsForSurface,
} from "../../examples/companion/capability-system-registry.js";
import { CapabilityToolRegistry } from "../../examples/companion/capability-tools.js";
import type { DevelopmentEnginePluginRegistry } from "../../examples/companion/development-engine-plugins.js";

test("能力工具注册表拒绝重复 id，并返回可解释的就绪状态", () => {
  let checks = 0;
  const registry = new CapabilityToolRegistry({ dataDir: "." }, 60_000);
  registry.register({
    id: "document.read",
    name: "读取文档",
    description: "读取文档内容",
    toolset: "document",
    requires: ["document-service"],
    check: () => {
      checks += 1;
      return false;
    },
  });

  const first = registry.list()[0]!;
  const second = registry.list()[0]!;
  assert.equal(first.available, false);
  assert.equal(first.readiness.reason, "not-configured");
  assert.match(first.readiness.message, /document-service/);
  assert.equal(checks, 1, "有效期内应复用就绪检查结果");
  assert.deepEqual(first.source, { kind: "builtin", id: "clownfish" });
  assert.throws(() => registry.register({
    id: "document.read",
    name: "重复工具",
    description: "不应覆盖原工具",
    toolset: "document",
  }), /能力工具重复/);
  assert.equal(second.readiness.checkedAt, first.readiness.checkedAt);
});

test("能力场景按工具集组合工具，不复制执行实现", () => {
  const surfaces = new CapabilitySurfaceRegistry();
  const tools = [
    tool("document.read", "document"),
    tool("writing.polish", "writing"),
    tool("voice.io", "voice"),
    tool("web.search", "web"),
  ];

  assert.deepEqual(
    surfaces.toolsFor("office", tools).map((item) => item.id),
    ["document.read", "writing.polish"],
  );
  assert.deepEqual(
    surfaces.toolsFor("development", tools).map((item) => item.id),
    ["web.search"],
  );
});

test("真实执行入口会按场景收窄工具，再应用角色绑定", () => {
  const registry = new CapabilityToolRegistry({ dataDir: "." });
  registry.register({ id: "web.search", name: "搜索", description: "搜索", toolset: "web" });
  registry.register({ id: "document.read", name: "文档", description: "文档", toolset: "document" });
  registry.register({ id: "voice.io", name: "语音", description: "语音", toolset: "voice" });

  const office = registry.listAvailableForInstruction(
    "整理文件",
    undefined,
    { toolsets: ["document", "writing"] },
  );
  assert.deepEqual(office.map((item) => item.id), ["document.read"]);

  const denied = registry.listAvailableForInstruction(
    "整理文件",
    { deny: ["document"] },
    { toolsets: ["document"] },
  );
  assert.deepEqual(denied, []);
});

test("统一快照合并延迟加载的扩展工具并保留来源", () => {
  const registry = new CapabilityToolRegistry({ dataDir: "." });
  registry.register({ id: "web.search", name: "搜索", description: "搜索", toolset: "web" });
  const engines = {
    list: () => [],
    readiness: () => ({}),
  } as unknown as DevelopmentEnginePluginRegistry;
  const extensionTool = {
    ...tool("weather.lookup", "extension"),
    dynamic: true,
    source: { kind: "mcp" as const, id: "weather", version: "1.0.0" },
  };
  const snapshot = buildCapabilitySystemRegistry({
    tools: registry,
    additionalTools: [extensionTool],
    abilities: [],
    engines,
    providers: [],
    extensions: [{
      id: "weather",
      name: "天气",
      version: "1.0.0",
      kind: "tool",
      runtime: "mcp",
      enabled: true,
      providerAttached: true,
      executionSecurity: "restricted",
      available: true,
      tools: ["lookup"],
    }],
  });

  assert.equal(snapshot.counts.tools, 2);
  assert.equal(snapshot.counts.readyExtensions, 1);
  assert.equal(snapshot.tools.find((item) => item.id === "weather.lookup")?.dynamic, true);
  assert.equal(snapshot.surfaces.find((item) => item.id === "task")?.tools.includes("weather.lookup"), true);
});

test("产品运行时工具进入统一目录并按六个入口收窄", () => {
  const summaries = companionRuntimeToolSummaries();
  assert.equal(summaries.length, 7);
  assert.equal(summaries.find((item) => item.id === "agent.task-create")?.effect, "write");
  assert.deepEqual(
    filterCompanionRuntimeToolsForSurface("education", [
      { definition: { name: "memory_recall" } },
      { definition: { name: "development_task_create" } },
      { definition: { name: "capability_artifact_list" } },
    ]).map((item) => item.definition.name),
    ["memory_recall", "capability_artifact_list"],
  );
  assert.deepEqual(
    filterCompanionRuntimeToolsForSurface("development", [
      { definition: { name: "memory_recall" } },
      { definition: { name: "development_task_create" } },
      { definition: { name: "capability_task_create" } },
    ]).map((item) => item.definition.name),
    ["memory_recall", "development_task_create"],
  );
});

function tool(id: string, toolset: string) {
  return {
    id,
    name: id,
    description: id,
    toolset,
    available: true,
    requires: [],
    readiness: {
      available: true,
      reason: "ready" as const,
      message: "可用",
      checkedAt: "2026-08-17T00:00:00.000Z",
    },
    source: { kind: "builtin" as const, id: "clownfish" },
    isAsync: false,
    execution: "direct" as const,
    effect: "read" as const,
    risk: "normal" as const,
    permissions: [],
  };
}
