import { chatJSON, JUDGE_MODEL } from './llm.mjs';

const JUDGE_SYS = `You are a strict evaluator for a memory system benchmark.
You are given: a QUERY about a user, a list of EXPECTED facts (the correct current answer),
a list of FORBIDDEN facts (stale/incorrect/should-not-appear-as-current), and the RETRIEVED memory
entries the system returned for the query.

Decide, judging ONLY the retrieved entries as a set:
- contains_expected: true if the retrieved entries clearly convey at least one EXPECTED fact as a current/true fact about the user.
- contains_forbidden: true if the retrieved entries present any FORBIDDEN fact as if it were a current/true fact about the user. A retrieved entry that explicitly marks a forbidden fact as past/former/no-longer-true does NOT count as forbidden.

Output strict JSON: {"contains_expected": bool, "contains_forbidden": bool, "why": "<one short sentence>"}`;

export async function judgeProbe(probe, retrieved) {
  const user = JSON.stringify({
    QUERY: probe.query,
    EXPECTED: probe.expected,
    FORBIDDEN: probe.forbidden,
    RETRIEVED: retrieved,
  }, null, 2);
  const r = await chatJSON(JUDGE_MODEL, JUDGE_SYS, user, 0);
  return { contains_expected: !!r.contains_expected, contains_forbidden: !!r.contains_forbidden, why: r.why };
}
