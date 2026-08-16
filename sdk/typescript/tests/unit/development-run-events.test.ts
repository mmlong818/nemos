import assert from "node:assert/strict";
import test from "node:test";
import {
  createDevelopmentRunEvent,
  developmentRunEventFromUnknown,
  inferDevelopmentRunEventType,
} from "../../examples/companion/development-run-events.js";

test("开发运行事件把不同引擎的文字进度归一为稳定状态", () => {
  assert.equal(inferDevelopmentRunEventType("正在读取项目并分析代码", 20), "reading");
  assert.equal(inferDevelopmentRunEventType("正在运行测试和构建", 80), "checking");
  assert.equal(inferDevelopmentRunEventType("修改等待用户确认", 90), "needs_attention");
  assert.equal(inferDevelopmentRunEventType("产物已保存", 100), "completed");
  const event = createDevelopmentRunEvent({ label: "正在读取项目", progress: 20, engine: "pi" });
  assert.equal(event.type, "reading");
  assert.equal(developmentRunEventFromUnknown(event)?.engine, "pi");
});

test("开发运行事件拒绝无法识别的持久化数据", () => {
  assert.equal(developmentRunEventFromUnknown({ type: "unknown", label: "x" }), undefined);
  assert.equal(developmentRunEventFromUnknown(null), undefined);
});
