import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runOfficeCorpusRegression } from "../examples/companion/office-corpus-regression.js";

async function main(): Promise<void> {
  const outputDir = resolve(process.argv[2] || ".tmp-runtime/office-corpus");
  mkdirSync(outputDir, { recursive: true });
  const receipts = await runOfficeCorpusRegression(outputDir);
  const report = {
    schema: "clownfish.office-corpus.v1",
    checkedAt: new Date().toISOString(),
    outputDir,
    total: receipts.length,
    passed: receipts.filter((item) => item.passed).length,
    failed: receipts.filter((item) => !item.passed).length,
    receipts,
  };
  writeFileSync(resolve(outputDir, "conversion-report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ outputDir, total: report.total, passed: report.passed, failed: report.failed })}\n`);
  if (report.failed) process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
