import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import JSZip from "jszip";
import { ArtifactReviewError } from "../../examples/companion/artifact-reviews.js";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { exportOfficeDocument } from "../../examples/companion/office-export.js";
import { readOfficeReviewSource } from "../../examples/companion/office-version-review.js";
import { OfficeWorkbenchStateStore } from "../../examples/companion/office-workbench-state.js";

const userId = "workbench-review-user";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "nemos-saved-office-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const office = new OfficeWorkbenchStateStore(join(root, "workbench.json"));
  const version = { id: "v1", name: "版本一", documentName: "工作台历史标题", blocks: [{ title: "正式标题", text: "SAVED_HISTORY_TEXT" }] };
  const document = { id: "doc1", name: "改过的标题", blocks: [{ title: "当前草稿", text: "EDITED_CURRENT_DRAFT" }], versions: [version] };
  office.save({ expectedRevision: 0, documents: [document], trash: [{ ...document, id: "trashed" }] });
  const runtime = () => new CapabilityRuntime({ dataDir: root, personas: () => [], notify: async () => assert.fail("Preparation must not send notifications") });
  return { root, office, version, document, runtime };
}

function isStatus(status: number) {
  return (error: unknown) => error instanceof ArtifactReviewError && error.status === status;
}

test("one saved version becomes one exact managed candidate without creating a task", async (t) => {
  const { office, runtime, version, document } = fixture(t);
  const source = readOfficeReviewSource(office.read(), "doc1", "v1", "docx", 1);
  const app = runtime();
  const taskCount = app.snapshot().tasks.length;
  const [first, duplicate] = await Promise.all([
    app.prepareOfficeVersionReview(source, userId, () => {}),
    app.prepareOfficeVersionReview(source, userId, () => {}),
  ]);
  assert.equal(first.reused, false);
  assert.deepEqual(duplicate, { ...first, reused: true });
  assert.equal(app.snapshot().tasks.length, taskCount);
  assert.equal(app.snapshot().artifacts.length, 1);
  const artifact = app.snapshot().artifacts[0]!;
  assert.equal(artifact.id, first.artifactId);
  assert.equal(artifact.taskId, "");
  assert.equal(artifact.title, version.documentName);
  assert.match(first.filename, /^工作台历史标题\.docx$/);
  assert.equal(artifact.metadata?.officeReviewSource?.versionId, version.id);
  assert.equal(artifact.proof?.contentHash, first.sha256);
  const data = readFileSync(artifact.file);
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /SAVED_HISTORY_TEXT/);
  assert.doesNotMatch(xml, /EDITED_CURRENT_DRAFT/);

  office.save({ expectedRevision: 1, documents: [{ ...document, name: "又改了", blocks: [{ title: "Draft", text: "NEW_DRAFT" }] }], trash: [] });
  const nextSource = readOfficeReviewSource(office.read(), "doc1", "v1", "docx", 2);
  assert.deepEqual(nextSource, source);
  const restarted = runtime();
  assert.deepEqual(await restarted.prepareOfficeVersionReview(nextSource, userId, () => {}), duplicate);
  const receipt = await restarted.confirmArtifactReview(first.artifactId, userId, first);
  assert.equal(receipt.sha256, first.sha256);
  let finished: unknown;
  await restarted.exportReviewedArtifact({ writeHead() {}, end(bytes: Buffer) { finished = bytes; } } as unknown as ServerResponse, receipt.reviewId, userId);
  assert.deepEqual(finished, data);
});

test("stale, recycled, trashed, and damaged source versions cannot impersonate an existing candidate", async (t) => {
  const { root, office, runtime, version, document } = fixture(t);
  assert.throws(() => readOfficeReviewSource(office.read(), "doc1", "v1", "docx", 0), isStatus(409));
  assert.throws(() => readOfficeReviewSource(office.read(), "trashed", "v1", "docx", 1), isStatus(404));
  assert.throws(() => readOfficeReviewSource(office.read(), "doc1", "v2", "docx", 1), isStatus(404));
  const source = readOfficeReviewSource(office.read(), "doc1", "v1", "docx", 1);
  const app = runtime();
  const first = await app.prepareOfficeVersionReview(source, userId, () => {});
  const receipt = await app.confirmArtifactReview(first.artifactId, userId, first);
  const artifact = app.snapshot().artifacts[0]!;
  office.save({ expectedRevision: 1, documents: [{ ...document, versions: [{ ...version, blocks: [{ title: "伪同名", text: "REPLACED" }] }] }], trash: [] });
  const recycled = readOfficeReviewSource(office.read(), "doc1", "v1", "docx", 2);
  await assert.rejects(app.prepareOfficeVersionReview(recycled, userId, () => {}), isStatus(409));
  unlinkSync(artifact.file);
  await assert.rejects(app.prepareOfficeVersionReview(source, userId, () => {}), isStatus(409));
  writeFileSync(join(root, "capabilities", "artifacts.json"), "[]");
  await assert.rejects(runtime().prepareOfficeVersionReview(source, userId, () => {}), isStatus(409));
  rmdirSync(dirname(artifact.file));
  const restarted = runtime();
  const recreated = await restarted.prepareOfficeVersionReview(source, userId, () => {});
  assert.notEqual(recreated.artifactId, first.artifactId);
  assert.equal((await restarted.artifactReview(recreated.artifactId, userId)).review, null);
  await assert.rejects(restarted.exportReviewedArtifact({} as ServerResponse, receipt.reviewId, userId), isStatus(404));
});

test("a failed source check or failed index commit cannot leave a partly registered candidate", async (t) => {
  const { root, office, runtime, document, version } = fixture(t);
  const legacy = { id: version.id, name: version.name, blocks: version.blocks };
  office.save({ expectedRevision: 1, documents: [{ ...document, versions: [legacy] }], trash: [] });
  const source = readOfficeReviewSource(office.read(), "doc1", "v1", "docx", 2);
  assert.equal(source.input.name, version.name);
  const app = runtime();
  const capabilityDir = join(root, "capabilities");
  const managed = join(capabilityDir, "artifacts");
  await assert.rejects(app.prepareOfficeVersionReview(source, userId, () => { throw new ArtifactReviewError(409, "source changed"); }), isStatus(409));
  assert.deepEqual(readdirSync(managed), []);
  const index = join(capabilityDir, "artifacts.json");
  mkdirSync(index);
  await assert.rejects(app.prepareOfficeVersionReview(source, userId, () => {}));
  assert.equal(app.snapshot().artifacts.length, 0);
  assert.deepEqual(readdirSync(managed), []);
  assert.equal(readdirSync(capabilityDir).some((name) => /^artifacts\.json\..*\.tmp$/.test(name)), false);
  rmdirSync(index);
  const success = await app.prepareOfficeVersionReview(source, userId, () => {});
  assert.equal(success.reused, false);
  assert.equal(existsSync(index), true);
});

test("strict review export rejects text and table truncation before publishing a candidate", async () => {
  const block = { title: "Title", text: "Body" };
  const strict = { rejectTruncatedContent: true };
  await assert.rejects(exportOfficeDocument({ name: "A", format: "docx", blocks: Array(201).fill(block) }, strict), /200/);
  await assert.rejects(exportOfficeDocument({ name: "A", format: "docx", blocks: [{ ...block, text: "x".repeat(120_001) }] }, strict), /超限/);
  await assert.rejects(exportOfficeDocument({ name: "A", format: "pptx", blocks: Array(51).fill(block) }, strict), /50/);
  await assert.rejects(exportOfficeDocument({ name: "A", format: "pptx", blocks: [{ ...block, text: Array(13).fill("Line").join("\n") }] }, strict), /12/);
  const table = ["|" + Array(41).fill("Cell").join("|") + "|", "|" + Array(41).fill("---").join("|") + "|"].join("\n");
  await assert.rejects(exportOfficeDocument({ name: "A", format: "docx", blocks: [{ ...block, text: table }] }, strict), /40/);
});
