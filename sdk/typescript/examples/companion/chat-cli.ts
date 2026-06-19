// examples/companion/chat-cli.ts — 交互式陪伴聊天（真实 LLM）
//
// 跑：
//   PowerShell:  $env:ZHIPU_API_KEY="..."; npx tsx examples/companion/chat-cli.ts
//   bash:        ZHIPU_API_KEY=... npx tsx examples/companion/chat-cli.ts
//
// 命令：
//   /who              列出通讯录里的人格
//   /persona <id>     切换正在对话的人格（如 /persona xiaohang）
//   /mem [关键词]     看当前人格此刻召回的两块上下文
//   /quit             退出
//
// 记忆默认持久化到 COMPANION_DB（默认 ./companion-chat.db），跨次运行保留——
// 这样你能验证"关掉再开，它还记得你"。

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Nemos } from "../../src/index.js";
import { CompanionEngine, personaNamespace } from "./engine.js";
import { PERSONAS } from "./personas.js";
import { resolveLLM } from "./llm.js";

const USER = process.env.COMPANION_USER || "me";
const DB = process.env.COMPANION_DB || "companion-chat.db";

// 各人格的初始"近况"（仅在该人格自我库为空时种入，避免跨次重复）
const SELF_SEED: Record<string, string[]> = {
  yeque: ["我最近在重听一张很旧的唱片，夜里很安静", "养了一盆总也养不活的薄荷"],
  xiaohang: ["我最近在练攀岩，手上全是茧", "在攒钱想去看一次极光"],
};

async function main(): Promise<void> {
  const llm = resolveLLM();
  const mem = new Nemos({
    storage: { type: "sqlite", path: DB },
    llm: llm.extraction,
    embedding: llm.embedding,
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const engine = new CompanionEngine(mem, PERSONAS, llm.chat);

  // 幂等种入近况
  for (const p of PERSONAS) {
    const existing = await mem.forUser(personaNamespace(p.id)).listByLayer("episodic", { scope: "self" });
    if (existing.length === 0 && SELF_SEED[p.id]) await engine.seedSelfState(p.id, SELF_SEED[p.id]!);
  }

  let current = PERSONAS[0]!;
  const rl = readline.createInterface({ input, output });

  console.log(`LLM: ${llm.label}`);
  console.log(`记忆库: ${DB}（跨次运行保留）`);
  who(current.id);
  console.log(`命令：/who  /persona <id>  /mem [关键词]  /quit\n`);

  try {
    for (;;) {
      const text = (await rl.question(`你 → ${current.name}： `)).trim();
      if (!text) continue;

      if (text === "/quit") break;
      if (text === "/who") {
        who(current.id);
        continue;
      }
      if (text.startsWith("/persona")) {
        const id = text.split(/\s+/)[1];
        const next = PERSONAS.find((p) => p.id === id);
        if (next) {
          current = next;
          console.log(`（已切到 ${current.name}）`);
        } else {
          console.log(`未知人格：${id ?? ""}`);
        }
        continue;
      }
      if (text.startsWith("/mem")) {
        const q = text.slice(4).trim() || "最近";
        const ctx = await engine.recall(USER, current.id, q);
        console.log(`  ▷【对方事实】(${current.name} 视角，q="${q}")\n${ctx.userFacts || "  （空）"}`);
        console.log(`  ▷【${current.name} 的近况】\n${ctx.selfState || "  （空）"}`);
        continue;
      }

      const r = await engine.send(USER, current.id, text);
      console.log(`${current.name} ← ${r.reply}\n`);
    }
  } finally {
    rl.close();
    mem.close();
  }
}

function who(currentId: string): void {
  const list = PERSONAS.map((p) => `${p.id === currentId ? "▸" : " "} ${p.name}(${p.id}) — ${p.persona}`);
  console.log(`通讯录：\n${list.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
