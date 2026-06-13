// examples/multi-perspective/index.ts
//
// 同一份内容用 v0.2 doubleCheck vs v0.3 multi-perspective 跑一遍，打印分类差异。

import { Mnemos } from "../../src/index.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("缺 ANTHROPIC_API_KEY 环境变量。");
  process.exit(1);
}

const CONTENT = `
昨天的设计 review 大家就 dashboard 的信息密度有不同看法。
我个人觉得密度太高 → 用户看一眼就崩；产品老板觉得密度不够 → "看起来像玩具"。

我们决定先做 A/B：周三上线两版，跑两周看转化。
默认推荐方案 B（高密度），但用户首次进入会给个"密度切换"的引导。

技术上，dashboard 数据走 SSE 增量推送；前端用 useDeferredValue 降低渲染阻塞。
新指标库（暂代号 metric-lite）下周可用。
`.trim();

function buildMnemos(useMultiPerspective: boolean): Mnemos {
  return new Mnemos({
    storage: { type: "memory" },
    llm: { provider: "anthropic", apiKey: apiKey! },
    features: useMultiPerspective
      ? { perspectives: ["fact", "method", "decision", "emotion"], autoLinking: false }
      : { doubleCheck: true },
  });
}

async function run(label: string, useMultiPerspective: boolean): Promise<void> {
  console.log(`\n========== ${label} ==========`);
  const mem = buildMnemos(useMultiPerspective);
  try {
    const r = await mem.forUser("alice").ingest(CONTENT);
    console.log(`derived 总数: ${r.derived.length}`);
    for (const d of r.derived) {
      const confInfo = d.source.confidence ? ` [${d.source.confidence}]` : "";
      const persp = d.source.perspectives ? ` (perspectives: ${d.source.perspectives.join("+")})` : "";
      console.log(`  - [${d.layer}]${confInfo}${persp} ${d.content.slice(0, 60)}`);
    }
    if (r.verification_stats) {
      console.log(`stats: ${JSON.stringify(r.verification_stats)}`);
    }
  } finally {
    mem.close();
  }
}

async function main(): Promise<void> {
  await run("v0.2 doubleCheck（同 prompt 双 pass + check）", false);
  await run("v0.3 multi-perspective（fact + method + decision + emotion）", true);

  console.log("\n💡 关键差异：");
  console.log("  - v0.2：同一 prompt 跑两次，再让 LLM 自己审；抗噪有限，盲区无法跨视角覆盖");
  console.log("  - v0.3：4 个特化视角并行抽，merge pass 合并；perspectives>=2 → high confidence");
  console.log("  - v0.3 的 confidence 由客户端规则推导（不信 LLM 自填），更可预测");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
