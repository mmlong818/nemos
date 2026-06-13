// background-ingest.test.ts — 端到端：ingest(background) → tick → derived 完成

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mnemos } from "../../../src/index.js";
import { makePerspectiveMockLLMConfig } from "../../helpers.js";

test("background ingest 立即返回 handle，archival 同步落地，derived 异步产出", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makePerspectiveMockLLMConfig(),
    features: { perspectives: ["fact"], autoLinking: false },
    worker: { manualWorker: true },
  });
  try {
    const userMem = mem.forUser("alice");
    const handle = await userMem.ingest("X 项目准备发布", { background: true });

    // 立即可读：archival 同步写入
    assert.equal(handle.status, "queued");
    const archivals = await userMem.listByLayer("archival");
    assert.equal(archivals.length, 1);
    assert.equal(archivals[0]!.id, handle.archival.id);

    // 状态可查
    const info0 = await userMem.getIngestStatus(handle.id);
    assert.equal(info0?.status, "queued");
    assert.equal(info0?.attempts, 0);

    // manualWorker 模式：手动 tick
    await mem.runWorkerTick();

    const info1 = await userMem.getIngestStatus(handle.id);
    assert.equal(info1?.status, "completed");
    assert.ok((info1?.derivedCount ?? 0) >= 1, "应产出至少 1 条 derived");

    // derived 已落地到非 archival layer
    const stats = await userMem.stats();
    assert.ok(stats.total >= 2, "至少 archival + 1 条 derived");
  } finally {
    mem.close();
  }
});

test("listPendingIngests 跨用户隔离", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makePerspectiveMockLLMConfig(),
    features: { perspectives: ["fact"], autoLinking: false },
    worker: { manualWorker: true },
  });
  try {
    await mem.forUser("alice").ingest("alice content", { background: true });
    await mem.forUser("bob").ingest("bob content", { background: true });
    const a = await mem.forUser("alice").listPendingIngests();
    const b = await mem.forUser("bob").listPendingIngests();
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.notEqual(a[0]!.id, b[0]!.id);
  } finally {
    mem.close();
  }
});

test("background + waitForIngest", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makePerspectiveMockLLMConfig(),
    features: { perspectives: ["fact"], autoLinking: false },
    worker: { pollIntervalMs: 50 }, // 快速轮询便于测试
  });
  try {
    const handle = await mem.forUser("alice").ingest("hello bg", { background: true });
    const info = await mem.waitForIngest(handle.id, 5000);
    assert.equal(info.status, "completed");
  } finally {
    mem.close();
  }
});

test("archival 仍 sync 写入即便 background 模式", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makePerspectiveMockLLMConfig(),
    features: { perspectives: ["fact"], autoLinking: false },
    worker: { manualWorker: true },
  });
  try {
    const userMem = mem.forUser("alice");
    const handle = await userMem.ingest("immediate archival", { background: true });
    // 不 tick，立即查 archival
    const archivals = await userMem.listByLayer("archival");
    assert.equal(archivals.length, 1);
    assert.equal(archivals[0]!.content, "immediate archival");
    assert.equal(handle.archival.source.authoritative, true);
  } finally {
    mem.close();
  }
});
