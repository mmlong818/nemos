// examples/background-ingest/index.ts
//
// v0.3：演示 background ingest 的"立即返回 + 后台抽取"流程。
// archival 同步写入，handle 立刻可用；derived 由 worker 异步产出。

import { Nemos } from "../../src/index.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("缺 ANTHROPIC_API_KEY 环境变量。");
  process.exit(1);
}

const mem = new Nemos({
  storage: { type: "sqlite", path: "./examples-bg.db" },
  llm: { provider: "anthropic", apiKey },
  features: {
    // 同时启用 multi-perspective（默认 v0.3 推荐组合）
    perspectives: ["fact", "method", "decision"],
    autoLinking: true,
  },
  worker: {
    pollIntervalMs: 500, // 演示快一点
  },
});

const userMem = mem.forUser("alice");

const LONG_CONTENT = `
今天回顾了一下过去一周的工程进度。

我们决定把 X 项目 的发布日期从 6 月底推迟到 7 月中——主要原因是 cache 层做了一次重写，
还没有跑过完整的压力测试。团队的判断是：早一周晚一周不如先把质量稳住，省得发布后回滚成本更高。

技术上的几个要点：
1. 新 cache 用 LRU + TTL 两级失效；
2. 监控加了 P99 / P999 两条曲线；
3. 文档迁移到了 Notion / Linear 的双轨；

下一步计划：周二碰个会，确认压测覆盖度；周五做 GA 发布。
`.trim();

async function main(): Promise<void> {
  console.log("📥 ingest(background=true)，立刻返回 handle...");
  const t0 = Date.now();
  const handle = await userMem.ingest(LONG_CONTENT, { background: true });
  const elapsed = Date.now() - t0;
  console.log(
    `  ✓ ${elapsed}ms 返回；handle.id=${handle.id}；archival.id=${handle.archival.id}；status=${handle.status}`,
  );

  console.log("\n🔎 archival 已可读（同步写入）：");
  const archs = await userMem.listByLayer("archival");
  console.log(`  archival 总数: ${archs.length}`);
  console.log(`  最新 archival.content 长度: ${archs[0]!.content.length} 字符`);

  console.log("\n⏳ 等待 worker 完成 derived 抽取...");
  const info = await mem.waitForIngest(handle.id, 60000);
  console.log(`  ✓ status=${info.status}; derivedCount=${info.derivedCount ?? 0}`);

  console.log("\n📊 最终统计：");
  const stats = await userMem.stats();
  console.log(`  total=${stats.total}`);
  console.log(`  by_layer=${JSON.stringify(stats.by_layer)}`);

  console.log("\n💡 关键点：");
  console.log("  - archival 在 ingest() 返回前已落地（< 50ms）");
  console.log("  - derived 抽取走后台，朋友 hot-path 不阻塞");
  console.log("  - 进程崩溃后再开 Nemos 时 'analyzing' 自动重置为 'queued'");

  mem.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
