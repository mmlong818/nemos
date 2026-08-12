import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEVELOPMENT_CORPUS, runDevelopmentCorpusRegression } from "../../examples/companion/development-corpus-regression.js";

test("十类真实小项目完成检查、提案写入和回滚", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-development-corpus-"));
  try {
    assert.equal(DEVELOPMENT_CORPUS.length, 10);
    const receipts = await runDevelopmentCorpusRegression(root);
    assert.equal(receipts.length, 10);
    assert.deepEqual(receipts.filter((item) => !item.passed).map((item) => ({ id: item.id, checks: item.checks, proposal: item.proposal })), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
