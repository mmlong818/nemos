import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilityRoadmap } from "../../examples/companion/capability-roadmap.js";

test("路线图明确排除不做的实时餐旅适配器", () => {
  const roadmap = buildCapabilityRoadmap();
  const realConnectors = roadmap.phases.find((phase) => phase.id === "real-connectors");
  assert.ok(realConnectors);

  const status = Object.fromEntries(realConnectors.items.map((item) => [item.id, item.status]));
  assert.equal(status["market-adapter"], "done");
  assert.equal(status["travel-adapter"], "excluded");
  assert.equal(status["hotel-restaurant-adapter"], "excluded");
  assert.equal(status["source-verification-ui"], "done");
});

test("路线图在真实 MCP provider 验收后标记桥接完成", () => {
  const roadmap = buildCapabilityRoadmap();
  const extensions = roadmap.phases.find((phase) => phase.id === "workers-plugins");
  assert.ok(extensions);

  const status = Object.fromEntries(extensions.items.map((item) => [item.id, item.status]));
  assert.equal(status["plugin-abi"], "done");
  assert.equal(status["mcp-bridge"], "done");
  assert.equal(status["credential-proxy"], "done");
  assert.equal(status["mcp-os-sandbox"], "done");
  assert.equal(status["audited-actions"], "done");
  assert.equal(status["durable-delivery"], "done");
  assert.equal(status["multi-agent-observability"], "done");
});

test("路线图统计只计算经过验收的完成项", () => {
  const roadmap = buildCapabilityRoadmap();
  const completed = roadmap.phases.flatMap((phase) => phase.items).filter((item) => item.status === "done").length;
  const total = roadmap.phases.reduce((sum, phase) => sum + phase.items.filter((item) => item.status !== "excluded").length, 0);

  assert.equal(roadmap.completed, completed);
  assert.equal(roadmap.total, total);
  assert.equal(roadmap.percent, Math.round((completed / total) * 100));
  assert.equal(roadmap.updatedAt, "2026-08-17T00:00:00.000+08:00");
});

test("统一执行闭环中的全部项目都有真实验收结果", () => {
  const phase = buildCapabilityRoadmap().phases.find((item) => item.id === "runtime-closure");
  assert.ok(phase);
  assert.equal(phase.items.every((item) => item.status === "done"), true);
});
