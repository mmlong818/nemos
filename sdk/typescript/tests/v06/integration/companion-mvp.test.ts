// v0.6 companion-mvp.test.ts — 多人格陪伴 MVP 骨架（RFC 0008 应用层）
// 证明拓扑的两件新事：
//   ① 跨轮记得（块1 召回到的对方事实）
//   ② 在场才知道（按会话 scope 分隔；别的人格看不到）
// 另含一个端到端冒烟（send 走通 ingest→召回→回复）。
// 「从不踩雷」的失效闭环已在 contradiction-invalidation.test.ts 单证。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../../src/index.js";
import { CompanionEngine, type ChatFn } from "../../../examples/companion/engine.js";
import type { Persona } from "../../../examples/companion/engine.js";
import { makeMockLLMConfig } from "../../helpers.js";

const PERSONAS: Persona[] = [
  { id: "yeque", name: "夜雀", persona: "沉静的倾听者。" },
  { id: "xiaohang", name: "小航", persona: "元气的搭子。" },
];

// 回声 chat：把 system 原样返回，便于断言人格"看到了什么"（也证明 send 走通）。
const echoChat: ChatFn = async (system: string): Promise<string> => system;

function setup(path: string): { mem: Nemos; engine: CompanionEngine } {
  const mem = new Nemos({
    storage: { type: "sqlite", path },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  return { mem, engine: new CompanionEngine(mem, PERSONAS, echoChat) };
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows: WAL/SHM 偶发被锁
  }
}

test("v0.6 companion: 跨轮记得 + 人格自我近况进入上下文", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-comp-recall-"));
  try {
    const { mem, engine } = setup(join(dir, "t.db"));
    await engine.seedSelfState("yeque", ["我最近在重听一张老唱片"]);

    // turn1：用户告诉夜雀一件事
    const r1 = await engine.send("alice", "yeque", "我养了一只狗叫 Max");
    assert.equal(typeof r1.reply, "string", "send 走通，有回复");

    // 之后召回：块1 记得 Max，块2 有夜雀的近况
    const ctx = await engine.recall("alice", "yeque", "Max");
    assert.ok(ctx.userFacts.includes("Max"), "跨轮记得：块1 召回到 Max");
    assert.ok(ctx.selfState.includes("唱片"), "块2 含人格自我近况");

    mem.close();
  } finally {
    cleanup(dir);
  }
});

test("v0.6 companion: 在场才知道——别的人格看不到非本会话的事实", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-comp-scope-"));
  try {
    const { mem, engine } = setup(join(dir, "t.db"));

    // 只在与「夜雀」的会话里说过 Max
    await engine.send("alice", "yeque", "我养了一只狗叫 Max");

    const yeque = await engine.recall("alice", "yeque", "Max");
    const xiaohang = await engine.recall("alice", "xiaohang", "Max");

    assert.ok(yeque.userFacts.includes("Max"), "夜雀在场 → 知道");
    assert.ok(!xiaohang.userFacts.includes("Max"), "小航不在场 → 看不到（scope 分隔）");

    mem.close();
  } finally {
    cleanup(dir);
  }
});

test("v0.6 companion: 人格自我状态与用户事实硬隔离（防自污染）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-comp-iso-"));
  try {
    const { mem, engine } = setup(join(dir, "t.db"));
    await engine.seedSelfState("yeque", ["我今天在海边散步"]);
    await engine.send("alice", "yeque", "我养了一只狗叫 Max");

    // 人格的虚构近况不得出现在用户真相库里
    const userFacts = await engine.recall("alice", "yeque", "海边");
    assert.ok(!userFacts.userFacts.includes("海边散步"), "人格近况未污染用户事实库");

    // 用户事实也不在人格的自我 namespace 里
    const selfMems = await mem.forUser("persona:yeque").listByLayer("episodic", { scope: "self" });
    assert.ok(!selfMems.some((m) => m.content.includes("Max")), "用户事实未进入人格自我库");

    mem.close();
  } finally {
    cleanup(dir);
  }
});
