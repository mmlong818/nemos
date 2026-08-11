import { createHash } from "node:crypto";

import type { GeneratedAbilitySpec } from "./native-capability-contracts.js";

export type CapabilityAdmissionScenario =
  | "normal"
  | "empty-result"
  | "malformed-input"
  | "tool-failure"
  | "handoff-recovery"
  | "windows-path"
  | "damaged-format"
  | "model-refusal";

export interface CapabilityAdmissionOutcome {
  scenario: CapabilityAdmissionScenario;
  passed: boolean;
  detail: string;
}

/**
 * 回执档位。
 * - generated-ability / installed-skill：对能力内容做静态检查
 * - admission-probes:*：对矩阵声明的运行期场景跑真实夹具探针
 */
export type CapabilityAdmissionProfileId =
  | "generated-ability"
  | "installed-skill"
  | `admission-probes:${"native" | "development" | "generated"}`;

export interface CapabilityAdmissionReceipt {
  version: 1;
  profile: CapabilityAdmissionProfileId;
  contractHash: string;
  checkedAt: string;
  passed: boolean;
  outcomes: CapabilityAdmissionOutcome[];
}

export const CAPABILITY_ADMISSION_MATRIX: Readonly<Record<"native" | "development" | "generated", readonly CapabilityAdmissionScenario[]>> = {
  native: ["normal", "empty-result", "malformed-input", "damaged-format", "model-refusal"],
  development: ["normal", "tool-failure", "handoff-recovery", "windows-path", "model-refusal"],
  generated: ["normal", "empty-result", "malformed-input", "model-refusal"],
};

export function admitInstalledSkillContent(content: string): CapabilityAdmissionReceipt {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const operationalLines = lines.filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line));
  const outcomes: CapabilityAdmissionOutcome[] = [
    { scenario: "normal", passed: /^#\s+\S+/m.test(normalized) && operationalLines.length >= 3, detail: `${operationalLines.length} 条可执行步骤` },
    { scenario: "empty-result", passed: normalized.length >= 80, detail: `${normalized.length} 个字符` },
    { scenario: "malformed-input", passed: !/[\u0000]/.test(normalized) && !/<script\b/i.test(normalized), detail: "内容边界和可执行脚本检查" },
    { scenario: "model-refusal", passed: /(输出|交付|验收|检查|结果|output|deliver|check|result)/i.test(normalized), detail: "包含结果或验收约定" },
  ];
  return {
    version: 1,
    profile: "installed-skill",
    contractHash: createHash("sha256").update(normalized).digest("hex"),
    checkedAt: new Date().toISOString(),
    passed: outcomes.every((item) => item.passed),
    outcomes,
  };
}

export function admitGeneratedAbilitySpec(spec: GeneratedAbilitySpec): CapabilityAdmissionReceipt {
  const positive = spec.testCases.filter((item) => item.shouldTrigger);
  const negative = spec.testCases.filter((item) => !item.shouldTrigger);
  const positiveKeys = new Set(spec.triggerExamples.map(normalizeExample));
  const negativeKeys = new Set(spec.nonTriggerExamples.map(normalizeExample));
  const overlaps = [...positiveKeys].filter((item) => negativeKeys.has(item));
  const outcomes: CapabilityAdmissionOutcome[] = [
    {
      scenario: "normal",
      passed: positive.length >= 3 && positive.every(validCase),
      detail: `${positive.length} 个应触发用例`,
    },
    {
      scenario: "empty-result",
      passed: [...positiveKeys, ...negativeKeys].every(Boolean) && spec.testCases.every((item) => normalizeExample(item.request).length > 0),
      detail: "空请求不会被登记为触发样例",
    },
    {
      scenario: "malformed-input",
      passed: negative.length >= 2 && negative.every(validCase) && overlaps.length === 0,
      detail: overlaps.length ? `触发与非触发样例冲突：${overlaps.join("、")}` : `${negative.length} 个非触发用例`,
    },
    {
      scenario: "model-refusal",
      passed: spec.prompt.trim().length >= 20 && spec.checks.length >= 2,
      detail: "提示词与交付检查完整，拒答或空产物仍会进入统一产物准入门",
    },
  ];
  const contract = JSON.stringify({
    name: spec.name,
    description: spec.description,
    defaultFormat: spec.defaultFormat,
    prompt: spec.prompt,
    triggerExamples: spec.triggerExamples,
    nonTriggerExamples: spec.nonTriggerExamples,
    checks: spec.checks,
    testCases: spec.testCases,
  });
  return {
    version: 1,
    profile: "generated-ability",
    contractHash: createHash("sha256").update(contract).digest("hex"),
    checkedAt: new Date().toISOString(),
    passed: outcomes.every((item) => item.passed),
    outcomes,
  };
}

function validCase(item: GeneratedAbilitySpec["testCases"][number]): boolean {
  return item.request.trim().length > 0 && item.reason.trim().length > 0;
}

function normalizeExample(value: string): string {
  return String(value || "").trim().toLocaleLowerCase("zh-CN").replace(/[\s，。！？、,.!?;；:：]+/g, "");
}
