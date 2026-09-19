import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PantheonService,
  classifyPantheonIntent,
  type PantheonCompletionRequest,
} from "../../examples/companion/pantheon.js";
import { ThoughtLibraryStore } from "../../examples/companion/thought-library.js";

const deterministicCompletion = async (request: PantheonCompletionRequest): Promise<string> =>
  `${request.phase}:${request.seatName ?? "主持人"}:${request.targetSeatName ?? "-"}`;

test("万神殿识别探索、挑战、决策和只要答案，只有显式意图允许收束", () => {
  assert.equal(classifyPantheonIntent("帮我探索远程办公可能带来的变化").intent, "explore");
  assert.equal(classifyPantheonIntent("请挑战这个方案，找出最强反例").intent, "challenge");
  assert.equal(classifyPantheonIntent("我需要决定是否迁移，并给出行动方案").intent, "decision");
  assert.equal(classifyPantheonIntent("只要答案，简短告诉我哪个更合适").intent, "answer");
  assert.equal(classifyPantheonIntent("讨论一下这个想法").wantsConclusion, false);
  assert.equal(classifyPantheonIntent("给我最终决定和下一步").wantsConclusion, true);
});

test("自动选择一到三种思维方法并留下可审计理由，用户可在开场前调整", () => {
  const service = new PantheonService({ completion: deterministicCompletion, idFactory: () => "session-1" });
  const session = service.createSession({ issue: "是否现在迁移核心系统？请评估风险并做决定" });
  assert.equal(session.plan.intent, "decision");
  assert.equal(session.plan.seats.length, 3);
  assert.ok(session.plan.seats.every((seat) => seat.selectionReason && seat.matchedSignals.length > 0));
  assert.deepEqual(session.limits, { maxRounds: 2, maxSeats: 3, maxConcurrentCalls: 2, maxReservedTokens: 7200 });
  const available = service.catalog().slice(0, 2).map((unit) => unit.id);
  const adjusted = service.adjustSeats(session.id, available);
  assert.deepEqual(adjusted.plan.seats.map((seat) => seat.modelId), available);
  assert.equal(adjusted.audit.at(-1)?.event, "seats_adjusted");
});

test("完整一轮包含独立立论、定向质询、回应和主持总结，插话进入下一阶段", async () => {
  const calls: PantheonCompletionRequest[] = [];
  let inFlight = 0;
  let peak = 0;
  const service = new PantheonService({
    completion: async (request) => {
      calls.push(request);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 3));
      inFlight -= 1;
      return deterministicCompletion(request);
    },
    idFactory: () => "session-flow",
  });
  let session = service.createSession({ issue: "探索社区共享空间的可行性", intent: "explore" });
  session = service.interject(session.id, "请特别考虑夜间噪音。", "user-turn-1");
  assert.equal(session.transcript.at(-1)?.kind, "user");
  session = await service.advance(session.id);
  assert.equal(session.phase, "questions");
  assert.equal(session.transcript.filter((entry) => entry.kind === "position").length, session.plan.seats.length);
  assert.ok(calls.some((call) => call.user.includes("夜间噪音")));
  session = await service.advance(session.id);
  assert.equal(session.phase, "responses");
  const questions = session.transcript.filter((entry) => entry.kind === "question");
  assert.equal(questions.length, session.plan.seats.length);
  assert.ok(questions.every((entry) => entry.targetSeatId && entry.targetSeatId !== entry.seatId));
  session = await service.advance(session.id);
  assert.equal(session.phase, "summary");
  assert.equal(session.transcript.filter((entry) => entry.kind === "response").length, session.plan.seats.length);
  session = await service.advance(session.id);
  assert.equal(session.phase, "paused");
  const summary = session.transcript.at(-1)!;
  assert.equal(summary.kind, "moderator");
  assert.equal(summary.isConclusion, false);
  assert.match(calls.at(-1)!.system, /不得给出最终决策或行动建议/);
  assert.ok(peak <= 2, `并发峰值 ${peak} 超过上限`);
  assert.ok(session.usage.reservedTokens <= session.limits.maxReservedTokens);
});

test("阶段执行期间拒绝插话，避免同阶段席位读取不同上下文", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = new PantheonService({
    completion: async (request) => { await gate; return deterministicCompletion(request); },
    idFactory: () => "session-locked",
  });
  const session = service.createSession({ issue: "探索一个需要多视角的合成议题" });
  const running = service.advance(session.id);
  assert.throws(() => service.interject(session.id, "中途改变约束"), /本轮结束后再提交/);
  release();
  await running;
});

test("只有原始决策意图或用户显式点击收束才生成结论，继续轮次受硬上限约束", async () => {
  const service = new PantheonService({ completion: deterministicCompletion, idFactory: () => "session-converge" });
  let session = service.createSession({ issue: "挑战这份迁移计划", intent: "challenge" });
  session = await service.advance(session.id);
  session = await service.advance(session.id);
  session = await service.advance(session.id);
  session = await service.advance(session.id);
  assert.equal(session.phase, "paused");
  session = await service.advance(session.id, "converge");
  assert.equal(session.phase, "complete");
  assert.equal(session.transcript.at(-1)?.isConclusion, true);
  assert.ok(session.audit.some((entry) => entry.event === "explicit_conclusion_requested"));
  await assert.rejects(() => service.advance(session.id, "continue"), /已经结束/);
});

for (const intent of ["decision", "answer"] as const) test(`${intent} 初始意图的普通推进只做阶段小结，仍须独立收束动作`, async () => {
  const service = new PantheonService({ completion: deterministicCompletion, idFactory: () => `session-${intent}` });
  let session = service.createSession({ issue: intent === "decision" ? "决定是否迁移核心系统" : "只要答案：哪个方向更稳妥", intent });
  session = await service.advance(session.id);
  session = await service.advance(session.id);
  session = await service.advance(session.id);
  session = await service.advance(session.id);
  assert.equal(session.phase, "paused");
  assert.equal(session.transcript.at(-1)?.kind, "moderator");
  assert.equal(session.transcript.at(-1)?.isConclusion, false);
  session = await service.advance(session.id, "converge");
  assert.equal(session.phase, "complete");
  assert.equal(session.transcript.at(-1)?.isConclusion, true);
});

test("思维蒸馏没有材料时不凭空补事实，必须审阅确认后才进入自动选席", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-thoughts-"));
  try {
    let completionCalls = 0;
    const store = new ThoughtLibraryStore(join(root, "thought-library.json"), {
      completion: async () => { completionCalls += 1; return "{}"; },
      idFactory: () => "thought-1",
      now: () => "2026-09-18T10:00:00.000Z",
    });
    let unit = await store.createDraft({ displayName: "我的取舍法", kind: "framework" });
    assert.equal(completionCalls, 0);
    assert.equal(unit.status, "draft");
    assert.match(unit.uncertaintyStatements.join(" "), /未提供可核验材料|用户定义/);
    assert.equal(store.eligibleUnits().length, 0);
    unit = store.updateDraft(unit.id, { applicableProblems: ["资源有限时的取舍"] });
    unit = store.transition(unit.id, "submit_review");
    assert.equal(unit.status, "review");
    unit = store.transition(unit.id, "approve");
    assert.equal(unit.status, "approved");
    assert.equal(store.eligibleUnits().length, 1);
    store.setEnabled(unit.id, false);
    assert.equal(store.eligibleUnits().length, 0);
    assert.equal(store.remove(unit.id), true);
    assert.equal(store.list().length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("带用户材料的蒸馏固定来源边界并保留非冒充声明", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-thoughts-material-"));
  try {
    const store = new ThoughtLibraryStore(join(root, "thought-library.json"), {
      completion: async () => JSON.stringify({
        applicableProblems: ["检验假设"],
        corePrinciples: ["先列出可证伪条件"],
        judgmentSteps: ["写下假设", "寻找反例"],
        counterexamplesAndLimits: ["材料没有覆盖价值冲突"],
        questioningStyle: ["什么证据会改变判断？"],
        uncertaintyStatements: ["仅根据所给摘录"],
      }),
      idFactory: () => "thought-2",
    });
    const unit = await store.createDraft({
      displayName: "某公开作者的方法摘录",
      kind: "person",
      sourceLabel: "用户提供的公开访谈摘录",
      material: "先写出什么结果会推翻当前判断，再去寻找相反证据。",
    });
    assert.deepEqual(unit.provenance, [{ kind: "user_material", label: "用户提供的公开访谈摘录" }]);
    assert.match(unit.identityDisclaimer, /不是本人|不代表本人/);
    assert.equal(unit.version, 1);
    assert.equal(unit.status, "draft");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("会话冻结已选私有思维单元，库中停用或删除不破坏既有讨论", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-thought-snapshot-"));
  try {
    let sequence = 0;
    const store = new ThoughtLibraryStore(join(root, "thought-library.json"), { idFactory: () => `thought-${++sequence}`, scopeId: "me" });
    let unit = await store.createDraft({ displayName: "已审阅方法", kind: "framework" });
    unit = store.transition(unit.id, "submit_review");
    unit = store.transition(unit.id, "approve");
    const service = new PantheonService({ completion: deterministicCompletion, thoughtLibrary: store, scopeId: "me:client", idFactory: () => "snapshot-session" });
    let session = service.createSession({ issue: "用私有方法分析合成议题", modelIds: [unit.id] });
    store.setEnabled(unit.id, false);
    store.remove(unit.id);
    session = await service.advance(session.id);
    assert.equal(session.phase, "questions");
    assert.equal(session.transcript[0]?.seatName, "已审阅方法");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("损坏的思维库原件不被覆盖，生成备份并阻止一切写入", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-thought-corrupt-"));
  try {
    const file = join(root, "thought-library.json");
    writeFileSync(file, "{broken", "utf8");
    const store = new ThoughtLibraryStore(file, { scopeId: "me" });
    assert.throws(() => store.list(), /已损坏.*未被覆盖/);
    await assert.rejects(() => store.createDraft({ displayName: "不能写", kind: "framework" }), /已损坏/);
    assert.equal(readFileSync(file, "utf8"), "{broken");
    assert.ok(existsSync(root) && (await import("node:fs")).readdirSync(root).some((name) => name.includes(".corrupt-") && name.endsWith(".bak")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("会话和私有思维单元绑定当前客户端/用户范围", async () => {
  const owner = new PantheonService({ completion: deterministicCompletion, scopeId: "me:client-a", idFactory: () => "owned-session" });
  const session = owner.createSession({ issue: "合成范围隔离议题" });
  const other = new PantheonService({ completion: deterministicCompletion, scopeId: "me:client-b", idFactory: () => "other" });
  assert.equal(other.getSession(session.id), undefined);
  const root = mkdtempSync(join(tmpdir(), "clownfish-thought-scope-"));
  try {
    const file = join(root, "thought-library.json");
    const a = new ThoughtLibraryStore(file, { scopeId: "user-a", idFactory: () => "a" });
    await a.createDraft({ displayName: "A的私有方法", kind: "framework" });
    const b = new ThoughtLibraryStore(file, { scopeId: "user-b" });
    assert.equal(b.list().length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
