export type DevelopmentApprovalPolicy = "request" | "auto" | "full";

const POLICY_MATRIX = {
  pi: ["request", "auto"],
  dsh: ["request", "auto"],
  kilo: ["request", "auto"],
  opencode: ["request", "auto"],
  codex: ["request", "auto", "full"],
} as const satisfies Record<string, readonly DevelopmentApprovalPolicy[]>;

export function developmentApprovalPolicies(engine: string): readonly DevelopmentApprovalPolicy[] {
  return Object.prototype.hasOwnProperty.call(POLICY_MATRIX, engine)
    ? POLICY_MATRIX[engine as keyof typeof POLICY_MATRIX]
    : POLICY_MATRIX.pi;
}

export function normalizeDevelopmentApprovalPolicy(
  engine: string,
  value: unknown,
  accessMode: "inspect" | "develop" = "develop",
): DevelopmentApprovalPolicy {
  if (accessMode === "inspect") return "request";
  const policies = developmentApprovalPolicies(engine);
  return policies.includes(value as never) ? value as DevelopmentApprovalPolicy : "request";
}

export function shouldAutoApplyDevelopmentProposal(
  policy: DevelopmentApprovalPolicy,
  checks: Array<{ passed: boolean }>,
): boolean {
  return policy === "auto" && checks.every((check) => check.passed);
}
