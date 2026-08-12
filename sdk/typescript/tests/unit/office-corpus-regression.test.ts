import assert from "node:assert/strict";
import test from "node:test";

import { OFFICE_CORPUS, runOfficeCorpusRegression } from "../../examples/companion/office-corpus-regression.js";

test("二十份日常 DOCX 语料真实生成、转换并保留关键结构", async () => {
  assert.equal(OFFICE_CORPUS.length, 20);
  assert.equal(new Set(OFFICE_CORPUS.map((item) => item.id)).size, 20);

  const receipts = await runOfficeCorpusRegression();
  assert.equal(receipts.length, 20);
  assert.deepEqual(
    receipts.filter((item) => !item.passed).map((item) => ({
      id: item.id,
      failed: item.checks.filter((check) => !check.passed).map((check) => check.name),
    })),
    [],
  );
  for (const receipt of receipts) {
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
    assert.ok(receipt.byteLength > 1_000);
  }
});
