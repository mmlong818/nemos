import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CompanionEngine, convScope, type ChatFn } from "../../examples/companion/engine.js";
import { Nemos } from "../../src/index.js";
import { makeMockLLMConfig } from "../helpers.js";
import { conversationArchives } from "../../examples/companion/conversation-history.js";

const persona = {
  id: "feifei",
  name: "菲菲",
  persona: "自然、可靠的朋友。",
};

test("网页会话在数据库关闭重开后恢复用户与助理原文，且不同会话不串线", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-web-session-restart-"));
  let memory = makeMemory(dir);
  const prompts: Array<{ system: string; user: string }> = [];
  const capture: ChatFn = async (system, user) => { prompts.push({ system, user }); return "继续处理"; };
  try {
    const first = new CompanionEngine(memory, [persona], async () => "回复甲：按已确认的三项要求交付");
    await first.send("me", persona.id, "任务甲：周五交付用户报告", {
      sessionId: "task-a", sourceMessageId: "message-a", memoryWriteMode: "archive-only", voice: { durationSec: 2 },
    });
    const second = new CompanionEngine(memory, [persona], async () => "回复乙：这是另一个秘密任务");
    await second.send("me", persona.id, "任务乙：无关内容", { sessionId: "task-b", memoryWriteMode: "archive-only" });
    const archives = await conversationArchives(memory, "me", convScope("me", persona.id), "task-a", 10);
    assert.equal(archives[0].source.conversation_id, "task-a");
    assert.equal(archives[0].source.source_message_id, "message-a");
    memory.close();
    memory = makeMemory(dir);
    const rebuilt = new CompanionEngine(memory, [persona], capture, {
      chatStream: async (system, user, cb) => { const reply = await capture(system, user); cb.onToken(reply); return reply; },
    });
    await rebuilt.sendStream("me", persona.id, "继续", { sessionId: "task-a", memoryWriteMode: "archive-only" }, { onStatus() {}, onToken() {} });
    assert.match(prompts[0].user, /对方\(语音\)：任务甲：周五交付用户报告/);
    assert.match(prompts[0].user, /菲菲：回复甲/);
    assert.ok(prompts[0].user.indexOf("任务甲") < prompts[0].user.indexOf("回复甲"));
    assert.doesNotMatch(prompts[0].user + prompts[0].system, /任务乙|回复乙|秘密任务/);
    await rebuilt.send("me", persona.id, "新任务", { sessionId: "task-c", memoryWriteMode: "archive-only" });
    assert.doesNotMatch(prompts[1].user + prompts[1].system, /任务甲|回复甲|任务乙|回复乙/);
    await rebuilt.send("other-user", persona.id, "继续", { sessionId: "task-a", memoryWriteMode: "archive-only" });
    assert.doesNotMatch(prompts[2].user + prompts[2].system, /任务甲|回复甲/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("恢复旧会话会翻页查找，不被其它会话的最近消息挤掉", async () => {
  const memory = new Nemos({ storage: { type: "memory" }, llm: makeMockLLMConfig(), features: { doubleCheck: false }, worker: { manualWorker: true } });
  try {
    const scope = convScope("me", persona.id);
    await memory.forUser("me").ingest("较早会话需要保留的决定", { scope, skipAnalysis: true, identity: { speakerId: "user:me", subjectId: "user:me", conversationId: "older-session", sourceMessageId: "old" } });
    for (let i = 0; i < 120; i++) {
      await memory.forUser("me").ingest(`其它会话内容 ${i}`, { scope, skipAnalysis: true, identity: { speakerId: "user:me", subjectId: "user:me", conversationId: "other-session", sourceMessageId: `other-${i}` } });
    }
    const restored = await conversationArchives(memory, "me", scope, "older-session", 24);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].content, "较早会话需要保留的决定");
  } finally { memory.close(); }
});

test("旧版未标记会话的归档不会被猜测归入网页对话", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-session-legacy-"));
  const memory = makeMemory(dir);
  try {
    const legacy = new CompanionEngine(memory, [persona], async () => "旧版回复原文");
    await legacy.send("me", persona.id, "旧版用户原文", { memoryWriteMode: "archive-only" });
    let received = "";
    const rebuilt = new CompanionEngine(memory, [persona], async (system, user) => { received = system + user; return "完成"; });
    await rebuilt.send("me", persona.id, "继续", { sessionId: "new-session", memoryWriteMode: "archive-only" });
    assert.doesNotMatch(received, /旧版用户原文|旧版回复原文/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("恢复运行产生的回复仍归属于原网页会话", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-recovered-session-"));
  const memory = makeMemory(dir);
  try {
    const engine = new CompanionEngine(memory, [persona], async () => "最初回复");
    await engine.send("me", persona.id, "原任务目标", { sessionId: "recover-a", memoryWriteMode: "archive-only" });
    await engine.recordRecoveredReply("me", persona.id, convScope("me", persona.id), "恢复后补充的结论", "recover-a");
    let received = "";
    const rebuilt = new CompanionEngine(memory, [persona], async (_system, user) => { received = user; return "完成"; });
    await rebuilt.send("me", persona.id, "继续", { sessionId: "recover-a", memoryWriteMode: "archive-only" });
    assert.match(received, /原任务目标/);
    assert.match(received, /恢复后补充的结论/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("关闭写入时用户与助理均不持久保存，关闭召回也确实生效", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-session-memory-off-"));
  const memory = makeMemory(dir);
  try {
    await memory.forUser("me").write({ layer: "semantic", content: "用户长期事实标记", scope: convScope("me", persona.id), source: { authoritative: true, origin: "test" } });
    let received = "";
    const engine = new CompanionEngine(memory, [persona], async (system) => { received = system; return "不应保存的回复"; });
    await engine.send("me", persona.id, "不应保存的请求", { sessionId: "off", memoryWriteMode: "off", memoryMode: "off" });
    assert.doesNotMatch(received, /用户长期事实标记/);
    assert.equal((await conversationArchives(memory, "me", convScope("me", persona.id), "off", 24)).length, 0);
    assert.equal((await conversationArchives(memory, "persona:feifei", convScope("me", persona.id), "off", 24)).length, 0);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function makeMemory(dir: string): Nemos {
  return new Nemos({
    storage: { type: "sqlite", path: join(dir, "memory.db") },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
}

test("产品模式可追加教学方法且不改变角色记忆命名空间", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-study-guidance-"));
  const memory = makeMemory(dir);
  let receivedSystem = "";
  const engine = new CompanionEngine(memory, [persona], async (system) => {
    receivedSystem = system;
    return "先从一个小问题开始。";
  }, { asyncIngest: false });

  try {
    await engine.send("me", "feifei", "我想学习函数", { systemAddendum: "每轮只推进一个关键步骤。" });
    assert.match(receivedSystem, /自然、可靠的朋友/);
    assert.match(receivedSystem, /每轮只推进一个关键步骤/);
    const entries = await memory.forUser("me").listByLayer("archival", {
      scope: convScope("me", "feifei"),
      limit: 10,
    });
    assert.ok(entries.some((entry) => entry.content === "我想学习函数"));
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("不同学习对话的短期上下文互不串线", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-study-session-isolation-"));
  const memory = makeMemory(dir);
  const prompts: string[] = [];
  const engine = new CompanionEngine(memory, [persona], async (_system, user) => {
    prompts.push(user);
    return "继续下一步。";
  }, { asyncIngest: false });

  try {
    await engine.send("me", "feifei", "我在学习负数", { sessionId: "math-session" });
    await engine.send("me", "feifei", "我在学习长城", { sessionId: "history-session" });
    await engine.send("me", "feifei", "负数下一步怎么做", { sessionId: "math-session" });

    assert.doesNotMatch(prompts[1], /学习负数/);
    assert.match(prompts[2], /学习负数/);
    assert.doesNotMatch(prompts[2], /学习长城/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("one-on-one user messages stay in the user namespace without persona attribution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-owner-"));
  const memory = makeMemory(dir);
  const engine = new CompanionEngine(memory, [persona], async () => "知道了，你今晚在加班。", { asyncIngest: false });

  try {
    await engine.send("me", "feifei", "我今晚在加班");
    const entries = await memory.forUser("me").listByLayer("archival", {
      scope: convScope("me", "feifei"),
      limit: 10,
    });
    const entry = entries.find((item) => item.content === "我今晚在加班");
    assert.ok(entry);
    assert.equal((entry.source as unknown as Record<string, unknown>).origin_agent, undefined);
    assert.equal(entry.source.speaker_id, "user:me");
    assert.equal(entry.source.subject_id, "user:me");
    assert.equal(entry.source.conversation_id, convScope("me", "feifei"));
    assert.match(entry.source.source_message_id || "", /^message-/);

    const personaStore = memory.forUser("persona:feifei");
    const personaArchives = await personaStore.listByLayer("archival", {
      scope: convScope("me", "feifei"),
      limit: 10,
    });
    const personaReply = personaArchives.find((item) => item.content === "知道了，你今晚在加班。");
    assert.ok(personaReply);
    assert.equal(personaReply.source.speaker_id, "agent:feifei");
    assert.equal(personaReply.source.subject_id, "agent:feifei");
    for (const layer of ["personal_semantic", "semantic", "episodic", "procedural"] as const) {
      assert.equal((await personaStore.listByLayer(layer, { scope: convScope("me", "feifei"), limit: 10 })).length, 0);
    }
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("测试、附件和虚构材料可以保留对话原文，但不会抽取成长期用户事实", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-archive-only-"));
  const memory = makeMemory(dir);
  const engine = new CompanionEngine(memory, [persona], async () => "已按测试材料回答。", { asyncIngest: false });

  try {
    await engine.send("me", "feifei", "这是测试故事：菲菲喜欢芒果，不代表用户本人。", {
      memoryWriteMode: "archive-only",
    });
    const scope = convScope("me", "feifei");
    const archives = await memory.forUser("me").listByLayer("archival", { scope, limit: 10 });
    assert.ok(archives.some((item) => item.content.includes("菲菲喜欢芒果")));
    for (const layer of ["personal_semantic", "semantic", "episodic", "procedural"] as const) {
      assert.equal((await memory.forUser("me").listByLayer(layer, { scope, limit: 10 })).length, 0);
    }
    const recalled = await engine.recall("me", "feifei", "菲菲喜欢什么");
    assert.doesNotMatch(recalled.userFacts, /菲菲喜欢芒果/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("memory off isolates expert tasks from user facts and previous persona statements", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-isolation-"));
  const memory = makeMemory(dir);
  try {
    await memory.forUser("me").write({
      layer: "semantic",
      content: "用户正在处理一个无关的旧项目",
      scope: convScope("me", "feifei"),
      source: { authoritative: true, origin: "test" },
    });
    await memory.forUser("persona:feifei").ingest("我之前给过另一项任务的建议", {
      scope: convScope("me", "feifei"),
      originAgent: "feifei",
    });
    const engine = new CompanionEngine(memory, [persona], async () => "完成", { asyncIngest: false });

    const isolated = await engine.recall("me", "feifei", "执行本次独立检查", "off");
    assert.equal(isolated.userFacts, "");
    assert.equal(isolated.selfState, "");
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a rebuilt engine restores recent turns and keeps persona names canonical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-continuity-"));
  const memory = makeMemory(dir);
  const firstEngine = new CompanionEngine(memory, [persona], async () => "你在加班，我记住了。", { asyncIngest: false });
  let secondPrompt = "";
  const secondChat: ChatFn = async (_system, user) => {
    secondPrompt = user;
    return "记得，你还在加班。";
  };

  try {
    await firstEngine.send("me", "feifei", "我今晚在加班");
    await memory.forUser("me").write({
      layer: "semantic",
      content: "feifei 和飞飞都指同一个角色名字",
      scope: convScope("me", "feifei"),
      source: { authoritative: false, origin: "legacy-test" },
    });
    const personaStore = memory.forUser("persona:feifei");
    await personaStore.ingest("这句关心不要重复", { scope: convScope("me", "feifei"), originAgent: "feifei" });
    await personaStore.ingest("这句关心不要重复", { scope: convScope("me", "feifei"), originAgent: "feifei" });

    const rebuilt = new CompanionEngine(memory, [persona], secondChat, { asyncIngest: false });
    const normalized = await rebuilt.recall("me", "feifei", "角色名字 feifei 飞飞");
    assert.match(normalized.userFacts, /菲菲/);
    assert.doesNotMatch(normalized.userFacts, /feifei|飞飞/);
    assert.equal(normalized.selfState.split("这句关心不要重复").length - 1, 1);

    await rebuilt.send("me", "feifei", "你还记得我在做什么吗");
    assert.match(secondPrompt, /对方：我今晚在加班/);
    assert.match(secondPrompt, /菲菲：你在加班，我记住了/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("同步抽取保留说话人、主体、会话和来源消息身份", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-source-identity-"));
  const memory = makeMemory(dir);
  try {
    const result = await memory.forUser("cat").ingest("我喜欢喝咖啡", {
      scope: "conv:1on1:cat:feifei",
      identity: {
        speakerId: "user:cat",
        subjectId: "user:cat",
        conversationId: "conv:1on1:cat:feifei",
        sourceMessageId: "message-123",
      },
    });
    assert.equal(result.archival.content, "我喜欢喝咖啡");
    assert.equal(result.archival.source.speaker_id, "user:cat");
    assert.equal(result.archival.source.subject_id, "user:cat");
    assert.equal(result.archival.source.source_message_id, "message-123");
    assert.ok(result.derived.length > 0);
    assert.equal(result.derived.every((item) => item.source.speaker_id === "user:cat"), true);
    assert.equal(result.derived.every((item) => item.source.source_message_id === "message-123"), true);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test("用户修正结构化记忆时保留原消息来源并生成可审计新版本", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-correction-"));
  const memory = makeMemory(dir);
  try {
    const result = await memory.forUser("cat").ingest("我住在上海", {
      scope: "conv:1on1:cat:feifei",
      identity: {
        speakerId: "user:cat",
        subjectId: "user:cat",
        conversationId: "conv:1on1:cat:feifei",
        sourceMessageId: "message-residence-1",
      },
    });
    const target = result.derived.find((item) => item.claim_key && item.predicate && item.subject_id);
    assert.ok(target);
    const operation = await memory.forUser("cat").correct(target.id, "我现在住在福州");
    assert.equal(operation.kind, "SUPERSEDE");
    assert.equal(memory.raw().storage.findById("default", "cat", target.id)?.belief_state, "superseded");
    assert.equal(target.source.source_message_id, "message-residence-1");
    const corrections = await memory.forUser("cat").listByLayer("archival", { scope: "conv:1on1:cat:feifei", limit: 20 });
    assert.ok(corrections.some((item) => item.content === "我现在住在福州" && item.source.origin === "user-correction"));
    assert.ok(corrections.some((item) => item.content === "我住在上海" && item.source.source_message_id === "message-residence-1"));
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test("后台抽取也从原始事件继承人物与来源消息身份", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-memory-background-identity-"));
  const memory = makeMemory(dir);
  try {
    const handle = await memory.forUser("cat").ingest("我喜欢喝热茶", {
      scope: "conv:1on1:cat:feifei",
      background: true,
      identity: {
        speakerId: "user:cat",
        subjectId: "user:cat",
        conversationId: "conv:1on1:cat:feifei",
        sourceMessageId: "message-background-1",
      },
    });
    await memory.runWorkerTick();
    const derived = await memory.forUser("cat").listByLayer("personal_semantic", {
      scope: "conv:1on1:cat:feifei",
      limit: 10,
    });
    assert.ok(derived.length > 0);
    assert.equal(derived.every((item) => item.source.speaker_id === "user:cat"), true);
    assert.equal(derived.every((item) => item.source.source_message_id === "message-background-1"), true);
    assert.equal(handle.archival.source.subject_id, "user:cat");
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
