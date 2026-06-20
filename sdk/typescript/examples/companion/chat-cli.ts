// examples/companion/chat-cli.ts — 交互式陪伴聊天（真实 LLM；1-on-1 / 群聊 / 语音条）
//
// 跑：
//   PowerShell:  $env:ZHIPU_API_KEY="..."; npx tsx examples/companion/chat-cli.ts
//   bash:        ZHIPU_API_KEY=... npx tsx examples/companion/chat-cli.ts
//
// 命令：
//   /who                  列出通讯录里的人格
//   /persona <id>         切到与某人格 1-on-1（如 /persona xiaohang）
//   /group <id> [p1 p2…]  建群并进入（给成员）/ 进入已有群（不给成员）
//   /voice <内容>         把这句作为「语音条」发送（走 voice-transcript profile）
//   /mem [关键词]         看当前对象此刻召回的两块上下文
//   /quit                 退出
//
// 记忆默认持久化到 COMPANION_DB（默认 ./companion-chat.db），跨次运行保留。

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Nemos } from "../../src/index.js";
import { CompanionEngine, personaNamespace } from "./engine.js";
import { PERSONAS, SELF_SEED } from "./personas.js";
import { resolveLLM } from "./llm.js";

const USER = process.env.COMPANION_USER || "me";
const DB = process.env.COMPANION_DB || "companion-chat.db";

type Target = { kind: "persona"; id: string } | { kind: "group"; id: string };

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

  for (const p of PERSONAS) {
    const existing = await mem.forUser(personaNamespace(p.id)).listByLayer("episodic", { scope: "self" });
    if (existing.length === 0 && SELF_SEED[p.id]) await engine.seedSelfState(p.id, SELF_SEED[p.id]!);
  }

  let target: Target = { kind: "persona", id: PERSONAS[0]!.id };
  const rl = readline.createInterface({ input, output });

  console.log(`LLM: ${llm.label}`);
  console.log(`记忆库: ${DB}（跨次运行保留）`);
  who(target);
  console.log(`命令：/who  /persona <id>  /group <id> [成员…]  /voice <内容>  /mem [词]  /quit\n`);

  const focusName = (): string =>
    target.kind === "persona"
      ? PERSONAS.find((p) => p.id === target.id)?.name ?? target.id
      : `群:${target.id}`;

  try {
    for (;;) {
      const raw = (await rl.question(`你 → ${focusName()}： `)).trim();
      if (!raw) continue;
      if (raw === "/quit") break;
      if (raw === "/who") {
        who(target);
        continue;
      }
      if (raw.startsWith("/persona")) {
        const id = raw.split(/\s+/)[1];
        if (PERSONAS.some((p) => p.id === id)) target = { kind: "persona", id: id! };
        else console.log(`未知人格：${id ?? ""}`);
        continue;
      }
      if (raw.startsWith("/group")) {
        const [, gid, ...members] = raw.split(/\s+/);
        if (!gid) {
          console.log("用法：/group <id> [成员 id…]");
          continue;
        }
        try {
          if (members.length > 0) engine.createGroup(gid, members);
          engine.groupMembers(gid); // 校验群存在
          target = { kind: "group", id: gid };
          console.log(`（进入群 ${gid}：${engine.groupMembers(gid).map((p) => p.name).join("、")}）`);
        } catch (e) {
          console.log(e instanceof Error ? e.message : String(e));
        }
        continue;
      }
      if (raw.startsWith("/mem")) {
        const q = raw.slice(4).trim() || "最近";
        const pid = target.kind === "persona" ? target.id : engine.groupMembers(target.id)[0]!.id;
        const ctx = await engine.recall(USER, pid, q);
        console.log(`  ▷【对方事实】(q="${q}")\n${ctx.userFacts || "  （空）"}`);
        console.log(`  ▷【近况】\n${ctx.selfState || "  （空）"}`);
        continue;
      }

      const voice = raw.startsWith("/voice");
      const text = voice ? raw.slice(6).trim() : raw;
      if (!text) continue;
      const opts = voice ? { voice: { durationSec: Math.max(2, Math.round(text.length / 4)) } } : {};
      const tag = voice ? "🎤 " : "";

      if (target.kind === "persona") {
        const r = await engine.send(USER, target.id, text, opts);
        const name = PERSONAS.find((p) => p.id === target.id)!.name;
        console.log(`${name} ← ${tag}${r.reply}\n`);
      } else {
        const replies = await engine.sendToGroup(USER, target.id, text, opts);
        for (const r of replies) {
          const name = PERSONAS.find((p) => p.id === r.personaId)!.name;
          console.log(`${name} ← ${r.reply}`);
        }
        console.log("");
      }
    }
  } finally {
    rl.close();
    mem.close();
  }
}

function who(target: Target): void {
  const list = PERSONAS.map((p) => {
    const active = target.kind === "persona" && target.id === p.id;
    return `${active ? "▸" : " "} ${p.name}(${p.id}) — ${p.persona}`;
  });
  console.log(`通讯录：\n${list.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
