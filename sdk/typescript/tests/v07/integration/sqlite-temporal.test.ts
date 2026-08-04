import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Nemos, type NemosConfig } from "../../../src/index.js";
import { makeMockLLMConfig } from "../../helpers.js";

function cleanup(path: string): void {
  for (const target of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(target)) rmSync(target, { force: true });
  }
}

test("v0.7.2 sqlite keeps future claim activation stable across restart", async () => {
  const path = join(tmpdir(), `nemos-v072-future-${process.pid}-${Date.now()}.db`);
  cleanup(path);
  const config: NemosConfig = {
    storage: { type: "sqlite", path },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  };

  let nemos = new Nemos(config);
  const user = nemos.forUser("alice");
  const current = await user.write({
    layer: "personal_semantic",
    content: "\u6211\u73b0\u5728\u4f4f\u5728\u798f\u5dde",
    source: { authoritative: false, origin: "test:user", chain_depth: 1, extractor: "user_typed" },
    subject: "user:self",
    predicate: "residence.current",
    object: "\u798f\u5dde",
    trustTier: 1,
    utteranceMode: "literal",
    validFrom: "2026-01-01T00:00:00.000Z",
  });
  const future = await user.write({
    layer: "personal_semantic",
    content: "\u6211\u5c06\u5728 2099 \u5e74\u642c\u5230\u706b\u661f\u57ce",
    source: { authoritative: false, origin: "test:user", chain_depth: 1, extractor: "user_typed" },
    subject: "user:self",
    predicate: "residence.current",
    object: "\u706b\u661f\u57ce",
    trustTier: 1,
    utteranceMode: "literal",
    validFrom: "2099-01-01T00:00:00.000Z",
  });
  await nemos.close();

  nemos = new Nemos(config);
  const reopened = nemos.forUser("alice");
  const before = await reopened.recall("\u6211\u73b0\u5728\u4f4f\u5728\u54ea\u91cc\uff1f", {
    now: "2026-07-24T12:00:00.000Z",
  });
  const after = await reopened.recall("\u6211\u73b0\u5728\u4f4f\u5728\u54ea\u91cc\uff1f", {
    now: "2099-02-01T00:00:00.000Z",
  });
  assert.deepEqual(before.items.map((item) => item.memory.id), [current.id]);
  assert.deepEqual(after.items.map((item) => item.memory.id), [future.id]);

  await nemos.close();
  cleanup(path);
});
