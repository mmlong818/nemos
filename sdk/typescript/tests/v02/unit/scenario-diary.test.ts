// scenario-diary.test.ts —— diary profile 自动标 sensitive + hide from search

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

test("scenario='diary' 时所有 derived 标 sensitive=true", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  const r = await u.ingest("今天我感到焦虑。我和朋友吵架了。", {
    scenario: "diary",
  });
  assert.ok(r.derived.length > 0, "应该有 derived");
  for (const d of r.derived) {
    assert.equal(d.sensitive, true, `derived ${d.id} 必须 sensitive=true`);
    assert.equal(d.scenario, "diary");
  }
  // archival 也带 sensitive 标记
  assert.equal(r.archival.sensitive, true, "diary 场景 archival 也 sensitive");
  mem.close();
});

test("sensitive=true 的 derived 默认不进 search 结果", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await u.ingest("今天我感到焦虑", { scenario: "diary" });
  await u.ingest("我喜欢早上写作"); // 默认 scenario，非 sensitive
  const results = await u.search("写作 焦虑");
  // 默认 search 不应返回 sensitive 记录
  for (const r of results) {
    assert.notEqual(r.sensitive, true, "默认 search 不应返回 sensitive");
  }
  mem.close();
});

test("includeSensitive=true 时能搜到 sensitive 记录", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await u.ingest("今天我感到焦虑", { scenario: "diary" });
  const all = await u.search("焦虑", { includeSensitive: true });
  const sensitiveHits = all.filter((m) => m.sensitive === true);
  assert.ok(sensitiveHits.length > 0, "includeSensitive=true 应返回 sensitive 记录");
  mem.close();
});
