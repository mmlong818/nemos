// examples/doc-search —— 批量 ingest 一组文档/笔记，然后关键词搜索
//
// 跑法：
//   ANTHROPIC_API_KEY=sk-... npx tsx examples/doc-search/index.ts

import { Mnemos } from "../../src/index.js";

const DOCS = [
  {
    scope: "project:mnemos",
    text: "mnemos 是开源的记忆基础设施，核心是 5 层存储（archival/episodic/semantic/personal_semantic/procedural）+ 三维元数据（source/arousal/surprise）。",
  },
  {
    scope: "project:mnemos",
    text: "spec I3 不变量：archival 是不可变的原始层，任何 update/delete 都被 trigger 拒绝。所有派生品必须 archival_ref 指回。",
  },
  {
    scope: "project:mnemos",
    text: "spec I4 不变量：personal_semantic 不接受 LLM 推断（authoritative=false）直接写入。AI 永远是仆人不是代理。",
  },
  {
    scope: "project:other",
    text: "在另一个项目中我用 Postgres + pgvector 做了 RAG，但 mnemos 用 SQLite + sqlite-vec，目标是嵌入式部署。",
  },
];

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("缺 ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const mem = new Mnemos({
    storage: { type: "sqlite", path: "./doc-search.db" },
    llm: { provider: "anthropic", apiKey },
    features: { doubleCheck: false },
  });
  const userMem = mem.forUser("knowledge-base");

  // 1. 批量沉淀
  for (const doc of DOCS) {
    const r = await userMem.ingest(doc.text, {
      scope: doc.scope,
      originAgent: "doc-importer",
    });
    process.stdout.write(`✓ ingested ${doc.scope}: derived=${r.derived.length}\n`);
  }

  // 2. 搜索
  const queries = [
    "什么是 mnemos？",
    "archival 能不能改？",
    "AI 写 personal_semantic 行吗？",
  ];

  for (const q of queries) {
    process.stdout.write(`\nQ: ${q}\n`);
    const hits = await userMem.search(q, {
      topK: 3,
      scope: "project:mnemos",
    });
    for (const h of hits) {
      process.stdout.write(`  [${h.layer}] ${h.content.slice(0, 80)}…\n`);
    }
  }

  mem.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
