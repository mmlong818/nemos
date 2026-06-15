// examples/forgetting/index.ts
//
// v0.4：演示 FSRS decay engine 的「访问强化 / 不访问衰减 / cold 标记 / archival 永久豁免」。
//
// 这个 demo 不连真 LLM —— 用 InMemoryStorage 直接 write() 写入 memory，
// 然后注入「未来 100 天」的时间跑 decay scan，观察 cold 标记落库。

import { Nemos } from "../../src/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const mem = new Nemos({
  storage: { type: "memory" },
  // 这个示例不调真 LLM；提供一个 stub 避免初始化失败
  llm: {
    provider: "custom",
    name: "stub",
    chat: async () =>
      JSON.stringify({
        archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "x" } },
        derived: [],
      }),
  },
  features: {
    doubleCheck: false,
    decay: {
      enabled: true,
      coldThreshold: 0.1,
      coldDormancyDays: 7,
      // demo 走手动 scan 即可；scan interval 不影响手动 runDecayScan
    },
  },
  worker: { manualWorker: true },
});

const u = mem.forUser("demo-user");

async function main(): Promise<void> {
  console.log("📥 写 10 条 episodic + 1 条 personal_semantic + 用户 ingest 一条原文");
  for (let i = 0; i < 10; i++) {
    await u.write({
      layer: "episodic",
      content: `事件 ${i + 1}：临时记下的小事`,
      source: { authoritative: false, origin: "demo", chain_depth: 1 },
    });
  }
  await u.write({
    layer: "personal_semantic",
    content: "稳定特征：偏好早起",
    source: { authoritative: false, origin: "demo", chain_depth: 1 },
  });
  await u.ingest("用户的一次原始记录。这条会进 archival 层", { skipAnalysis: true });

  const stats0 = await u.stats();
  console.log("初始 stats:", stats0.by_layer);

  console.log("\n⏰ 注入未来 100 天，跑 decay scan");
  const result = await u.runDecayScan(Date.now() + 100 * DAY_MS);
  console.log(`  scanned=${result.scanned}, cooled=${result.cooled}`);

  console.log("\n❄ 当前 cold 列表（archival 永远不在内）：");
  const cold = await u.listCold();
  for (const m of cold) {
    console.log(`  [${m.layer}] ${m.content}  R=${m.retrievability?.toFixed(4)}`);
  }

  console.log("\n🛡 archival 永远 protected：");
  const arch = await u.listByLayer("archival");
  for (const a of arch) {
    console.log(`  [${a.layer}] protected=${a.archival_protected} cold=${a.cold ?? false}`);
  }

  console.log("\n🔍 默认 search 自动隐藏 cold；includeCold:true 才返回：");
  const def = await u.search("事件");
  const all = await u.search("事件", { includeCold: true });
  console.log(`  默认: ${def.length} 条；includeCold:true: ${all.length} 条`);

  console.log("\n💡 关键点：");
  console.log("  - archival_protected 是硬约束 → archival 永远不会 cold");
  console.log("  - search 命中会刷新 last_accessed + S*=1.3，自然抗衰减");
  console.log("  - 用户可 clearCold(memoryId) 取消 cold（「这条还有用」）");

  mem.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
