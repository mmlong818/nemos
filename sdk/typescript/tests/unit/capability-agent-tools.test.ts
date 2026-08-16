import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityToolRegistry,
  capabilityAgentToolName,
  createDefaultCapabilityToolRegistry,
} from "../../examples/companion/capability-tools.js";

function registry() {
  return createDefaultCapabilityToolRegistry(".", {
    hasLiveSearch: () => true,
    hasVision: () => true,
    hasVoice: () => true,
  });
}

test("capability registry only exposes executable tools relevant to the request", () => {
  assert.deepEqual(registry().toAgentTools("你好").map((tool) => tool.definition.name), []);

  const tools = registry().toAgentTools("帮我核实明天上海到杭州的高铁余票来源");
  const names = tools.map((tool) => tool.definition.name);
  assert.ok(names.includes(capabilityAgentToolName("source.discovery")));
  assert.ok(names.includes(capabilityAgentToolName("source.travel-rail")));
  assert.equal(tools.every((tool) => tool.definition.effect === "read"), true);
});

test("capability AgentTool adapter returns structured registry output", async () => {
  const tool = registry()
    .toAgentTools("核实高铁信息来源")
    .find((item) => item.definition.name === capabilityAgentToolName("source.discovery"));
  assert.ok(tool);
  const result = await tool.execute(
    { query: "上海到杭州高铁余票" },
    { runId: "test", sessionId: "test", signal: new AbortController().signal },
  );
  assert.equal(result.isError, false);
  assert.match(result.content, /Source verification status|Source connector guidance/);
  assert.equal(typeof result.data, "object");
});

test("联网搜索工具有真实执行器并返回结构化来源", async () => {
  const live = createDefaultCapabilityToolRegistry(".", {
    hasLiveSearch: () => true,
    hasVision: () => false,
    hasVoice: () => false,
    runLiveSearch: async (query) => [{
      title: "官方说明",
      content: `关于 ${query} 的一手资料`,
      url: "https://example.com/source",
    }],
  });
  const result = await live.run("web.search", { query: "测试问题" });
  assert.equal(result.ok, true);
  assert.match(result.text, /官方说明/);
  assert.deepEqual((result.data as { query: string }).query, "测试问题");
});

test("工具执行返回来源回执，并明确截断超长结果", async () => {
  const tools = new CapabilityToolRegistry({ dataDir: "." });
  tools.register({
    id: "demo.long",
    name: "长结果",
    description: "测试长结果边界",
    toolset: "demo",
    maxResultSizeChars: 5,
    source: { kind: "plugin", id: "demo-plugin", version: "1.0.0" },
    run: async () => ({ ok: true, text: "123456789", checkedAt: new Date().toISOString() }),
  });
  tools.register({
    id: "demo.integrated",
    name: "运行时能力",
    description: "由产品运行时直接完成",
    toolset: "demo",
  });

  const result = await tools.run("demo.long", {});
  assert.match(result.text, /^12345/);
  assert.match(result.text, /已在 5 个字符处截断/);
  assert.equal(result.receipt?.toolId, "demo.long");
  assert.equal(result.receipt?.source.id, "demo-plugin");
  assert.equal(result.receipt?.truncated, true);
  assert.equal(tools.list().find((item) => item.id === "demo.integrated")?.execution, "runtime-integrated");
});
