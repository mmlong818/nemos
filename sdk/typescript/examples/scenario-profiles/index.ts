// examples/scenario-profiles —— 同一份内容，4 个 scenario，看分类差异
//
// 跑法：
//   cd sdk/typescript
//   npm install
//   ANTHROPIC_API_KEY=sk-... npx tsx examples/scenario-profiles/index.ts
//
// 预期：
//   - chat       → 偏 episodic + personal_semantic
//   - doc-research → 偏 semantic + procedural；零 personal_semantic
//   - diary      → 偏 episodic + personal_semantic；所有 derived sensitive=true
//   - coding     → 偏 procedural + semantic
//
// 输出每个 profile 下的 layer 分布 + 是否带 event_at / sensitive。

import { Nemos } from "../../src/index.js";

const CONTENT = `# MiniMax M3 模型发布纪要

2026 年 5 月 30 日，MiniMax 在上海发布 M3 旗舰大模型，对标 GPT-5 与 Claude Opus 4.7。

技术要点：
- 上下文窗口扩到 2M token，业内最长
- 引入混合注意力（local + sparse global），推理成本降 40%
- 中文 SuperCLUE 评分超 Sonnet 4.6

发布会上 CEO 表示，下一步是把 M3 蒸馏成端侧小模型。

我个人觉得这次发布最有意思的不是性能数字，而是它强调了"长上下文 + 低成本"组合，这恰好是我们团队这个季度规划里反复讨论的方向。我们准备 6 月开始切到 M3 API 做内部基准测试。`;

const PROFILES = ["chat", "doc-research", "diary", "coding"] as const;

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("缺 ANTHROPIC_API_KEY env var");
    process.exit(1);
  }

  const mem = new Nemos({
    storage: { type: "memory" },
    llm: { provider: "anthropic", apiKey },
    features: { doubleCheck: false }, // 示例求快
  });

  for (const profile of PROFILES) {
    const u = mem.forUser(`demo-${profile}`);
    process.stdout.write(`\n=== Profile: ${profile} ===\n`);
    const r = await u.ingest(CONTENT, { scenario: profile });

    const counts: Record<string, number> = {};
    let withEventAt = 0;
    let sensitive = 0;
    for (const d of r.derived) {
      counts[d.layer] = (counts[d.layer] || 0) + 1;
      if (d.event_at) withEventAt++;
      if (d.sensitive) sensitive++;
    }
    process.stdout.write(`Derived 分布: ${JSON.stringify(counts)}\n`);
    process.stdout.write(
      `带 event_at: ${withEventAt}/${r.derived.length}，sensitive: ${sensitive}/${r.derived.length}\n`,
    );
    process.stdout.write(`Archival sensitive: ${r.archival.sensitive || false}\n`);
    // 抽样：每层第一条
    const byLayer: Record<string, string> = {};
    for (const d of r.derived) {
      if (!byLayer[d.layer]) byLayer[d.layer] = d.content;
    }
    for (const [layer, sample] of Object.entries(byLayer)) {
      process.stdout.write(`  [${layer}] ${sample.slice(0, 80)}\n`);
    }
  }

  mem.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
