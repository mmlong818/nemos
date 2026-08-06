import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseNativeCapabilityPayload } from "../../examples/companion/native-capability-contracts.js";
import { validateDevelopmentWorkspace } from "../../examples/companion/pi-development.js";
import { assessProfessionalArtifact } from "../../examples/companion/professional-artifact-gate.js";

const validResearch = JSON.stringify({
  kind: "research-brief",
  title: "核验报告",
  summary: "一条带来源锚点的结论",
  data: {
    question: "结论是否有证据？",
    plan: ["确认问题", "查找来源", "交叉核验"],
    sources: [{
      id: "S1", title: "官方资料", url: "https://example.com/source", publisher: "机构", tier: 1,
      score: 95, checkedAt: "2026-08-07T00:00:00.000Z", claims: ["结论"],
      anchors: [{ id: "A1", page: "第 2 页", quote: "用于核验的短引文" }],
    }, {
      id: "S2", title: "第二来源", url: "https://example.org/source", publisher: "机构二", tier: 2,
      score: 85, checkedAt: "2026-08-07T00:01:00.000Z", claims: ["结论"],
      anchors: [{ id: "A2", span: "结论段", quote: "独立来源的短引文" }],
    }],
    findings: [{ claim: "结论", evidenceIds: ["S1", "S2"], anchorIds: ["A1", "A2"], confidence: 0.9, status: "confirmed" }],
    conclusion: "证据充分。", limitations: ["样本有限"], nextSteps: ["持续复核"],
  },
});

test("能力准入夹具拒绝空、损坏和不完整的模型输出", () => {
  const fixtures = ["", "{broken", JSON.stringify({ kind: "research-brief" })];
  for (const fixture of fixtures) {
    assert.throws(() => parseNativeCapabilityPayload("research-brief", fixture));
  }
  assert.equal(parseNativeCapabilityPayload("research-brief", validResearch).kind, "research-brief");
});

test("Windows 工作区路径在准入边界按真实目录校验", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-admission-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}", "utf8");
    assert.equal(validateDevelopmentWorkspace(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("任何必需工具或渲染检查失败都不能被平均成通过", () => {
  const receipt = assessProfessionalArtifact({
    domain: "software", artifactExists: true, structuredInput: true, intermediateArtifact: true,
    renderedArtifact: true, version: "fixture-v1",
    checks: [
      { id: "build", label: "构建", required: true, passed: true },
      { id: "test", label: "测试", required: true, passed: false },
    ],
  });
  assert.notEqual(receipt.level, "validated");
  assert.match(receipt.failureReasons.join("\n"), /测试/);
});
