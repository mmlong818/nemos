// capability-admission-probes.ts — v0.8 准入夹具探针
//
// 背景：CAPABILITY_ADMISSION_MATRIX 声明了八类场景，但其中 tool-failure、
// handoff-recovery、windows-path、damaged-format 此前只是矩阵里的字符串，
// 没有任何代码评估过它们，守门的测试只是把声明的字符串跟硬编码集合比对。
//
// 这里的处理方式：这四类是运行期行为，不能靠静态读内容判断，所以为每个场景
// 注册一个**真实可运行的确定性探针**。准入时逐个跑；缺探针本身即准入失败——
// 这正是 M13 验收门写的「测试缺失本身就是准入失败」。

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CAPABILITY_ADMISSION_MATRIX,
  type CapabilityAdmissionOutcome,
  type CapabilityAdmissionReceipt,
  type CapabilityAdmissionScenario,
} from "./capability-admission.js";
import {
  createCapabilityHandoffEnvelope,
  failCapabilityHandoff,
  isCapabilityHandoffDelivered,
  receiveCapabilityHandoff,
  returnCapabilityHandoff,
} from "./capability-handoff.js";
import { parseNativeCapabilityPayload } from "./native-capability-contracts.js";
import { assessProfessionalArtifact } from "./professional-artifact-gate.js";
import { validateDevelopmentWorkspace } from "./pi-development.js";

export type CapabilityAdmissionProfile = keyof typeof CAPABILITY_ADMISSION_MATRIX;

/** 探针必须是确定性的、不联网、不依赖用户数据，否则准入结果不可复现。 */
type AdmissionProbe = () => { passed: boolean; detail: string };

/** 一个场景「通过」的判定始终是反向的：错误输入必须被拒绝，而不是被接受。 */
const PROBES: Partial<Record<CapabilityAdmissionScenario, AdmissionProbe>> = {
  normal: () => {
    const receipt = assessProfessionalArtifact({
      domain: "software",
      artifactExists: true,
      structuredInput: true,
      intermediateArtifact: true,
      renderedArtifact: true,
      version: "probe-v1",
      checks: [{ id: "build", label: "构建", required: true, passed: true }],
    });
    return { passed: receipt.level !== "produced", detail: `正常路径产出等级 ${receipt.level}` };
  },

  "empty-result": () => {
    let rejected = false;
    try {
      parseNativeCapabilityPayload("research-brief", "");
    } catch {
      rejected = true;
    }
    return { passed: rejected, detail: "空模型输出被拒绝" };
  },

  "malformed-input": () => {
    let rejected = false;
    try {
      parseNativeCapabilityPayload("research-brief", "{broken");
    } catch {
      rejected = true;
    }
    return { passed: rejected, detail: "结构损坏的输出被拒绝" };
  },

  "damaged-format": () => {
    // 合法 JSON 但缺必填字段：这是「格式看着对、内容破损」的真实形态。
    let rejected = false;
    try {
      parseNativeCapabilityPayload("research-brief", JSON.stringify({ kind: "research-brief" }));
    } catch {
      rejected = true;
    }
    return { passed: rejected, detail: "字段缺失的破损产物被拒绝" };
  },

  "model-refusal": () => {
    // 模型拒答时只有文字、没有产物，不得升级为已校验。
    const receipt = assessProfessionalArtifact({
      domain: "software",
      artifactExists: false,
      structuredInput: false,
      intermediateArtifact: false,
      renderedArtifact: false,
      version: "probe-v1",
      checks: [],
    });
    return { passed: receipt.level === "produced" || !!receipt.failureReasons.length, detail: "拒答不产生已校验产物" };
  },

  "tool-failure": () => {
    // 必需检查失败不能被其它通过项平均掉。
    const receipt = assessProfessionalArtifact({
      domain: "software",
      artifactExists: true,
      structuredInput: true,
      intermediateArtifact: true,
      renderedArtifact: true,
      version: "probe-v1",
      checks: [
        { id: "build", label: "构建", required: true, passed: true },
        { id: "test", label: "测试", required: true, passed: false },
      ],
    });
    return {
      passed: receipt.level !== "validated" && receipt.failureReasons.length > 0,
      detail: `必需检查失败后等级 ${receipt.level}`,
    };
  },

  "handoff-recovery": () => {
    const envelope = createCapabilityHandoffEnvelope({ goal: "准入探针" }, "research-brief");
    if (!envelope) return { passed: false, detail: "无法构造交接包" };
    const received = receiveCapabilityHandoff(envelope);
    const failed = failCapabilityHandoff(received, { kind: "timeout" });
    // 中断的交接既不能算交付，也必须能在重试后恢复成交付。
    const notDelivered = !isCapabilityHandoffDelivered(failed) && failed.status === "failed";
    const recovered = isCapabilityHandoffDelivered(returnCapabilityHandoff(failed, "artifact-probe"));
    return {
      passed: notDelivered && recovered && failed.retryable === true,
      detail: "中断交接不算交付且可恢复",
    };
  },

  "windows-path": () => {
    const dir = mkdtempSync(join(tmpdir(), "clownfish-admission-probe-"));
    try {
      writeFileSync(join(dir, "package.json"), "{}", "utf8");
      const resolved = validateDevelopmentWorkspace(dir);
      let rootRejected = false;
      try {
        // 盘根必须被拒：Windows 上这是最容易误放行的路径形态。
        validateDevelopmentWorkspace(dir.slice(0, 3));
      } catch {
        rootRejected = true;
      }
      return { passed: resolved === dir && rootRejected, detail: "真实目录通过、盘根被拒" };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

/** 矩阵里声明但没有注册探针的场景。非空即表示准入体系本身不完整。 */
export function missingAdmissionProbes(): CapabilityAdmissionScenario[] {
  const declared = new Set(Object.values(CAPABILITY_ADMISSION_MATRIX).flat());
  return [...declared].filter((scenario) => !PROBES[scenario]);
}

/**
 * 跑完某一档声明的全部场景探针。
 *
 * 缺探针记为 failed 而不是跳过——跳过会让「未实现」和「已通过」在回执里长得一样，
 * 那正是这次复检抓到的问题。
 */
export function runCapabilityAdmissionProbes(
  profile: CapabilityAdmissionProfile,
  now = new Date(),
): CapabilityAdmissionReceipt {
  const scenarios = CAPABILITY_ADMISSION_MATRIX[profile];
  const outcomes: CapabilityAdmissionOutcome[] = scenarios.map((scenario) => {
    const probe = PROBES[scenario];
    if (!probe) return { scenario, passed: false, detail: "缺少可运行的准入夹具探针" };
    try {
      const result = probe();
      return { scenario, passed: result.passed, detail: result.detail };
    } catch (error) {
      // 探针自身异常也算准入失败：无法验证等于没有验证。
      return {
        scenario,
        passed: false,
        detail: `探针执行失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
  return {
    version: 1,
    profile: `admission-probes:${profile}`,
    contractHash: admissionProbeContractHash(profile),
    checkedAt: now.toISOString(),
    passed: outcomes.every((item) => item.passed),
    outcomes,
  };
}

function admissionProbeContractHash(profile: CapabilityAdmissionProfile): string {
  // 指纹绑定「这一档声明了哪些场景」，声明变化时回执不能沿用旧结论。
  const scenarios = [...CAPABILITY_ADMISSION_MATRIX[profile]].sort();
  return createHash("sha256").update(`${profile}:${scenarios.join(",")}`).digest("hex");
}
