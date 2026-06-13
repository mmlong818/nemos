// examples/cross-memory-linking/index.ts
//
// 演示 v0.3 跨 memory 自动连接 + spreading activation 检索。
// 写 5 条 memory（含交叉 entity），观察 related 双向填入 + search 拓展。

import { Mnemos } from "../../src/index.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("缺 ANTHROPIC_API_KEY 环境变量。");
  process.exit(1);
}

const ENTRIES = [
  "X 项目 启动会，团队 Alpha 主导，目标是 Q3 GA。",
  "X 项目 的架构改用了 Service Mesh，移除了 Sidecar。",
  "团队 Alpha 调整：李四加入，负责后端。",
  "Service Mesh 的 RFC 已合并，下周开始迁移。",
  "Q3 OKR review：X 项目 是主线，其他延后。",
];

async function main(): Promise<void> {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: { provider: "anthropic", apiKey: apiKey! },
    features: {
      perspectives: ["fact"], // 简化路径
      autoLinking: true,
    },
    worker: { pollIntervalMs: 500 },
  });

  const userMem = mem.forUser("alice");

  console.log("📥 写入 5 条 memory（background 模式）...");
  const handles = [];
  for (const text of ENTRIES) {
    const h = await userMem.ingest(text, { background: true });
    handles.push(h);
    console.log(`  ✓ enqueue ${h.id} (archival ${h.archival.id.slice(0, 12)}...)`);
  }

  console.log("\n⏳ 等待 worker 全部完成...");
  for (const h of handles) {
    await mem.waitForIngest(h.id, 60000);
  }
  console.log("  ✓ 全部 completed");

  console.log("\n🔗 检查 related（每条 archival 的双向连接）...");
  const archs = await userMem.listByLayer("archival");
  for (const a of archs) {
    const ents = a.entities ?? [];
    const rel = a.related ?? [];
    console.log(
      `  ${a.id.slice(0, 12)}... entities=${JSON.stringify(ents)} related=[${rel.length} 条]`,
    );
  }

  console.log("\n🔍 search('X 项目') 默认（无 spreading）：");
  const r0 = await userMem.search("X 项目", { topK: 20 });
  for (const m of r0) {
    console.log(`  - [${m.layer}] ${m.content.slice(0, 50)}`);
  }

  console.log("\n🌐 search('X 项目') 开 spreadingActivation：");
  const r1 = await userMem.search("X 项目", { topK: 20, spreadingActivation: true });
  for (const m of r1) {
    console.log(`  - [${m.layer}] ${m.content.slice(0, 50)}`);
  }

  console.log("\n💡 关键点：");
  console.log("  - entity 抽取走 worker，朋友 hot-path 不阻塞");
  console.log("  - related 双向写入（A → B 同时 B → A）");
  console.log("  - 跨 user 永不连接（隔离硬约束）");
  console.log("  - spreadingActivation: 沿 related 拓展 2 跳，每跳取 top-5");

  mem.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
