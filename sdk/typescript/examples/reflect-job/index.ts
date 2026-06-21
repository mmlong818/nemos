// examples/reflect-job/index.ts
//
// v0.4：演示 reflect consolidation job。
// 用 stub LLM（不调真 API）：当 prompt 含「nemos 反思整合器」时
// 返回一条带 consolidated_from 的 personal_semantic。

import { Nemos } from "../../src/index.js";

const mem = new Nemos({
  storage: { type: "memory" },
  llm: {
    provider: "custom",
    name: "reflect-demo-stub",
    chat: async (system: string, user: string): Promise<string> => {
      if (system.includes("nemos 反思整合器")) {
        // 抽 ep_xxx id
        const ids: string[] = [];
        const re = /"id":\s*"(ep_[a-zA-Z0-9]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(user)) !== null) {
          if (m[1]) ids.push(m[1]);
          if (ids.length >= 5) break;
        }
        if (ids.length === 0) return JSON.stringify({ derived: [] });
        return JSON.stringify({
          derived: [
            {
              layer: "personal_semantic",
              content: "用户倾向在早晨时段进入高产状态（基于多条 episodic 一致信号）",
              type: "user",
              scope: "global",
              source: {
                authoritative: false,
                origin: "reflect-consolidation",
                chain_depth: 1,
                confidence: "high",
                perspectives_conflict: false,
              },
              consolidated_from: ids,
              arousal: { value: 0.3, signal_sources: [] },
              surprise: { value: 0.2, basis: `consolidated from ${ids.length} episodes` },
            },
          ],
        });
      }
      // ingest 走最小 mock
      if (system.includes("记忆审查官")) return JSON.stringify({ derived: [], stats: {} });
      return JSON.stringify({
        archival: {
          arousal: { value: 0, signal_sources: [] },
          surprise: { value: 0, basis: "raw" },
        },
        derived: [
          {
            layer: "episodic",
            content: "[demo] 今天我又在早晨高产",
            type: "user",
            scope: "global",
            source: { authoritative: false, origin: "llm-extract", chain_depth: 1 },
            arousal: { value: 0.3, signal_sources: [] },
            surprise: { value: 0.2, basis: "demo" },
          },
        ],
      });
    },
  },
  features: {
    doubleCheck: false,
    reflect: { enabled: true, autoTriggerThreshold: 9999 }, // 关 auto，手动跑
  },
  worker: { manualWorker: true },
});

const u = mem.forUser("alice");

async function main(): Promise<void> {
  console.log("📥 写 20 条 episodic（模拟一周的日常）");
  for (let i = 0; i < 20; i++) {
    await u.ingest(`今天发生了事 ${i + 1}`);
  }
  const before = await u.stats();
  console.log("ingest 后 by_layer:", before.by_layer);

  console.log("\n🧠 手动跑 reflect：让 LLM 从 20 条 episodic 提炼 personal_semantic");
  const result = await u.runReflect();
  console.log(`  episodicConsumed=${result.episodicConsumed}`);
  console.log(`  anchorCount=${result.anchorCount}`);
  console.log(`  新 derived=${result.derived.length} 条`);
  for (const d of result.derived) {
    console.log(`  → [${d.layer}] ${d.content}`);
    console.log(`     consolidated_from: ${d.consolidated_from?.length} 条 ep`);
    console.log(`     consolidated_at: ${d.consolidated_at}`);
    console.log(`     authoritative=${d.source.authoritative} (硬约束：永远 false)`);
  }

  const after = await u.stats();
  console.log("\nreflect 后 by_layer:", after.by_layer);

  console.log("\n💡 关键点：");
  console.log("  - reflect 输出走 persistDerivedList，authoritative=false 是硬约束");
  console.log("  - consolidated_from 引用必须是真实 episodic id（防 LLM 编造）");
  console.log("  - archival 永远不被读 / 不被修改（archival_protected）");
  console.log("  - 启用 features.reflect.enabled=true 后，达到阈值会自动入队跑");

  mem.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
