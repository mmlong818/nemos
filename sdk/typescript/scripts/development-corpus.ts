import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runDevelopmentCorpusRegression } from "../examples/companion/development-corpus-regression.js";

async function main(): Promise<void> {
  const root = resolve(process.argv[2] || `.tmp-runtime/development-corpus/${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`);
  mkdirSync(root, { recursive: true });
  const receipts = await runDevelopmentCorpusRegression(root);
  const report = {
    schema: "clownfish.development-corpus.v1",
    checkedAt: new Date().toISOString(),
    root,
    total: receipts.length,
    passed: receipts.filter((item) => item.passed).length,
    failed: receipts.filter((item) => !item.passed).length,
    receipts,
  };
  writeFileSync(resolve(root, "development-report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ root, total: report.total, passed: report.passed, failed: report.failed })}\n`);
  if (report.failed) process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
