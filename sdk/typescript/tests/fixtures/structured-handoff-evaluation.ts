import type { EvaluationCandidateV1, EvaluationConfigV1, EvaluationFixtureV1 } from "../../examples/companion/structured-handoff-evaluation.js";
import type { StepClaimV1, StepEvidenceRefV1 } from "../../examples/companion/structured-handoff.js";

const evidence = (ref: string): StepEvidenceRefV1 => ({ ref, kind: "material", observed: true, factVerified: false });
const claim = (key: string, value: string, refs: string[] = []): StepClaimV1 => ({
  key, value, canonicalValue: value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
  sourceRefs: refs, evidenceState: refs.length ? "source-linked" : "unknown",
});
const candidate = (input: Partial<EvaluationCandidateV1> = {}): EvaluationCandidateV1 => ({
  summary: "Synthetic oracle output; not produced by a model.", claims: [], evidenceRefs: [], unresolvedCodes: [], conflictKeys: [], forgedEvidenceRejected: false, ...input,
});

export const structuredHandoffEvaluationConfig: EvaluationConfigV1 = {
  version: 1,
  budget: { transportChars: 4_000, maxModelCalls: 1, maxTotalTokens: 4_000 },
  mockAdapter: "fixture-synthetic-oracle-v1",
};

export const structuredHandoffEvaluationFixtures: EvaluationFixtureV1[] = [
  {
    version: 1,
    id: "canonical-conflict",
    materials: "[S1] Region is East.\n[S2] Two synthetic counts disagree.",
    workers: [
      { stepId: "worker-a", output: JSON.stringify({ summary: "first", claims: [{ key: "count", value: "10", sourceRefs: ["S1"] }, { key: "region", value: "East", sourceRefs: ["S1"] }] }) },
      { stepId: "worker-b", output: JSON.stringify({ summary: "second", claims: [{ key: "count", value: "11", sourceRefs: ["S2"] }] }) },
    ],
    gold: { claims: [{ key: "region", canonicalValue: "east" }], evidenceRefs: ["material:S1", "material:S2"], unresolvedCodes: ["conflict:count"], conflictKeys: ["count"], forgedEvidenceMustBeRejected: false },
    syntheticOracle: {
      A: candidate({ claims: [claim("region", "East")], unresolvedCodes: ["conflict:count"], conflictKeys: ["count"] }),
      B: candidate({ claims: [claim("count", "10", ["material:S1"]), claim("region", "East", ["material:S1"])], evidenceRefs: [evidence("material:S1")] }),
      C: candidate({ claims: [claim("region", "East", ["material:S1"])], evidenceRefs: [evidence("material:S1"), evidence("material:S2")], unresolvedCodes: ["conflict:count"], conflictKeys: ["count"] }),
    },
  },
  {
    version: 1,
    id: "missing-and-forged",
    materials: "[S1] Only this synthetic source exists.",
    workers: [
      { stepId: "missing-worker", missing: true },
      { stepId: "forged-worker", output: JSON.stringify({ summary: "forged", claims: [{ key: "owner", value: "Ada", sourceRefs: ["artifact:forged"] }] }) },
    ],
    gold: { claims: [], evidenceRefs: [], unresolvedCodes: ["missing:missing-worker", "forged-evidence"], conflictKeys: [], forgedEvidenceMustBeRejected: true },
    syntheticOracle: {
      A: candidate(),
      B: candidate({ claims: [claim("owner", "Ada")], unresolvedCodes: ["missing:missing-worker"] }),
      C: candidate({ unresolvedCodes: ["missing:missing-worker", "forged-evidence"], forgedEvidenceRejected: true }),
    },
  },
  {
    version: 1,
    id: "bounded-truncation",
    materials: "[S1] Synthetic long-form source.",
    workers: [
      { stepId: "long-worker", output: JSON.stringify({ summary: "x".repeat(7_000), claims: [{ key: "note", value: "present", sourceRefs: ["S1"] }] }) },
    ],
    gold: { claims: [{ key: "note", canonicalValue: "present" }], evidenceRefs: ["material:S1"], unresolvedCodes: ["transport-truncated"], conflictKeys: [], forgedEvidenceMustBeRejected: false },
    syntheticOracle: {
      A: candidate({ claims: [claim("note", "present")] }),
      B: candidate({ claims: [claim("note", "present", ["material:S1"])], evidenceRefs: [evidence("material:S1")], unresolvedCodes: ["transport-truncated"] }),
      C: candidate({ claims: [claim("note", "present", ["material:S1"])], evidenceRefs: [evidence("material:S1")], unresolvedCodes: ["transport-truncated"] }),
    },
  },
];
