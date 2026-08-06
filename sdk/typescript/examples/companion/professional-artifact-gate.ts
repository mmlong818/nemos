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
}

export interface ProfessionalArtifactReceipt {
  version: 1;
  domain: ProfessionalArtifactDomain;
  artifactVersion: string;
  level: "produced" | "validated" | "failed";
  phases: {
    structuredInput: boolean;
    intermediateArtifact: boolean;
    renderedArtifact: boolean;
    verified: boolean;
  };
  checks: ProfessionalArtifactCheck[];
  failureReasons: string[];
}

/**
 * A professional artifact is only validated when every required phase and
 * every required check passes. Merely writing a file is never sufficient.
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
  const verified = input.checks.some((check) => check.required) &&
    input.checks.filter((check) => check.required).every((check) => check.passed);
  const produced = input.artifactExists;
  return {
    version: 1,
    domain: input.domain,
    artifactVersion: input.version,
    level: failures.length === 0 && verified ? "validated" : produced ? "produced" : "failed",
    phases: {
      structuredInput: input.structuredInput,
      intermediateArtifact: input.intermediateArtifact,
      renderedArtifact: input.renderedArtifact,
      verified,
    },
    checks: input.checks.map((check) => ({ ...check })),
    failureReasons: failures,
  };
}
