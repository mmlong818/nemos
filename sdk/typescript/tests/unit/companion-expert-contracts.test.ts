import assert from "node:assert/strict";
import test from "node:test";

import {
  dependencyArtifactBlock,
  expertAssignmentPrompt,
  expertContract,
  planExpertTeam,
} from "../../examples/companion/expert-contracts.js";
import { EXPERT_CORES } from "../../examples/companion/experts.js";

test("every registered expert has an executable contract", () => {
  assert.equal(EXPERT_CORES.length, 26);
  for (const expert of EXPERT_CORES) {
    assert.ok(expertContract(expert.id), `${expert.id} is missing an execution contract`);
  }
});

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

test("covers document, presentation, data, coordination, automation, security, contract, and visual work", () => {
  const cases: Array<[string, string, string]> = [
    ["document-draft", "整理一份可以发送的正式 Word 报告", "document_editor"],
    ["presentation-builder", "制作一套面向投资人的产品演示 PPT", "presentation_design"],
    ["market-briefing", "检查 Excel 数据口径、指标和趋势图", "data_analysis"],
    ["meeting-minutes", "整理会议决定、负责人和行动项", "project_coordination"],
    ["workflow-builder", "把重复工作改成有审批和失败重试的自动化流程", "workflow_automation"],
    ["project-development", "检查权限、密钥泄露和发布安全", "security_compliance"],
    ["business-deal", "检查合作协议的付款、验收和知识产权条款", "contract_risk"],
    ["image-prompt-reconstruction", "分析图片构图、光线和材质并反推提示词", "visual_analysis"],
    ["research-brief", "不要只看简介，要核验来源和仓库实际实现", "research_verification"],
  ];

  for (const [capabilityId, instruction, personaId] of cases) {
    const plan = planExpertTeam({ capabilityId, instruction });
    assert.ok(plan.assignments.some((item) => item.personaId === personaId), `${capabilityId} should include ${personaId}`);
  }
});

test("passes both summaries and full expert artifacts to dependent work", () => {
  const block = dependencyArtifactBlock(["artifact:one", "artifact:two"], (id) => ({
    title: id === "one" ? "架构检查" : "质量检查",
    summary: id === "one" ? "摘要一" : "摘要二",
    text: id === "one" ? "完整原文一：数据库是唯一状态源。" : "完整原文二：上传失败需要可恢复。",
    proofLevel: id === "one" ? "verified" : "validated",
    verificationSummary: id === "one" ? "当前源码已核验" : undefined,
    checks: id === "one" ? [] : [{ label: "浏览器真实操作", status: "not-run", detail: "未提供浏览器" }],
  }));

  assert.match(block, /提炼摘要：摘要一/);
  assert.match(block, /完整原文一：数据库是唯一状态源/);
  assert.match(block, /提炼摘要：摘要二/);
  assert.match(block, /完整原文二：上传失败需要可恢复/);
  assert.match(block, /证据状态：已核验/);
  assert.match(block, /来源核验：当前源码已核验/);
  assert.match(block, /未通过检查：浏览器真实操作/);
  assert.match(block, /没有达到“已核验”/);
});
