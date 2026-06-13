// cross-memory-linking.test.ts — 写 2 条含同 entity → related 双向填入

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mnemos } from "../../../src/index.js";
import { makeEntityMockLLMConfig } from "../../helpers.js";

test("两条 memory 共享同 entity → related 双向 link", async () => {
  // 同时返回同样的 entity，模拟 LLM 抽出共同 entity
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeEntityMockLLMConfig(["项目 X", "团队 Alpha"]),
    features: {
      // 用单 perspective 简化路径
      perspectives: ["fact"],
      autoLinking: true,
    },
    worker: { manualWorker: true },
  });
  try {
    const userMem = mem.forUser("alice");
    const h1 = await userMem.ingest("第一条提到项目 X 和团队 Alpha", { background: true });
    await mem.runWorkerTick();
    const h2 = await userMem.ingest("第二条也提到项目 X", { background: true });
    await mem.runWorkerTick();

    // 两条 archival 都应在
    const archs = await userMem.listByLayer("archival");
    assert.equal(archs.length, 2);

    // 两条 archival 都应带 entities
    for (const a of archs) {
      assert.ok(Array.isArray(a.entities) && a.entities.length > 0, `archival ${a.id} 缺少 entities`);
    }

    // related 双向
    const a1 = archs.find((a) => a.id === h1.archival.id);
    const a2 = archs.find((a) => a.id === h2.archival.id);
    assert.ok(a1?.related?.includes(a2!.id), "a1.related 应含 a2.id");
    assert.ok(a2?.related?.includes(a1!.id), "a2.related 应含 a1.id");
  } finally {
    mem.close();
  }
});

test("跨 user namespace 永不 link", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeEntityMockLLMConfig(["共享 entity"]),
    features: { perspectives: ["fact"], autoLinking: true },
    worker: { manualWorker: true },
  });
  try {
    await mem.forUser("alice").ingest("alice 提到共享 entity", { background: true });
    await mem.runWorkerTick();
    await mem.forUser("bob").ingest("bob 也提到共享 entity", { background: true });
    await mem.runWorkerTick();

    const aliceArch = await mem.forUser("alice").listByLayer("archival");
    const bobArch = await mem.forUser("bob").listByLayer("archival");

    // alice.related 不应含 bob 的 id（即便 entity 相同）
    for (const a of aliceArch) {
      for (const b of bobArch) {
        assert.ok(
          !(a.related ?? []).includes(b.id),
          `跨 user 不应 link: ${a.id} → ${b.id}`,
        );
      }
    }
  } finally {
    mem.close();
  }
});

test("autoLinking=false 时不写 related", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeEntityMockLLMConfig(["项目 X"]),
    features: { perspectives: ["fact"], autoLinking: false },
    worker: { manualWorker: true },
  });
  try {
    const userMem = mem.forUser("alice");
    await userMem.ingest("first 项目 X", { background: true });
    await mem.runWorkerTick();
    await userMem.ingest("second 项目 X", { background: true });
    await mem.runWorkerTick();
    const archs = await userMem.listByLayer("archival");
    for (const a of archs) {
      assert.ok(!a.related || a.related.length === 0, `archival ${a.id} 不应有 related (autoLinking=false)`);
      // entities 也不抽
      assert.ok(!a.entities || a.entities.length === 0, `archival ${a.id} 不应有 entities`);
    }
  } finally {
    mem.close();
  }
});
