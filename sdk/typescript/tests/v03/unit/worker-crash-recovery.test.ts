// worker-crash-recovery.test.ts — 模拟 analyzing 中断 → 启动时重置为 queued

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makePerspectiveMockLLMConfig } from "../../helpers.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("启动时把 analyzing 重置为 queued", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-recovery-"));
  const dbPath = join(dir, "x.db");
  try {
    // 第一次：构造 SDK，手动把 queue 行标为 analyzing 后关闭
    const mem1 = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makePerspectiveMockLLMConfig(),
      worker: { manualWorker: true },
    });
    const handle = await mem1.forUser("alice").ingest("hello", { background: true });
    // 标 analyzing
    mem1.raw().storage.updateQueueStatus(handle.id, { status: "analyzing" });
    let info = mem1.workerHandle().getStatus(handle.id);
    assert.equal(info?.status, "analyzing");
    mem1.close();

    // 第二次：构造 SDK → 应当把 analyzing 重置为 queued
    const mem2 = new Nemos({
      storage: { type: "sqlite", path: dbPath },
      llm: makePerspectiveMockLLMConfig(),
      worker: { manualWorker: true },
    });
    info = mem2.workerHandle().getStatus(handle.id);
    assert.equal(info?.status, "queued");
    mem2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
