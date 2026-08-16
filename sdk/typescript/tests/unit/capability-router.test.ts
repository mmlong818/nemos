import assert from "node:assert/strict";
import test from "node:test";
import { routeCapability } from "../../examples/companion/capability-router.js";

test("routes explicit project work ahead of generic document words", () => {
  assert.equal(routeCapability({ goal: "检查项目文档并修复构建问题" }).capabilityId, "project-development");
});

test("explicit meeting-minute deliverables outrank incidental development vocabulary", () => {
  const result = routeCapability({
    goal: "把这段记录整理成会议纪要：周一上线新版；赵强周五前完成回归测试；风险是支付接口偶发超时。",
  });
  assert.equal(result.capabilityId, "meeting-minutes");
  assert.equal(result.confidence, "high");
});

test("routes an attached presentation when the goal is otherwise vague", () => {
  const result = routeCapability({ goal: "帮我继续完善", materialNames: ["季度总结.pptx"] });
  assert.equal(result.capabilityId, "presentation-builder");
  assert.equal(result.confidence, "medium");
});

test("routes extraction from an attached Markdown file as document work, not interface design", () => {
  const result = routeCapability({
    goal: "提取这份材料里有关界面设计的三个结论",
    materialNames: ["产品复盘.md"],
  });
  assert.equal(result.capabilityId, "document-draft");
  assert.equal(result.confidence, "high");
});

test("an explicit workspace always uses project development", () => {
  const result = routeCapability({ goal: "看看这个", workspacePath: "C:\\work\\demo" });
  assert.equal(result.catalogId, "developer");
  assert.equal(result.confidence, "high");
});

test("routes former task-page utilities to capability-page abilities", () => {
  assert.equal(routeCapability({ goal: "把这段中文翻译成英文" }).catalogId, "translate");
  assert.equal(routeCapability({ goal: "把这段录音转写成文字" }).catalogId, "speech");
  assert.equal(routeCapability({ goal: "轻量润色这段文字，只改错别字" }).catalogId, "polish");
});

test("falls back to the thinking workbench without pretending certainty", () => {
  const result = routeCapability({ goal: "我还没想清楚" });
  assert.equal(result.capabilityId, "thinking-workbench");
  assert.equal(result.confidence, "low");
});
