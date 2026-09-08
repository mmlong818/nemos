import assert from "node:assert/strict";
import test from "node:test";

import { validateTurnCompletion } from "../../src/agent/index.js";

test("a model declaration and action receipt cannot replace the final delivery", () => {
  const validation = validateTurnCompletion({
    declaration: { state: "completed", evidenceRefs: ["tool:write-1"] },
    assistantText: "",
    trustedEvidence: [{ kind: "tool_receipt", ref: "tool:write-1", tool: "save", effect: "write" }],
  });
  assert.equal(validation.accepted, false);
});

test("completion accepts user-visible text or an artifact actually observed by the runtime", () => {
  assert.equal(validateTurnCompletion({
    declaration: { state: "completed", evidenceRefs: [] },
    assistantText: "Here is the requested analysis.",
    trustedEvidence: [],
  }).accepted, true);
  assert.equal(validateTurnCompletion({
    declaration: { state: "completed", evidenceRefs: ["artifact:report"] },
    assistantText: "",
    trustedEvidence: [{ kind: "artifact", ref: "artifact:report" }],
  }).accepted, true);
  assert.equal(validateTurnCompletion({
    declaration: { state: "completed", evidenceRefs: ["artifact:invented"] },
    assistantText: "",
    trustedEvidence: [],
  }).accepted, false);
});

test("waiting and blocked dispositions require their structured reason", () => {
  assert.equal(validateTurnCompletion({
    declaration: { state: "waiting_input", question: "" }, assistantText: "", trustedEvidence: [],
  }).accepted, false);
  assert.equal(validateTurnCompletion({
    declaration: { state: "blocked", blocker: "" }, assistantText: "", trustedEvidence: [],
  }).accepted, false);
  assert.equal(validateTurnCompletion({
    declaration: { state: "waiting_input", question: "Which account should I use?" }, assistantText: "", trustedEvidence: [],
  }).disposition?.state, "waiting_input");
});
