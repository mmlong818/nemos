// examples/coding-agent —— 跨 session 记住用户偏好 + 项目知识
//
// 场景：一个 coding agent 跨多次 session 工作。
// session 1 用户告诉它「我用 4 空格缩进」
// session 2 它启动时拉出这条偏好 → 不再问。
//
// 跑法：
//   ANTHROPIC_API_KEY=sk-... npx tsx examples/coding-agent/index.ts

import { Mnemos } from "../../src/index.js";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("缺 ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const mem = new Mnemos({
    storage: { type: "sqlite", path: "./coding-agent.db" },
    llm: { provider: "anthropic", apiKey },
    defaultScope: "project:my-rust-app",
    features: { doubleCheck: false },
  });
  const userMem = mem.forUser("developer-1");

  // ===== Session 1 =====
  process.stdout.write("\n=== Session 1：用户教 agent ===\n");
  const session1Inputs = [
    "我在写一个 Rust web 服务，用 axum 框架。",
    "我坚持用 4 空格缩进，不要 tab！",
    "测试都放在 tests/ 目录下，集成测试用 #[tokio::test]。",
  ];
  for (const t of session1Inputs) {
    process.stdout.write(`user: ${t}\n`);
    await userMem.ingest(t, { originAgent: "coding-agent-s1" });
  }

  // 模拟 session 之间间隔——SDK 重新打开数据库（用同一 path 即可继续）
  mem.close();
  process.stdout.write("\n(close + reopen DB to simulate new session)\n");

  // ===== Session 2 =====
  const mem2 = new Mnemos({
    storage: { type: "sqlite", path: "./coding-agent.db" },
    llm: { provider: "anthropic", apiKey },
    defaultScope: "project:my-rust-app",
    features: { doubleCheck: false },
  });
  const userMem2 = mem2.forUser("developer-1");

  process.stdout.write("\n=== Session 2：agent 启动时拉相关偏好 ===\n");
  const ctx = await userMem2.getRelevantContext("新写一个 handler 函数", { topK: 8 });
  process.stdout.write(`[agent context for this task]\n${ctx}\n`);

  // 用户在 session 2 继续工作
  await userMem2.ingest("我刚加了 /api/users/:id 这个路由", {
    originAgent: "coding-agent-s2",
  });

  // 导出全量看下
  const exported = await userMem2.export("json-ld");
  process.stdout.write(`\n[export size] ${exported.length} chars\n`);

  mem2.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
