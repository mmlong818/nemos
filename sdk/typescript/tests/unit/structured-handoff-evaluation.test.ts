import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { renderStructuredHandoffEvaluationMarkdown, runStructuredHandoffEvaluation } from "../../examples/companion/structured-handoff-evaluation.js";
import { structuredHandoffEvaluationConfig, structuredHandoffEvaluationFixtures } from "../fixtures/structured-handoff-evaluation.js";

const run = () => runStructuredHandoffEvaluation(structuredHandoffEvaluationFixtures, structuredHandoffEvaluationConfig);

test("gold fixture corpus is stable and covers conflict, missing, forged evidence, and truncation", () => {
  const serialized = JSON.stringify(structuredHandoffEvaluationFixtures);
  assert.equal(createHash("sha256").update(serialized).digest("hex"), "b9b60bd156ec90ad148913a7fff63ebf1a93095b03b4a1dd41a1b4d240f7d599");
  assert.deepEqual(structuredHandoffEvaluationFixtures.map((fixture) => fixture.id), ["canonical-conflict", "missing-and-forged", "bounded-truncation"]);
  assert.match(serialized, /conflict|missing|artifact:forged|7,?000|xxxx/);
});

test("A is explicitly incomparable while B/C/D share fixed worker corpus and identical budgets", () => {
  const report = run();
  for (const fixture of structuredHandoffEvaluationFixtures) {
    const cases = report.cases.filter((item) => item.fixtureId === fixture.id);
    const a = cases.find((item) => item.arm === "A")!;
    assert.equal(a.workerCorpusHash, null); assert.deepEqual(a.comparableTo, []); assert.match(a.incomparableReason!, /original materials only/);
    const ablation = cases.filter((item) => item.arm !== "A");
    assert.equal(new Set(ablation.map((item) => item.workerCorpusHash)).size, 1);
    assert.ok(ablation.every((item) => item.applicability === "fixed-worker-transmission-ablation"));
    assert.ok(cases.every((item) => JSON.stringify(item.budget) === JSON.stringify(structuredHandoffEvaluationConfig.budget)));
  }
});

test("separate risk scores surface conflicts, forged refs, missing outputs, and deterministic truncation", () => {
  const first = run(), second = run();
  assert.deepEqual(first, second);
  assert.ok(first.cases.every((item) => item.scores.outputDeterminism.rate === 1));
  const conflict = first.cases.find((item) => item.fixtureId === "canonical-conflict" && item.arm === "D")!;
  assert.deepEqual(conflict.candidate.conflictKeys, ["count"]);
  assert.equal(conflict.scores.conflictSurfacing.rate, 1);
  const forged = first.cases.find((item) => item.fixtureId === "missing-and-forged" && item.arm === "D")!;
  assert.equal(forged.candidate.forgedEvidenceRejected, true);
  assert.equal(forged.scores.forgedEvidenceRejection.rate, 1);
  const missedForgery = first.cases.find((item) => item.fixtureId === "missing-and-forged" && item.arm === "B")!;
  assert.deepEqual(missedForgery.scores.forgedEvidenceRejection, { earned: 0, total: 1, rate: 0 });
  const incomparableA = first.cases.find((item) => item.fixtureId === "missing-and-forged" && item.arm === "A")!;
  assert.deepEqual(incomparableA.scores.forgedEvidenceRejection, { earned: 0, total: 0, rate: null });
  assert.ok(first.cases.filter((item) => item.fixtureId !== "missing-and-forged").every((item) => item.scores.forgedEvidenceRejection.total === 0 && item.scores.forgedEvidenceRejection.rate === null));
  assert.ok(forged.candidate.unresolvedCodes.includes("missing:missing-worker"));
  const truncated = first.cases.filter((item) => item.fixtureId === "bounded-truncation" && item.arm !== "A");
  assert.ok(truncated.every((item) => item.transportTruncated && item.contextChars === structuredHandoffEvaluationConfig.budget.transportChars));
});

test("tampered synthetic evidence is rejected instead of becoming a scored source", () => {
  const fixtures = structuredClone(structuredHandoffEvaluationFixtures);
  fixtures[0].syntheticOracle.B.evidenceRefs.push({ ref: "artifact:forged", kind: "artifact", observed: true, factVerified: false });
  assert.throws(() => runStructuredHandoffEvaluation(fixtures, structuredHandoffEvaluationConfig), /forged evidence/);
});

test("forged-evidence applicability is bound to the actual fixed worker corpus", () => {
  const forged = structuredClone(structuredHandoffEvaluationFixtures.find((fixture) => fixture.id === "missing-and-forged")!);
  const forgedReport = runStructuredHandoffEvaluation([forged], structuredHandoffEvaluationConfig);
  assert.deepEqual(forgedReport.cases.find((item) => item.arm === "A")!.scores.forgedEvidenceRejection, { earned: 0, total: 0, rate: null });
  assert.ok(forgedReport.cases.filter((item) => item.arm !== "A").every((item) => item.scores.forgedEvidenceRejection.total === 1));

  forged.gold.forgedEvidenceMustBeRejected = false;
  assert.throws(() => runStructuredHandoffEvaluation([forged], structuredHandoffEvaluationConfig), /gold does not match.*worker corpus/);

  const clean = structuredClone(structuredHandoffEvaluationFixtures.find((fixture) => fixture.id === "canonical-conflict")!);
  clean.gold.forgedEvidenceMustBeRejected = true;
  assert.throws(() => runStructuredHandoffEvaluation([clean], structuredHandoffEvaluationConfig), /gold does not match.*worker corpus/);
});

test("reports never fabricate runtime measurements or present the synthetic oracle as a benchmark", () => {
  const report = run();
  assert.equal(report.benchmarkClaim, "none");
  for (const item of report.cases) assert.deepEqual(item.measurements, { status: "not-measured", modelCalls: null, inputTokens: null, outputTokens: null, cost: null });
  const markdown = renderStructuredHandoffEvaluationMarkdown(report);
  assert.match(markdown, /Synthetic protocol check only/);
  assert.match(markdown, /not-measured/);
  assert.doesNotMatch(markdown, /winner|best model|cost saved/i);
  const noForgeryRow = markdown.split("\n").find((line) => line.includes("canonical-conflict") && line.includes("| D |"))!;
  assert.match(noForgeryRow, /\| n\/a \| 1\.000 \| not-measured \|$/);
});

test("CLI writes JSON and Markdown only to an explicit disposable output directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "structured-handoff-eval-"));
  const dir = join(parent, "new-report");
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/structured-handoff-eval.ts", "--out-dir", dir], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const jsonFile = join(dir, "structured-handoff-evaluation.json"), markdownFile = join(dir, "structured-handoff-evaluation.md");
    assert.ok(existsSync(jsonFile)); assert.ok(existsSync(markdownFile));
    const parsed = JSON.parse(readFileSync(jsonFile, "utf8"));
    assert.equal(parsed.benchmarkClaim, "none");
    assert.match(readFileSync(markdownFile, "utf8"), /No model quality/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("CLI rejects missing, relative, repository, file, and existing-directory targets without writing", (t) => {
  const invoke = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/structured-handoff-eval.ts", ...args], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(invoke([]).status, 0);
  const relative = `relative-eval-${process.pid}`;
  assert.notEqual(invoke(["--out-dir", relative]).status, 0);
  assert.equal(existsSync(join(process.cwd(), relative)), false);
  const repositoryRoot = join(process.cwd(), "..", "..");
  const rootResult = invoke(["--out-dir", repositoryRoot]);
  assert.notEqual(rootResult.status, 0); assert.match(rootResult.stderr, /repository root/);
  const repositoryChild = join(repositoryRoot, `structured-handoff-eval-forbidden-${process.pid}`);
  const childResult = invoke(["--out-dir", repositoryChild]);
  assert.notEqual(childResult.status, 0); assert.match(childResult.stderr, /inside the repository/);
  assert.equal(existsSync(repositoryChild), false);
  if (process.platform === "win32") {
    for (const remotePath of ["\\\\server\\share\\structured-handoff-eval", "\\\\?\\C:\\structured-handoff-eval"]) {
      const remoteResult = invoke(["--out-dir", remotePath]);
      assert.notEqual(remoteResult.status, 0); assert.match(remoteResult.stderr, /local drive path/);
    }
  } else {
    t.diagnostic("UNC/device path rejection is Windows-specific");
  }
  const parent = mkdtempSync(join(tmpdir(), "structured-handoff-eval-reject-"));
  try {
    const existingDir = join(parent, "existing");
    mkdirSync(existingDir);
    assert.notEqual(invoke(["--out-dir", existingDir]).status, 0);
    assert.equal(existsSync(join(existingDir, "structured-handoff-evaluation.json")), false);
    const existingFile = join(parent, "file-target"); writeFileSync(existingFile, "keep", "utf8");
    assert.notEqual(invoke(["--out-dir", existingFile]).status, 0);
    assert.equal(readFileSync(existingFile, "utf8"), "keep");

    const realParent = join(parent, "real-parent");
    mkdirSync(realParent);
    const linkedParent = join(parent, "linked-parent");
    try { symlinkSync(realParent, linkedParent, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { t.diagnostic(`symlink/reparse case skipped: ${error instanceof Error ? error.message : String(error)}`); return; }
    const linkedOutput = join(linkedParent, "report");
    const linkedResult = invoke(["--out-dir", linkedOutput]);
    assert.notEqual(linkedResult.status, 0); assert.match(linkedResult.stderr, /symbolic link|reparse point/);
    assert.equal(existsSync(join(realParent, "report")), false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
