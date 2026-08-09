import assert from "node:assert/strict";
import test from "node:test";

import {
  dependencyArtifactBlock,
  expertAssignmentPrompt,
  planExpertTeam,
} from "../../examples/companion/expert-contracts.js";

test("plans a capability-specific expert team and changes it for task signals", () => {
  const ordinary = planExpertTeam({
    capabilityId: "project-development",
    instruction: "修复本地项目的表单错误并运行测试",
  });
  const release = planExpertTeam({
    capabilityId: "project-development",
    instruction: "完成构建、发布到远端，并准备失败回滚方案",
  });

  assert.ok(ordinary.assignments.length >= 3);
  assert.ok(ordinary.assignments.some((item) => item.personaId === "lean_engineering"));
  assert.ok(ordinary.assignments.some((item) => item.personaId === "quality_testing"));
  assert.equal(ordinary.assignments.every((item) => item.capabilityId === "project-development"), true);
  assert.ok(release.assignments.some((item) => item.personaId === "release_operations"));
  assert.equal(release.assignments.every((item) => item.memoryMode === "off"), true);
  assert.equal(release.finalMemoryMode, "preferences");
});

test("expert assignments include execution, deliverable, and review contracts", () => {
  const plan = planExpertTeam({
    capabilityId: "product-design",
    instruction: "检查新手从上传文件到下载结果的完整流程",
  });
  const assignment = plan.assignments.find((item) => item.personaId === "user_experience");
  assert.ok(assignment);
  const prompt = expertAssignmentPrompt(assignment, "改进文件工作流");

  assert.match(prompt, /执行流程/);
  assert.match(prompt, /必须交付/);
  assert.match(prompt, /复核标准/);
  assert.match(prompt, /工具不可用时明确记录缺口/);
  assert.doesNotMatch(prompt, /来源仓库|复制的提示词|第三方专家/);
});

test("passes both summaries and full expert artifacts to dependent work", () => {
  const block = dependencyArtifactBlock(["artifact:one", "artifact:two"], (id) => ({
    title: id === "one" ? "架构检查" : "质量检查",
    summary: id === "one" ? "摘要一" : "摘要二",
    text: id === "one" ? "完整原文一：数据库是唯一状态源。" : "完整原文二：上传失败需要可恢复。",
  }));

  assert.match(block, /提炼摘要：摘要一/);
  assert.match(block, /完整原文一：数据库是唯一状态源/);
  assert.match(block, /提炼摘要：摘要二/);
  assert.match(block, /完整原文二：上传失败需要可恢复/);
});
