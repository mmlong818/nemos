import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GUIDELINE_LIMITS,
  WorkGuidelineStore,
  authorizeWithGuidelines,
  resolveGuidelineDecision,
  reviewGuidelineProposal,
  userGuideline,
  type GuidelineEvidence,
} from "../../examples/companion/work-guidelines.js";

function evidence(count: number, kind: GuidelineEvidence["kind"] = "correction"): GuidelineEvidence[] {
  return Array.from({ length: count }, (_, index) => ({
    kind,
    conversationId: `chat-${index}`,
    at: "2026-09-08T00:00:00.000Z",
  }));
}

function storeAt(dir: string) {
  return new WorkGuidelineStore(join(dir, "work-guidelines.json"));
}

test("派生准则必须有足够引用，且引用不能靠同一次对话刷出来", () => {
  const min = GUIDELINE_LIMITS.minimumDerivedCitations;
  const accepted = reviewGuidelineProposal({
    text: "改动多个文件前先说明打算怎么改。",
    behavior: "ask-first",
    match: ["office_write"],
    evidence: evidence(min),
  });
  assert.equal(accepted.origin, "derived");
  assert.equal(accepted.evidence.length, min);

  assert.throws(() => reviewGuidelineProposal({
    text: "改动多个文件前先说明打算怎么改。",
    behavior: "ask-first",
    match: [],
    evidence: evidence(min - 1),
  }), /CF-E0305/);

  // 同一次对话重复 min 次仍然只算一条引用。
  assert.throws(() => reviewGuidelineProposal({
    text: "改动多个文件前先说明打算怎么改。",
    behavior: "ask-first",
    match: [],
    evidence: Array.from({ length: min }, () => ({ kind: "correction" as const, conversationId: "chat-same", at: "2026-09-08T00:00:00.000Z" })),
  }), /CF-E0305/);
});

test("只有三种事实算证据；提问、旁观和缺失都不算", () => {
  const min = GUIDELINE_LIMITS.minimumDerivedCitations;
  for (const kind of ["correction", "revert", "explicit-instruction"] as const) {
    assert.ok(reviewGuidelineProposal({
      text: `准则 ${kind}`,
      behavior: "ask-first",
      match: [],
      evidence: evidence(min, kind),
    }));
  }
  for (const kind of ["question", "user-did-it", "absence", ""]) {
    assert.throws(() => reviewGuidelineProposal({
      text: "从提问推断出来的准则",
      behavior: "ask-first",
      match: [],
      evidence: Array.from({ length: min }, (_, index) => ({ kind, conversationId: `chat-${index}` })) as unknown as GuidelineEvidence[],
    }), /CF-E0305/, `${kind} 不该被当成证据`);
  }
});

test("准则里出现用户原话逐字引述时整条丢弃，而不是截断保存", () => {
  const min = GUIDELINE_LIMITS.minimumDerivedCitations;
  const utterance = "别再自动把我的会议记录发给张经理了，每次都要先问我";
  assert.throws(() => reviewGuidelineProposal({
    text: `以后${utterance}`,
    behavior: "ask-first",
    match: [],
    evidence: evidence(min),
  }, { userUtterances: [utterance] }), /CF-E0306/);
  // 高层概括不含原话连续片段，允许写入。
  assert.ok(reviewGuidelineProposal({
    text: "发送会议材料给外部联系人之前先征求同意。",
    behavior: "ask-first",
    match: ["message_send"],
    evidence: evidence(min),
  }, { userUtterances: [utterance] }));
});

test("冲突时按 never > ask-first > allow-automatically 取最保守，并说明是哪一条", () => {
  const never = userGuideline({ text: "永不自动付款。", behavior: "never", match: ["payment_"] });
  const ask = userGuideline({ text: "付款前先问。", behavior: "ask-first", match: ["payment_"] });
  const allow = userGuideline({ text: "自动允许查询付款状态。", behavior: "allow-automatically", match: ["payment_status"] });

  assert.equal(resolveGuidelineDecision([allow, ask, never], { toolName: "payment_send" }).behavior, "never");
  assert.equal(resolveGuidelineDecision([allow, ask], { toolName: "payment_send" }).behavior, "ask-first");
  const hit = resolveGuidelineDecision([allow], { toolName: "payment_status" });
  assert.equal(hit.behavior, "allow-automatically");
  assert.equal(hit.guidelineId, allow.id);
  assert.equal(hit.guidelineText, allow.text);
  assert.equal(resolveGuidelineDecision([allow], { toolName: "office_write" }).behavior, "unset");
  assert.equal(resolveGuidelineDecision([allow], { toolName: "" }).behavior, "unset");
  // 停用的准则不参与判定。
  assert.equal(resolveGuidelineDecision([{ ...never, enabled: false }], { toolName: "payment_send" }).behavior, "unset");
});

test("自动放行必须点名动作；广谱只允许用在更保守的方向", () => {
  assert.throws(() => userGuideline({ text: "凡事自动允许。", behavior: "allow-automatically", match: [] }), /点名/);
  assert.ok(userGuideline({ text: "凡事先问我。", behavior: "ask-first", match: [] }));
  assert.ok(userGuideline({ text: "任何外发动作都不许自己做。", behavior: "never", match: [] }));
  // 空 match 的 ask-first 匹配任何动作，但空 match 永远不会自动放行。
  const broad = userGuideline({ text: "凡事先问我。", behavior: "ask-first", match: [] });
  assert.equal(resolveGuidelineDecision([broad], { toolName: "任意工具" }).behavior, "ask-first");
});

test("授权链：never 直接拒不打扰用户，自动放行不进审批，其余落回审批", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-guidelines-authorize-"));
  try {
    const store = storeAt(dir);
    store.add(userGuideline({ text: "永不自动付款。", behavior: "never", match: ["payment_send"] }));
    store.add(userGuideline({ text: "自动允许查询付款状态。", behavior: "allow-automatically", match: ["payment_status"] }));
    let fallbackCalls = 0;
    const authorize = (toolName: string) => authorizeWithGuidelines(
      store,
      { call: { name: toolName } },
      async () => { fallbackCalls++; return { allowed: true, reason: "审批通过" }; },
      (reason) => ({ allowed: false, reason }),
      (reason) => ({ allowed: true, reason }),
    );

    const denied = await authorize("payment_send");
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /CF-E0205/);
    assert.equal(fallbackCalls, 0);

    const auto = await authorize("payment_status");
    assert.equal(auto.allowed, true);
    assert.match(auto.reason, /自动放行/);
    assert.equal(fallbackCalls, 0);

    const asked = await authorize("office_write");
    assert.equal(asked.allowed, true);
    assert.equal(asked.reason, "审批通过");
    assert.equal(fallbackCalls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("同一句准则不会变成两条：证据合并，行为取更保守的那个", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-guidelines-merge-"));
  try {
    const store = storeAt(dir);
    const first = store.add(userGuideline({ text: "外发之前先问。", behavior: "allow-automatically", match: ["mail_send"] }));
    const merged = store.add(userGuideline({ text: "外发之前先问。", behavior: "ask-first", match: ["message_send"] }));
    assert.equal(merged.id, first.id);
    assert.equal(store.list().length, 1);
    assert.equal(merged.behavior, "ask-first");
    assert.deepEqual(merged.match, ["mail_send", "message_send"]);
    assert.equal(merged.evidence.length, 1, "同一次决定不该被数成两条证据");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("条数有上限；改动只开放用户读得懂的三项，证据与来源不可篡改", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-guidelines-limits-"));
  try {
    const store = storeAt(dir);
    for (let index = 0; index < GUIDELINE_LIMITS.maxEntries; index++) {
      store.add(userGuideline({ text: `准则 ${index}`, behavior: "ask-first", match: [] }));
    }
    assert.throws(() => store.add(userGuideline({ text: "再来一条", behavior: "ask-first", match: [] })), /40/);

    const target = store.list()[0]!;
    const updated = store.update(target.id, { text: "换个说法", enabled: false });
    assert.equal(updated.text, "换个说法");
    assert.equal(updated.enabled, false);
    assert.equal(updated.origin, target.origin);
    assert.deepEqual(updated.evidence, target.evidence);
    // 已有 allow-automatically 的条目不能通过改行为绕开「必须点名动作」。
    assert.throws(() => store.update(target.id, { behavior: "allow-automatically" }), /点名/);
    assert.throws(() => store.update(target.id, { text: "   " }), /不能为空/);
    assert.equal(store.remove(target.id), true);
    assert.equal(store.remove(target.id), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("落盘可读回；单条被改坏只跳过该条，不会让整表静默失效", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-guidelines-persist-"));
  const file = join(dir, "work-guidelines.json");
  try {
    const store = new WorkGuidelineStore(file);
    store.add(userGuideline({ text: "永不自动付款。", behavior: "never", match: ["payment_send"] }));
    store.add(userGuideline({ text: "外发之前先问。", behavior: "ask-first", match: ["mail_send"] }));
    assert.equal(new WorkGuidelineStore(file).list().length, 2);

    const parsed = JSON.parse(readFileSync(file, "utf8")) as { version: 1; guidelines: unknown[] };
    parsed.guidelines.push({ id: "broken", text: "", behavior: "allow-automatically", match: [], origin: "user", evidence: [] });
    writeFileSync(file, JSON.stringify(parsed), "utf8");
    const reloaded = new WorkGuidelineStore(file);
    assert.equal(reloaded.list().length, 2);
    assert.equal(reloaded.decide({ toolName: "payment_send" }).behavior, "never");

    writeFileSync(file, "{ 这不是 JSON", "utf8");
    const empty = new WorkGuidelineStore(file);
    assert.deepEqual(empty.list(), []);
    // 空表意味着没有自动放行，而不是全部放行。
    assert.equal(empty.decide({ toolName: "payment_send" }).behavior, "unset");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
