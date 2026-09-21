import assert from "node:assert/strict";
import test from "node:test";
import { ATTACHMENT_RECEIPT_RULE, attachmentReceiptLine, measureAttachment } from "../../examples/companion/attachment-receipt.js";

test("measurement counts logical lines regardless of line endings and ignores trailing blank lines", () => {
  assert.deepEqual(measureAttachment(""), { lines: 0, chars: 0 });
  assert.deepEqual(measureAttachment("a\r\nb\r\n\r\n"), { lines: 2, chars: 3 });
  assert.deepEqual(measureAttachment("一行"), { lines: 1, chars: 2 });
});

test("the receipt line states name, kind, size and completeness so the model can echo it", () => {
  const complete = attachmentReceiptLine({ name: "meeting.txt", kind: "TXT", text: "时间：9月20日\n参会：张三\n决定：下周三复盘" });
  assert.equal(complete, "附件回执：meeting.txt（TXT）· 3 行 · 23 字 · 完整");
  const cut = attachmentReceiptLine({ name: "big.csv", kind: "CSV", text: Array.from({ length: 1200 }, (_, i) => `row${i}`).join("\n"), truncated: true, originalSize: 3_400_000 });
  assert.match(cut, /^附件回执：big\.csv（CSV）· 1,200 行 · [\d,]+ 字 · 已截断，仅含前 [\d,]+ 字（原文约 3,400,000）$/);
  assert.match(ATTACHMENT_RECEIPT_RULE, /第一句先复述/);
});
