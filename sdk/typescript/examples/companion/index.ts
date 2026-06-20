// examples/companion/index.ts — 多人格 AI 陪伴 MVP 脚本化 demo
//
// 跑：  npx tsx examples/companion/index.ts
//   有 ZHIPU_API_KEY → 真实 glm-5.2 回复 + 向量检索；无 → 离线兜底（仍演示拓扑）。
// 交互式对话见 chat-cli.ts；网页版见 server.ts。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../src/index.js";
import { CompanionEngine } from "./engine.js";
import { PERSONAS, SELF_SEED } from "./personas.js";
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

  const [p1, p2] = PERSONAS; // 菲菲(主) + 阿哲(对照)
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
    if (SELF_SEED[p1!.id]) await engine.seedSelfState(p1!.id, SELF_SEED[p1!.id]!);

    console.log(`=== 与「${p1!.name}」一对一 ===`);
    let r = await engine.send(alice, p1!.id, "我养了一只狗叫 Max，它特别黏人");
    line("你 →", "我养了一只狗叫 Max，它特别黏人");
    line(`${p1!.name} ←`, r.reply);

    r = await engine.send(alice, p1!.id, "还记得我的狗吗？最近它有点不爱吃东西");
    line("\n你 →", "还记得我的狗吗？最近它有点不爱吃东西");
    line(`${p1!.name} ←`, r.reply);
    console.log(`   ▷ ${p1!.name}此刻看到的【对方事实】块：\n${indent(r.context.userFacts || "（空）")}`);
    console.log(`   ▷ ${p1!.name}的【近况】块：${r.context.selfState || "（空）"}`);

    console.log(`\n=== 在场才知道：换「${p2!.name}」问同一件事（它不在那段会话）===`);
    const f1 = await engine.recall(alice, p1!.id, "我的狗 Max");
    const f2 = await engine.recall(alice, p2!.id, "我的狗 Max");
    console.log(`   ${p1!.name} 知道 Max？ ${f1.userFacts.includes("Max") ? "✔ 知道" : "✘ 不知道"}`);
    console.log(
      `   ${p2!.name} 知道 Max？ ${f2.userFacts.includes("Max") ? "✔ 知道" : "✘ 不知道（记忆按会话分隔，符合预期）"}`,
    );

    console.log("\n=== 语音条（走 voice-transcript profile）===");
    const v = await engine.send(alice, p1!.id, "（语音）我最近爱上喝燕麦拿铁 latte", {
      voice: { durationSec: 9 },
    });
    line("你 🎤→", "我最近爱上喝燕麦拿铁 latte（0:09）");
    line(`${p1!.name} ←`, v.reply);

    console.log(`\n=== 群聊·在场扩散：建群拉上 ${p1!.name} + ${p2!.name} ===`);
    engine.createGroup("weekend", [p1!.id, p2!.id]);
    const groupReplies = await engine.sendToGroup(alice, "weekend", "我下周要搬去 Tokyo 了，周末来帮我搬家？");
    line("你 →群", "我下周要搬去 Tokyo 了，周末来帮我搬家？");
    for (const gr of groupReplies) {
      const name = PERSONAS.find((p) => p.id === gr.personaId)!.name;
      line(`${name} ←`, gr.reply);
    }
    const yqTokyo = (await engine.recall(alice, p1!.id, "Tokyo")).userFacts.includes("Tokyo");
    const xhTokyo = (await engine.recall(alice, p2!.id, "Tokyo")).userFacts.includes("Tokyo");
    const xhMax = (await engine.recall(alice, p2!.id, "我的狗 Max")).userFacts.includes("Max");
    console.log(`   群里说的 Tokyo → ${p1!.name}记得？${yqTokyo ? "✔" : "✘"}  ${p2!.name}记得？${xhTokyo ? "✔（在场扩散）" : "✘"}`);
    console.log(`   只对 ${p1!.name} 说过的 Max → ${p2!.name}知道？${xhMax ? "✔" : "✘（1-on-1 仍分隔，符合预期）"}`);

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
