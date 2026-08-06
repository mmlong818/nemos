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

test("结构化输入、中间产物、渲染和全部必需检查通过后才算已验证", () => {
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
  assert.equal(receipt.phases.verified, true);
});
