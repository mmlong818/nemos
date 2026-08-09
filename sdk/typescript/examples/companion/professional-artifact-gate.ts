export type ProfessionalArtifactDomain =
  | "document"
  | "presentation"
  | "software"
  | "engineering"
  | "three-dimensional"
  | "risk-model";

export interface ProfessionalArtifactCheck {
  id: string;
  label: string;
  required: boolean;
  passed: boolean;
  phase?: "validation" | "verification";
  detail?: string;
}

export interface ProfessionalArtifactGateInput {
  domain: ProfessionalArtifactDomain;
  artifactExists: boolean;
  structuredInput: boolean;
  intermediateArtifact: boolean;
  renderedArtifact: boolean;
  checks: ProfessionalArtifactCheck[];
  version: string;
  approved?: boolean;
}

export interface ProfessionalArtifactReceipt {
  version: 1;
  domain: ProfessionalArtifactDomain;
  artifactVersion: string;
  level: "produced" | "validated" | "verified" | "approved" | "failed";
  phases: {
    structuredInput: boolean;
    intermediateArtifact: boolean;
    renderedArtifact: boolean;
    validated: boolean;
    verified: boolean;
    approved: boolean;
  };
  checks: ProfessionalArtifactCheck[];
  failureReasons: string[];
}

/**
 * Validation proves structure and deterministic rules. Verification is a
 * separate level and requires at least one real domain or tool check. Merely
 * writing a file, or relabelling a validation check, is never sufficient.
 */
export function assessProfessionalArtifact(input: ProfessionalArtifactGateInput): ProfessionalArtifactReceipt {
  const failures: string[] = [];
  if (!input.artifactExists) failures.push("未生成真实产物");
  if (!input.structuredInput) failures.push("缺少结构化输入");
  if (!input.intermediateArtifact) failures.push("缺少可检查的中间产物");
  if (!input.renderedArtifact) failures.push("缺少渲染或解析结果");
  for (const check of input.checks) {
    if (check.required && !check.passed) failures.push(`${check.label}未通过`);
  }
  const validationChecks = input.checks.filter((check) => check.required && check.phase !== "verification");
  const verificationChecks = input.checks.filter((check) => check.required && check.phase === "verification");
  const requiredPhasesPassed = input.artifactExists && input.structuredInput &&
    input.intermediateArtifact && input.renderedArtifact;
  const validated = requiredPhasesPassed && validationChecks.every((check) => check.passed) &&
    verificationChecks.every((check) => check.passed);
  const verified = validated && verificationChecks.length > 0;
  const approved = verified && input.approved === true;
  const produced = input.artifactExists;
  return {
    version: 1,
    domain: input.domain,
    artifactVersion: input.version,
    level: approved ? "approved" : verified ? "verified" : validated ? "validated" : produced ? "produced" : "failed",
    phases: {
      structuredInput: input.structuredInput,
      intermediateArtifact: input.intermediateArtifact,
      renderedArtifact: input.renderedArtifact,
      validated,
      verified,
      approved,
    },
    checks: input.checks.map((check) => ({ ...check })),
    failureReasons: failures,
  };
}
