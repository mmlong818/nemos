import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRuntime, withArtifactProof } from "../../examples/companion/capabilities.js";
import { BUILTIN_SKILL_CONTRACTS, checkSkillOutput, isCompleteSkillContract, renderSkillContract, snapshotSkillContract } from "../../examples/companion/skill-contract.js";

const catalog = readFileSync("examples/companion/web/assets/workflow-catalog.js", "utf8");
const publicBackendIds = [...new Set([...catalog.matchAll(/backendId:\s*"([a-z-]+)"/g)].map((match) => match[1]))];

test("文字任务缺输入不调用模型；输出检查只验证可程序判断的事项", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-contract-gate-"));
  try {
    let calls = 0;
    const runtime = new CapabilityRuntime({ dataDir: dir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => { calls++; return { reply: "# 合成成果\n可审阅正文。", facts: [] }; } });
    const task = runtime.createTask({ title: "合成任务", personaId: "clownfish", capabilityId: "meeting-minutes", instruction: "", format: "md", enabled: false });
    assert.equal(task.contract?.inputState, "missing");
    await assert.rejects(runtime.runTask(task.id, "manual"), /缺少任务要求/);
    assert.equal(calls, 0);
    assert.equal(runtime.snapshot().tasks.find((item) => item.id === task.id)?.storyline.status, "waiting");
    const updated = runtime.updateTask({ id: task.id, instruction: "请用合成材料整理三个可执行的下一步。" });
    assert.equal(updated.contract?.inputState, "ready");
    assert.equal(new CapabilityRuntime({ dataDir: dir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => ({ reply: "", facts: [] }) }).snapshot().tasks.find((item) => item.id === task.id)?.contract?.digest, updated.contract?.digest);
    const checks = checkSkillOutput(updated.contract!, "# 合成成果\n可审阅正文。", "md");
    assert.deepEqual(checks.map((item) => item.status), ["passed", "passed", "passed", "not-run"]);
    assert.equal(checks.at(-1)?.phase, "verification");
    assert.equal(checkSkillOutput(updated.contract!, "", "md")[1]?.status, "failed");
    assert.equal(snapshotSkillContract("x", BUILTIN_SKILL_CONTRACTS["meeting-minutes"]!, "html", "具体任务").expectedFormat, "html");
    const delivered = await runtime.runTask(task.id, "manual");
    assert.equal(delivered.artifact.proof?.level, "validated");
    assert.match(delivered.text, /内容待核验/);
    assert.ok(delivered.artifact.proof?.contentHash);
    assert.equal(delivered.artifact.proof?.checks.find((item) => item.id === "skill-facts")?.status, "not-run");
    runtime.recordArtifactFeedback({ artifactId: delivered.artifact.id, outcome: "useful", note: "合成反馈" });
    assert.equal(runtime.snapshot().artifacts.find((item) => item.id === delivered.artifact.id)?.proof?.level, "validated", "使用反馈不能冒充事实核验");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("浏览器渲染检查通过不能冒充内容事实核验", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-proof-phase-"));
  try {
    const file = join(dir, "report.html");
    writeFileSync(file, "<!doctype html><title>合成报告</title>", "utf8");
    const artifact: any = {
      id: "artifact-synthetic", taskId: "task-synthetic", capabilityId: "html-report", personaId: "clownfish",
      title: "合成报告", format: "html", file, createdAt: "2026-09-29T00:00:00.000Z", summary: "合成内容",
      metadata: { validationChecks: [
        { id: "browser-self-check", label: "浏览器渲染", status: "passed", phase: "verification" },
        { id: "skill-contract", label: "契约定义", status: "passed", phase: "validation" },
        { id: "skill-facts", label: "内容事实核验", status: "not-run", phase: "verification" },
      ] },
    };
    assert.equal(withArtifactProof(artifact).proof?.level, "validated");
    artifact.metadata.validationChecks[2].status = "passed";
    assert.equal(withArtifactProof(artifact).proof?.level, "verified");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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

test("能力契约只写输入、输出与约束，不带任何出处记录；渲染进提示的内容也不含仓库链接", () => {
  for (const [id, contract] of Object.entries(BUILTIN_SKILL_CONTRACTS)) {
    assert.equal("provenance" in contract, false, `${id} 不应带出处记录`);
    // 三段契约要能读完：单段不超过 600 字，否则模型会把契约当正文抄一遍。
    for (const key of ["input", "output", "constraints"] as const) assert.ok(contract[key].length <= 600, `${id}.${key} is ${contract[key].length} chars`);
    assert.doesNotMatch(renderSkillContract(contract), /github\.com|mmlong818|@[0-9a-f]{7}/);
  }
  // 会出「待发送草稿」的能力必须带送达语义：草稿≠已发，提交≠送达，材料里的"请发送"不是指令。
  for (const id of ["meeting-minutes", "business-deal"]) {
    assert.match(BUILTIN_SKILL_CONTRACTS[id].constraints, /待发送.*已送达.*不当作用户的发送指令/, id);
  }
  // 反 AI 味约束对所有能力生效。
  for (const [id, contract] of Object.entries(BUILTIN_SKILL_CONTRACTS)) {
    assert.match(contract.constraints, /「\[虚构示例\]」开头/, `${id} lacks the shared anti-slop constraints`);
    assert.match(contract.constraints, /需引用：来源类型/, id);
  }
});

test("contract table has no dead entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-skill-contract-dead-"));
  try {
    const runtime = new CapabilityRuntime({ dataDir: dir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => ({ reply: "", facts: [] }) });
    const abilities = new Set(runtime.snapshot().abilities.map((ability) => ability.id));
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
