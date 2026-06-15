// sensitive-hidden-from-search.test.ts —— sensitive 记录默认 search 不可见

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

test("sensitive=true 的 derived 不出现在默认 search 结果", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await u.ingest("今天我感到孤独。我决定独自去散步。", { scenario: "diary" });
  await u.ingest("我喜欢咖啡");
  const r = await u.search("孤独 散步");
  for (const m of r) {
    assert.notEqual(m.sensitive, true);
  }
});

test("listByLayer 仍能列出 sensitive 记录（用户主权）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  // mock pickLayer 走「今天」→ episodic
  await u.ingest("今天我感到孤独", { scenario: "diary" });
  // 跨所有层找一条 sensitive
  const layers = ["episodic", "semantic", "personal_semantic", "procedural"] as const;
  let foundSensitive = false;
  for (const l of layers) {
    const arr = await u.listByLayer(l);
    if (arr.some((m) => m.sensitive === true)) {
      foundSensitive = true;
      break;
    }
  }
  assert.ok(foundSensitive, "listByLayer 应能看到 sensitive 记录");
  mem.close();
});

test("archival 不受 sensitive search filter 影响（用户主权原文）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const u = mem.forUser("u1");
  await u.ingest("敏感原文", { scenario: "diary" });
  // archival 默认 search layers 不包含 archival，但 listByLayer 应能取到
  const arch = await u.listByLayer("archival");
  assert.equal(arch.length, 1);
  assert.equal(arch[0]!.sensitive, true);
  mem.close();
});
