import assert from "node:assert/strict";
import test from "node:test";
import { completedAgentOutput } from "../../examples/companion/llm.js";
import { AgentTurnDispositionError } from "../../src/index.js";
import type { AgentRunResult } from "../../src/index.js";

function run(output: string, disposition: AgentRunResult["disposition"]): AgentRunResult {
  return { output, disposition } as AgentRunResult;
}

test("waiting_input keeps the delivered body and appends the follow-up question once", () => {
  const body = "本周完成：…\n下周计划：…\n风险：…";
  const question = "周报模板已交付在正文中，是否还需要调整格式？";
  const trailing: string[] = [];
  const text = completedAgentOutput(run(body, { state: "waiting_input", question }), 10_000, (chunk) => trailing.push(chunk));
  assert.equal(text, `${body}\n\n${question}`);
  assert.deepEqual(trailing, [`\n\n${question}`], "the streamed channel must receive exactly the appended part");
  // A body that already ends with the question is not duplicated.
  assert.equal(completedAgentOutput(run(text, { state: "waiting_input", question }), 10_000), text);
});

test("waiting_input without any delivered body is still an incomplete turn", () => {
  const question = "请先告诉我目标读者是谁？";
  for (const output of ["", "   ", question]) {
    assert.throws(
      () => completedAgentOutput(run(output, { state: "waiting_input", question }), 10_000),
      (error: unknown) => error instanceof AgentTurnDispositionError && error.disposition.state === "waiting_input",
    );
  }
});

test("blocked and cancelled dispositions never surface partial text as a completed answer", () => {
  assert.throws(() => completedAgentOutput(run("half", { state: "blocked", blocker: "no tool access" }), 10_000), AgentTurnDispositionError);
  assert.throws(() => completedAgentOutput(run("half", { state: "cancelled", reason: "user" } as AgentRunResult["disposition"]), 10_000), AgentTurnDispositionError);
  assert.equal(completedAgentOutput(run("  done  ", { state: "completed", evidence: [] } as AgentRunResult["disposition"]), 10), "done");
});
