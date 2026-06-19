// examples/companion/index.ts — 多人格 AI 陪伴 MVP 脚本化 demo
//
// 跑：  npx tsx examples/companion/index.ts
//   有 ZHIPU_API_KEY → 真实 glm-5.2 回复 + 向量检索；无 → 离线兜底（仍演示拓扑）。
// 交互式对话见 chat-cli.ts。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../src/index.js";
import { CompanionEngine } from "./engine.js";
import { PERSONAS } from "./personas.js";
import { resolveLLM } from "./llm.js";

function line(label: string, text: string): void {
  console.log(`${label} ${text}`);
}
function indent(s: string): string {
  return s.split("\n").map((l) => `     ${l}`).join("\n");
}

async function main(): Promise<void> {
  const llm = resolveLLM();
  console.log(`LLM: ${llm.label}\n`);

  const dir = mkdtempSync(join(tmpdir(), "nemos-companion-demo-"));
  const mem = new Nemos({
    storage: { type: "sqlite", path: join(dir, "companion.db") },
    llm: llm.extraction,
    embedding: llm.embedding,
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });

  try {
    const engine = new CompanionEngine(mem, PERSONAS, llm.chat);
    const alice = "alice";

    await engine.seedSelfState("yeque", ["我最近在重听一张很旧的唱片，夜里很安静"]);

    console.log("=== 与「夜雀」一对一 ===");
    let r = await engine.send(alice, "yeque", "我养了一只狗叫 Max，它特别黏人");
    line("你 →", "我养了一只狗叫 Max，它特别黏人");
    line("夜雀 ←", r.reply);

    r = await engine.send(alice, "yeque", "还记得我的狗吗？最近它有点不爱吃东西");
    line("\n你 →", "还记得我的狗吗？最近它有点不爱吃东西");
    line("夜雀 ←", r.reply);
    console.log(`   ▷ 夜雀此刻看到的【对方事实】块：\n${indent(r.context.userFacts || "（空）")}`);
    console.log(`   ▷ 夜雀的【近况】块：${r.context.selfState || "（空）"}`);

    console.log("\n=== 在场才知道：换「小航」问同一件事（它不在那段会话）===");
    const yeque = await engine.recall(alice, "yeque", "我的狗 Max");
    const xiaohang = await engine.recall(alice, "xiaohang", "我的狗 Max");
    console.log(`   夜雀 知道 Max？ ${yeque.userFacts.includes("Max") ? "✔ 知道" : "✘ 不知道"}`);
    console.log(
      `   小航 知道 Max？ ${xiaohang.userFacts.includes("Max") ? "✔ 知道" : "✘ 不知道（记忆按会话分隔，符合预期）"}`,
    );

    mem.close();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows: WAL/SHM 偶发被锁
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
