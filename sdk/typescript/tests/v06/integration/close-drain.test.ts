// close-drain.test.ts
// 回归：游离 auto-reflect 与 close() 的竞态。
// 修复前：ingest 触发 fire-and-forget reflect（跨 await 让出）→ 调用方 close() 立即关闭
// SQLite 连接 → reflect 恢复执行 storage.insert 命中已关连接，抛
// "The database connection is not open"（被 .catch 兜底成 warn，reflect 产物丢失）。
// 修复后：close() 先 drain 在途工作再关连接；停止后拒绝新 reflect。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../../src/index.js";
import type { LLMConfig, LogLevel } from "../../../src/types.js";

/** 抽取立即返回；reflect 响应故意延迟 delayMs（宏任务），制造与 close() 的竞速窗口。 */
function makeSlowReflectLLM(delayMs: number): LLMConfig {
  return {
    provider: "custom",
    name: "slow-reflect-mock",
    chat: async (system: string, user: string): Promise<string> => {
      if (system.includes("nemos 反思整合器")) {
        await new Promise((r) => setTimeout(r, delayMs));
        const ids: string[] = [];
        const re = /"id":\s*"(ep_[a-zA-Z0-9]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(user)) !== null) {
          if (m[1]) ids.push(m[1]);
          if (ids.length >= 3) break;
        }
        if (ids.length === 0) return JSON.stringify({ derived: [] });
        return JSON.stringify({
          derived: [
            {
              layer: "personal_semantic",
              content: "用户倾向早晨高产（慢 reflect 产物）",
              type: "user",
              scope: "global",
              source: { authoritative: false, origin: "reflect-consolidation", chain_depth: 1, confidence: "high" },
              consolidated_from: ids,
              arousal: { value: 0.3, signal_sources: [] },
              surprise: { value: 0.2, basis: "x" },
            },
          ],
        });
      }
      return JSON.stringify({
        archival: { arousal: { value: 0, signal_sources: [] }, surprise: { value: 0, basis: "r" } },
        derived: [
          {
            layer: "episodic",
            content: "今天做了某件事",
            type: "user",
            scope: "global",
            source: { authoritative: false, origin: "llm-extract", chain_depth: 1 },
            arousal: { value: 0, signal_sources: [] },
            surprise: { value: 0, basis: "r" },
          },
        ],
      });
    },
  };
}

test("close() drain：在途 auto-reflect 完成后才关连接，产物不丢、无连接错误", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-close-drain-"));
  const dbPath = join(dir, "m.db");
  const warns: string[] = [];
  const logger = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (level === "warn" || level === "error") warns.push(`${msg} ${meta ? JSON.stringify(meta) : ""}`);
  };

  const mem = new Nemos({
    storage: { type: "sqlite", path: dbPath },
    llm: makeSlowReflectLLM(120),
    features: { doubleCheck: false, reflect: { enabled: true, autoTriggerThreshold: 3 } },
    worker: { manualWorker: true },
    logger,
  });
  const u = mem.forUser("alice");
  for (let i = 0; i < 3; i++) await u.ingest(`今天我又做了高产的事 ${i}`);

  // 第 3 条 ingest 已触发游离 reflect（LLM 侧还挂在 120ms 延迟上）；立刻 close 竞速
  await mem.close();

  const connErr = warns.filter((w) => /not open|已关闭/i.test(w));
  assert.deepEqual(connErr, [], `close() 后不应有连接已关错误，实际: ${connErr.join(" | ")}`);

  // 重开同一 DB：reflect 产物应已持久化（证明 close 等到了 reflect 完成）
  const mem2 = new Nemos({
    storage: { type: "sqlite", path: dbPath },
    llm: makeSlowReflectLLM(1),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  const psem = await mem2.forUser("alice").listByLayer("personal_semantic");
  const consolidated = psem.find((m) => Array.isArray(m.consolidated_from) && m.consolidated_from.length > 0);
  assert.ok(consolidated, "drain 后 reflect 产物应已落库");
  await mem2.close();
  rmSync(dir, { recursive: true, force: true });
});

test("close() 后 worker 拒绝新 reflect（明确报错而非命中关闭连接）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeSlowReflectLLM(1),
    features: { doubleCheck: false, reflect: { enabled: true } },
    worker: { manualWorker: true },
  });
  await mem.close();
  await assert.rejects(
    () => mem.workerHandle().runReflectFor("default", "alice", "global"),
    /worker 已停止/,
  );
});
