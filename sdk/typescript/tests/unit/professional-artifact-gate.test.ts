import assert from "node:assert/strict";
import test from "node:test";

import { assessProfessionalArtifact } from "../../examples/companion/professional-artifact-gate.js";

test("专业产物不能只凭文件存在就通过", () => {
  const receipt = assessProfessionalArtifact({
    domain: "engineering",
    artifactExists: true,
    structuredInput: true,
    intermediateArtifact: true,
    renderedArtifact: true,
    version: "engineering-v1",
    checks: [{ id: "compile", label: "编译检查", required: true, passed: false }],
  });
  assert.equal(receipt.level, "produced");
  assert.deepEqual(receipt.failureReasons, ["编译检查未通过"]);
});

test("结构化输入、中间产物、渲染和规则检查通过后只算已校验", () => {
  const receipt = assessProfessionalArtifact({
    domain: "three-dimensional",
    artifactExists: true,
    structuredInput: true,
    intermediateArtifact: true,
    renderedArtifact: true,
    version: "scene-v2",
    checks: [
      { id: "parse", label: "格式解析", required: true, passed: true },
      { id: "dimensions", label: "尺寸检查", required: true, passed: true },
      { id: "preview", label: "预览检查", required: false, passed: false },
    ],
  });
  assert.equal(receipt.level, "validated");
  assert.equal(receipt.phases.validated, true);
  assert.equal(receipt.phases.verified, false);
});

test("只有真实领域或工具检查通过后才能升级为已核验", () => {
  const receipt = assessProfessionalArtifact({
    domain: "software",
    artifactExists: true,
    structuredInput: true,
    intermediateArtifact: true,
    renderedArtifact: true,
    version: "software-v3",
    checks: [
      { id: "manifest", label: "清单检查", required: true, passed: true },
      { id: "test", label: "真实测试", required: true, passed: true, phase: "verification" },
    ],
  });
  assert.equal(receipt.level, "verified");
  assert.equal(receipt.phases.verified, true);
  assert.equal(receipt.phases.approved, false);
});

test("人工确认不能越过领域核验直接升级", () => {
  const receipt = assessProfessionalArtifact({
    domain: "presentation",
    artifactExists: true,
    structuredInput: true,
    intermediateArtifact: true,
    renderedArtifact: true,
    version: "deck-v1",
    approved: true,
    checks: [{ id: "structure", label: "结构检查", required: true, passed: true }],
  });
  assert.equal(receipt.level, "validated");
  assert.equal(receipt.phases.approved, false);
});
