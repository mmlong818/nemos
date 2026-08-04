import assert from "node:assert/strict";
import test from "node:test";

import {
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
