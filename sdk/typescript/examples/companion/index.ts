// examples/companion/index.ts — 多人格 AI 陪伴 MVP 可跑 demo（离线）
//
// 跑：  npx tsx examples/companion/index.ts
//
// 为零依赖演示，这里用一个本地启发式抽取 LLM + 一个"回声脑"做人格回复，
// 让你直接看到记忆在端到端起作用（跨轮记得 / 在场才知道）。
// 生产请把 extractionLLM 换成真实 provider（zhipu/anthropic/openai），
// 把 chat 换成真实对话 LLM。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos, type LLMConfig } from "../../src/index.js";
import { CompanionEngine, type ChatFn } from "./engine.js";
import { PERSONAS } from "./personas.js";

// —— 本地启发式抽取 LLM（仅 demo；契约同 SDK SYSTEM_PROMPT JSON）——
function localExtractionLLM(): LLMConfig {
  const pickLayer = (s: string): string => {
    if (/我.*(喜欢|讨厌|偏好|养|怕|想|打算)/.test(s)) return "personal_semantic";
    if (/(今天|昨天|刚才|上周|去世|走了)/.test(s)) return "episodic";
    return "semantic";
  };
  return {
    provider: "custom",
    name: "local-extract",
    chat: async (_system: string, user: string): Promise<string> => {
      const m = user.match(/用户内容：\n([\s\S]*)$/);
      const content = (m?.[1] || "").trim();
      const sentences = content
        .split(/[\n。.！!？?，,]+/)
        .map((x) => x.trim())
        .filter((x) => x.length > 2);
      const derived = sentences.slice(0, 5).map((sent) => ({
        layer: pickLayer(sent),
        content: sent,
        type: pickLayer(sent) === "personal_semantic" ? "user" : "project",
        source: { authoritative: false, origin: "local-extract", chain_depth: 1 },
        arousal: { value: 0.3, signal_sources: [] },
        surprise: { value: 0.2, basis: "local" },
      }));
      return JSON.stringify({
        archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "raw" } },
        derived,
      });
    },
  };
}

// —— 回声脑：摘出【对方事实】块里的要点，证明记忆被用上（仅 demo）——
const echoChat: ChatFn = async (system: string): Promise<string> => {
  const factsBlock = /【关于对方的事实】[\s\S]*?\n([\s\S]*?)\n\n【你自己的近况】/.exec(system)?.[1] ?? "";
  const bullets = [...factsBlock.matchAll(/^- (.+?)(?:\s+_.*_)?$/gm)].map((m) => m[1]!.trim());
  return bullets.length > 0
    ? `（我记得你说过：${bullets.join("；")}）嗯，我都记着呢。`
    : `（我们还不太熟，慢慢来。）`;
};

function line(label: string, text: string): void {
  console.log(`${label} ${text}`);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nemos-companion-demo-"));
  const mem = new Nemos({
    storage: { type: "sqlite", path: join(dir, "companion.db") },
    llm: localExtractionLLM(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });

  try {
    const engine = new CompanionEngine(mem, PERSONAS, echoChat);
    const alice = "alice";

    // 人格自我状态（轻倾诉素材，存独立 namespace）
    await engine.seedSelfState("yeque", ["我最近在重听一张很旧的唱片，夜里很安静"]);

    console.log("=== 与「夜雀」一对一 ===");
    let r = await engine.send(alice, "yeque", "我养了一只狗叫 Max，它特别黏人");
    line("你 →", "我养了一只狗叫 Max，它特别黏人");
    line("夜雀 ←", r.reply);

    r = await engine.send(alice, "yeque", "还记得 Max 吗");
    line("\n你 →", "还记得 Max 吗");
    line("夜雀 ←", r.reply);
    console.log(`   ▷ 夜雀此刻看到的【对方事实】块：\n${indent(r.context.userFacts || "（空）")}`);
    console.log(`   ▷ 夜雀的【近况】块：${r.context.selfState || "（空）"}`);

    console.log("\n=== 在场才知道：换「小航」问同一件事（它不在那段会话）===");
    const yeque = await engine.recall(alice, "yeque", "Max");
    const xiaohang = await engine.recall(alice, "xiaohang", "Max");
    console.log(`   夜雀 知道 Max？ ${yeque.userFacts.includes("Max") ? "✔ 知道" : "✘ 不知道"}`);
    console.log(`   小航 知道 Max？ ${xiaohang.userFacts.includes("Max") ? "✔ 知道" : "✘ 不知道（记忆按会话分隔，符合预期）"}`);

    mem.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows: WAL/SHM 偶发被锁
    }
  }
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `     ${l}`)
    .join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
