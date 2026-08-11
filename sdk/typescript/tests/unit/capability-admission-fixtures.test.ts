import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseNativeCapabilityPayload } from "../../examples/companion/native-capability-contracts.js";
import { validateDevelopmentWorkspace } from "../../examples/companion/pi-development.js";
import { assessProfessionalArtifact } from "../../examples/companion/professional-artifact-gate.js";
import { admitGeneratedAbilitySpec, admitInstalledSkillContent, CAPABILITY_ADMISSION_MATRIX } from "../../examples/companion/capability-admission.js";
import { missingAdmissionProbes, runCapabilityAdmissionProbes } from "../../examples/companion/capability-admission-probes.js";
import type { GeneratedAbilitySpec } from "../../examples/companion/native-capability-contracts.js";

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

const generatedSpec: GeneratedAbilitySpec = {
  name: "整理周报",
  description: "把团队更新整理为可发送的项目周报。",
  defaultFormat: "md",
  prompt: "根据用户提供的事实整理周报；信息不足时明确列出缺口，不得补写未经确认的进展。",
  triggerExamples: ["整理本周项目周报", "把这些进展做成周报", "生成团队周报"],
  nonTriggerExamples: ["查询天气", "写一篇新闻"],
  checks: ["事实可追溯", "行动项有负责人或标记待定"],
  testCases: [
    { request: "整理本周项目周报", shouldTrigger: true, reason: "明确要求周报" },
    { request: "把这些进展做成周报", shouldTrigger: true, reason: "目标输出是周报" },
    { request: "生成团队周报", shouldTrigger: true, reason: "直接匹配能力" },
    { request: "查询天气", shouldTrigger: false, reason: "不属于项目整理" },
    { request: "写一篇新闻", shouldTrigger: false, reason: "不是周报任务" },
  ],
};

test("矩阵声明的八类场景全部有可运行的夹具探针", () => {
  const covered = new Set(Object.values(CAPABILITY_ADMISSION_MATRIX).flat());
  assert.deepEqual(covered, new Set([
    "normal", "empty-result", "malformed-input", "tool-failure", "handoff-recovery",
    "windows-path", "damaged-format", "model-refusal",
  ]));
  // 上面只证明「声明了八个字符串」。真正要守的是每个场景都有代码去评估它——
  // 此前 tool-failure / handoff-recovery / windows-path / damaged-format 四类
  // 只存在于矩阵里，零评估点，而当时的测试照样通过。
  assert.deepEqual(missingAdmissionProbes(), [], "矩阵声明了场景却没有对应探针");
});

test("三档准入都真实跑完自己声明的场景并逐条给出回执", () => {
  for (const profile of ["native", "development", "generated"] as const) {
    const receipt = runCapabilityAdmissionProbes(profile);
    const scenarios = CAPABILITY_ADMISSION_MATRIX[profile];
    assert.equal(receipt.profile, `admission-probes:${profile}`);
    assert.equal(receipt.outcomes.length, scenarios.length, `${profile} 的回执条数`);
    assert.deepEqual(
      receipt.outcomes.map((item) => item.scenario),
      [...scenarios],
      `${profile} 的场景逐条对应`,
    );
    assert.equal(receipt.passed, true, `${profile} 未通过：${JSON.stringify(receipt.outcomes.filter((o) => !o.passed))}`);
    // 每条都要有可读的判定依据，不能只有 true。
    assert.ok(receipt.outcomes.every((item) => item.detail.length > 0));
  }
});

test("场景声明变化会改变合同指纹，旧结论不能沿用", () => {
  const native = runCapabilityAdmissionProbes("native");
  const development = runCapabilityAdmissionProbes("development");
  assert.match(native.contractHash, /^[a-f0-9]{64}$/);
  assert.notEqual(native.contractHash, development.contractHash);
});

test("生成能力每次写入前都生成绑定合同指纹的准入回执", () => {
  const receipt = admitGeneratedAbilitySpec(generatedSpec);
  assert.equal(receipt.passed, true);
  assert.match(receipt.contractHash, /^[a-f0-9]{64}$/);
  assert.equal(receipt.outcomes.length, CAPABILITY_ADMISSION_MATRIX.generated.length);
});

test("触发边界冲突会阻止生成能力准入", () => {
  const invalid = structuredClone(generatedSpec);
  invalid.nonTriggerExamples[0] = invalid.triggerExamples[0]!;
  const receipt = admitGeneratedAbilitySpec(invalid);
  assert.equal(receipt.passed, false);
  assert.match(receipt.outcomes.find((item) => item.scenario === "malformed-input")?.detail || "", /冲突/);
});

test("外部安装能力也必须具备可执行步骤和结果约定", () => {
  const accepted = admitInstalledSkillContent(`# 周报整理\n\n## 步骤\n\n1. 收集用户提供的事实。\n2. 按完成、进行中和风险分组。\n3. 标记缺失的负责人。\n\n## 输出\n\n交付可发送的周报，并在交付前检查事实来源。`);
  assert.equal(accepted.passed, true);
  assert.equal(accepted.profile, "installed-skill");
  const rejected = admitInstalledSkillContent("# 一个名字\n\n随便处理一下。");
  assert.equal(rejected.passed, false);
});
