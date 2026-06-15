// event-at-extracted.test.ts —— LLM 抽取的 event_at 被写入存储；contentDate 覆盖

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeScenarioAwareMockLLMConfig } from "../../helpers.js";

test("启用 temporal.extractEventDate 后 derived 带 event_at", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeScenarioAwareMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("2026-05-30 我和团队开了启动会", {
    scenario: "meeting",
  });
  assert.ok(r.derived.length > 0);
  const withEvent = r.derived.filter((d) => d.event_at);
  assert.ok(withEvent.length > 0, "至少有一条 derived 带 event_at");
  for (const d of withEvent) {
    assert.match(d.event_at!, /^\d{4}-\d{2}-\d{2}/);
  }
  mem.close();
});

test("contentDate 写入 archival.event_at", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeScenarioAwareMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("一段没有时间标识的内容", {
    contentDate: "2025-01-15",
  });
  assert.equal(r.archival.event_at, "2025-01-15");
  mem.close();
});

test("非 ISO 8601 的 event_at 被拒收（不写入）", async () => {
  // 制造一个 mock 输出非法 event_at
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: {
      provider: "custom",
      name: "bad-event-at",
      chat: async (system: string): Promise<string> => {
        if (system.includes("记忆审查官")) {
          return JSON.stringify({ derived: [], stats: {} });
        }
        return JSON.stringify({
          archival: {
            arousal: { value: 0, signal_sources: [] },
            surprise: { value: 0, basis: "x" },
          },
          derived: [
            {
              layer: "episodic",
              content: "事件 X",
              type: "project",
              scope: "global",
              source: { authoritative: false, origin: "llm-extract", chain_depth: 1 },
              arousal: { value: 0.3, signal_sources: [] },
              surprise: { value: 0.3, basis: "x" },
              event_at: "yesterday around 3pm", // 非法
            },
          ],
        });
      },
    },
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("某事件", { scenario: "meeting" });
  for (const d of r.derived) {
    if (d.event_at) {
      assert.match(d.event_at, /^\d{4}/, "event_at 必须 ISO 8601 形态");
    }
  }
  mem.close();
});
