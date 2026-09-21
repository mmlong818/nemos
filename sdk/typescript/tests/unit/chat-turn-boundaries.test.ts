import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../src/index.js";
import { CompanionEngine, type ChatFn, type Persona } from "../../examples/companion/engine.js";
import { turnDispositionUserMessage } from "../../examples/companion/llm.js";
import { makeMockLLMConfig } from "../helpers.js";

const PERSONAS: Persona[] = [{ id: "fish", name: "小丑鱼", persona: "本机助理。" }];

test("attachment scaffolding reaches the model but only the user's own words reach memory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-memory-text-"));
  const mem = new Nemos({ storage: { type: "sqlite", path: join(dir, "t.db") }, llm: makeMockLLMConfig(), features: { doubleCheck: false }, worker: { manualWorker: true } });
  try {
    const seen: string[] = [];
    const chat: ChatFn = async (_system, user) => { seen.push(typeof user === "string" ? user : JSON.stringify(user)); return "好的"; };
    const engine = new CompanionEngine(mem, PERSONAS, chat);
    const spoken = "请总结这份会议纪要";
    const composed = `[优先处理附件]\n用户当前请求：${spoken}\n附件：meeting.txt（TXT）\n必须先阅读并基于附件回答当前请求。\n---\n三季度销售完成率 87%\n---`;
    await engine.send("alice", "fish", composed, { memoryText: spoken, memoryWriteMode: "archive-only", sessionId: "s1" });
    assert.ok(seen.some((turn) => turn.includes("三季度销售完成率")), "the model must still see the attachment body");

    const rows = await mem.forUser("alice").listByLayer("archival", { limit: 50 });
    const contents = rows.map((row) => String(row.content));
    assert.ok(contents.some((content) => content.includes(spoken)), `the user's request is archived: ${JSON.stringify(contents)}`);
    for (const content of contents) {
      assert.ok(!content.includes("[优先处理附件]"), "product-layer scaffolding must never be stored as the user's words");
      assert.ok(!content.includes("三季度销售完成率"), "attachment contents must not become user memory");
    }
  } finally {
    mem.close();
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows WAL lock */ }
  }
});

test("turn dispositions are explained in the product's language, never as runtime internals", () => {
  assert.equal(turnDispositionUserMessage({ state: "waiting_input", question: "目标读者是谁？" }), "目标读者是谁？");
  assert.match(turnDispositionUserMessage({ state: "blocked", blocker: "The model ended the turn without a user-visible answer or artifact." }), /没有给出可见的回答/);
  assert.equal(turnDispositionUserMessage({ state: "blocked", blocker: "需要文件读取权限" }), "需要文件读取权限");
  assert.equal(turnDispositionUserMessage({ state: "cancelled", reason: "user" }), "这次运行已取消。");
});
