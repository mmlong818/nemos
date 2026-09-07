import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantBotStore, normalizeTeamRequest, runAssistantTeam, validateTeamDelivery, teamRequestHash } from "../../examples/companion/assistant-team.js";
import type { AgentJobRecord, AgentJobHandlerContext } from "../../src/agent/job-queue.js";
import type { ChatFn } from "../../examples/companion/engine.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import type { Nemos } from "../../src/index.js";
import type { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { filterCompanionRuntimeToolsForSurface } from "../../examples/companion/capability-system-registry.js";

const request = { requestId: "qa-1", objective: "只整理 S1 并核验日期", materials: "[S1] 活动10月6日", requiredFields: ["日期"], workerIds: ["bot-organizer"], reviewerId: "bot-reviewer", model: "qa-model" };
test("移入市场保留规则和冻结任务，添加回团队保留身份及停用状态", () => {
  const store = new AssistantBotStore(":memory:");
  try {
    store.seed("qa");
    const before = store.get("qa", "bot-organizer");
    const frozen = store.plan("qa", request);
    const moved = store.save("qa", { id: before.id, revision: before.revision, placement: "market" });
    assert.equal(moved.instructions, before.instructions);
    assert.equal(moved.enabled, before.enabled);
    assert.equal(moved.marketListed, true);
    assert.deepEqual(frozen.workers[0], before);
    assert.throws(() => store.plan("qa", request), /添加到我的 Bot/);
    assert.throws(() => store.save("other", { id: moved.id, revision: moved.revision, placement: "team" }), /不属于/);
    assert.throws(() => store.save("qa", { id: moved.id, revision: before.revision, placement: "team" }), /已被更新/);
    assert.throws(() => store.save("qa", { id: moved.id, revision: moved.revision, placement: "invalid" }), /归属/);
    const edited = store.save("qa", { id: moved.id, revision: moved.revision, enabled: false });
    assert.equal(edited.placement, "market");
    const restored = store.save("qa", { id: edited.id, revision: edited.revision, placement: "team" });
    assert.equal(restored.id, before.id);
    assert.equal(restored.instructions, before.instructions);
    assert.equal(restored.enabled, false);
    assert.equal(restored.marketListed, true);
    assert.equal(store.list("qa").length, 2);
  } finally { store.close(); }
});
const final = JSON.stringify({ summary: "本地合成结果", fields: [{ label: "日期", value: "10月6日", sources: ["S1"] }] });
function fixture() {
  const store = new AssistantBotStore(":memory:"); store.seed("qa");
  const job = { id: "qa-job", payload: { teamPlan: store.plan("qa", request) }, checkpoints: [], metadata: { userId: "qa" } } as unknown as AgentJobRecord;
  const abort = new AbortController();
  const context: AgentJobHandlerContext = { signal: abort.signal, checkpoint: (status, progress, data) => { job.checkpoints.push({ at: new Date().toISOString(), status, progress, data }); } };
  return { store, job, abort, context };
}

test("Bot 规则持久化、隔离、版本冲突及停用，不覆盖用户修改", () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-bots-unit-")); const path = join(dir, "bots.db");
  let store = new AssistantBotStore(path);
  try {
    store.seed("one"); const bot = store.get("one", "bot-organizer");
    const updated = store.save("one", { ...bot, instructions: "明确的新通知覆盖旧草案", enabled: false });
    assert.equal(updated.revision, 2);
    assert.throws(() => store.save("one", bot as unknown as Record<string, unknown>), /已被更新/);
    assert.throws(() => store.get("two", bot.id), /不存在/);
    assert.throws(() => store.plan("one", request), /停用/);
    store.close(); store = new AssistantBotStore(path); store.seed("one");
    assert.equal(store.get("one", bot.id).instructions, updated.instructions);
    assert.equal(store.get("one", bot.id).enabled, false);
    assert.throws(() => store.save("one", { name: "x", role: "admin", instructions: "x" }), /职责/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("输入校验限制角色与字段，不接受循环/重复或隐藏额外载荷", () => {
  assert.throws(() => normalizeTeamRequest({ ...request, workerIds: ["a", "a"] }), /重复/);
  assert.throws(() => normalizeTeamRequest({ ...request, workerIds: ["a", "b", "c"] }), /最多/);
  assert.throws(() => normalizeTeamRequest({ ...request, requiredFields: [1] }), /文字/);
  assert.throws(() => normalizeTeamRequest({ ...request, objective: "" }), /不能为空/);
  assert.throws(() => normalizeTeamRequest({ ...request, requestId: "../x" }), /编号/);
  assert.equal(teamRequestHash({ ...request }), teamRequestHash(normalizeTeamRequest({ ...request, privateMemory: "must-not-share" })));
});

test("真实回执齐备后自动汇总；工具和所有记忆 scope 在运行层关闭", async () => {
  const f = fixture(), calls: Parameters<ChatFn>[] = [];
  try {
    // Private/unknown properties on the frozen job must not enter any role's input.
    f.job.payload.privateMemory = "NEVER_SHARE_PRIVATE";
    const chat: ChatFn = async (...args) => { calls.push(args); return args[0].includes("最终交付协议") ? final : "带来源的结果 S1"; };
    const result = await runAssistantTeam(f.job, f.context, chat);
    assert.equal(calls.length, 3); assert.equal(result.data.receipts.length, 3);
    assert.equal(result.data.delivery.fields[0].value, "10月6日");
    for (const call of calls) {
      assert.equal(call[4]?.toolMode, "off"); assert.deepEqual(call[4]?.memoryScopes, []);
      assert.equal(call[4]?.userId, "qa"); assert.doesNotMatch(call[0] + call[1], /NEVER_SHARE_PRIVATE/);
    }
    assert.deepEqual(JSON.parse(calls[0][1]).receipts, []);
    assert.equal(JSON.parse(calls[1][1]).receipts.length, 1);
    assert.equal(JSON.parse(calls[2][1]).receipts.length, 2);
    assert.equal(f.job.checkpoints.filter((c) => (c.data as any)?.teamReceipt?.state === "returned").length, 3);
    assert.notEqual(calls[0][4]?.sessionId, calls[1][4]?.sessionId);
  } finally { f.store.close(); }
});

test("失败不虚报交付；人工继续只重做缺少有效回执的汇总", async () => {
  const f = fixture(); let calls = 0;
  try {
    await assert.rejects(runAssistantTeam(f.job, f.context, async (system) => { calls++; return system.includes("最终交付协议") ? '{"summary":"缺字段","fields":[]}' : "S1 整理结果"; }), /必填字段/);
    assert.equal(calls, 3);
    assert.equal((f.job.checkpoints.at(-1)?.data as any).teamReceipt.state, "failed");
    calls = 0;
    const result = await runAssistantTeam(f.job, f.context, async () => { calls++; return final; });
    assert.equal(calls, 1); assert.equal(result.data.receipts.length, 3);
    calls = 0; await runAssistantTeam(f.job, f.context, async () => { calls++; return final; }); assert.equal(calls, 0);
  } finally { f.store.close(); }
});

test("字段协议拒绝空结果、重复标签和无来源，不假装验证事实", () => {
  assert.throws(() => validateTeamDelivery("已完成", []), /协议/);
  assert.throws(() => validateTeamDelivery('{"summary":"x","fields":[{"label":"日期","value":"x","sources":[]}]}', ["日期"]), /没有来源/);
  assert.throws(() => validateTeamDelivery('{"summary":"x","fields":[{"label":"日期","value":"x","sources":["S1"]},{"label":"日期","value":"x","sources":["S1"]}]}', ["日期", "时间"]), /不一致/);
  assert.equal(validateTeamDelivery(final, ["日期"]).fields.length, 1);
});

test("独立模式只调用主助理一次；Bot 修改不改变已提交任务快照", async () => {
  const f = fixture();
  try {
    const original = f.store.get("qa", "bot-organizer");
    f.store.save("qa", { ...original, instructions: "NEW_RULE_NOT_IN_QUEUED_PLAN" });
    const seen: string[] = [];
    await runAssistantTeam(f.job, f.context, async (s) => { seen.push(s); return s.includes("最终交付协议") ? final : "S1"; });
    assert.ok(seen.every((s) => !s.includes("NEW_RULE_NOT_IN_QUEUED_PLAN")));
    f.job.payload.teamPlan = f.store.plan("qa", { ...request, workerIds: [], reviewerId: "" }); f.job.checkpoints = [];
    let count = 0; await runAssistantTeam(f.job, f.context, async () => { count++; return final; }); assert.equal(count, 1);
  } finally { f.store.close(); }
});

test("取消和不响应信号的模型均不会卡死，超时不继续派发", async () => {
  const f = fixture(); let calls = 0;
  try {
    await assert.rejects(runAssistantTeam(f.job, f.context, async () => { calls++; return new Promise<string>(() => {}); }, { stageTimeoutMs: 15 }), /超时/);
    assert.equal(calls, 1);
    f.abort.abort(); await assert.rejects(runAssistantTeam(f.job, f.context, async () => { calls++; return final; }));
    assert.equal(calls, 1);
  } finally { f.store.close(); }
});

test("主助理团队工具只共享本条用户请求，不能由模型参数注入私人材料", async () => {
  let submitted: any;
  const provider = createCompanionAgentToolProvider({ memory: () => ({} as Nemos), capabilities: () => ({} as CapabilityRuntime),
    assistantTeam: { list: () => [], enqueue: (input) => { submitted = input; return { id: "job", status: "queued" }; } } });
  const context = { userId: "qa", personaId: "clownfish", instruction: "请助理团队整理这条公开资料", sessionId: "qa", scope: "qa", memoryScopes: ["private"], mode: "task" as const };
  const tools = await provider(context.instruction, context);
  const tool = tools.find((t) => t.definition.name === "assistant_team_start")!;
  assert.ok(tool); assert.equal(tool.definition.effect, "write");
  assert.ok(filterCompanionRuntimeToolsForSurface("task", tools).includes(tool));
  assert.ok(!filterCompanionRuntimeToolsForSurface("office", tools).includes(tool));
  await tool.execute({ workerIds: [], reviewerId: "", requiredFields: [], materials: "PRIVATE_FROM_MODEL", objective: "PRIVATE_FROM_MODEL" }, { runId: "qa", sessionId: "qa", signal: new AbortController().signal });
  assert.equal(submitted.objective, context.instruction); assert.equal(submitted.materials, ""); assert.doesNotMatch(JSON.stringify(submitted), /PRIVATE_FROM_MODEL/);
  assert.ok(!(await provider(context.instruction, { ...context, personaId: "other" })).some((t) => t.definition.name === "assistant_team_start"));
  await assert.rejects(tool.execute({ workerIds: [], reviewerId: "", requiredFields: ["PRIVATE_FROM_MEMORY"] }, { runId: "qa", sessionId: "qa", signal: new AbortController().signal }), /本条用户请求/);
});
