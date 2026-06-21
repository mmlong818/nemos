// examples/chat-product —— 模拟聊天产品集成 nemos
//
// 跑法：
//   cd sdk/typescript
//   npm install
//   ANTHROPIC_API_KEY=sk-... npx tsx examples/chat-product/index.ts
//
// 期望：
//   1. 用户每条消息会被 ingest（archival + derived）
//   2. AI 回复前会 getRelevantContext，把相关记忆拼进 prompt
//   3. 第二条消息能用到第一条产生的偏好记忆

import { Nemos } from "../../src/index.js";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("缺 ANTHROPIC_API_KEY env var");
    process.exit(1);
  }

  const mem = new Nemos({
    storage: { type: "sqlite", path: "./chat-product.db" },
    llm: { provider: "anthropic", apiKey },
    features: { doubleCheck: false }, // 示例求快，跳过双 pass
  });
  const userMem = mem.forUser("user-demo-001");

  // 模拟对话：3 轮
  const turns = [
    "我是一名前端工程师，主要写 React + TypeScript。",
    "我习惯每天早上 6 点起床先写 1 小时代码再上班。",
    "今天我想聊聊性能优化，从哪里开始？",
  ];

  for (const [i, userMsg] of turns.entries()) {
    process.stdout.write(`\n[Turn ${i + 1}] User: ${userMsg}\n`);
    // 1. AI 回复前：取相关记忆
    const ctx = await userMem.getRelevantContext(userMsg, { topK: 5 });
    if (ctx) {
      process.stdout.write(`[mem ctx]\n${ctx}\n`);
    }
    // 2. 沉淀用户消息
    const result = await userMem.ingest(userMsg, { originAgent: "chat-demo" });
    process.stdout.write(
      `[ingest] archival=1, derived=${result.derived.length}\n`,
    );
  }

  // 最后看看记下了什么
  const stats = await userMem.stats();
  process.stdout.write(`\n[stats] ${JSON.stringify(stats.by_layer)}\n`);
  mem.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
