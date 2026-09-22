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

test("descriptive evidenceRefs next to visible text are ignored instead of failing the turn", () => {
  // 真实运行：模型把 evidenceRefs 填成一句说明；正文在，就按正文完成，不把说明当伪造的产物引用。
  const described = validateTurnCompletion({
    declaration: { state: "completed", evidenceRefs: ["决策稿正文已直接输出，Markdown 格式"] },
    assistantText: "# 决策稿\n\n方案表……",
    trustedEvidence: [],
  });
  assert.equal(described.accepted, true);
  assert.deepEqual(described.disposition, { state: "completed", evidence: [{ kind: "text", ref: "assistant:final" }] });
  const mixed = validateTurnCompletion({
    declaration: { state: "completed", evidenceRefs: ["artifact:report", "说明文字"] },
    assistantText: "报告已生成。",
    trustedEvidence: [{ kind: "artifact", ref: "artifact:report" }],
  });
  assert.deepEqual(mixed.disposition, { state: "completed", evidence: [{ kind: "text", ref: "assistant:final" }, { kind: "artifact", ref: "artifact:report" }] });
  // 没有正文、只有凭空引用：仍然拒绝。
  assert.equal(validateTurnCompletion({
    declaration: { state: "completed", evidenceRefs: ["决策稿已交付"] }, assistantText: "", trustedEvidence: [],
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
