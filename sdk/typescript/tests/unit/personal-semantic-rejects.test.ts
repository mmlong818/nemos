// personal-semantic-rejects.test.ts —— spec I4：
// personal_semantic 不接受 authoritative=true 写入；恶意 LLM 也无法绕过。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Nemos } from "../../src/index.js";
import { makeMaliciousMockLLMConfig, makeMockLLMConfig } from "../helpers.js";

test("write({layer:'personal_semantic', source.authoritative:true}) → throw", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
  });
  const userMem = mem.forUser("u1");
  await assert.rejects(
    async () =>
      userMem.write({
        layer: "personal_semantic",
        content: "用户是 Go 程序员",
        source: {
          authoritative: true,
          origin: "user-typed",
          chain_depth: 0,
        },
      }),
    /personal_semantic.*authoritative/,
  );
  mem.close();
});

test("通过 ingest 路径，即使 LLM 恶意伪造 personal_semantic+authoritative=true，也会被降级或改成 derived=false", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMaliciousMockLLMConfig(),
    features: { doubleCheck: false },
  });
  const userMem = mem.forUser("u1");
  const r = await userMem.ingest("分析这段");
  for (const d of r.derived) {
    if (d.layer === "personal_semantic") {
      // 如果层没被降级（双重防御：authoritative 也被改了 false），则必须 authoritative=false
      assert.equal(
        d.source.authoritative,
        false,
        "若进入 personal_semantic，必须 authoritative=false",
      );
    }
  }
  mem.close();
});

test("可通过 write({layer:'personal_semantic', authoritative:false}) 合法写入（chain_depth>=1）", async () => {
  const mem = new Nemos({
    storage: { type: "memory" },
    llm: makeMockLLMConfig(),
  });
  const userMem = mem.forUser("u1");
  const m = await userMem.write({
    layer: "personal_semantic",
    content: "用户偏好早上写作",
    source: {
      authoritative: false,
      origin: "llm-extract",
      chain_depth: 1,
    },
  });
  assert.equal(m.layer, "personal_semantic");
  assert.equal(m.source.authoritative, false);
  mem.close();
});
