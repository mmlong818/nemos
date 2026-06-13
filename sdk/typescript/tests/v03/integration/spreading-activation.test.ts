// spreading-activation.test.ts — search 沿 related 拓展

import { test } from "node:test";
import assert from "node:assert/strict";
import { Mnemos } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

test("spreadingActivation=true 沿 related 拓展 2 跳", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
  });
  try {
    const userMem = mem.forUser("alice");
    // 直接 write 三条 memory，手工构造 related 链 A → B → C
    const a = await userMem.write({
      layer: "semantic",
      content: "anchor 节点 A",
      source: { authoritative: false, origin: "test" },
    });
    const b = await userMem.write({
      layer: "semantic",
      content: "B 节点（与 A 相关）",
      source: { authoritative: false, origin: "test" },
      related: [a.id],
    });
    const c = await userMem.write({
      layer: "semantic",
      content: "C 节点（与 B 相关）",
      source: { authoritative: false, origin: "test" },
      related: [b.id],
    });
    // 让 A 也指向 B（双向），B 也指向 C
    mem.raw().storage.updateRelated("default", "alice", "semantic", a.id, [b.id]);
    mem.raw().storage.updateRelated("default", "alice", "semantic", b.id, [a.id, c.id]);

    // search "anchor" 默认只能命中 A（FTS）
    const r0 = await userMem.search("anchor", { topK: 50 });
    assert.equal(r0.length, 1);
    assert.equal(r0[0]!.id, a.id);

    // 开 spreadingActivation → 应当顺着 A → B → C 拓展
    const r1 = await userMem.search("anchor", { topK: 50, spreadingActivation: true });
    const ids = new Set(r1.map((m) => m.id));
    assert.ok(ids.has(a.id), "包含种子 A");
    assert.ok(ids.has(b.id), "1 跳到 B");
    assert.ok(ids.has(c.id), "2 跳到 C");
  } finally {
    mem.close();
  }
});

test("spreadingActivation 不会跨 user namespace", async () => {
  const mem = new Mnemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
  });
  try {
    const aliceMem = mem.forUser("alice");
    const bobMem = mem.forUser("bob");
    const aliceX = await aliceMem.write({
      layer: "semantic",
      content: "alice anchor",
      source: { authoritative: false, origin: "test" },
    });
    const bobY = await bobMem.write({
      layer: "semantic",
      content: "bob other",
      source: { authoritative: false, origin: "test" },
    });
    // 即便强行把 alice 的 related 指向 bob 的 id：spreading 找不到（findById 受 user 限制）
    mem.raw().storage.updateRelated("default", "alice", "semantic", aliceX.id, [bobY.id]);
    const r = await aliceMem.search("anchor", { spreadingActivation: true });
    const ids = new Set(r.map((m) => m.id));
    assert.ok(ids.has(aliceX.id));
    assert.ok(!ids.has(bobY.id), "永不跨 user");
  } finally {
    mem.close();
  }
});
