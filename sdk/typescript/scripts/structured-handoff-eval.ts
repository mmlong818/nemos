import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { renderStructuredHandoffEvaluationMarkdown, runStructuredHandoffEvaluation } from "../examples/companion/structured-handoff-evaluation.js";
import { structuredHandoffEvaluationConfig, structuredHandoffEvaluationFixtures } from "../tests/fixtures/structured-handoff-evaluation.js";

const index = process.argv.indexOf("--out-dir");
if (index < 0 || !process.argv[index + 1] || process.argv[index + 2]) {
  throw new Error("Usage: npm run evaluation:structured-handoff -- --out-dir <explicit-directory>");
}
const requestedOutput = process.argv[index + 1];
if (!isAbsolute(requestedOutput)) throw new Error("--out-dir must be an absolute path");
if (process.platform === "win32" && /^\\\\/.test(requestedOutput)) throw new Error("--out-dir must be a local drive path, not UNC or a device path");
const outputDir = resolve(requestedOutput);
const repositoryRoot = resolve(__dirname, "../../..");
const samePath = (left: string, right: string) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
const repositoryRelative = relative(repositoryRoot, outputDir);
if (samePath(outputDir, repositoryRoot) || (repositoryRelative !== "" && !repositoryRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && repositoryRelative !== ".." && !isAbsolute(repositoryRelative))) {
  throw new Error("--out-dir cannot be the repository root or inside the repository");
}
if (existsSync(outputDir)) throw new Error("--out-dir must not already exist; existing files and directories are never overwritten");
const parent = dirname(outputDir);
if (!existsSync(parent)) throw new Error("--out-dir parent must be an existing directory");
for (let cursor = parent; ; cursor = dirname(cursor)) {
  const stat = lstatSync(cursor);
  if (stat.isSymbolicLink() || !samePath(resolve(realpathSync.native(cursor)), resolve(cursor))) {
    throw new Error("--out-dir cannot traverse a symbolic link or reparse point");
  }
  const next = dirname(cursor);
  if (next === cursor) break;
}
if (!lstatSync(parent).isDirectory()) throw new Error("--out-dir parent must be an existing directory");
mkdirSync(outputDir);
const report = runStructuredHandoffEvaluation(structuredHandoffEvaluationFixtures, structuredHandoffEvaluationConfig);
writeFileSync(resolve(outputDir, "structured-handoff-evaluation.json"), JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
writeFileSync(resolve(outputDir, "structured-handoff-evaluation.md"), renderStructuredHandoffEvaluationMarkdown(report), { encoding: "utf8", flag: "wx" });
process.stdout.write(`Offline synthetic evaluation written to ${outputDir}\nNo model calls, tokens, latency, or cost were measured.\n`);
