import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { BUILTIN_SKILL_CONTRACTS, isCompleteSkillContract, renderSkillContract } from "../../examples/companion/skill-contract.js";

const catalog = readFileSync("examples/companion/web/assets/workflow-catalog.js", "utf8");
const publicBackendIds = [...new Set([...catalog.matchAll(/backendId:\s*"([a-z-]+)"/g)].map((match) => match[1]))];

test("every user-facing execution ability carries a complete input / output / constraints contract", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-skill-contract-"));
  try {
    const runtime = new CapabilityRuntime({ dataDir: dir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => ({ reply: "", facts: [] }) });
    const abilities = new Map(runtime.snapshot().abilities.map((ability) => [ability.id, ability]));
    const executionIds = publicBackendIds.filter((id) => abilities.has(id));
    assert.ok(executionIds.length >= 10, `catalog should map to builtin abilities: ${executionIds.join(", ")}`);
    for (const id of executionIds) {
      assert.ok(isCompleteSkillContract(abilities.get(id)!.contract), `${id} is missing a complete contract`);
    }
    // Tools (quick-*) are not abilities; the contract table must not carry dead entries either.
    for (const id of Object.keys(BUILTIN_SKILL_CONTRACTS)) assert.ok(abilities.has(id), `${id} has a contract but no ability`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("contracts render as three labelled lines and reach the run prompt after the capability rules", async () => {
  const rendered = renderSkillContract({ input: "每行一条记录", output: "表格加三句结论", constraints: "不编造数字" });
  assert.deepEqual(rendered.split("\n"), ["Skill contract:", "- 输入契约：每行一条记录", "- 输出契约：表格加三句结论", "- 约束：不编造数字"]);
  assert.equal(isCompleteSkillContract({ input: "短", output: "表格加三句结论", constraints: "不编造数字、人名与日期" }), false);

  const dir = mkdtempSync(join(tmpdir(), "clownfish-skill-contract-prompt-"));
  try {
    const prompts: string[] = [];
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async (_personaId: string, prompt: string) => { prompts.push(prompt); return { reply: "会议纪要正文\n\n交付完成。", facts: [] }; },
    });
    const task = runtime.createTask({ title: "纪要", personaId: "clownfish", capabilityId: "meeting-minutes", instruction: "整理这次会议" });
    await runtime.runTask(task.id, "manual");
    const prompt = prompts[0];
    const rules = prompt.indexOf("Capability rules:");
    const contract = prompt.indexOf("Skill contract:");
    const request = prompt.indexOf("User request:");
    assert.ok(rules >= 0 && contract > rules && request > contract, "contract sits between the rules and the user request");
    assert.match(prompt, /输入契约：会议转写/);
    assert.match(prompt, /约束：未点名的负责人写「未指定」/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
