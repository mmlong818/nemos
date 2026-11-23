import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ArtifactReviewError } from "../../examples/companion/artifact-reviews.js";
import { CapabilityRuntime, withArtifactProof, type CapabilityArtifact } from "../../examples/companion/capabilities.js";
import { exportOfficeDocument } from "../../examples/companion/office-export.js";

const reviewer = "local-user";

function runtimeAt(dataDir: string) {
  return new CapabilityRuntime({ dataDir, personas: () => [], notify: async () => assert.fail("审阅不能调用模型") });
}

async function captureFile(write: (response: ServerResponse) => Promise<void>) {
  let status: number | undefined;
  let headers: OutgoingHttpHeaders | undefined;
  let data: Buffer | undefined;
  await write({
    writeHead(code: number, supplied: OutgoingHttpHeaders) { status = code; headers = supplied; },
    end(content: Buffer) { data = content; },
  } as unknown as ServerResponse);
  return { status, headers, data };
}

async function assertStatus(write: () => Promise<unknown>, status: number) {
  await assert.rejects(write, (error: unknown) => error instanceof ArtifactReviewError && error.status === status);
}

async function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "nemos-artifact-review-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const capabilityDir = join(dir, "capabilities");
  const managed = join(capabilityDir, "artifacts");
  mkdirSync(managed, { recursive: true });
  const historyFile = join(capabilityDir, "artifact-reviews.json");
  const index = join(capabilityDir, "artifacts.json");
  const first = (await exportOfficeDocument({ name: "First version", format: "pdf", blocks: [{ title: "Version A", text: "Contents of version A" }] })).data;
  const second = (await exportOfficeDocument({ name: "Second version", format: "pdf", blocks: [{ title: "Version B", text: "Contents of version B" }] })).data;
  const previewFile = join(managed, "preview.html");
  writeFileSync(previewFile, "<p>Independent preview</p>");
  const save = (id: string, file: string, content: Buffer, version: number, format: CapabilityArtifact["format"] = "pdf") => {
    writeFileSync(file, content);
    return withArtifactProof({
      id, taskId: "same-task", personaId: "clownfish", capabilityId: "document-draft",
      title: "Same title", format, file, previewFile, summary: "A summary",
      createdAt: "2026-11-19T00:00:00.000Z", metadata: { native: true, lineage: { version } },
    });
  };
  const a = save("pdf-a", join(managed, "approved-a.pdf"), first, 1);
  const b = save("pdf-b", join(managed, "draft-b.pdf"), second, 2);
  a.proof!.level = "approved"; // Legacy status alone cannot authorize this export.
  const writeIndex = (artifacts: CapabilityArtifact[]) => writeFileSync(index, JSON.stringify(artifacts));
  writeIndex([a, b]);
  return { dir, managed, historyFile, first, second, a, b, save, writeIndex };
}

test("PDF preview and approved export use the exact fingerprinted file; approval is explicit, idempotent, and scoped", async (t) => {
  const { dir, historyFile, first, a, b } = await fixture(t);
  const runtime = runtimeAt(dir);
  const meta = await runtime.artifactReview(a.id, reviewer);
  assert.deepEqual(meta, {
    artifactId: a.id, title: a.title, createdAt: a.createdAt, filename: "approved-a.pdf",
    version: 1, format: "pdf", sha256: createHash("sha256").update(first).digest("hex"),
    byteLength: first.length, review: null,
  });
  const fingerprint = { sha256: meta.sha256, byteLength: meta.byteLength }; // Legacy PDF API omits format.
  const preview = await captureFile((response) => runtime.previewArtifactReview(response, a.id, fingerprint));
  assert.match(String(preview.headers?.["Content-Disposition"]), /^inline;/);
  assert.equal(preview.headers?.["Content-Type"], "application/pdf");
  assert.deepEqual(preview.data, first);
  assert.equal(existsSync(historyFile), false);

  const review = await runtime.confirmArtifactReview(a.id, reviewer, fingerprint);
  const stored = readFileSync(historyFile);
  assert.equal(review.artifactId, a.id);
  assert.equal(review.reviewedBy, reviewer);
  assert.ok(Number.isFinite(Date.parse(review.reviewedAt)));
  assert.deepEqual(await runtime.confirmArtifactReview(a.id, reviewer, fingerprint), review);
  assert.deepEqual(readFileSync(historyFile), stored);
  assert.equal((await runtime.artifactReview(b.id, reviewer)).review, null);
  assert.equal((await runtime.artifactReview(a.id, "different-user")).review, null);
  await assertStatus(() => runtime.confirmArtifactReview(b.id, reviewer, meta), 409);
  await assertStatus(() => runtime.exportReviewedArtifact({} as ServerResponse, review.reviewId, "different-user"), 404);
  await assertStatus(() => runtime.exportReviewedArtifact({} as ServerResponse, a.id, reviewer), 404);

  runtime.updateArtifactWorkspace({ id: a.id, action: "save", current: { body: "New working notes", status: "review" } });
  assert.deepEqual(readFileSync(historyFile), stored);
  const restarted = runtimeAt(dir);
  assert.deepEqual((await restarted.artifactReview(a.id, reviewer)).review, review);
  const download = await captureFile((response) => restarted.exportReviewedArtifact(response, review.reviewId, reviewer));
  assert.equal(download.status, 200);
  assert.equal(download.headers?.["Cache-Control"], "no-store");
  assert.match(String(download.headers?.["Content-Disposition"]), /^attachment;.*approved-a\.pdf/);
  assert.equal(download.headers?.["Content-Length"], first.length);
  assert.deepEqual(download.data, preview.data);
});

test("changed, missing, or unsupported files never produce an approved download", async (t) => {
  const { dir, managed, a, b, second, save, writeIndex } = await fixture(t);
  const runtime = runtimeAt(dir);
  const meta = await runtime.artifactReview(a.id, reviewer);
  writeFileSync(a.file, second);
  await assertStatus(() => runtime.previewArtifactReview({} as ServerResponse, a.id, meta), 409);
  await assertStatus(() => runtime.confirmArtifactReview(a.id, reviewer, meta), 409);

  const metaB = await runtime.artifactReview(b.id, reviewer);
  const receipt = await runtime.confirmArtifactReview(b.id, reviewer, metaB);
  const changed = save(b.id, b.file, Buffer.concat([second, Buffer.from("\n% changed\n")]), 2);
  const noProof = { ...changed, id: "legacy", proof: undefined };
  const pdfNameOnly = save("invalid-pdf", join(managed, "invalid.pdf"), Buffer.from("not PDF"), 1);
  const otherFormat = save("other-format", join(managed, "other.md"), second, 1, "md");
  writeIndex([a, changed, noProof, pdfNameOnly, otherFormat]);
  const restarted = runtimeAt(dir);
  assert.equal((await restarted.artifactReview(b.id, reviewer)).review, null);
  await assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, receipt.reviewId, reviewer), 409);
  await assertStatus(() => restarted.artifactReview(noProof.id, reviewer), 422);
  await assertStatus(() => restarted.artifactReview(pdfNameOnly.id, reviewer), 422);
  await assertStatus(() => restarted.artifactReview(otherFormat.id, reviewer), 422);

  const newReview = await restarted.confirmArtifactReview(b.id, reviewer, await restarted.artifactReview(b.id, reviewer));
  assert.notEqual(newReview.reviewId, receipt.reviewId);
  unlinkSync(changed.file);
  await assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, newReview.reviewId, reviewer), 409);
  writeIndex([a]);
  await assertStatus(() => runtimeAt(dir).exportReviewedArtifact({} as ServerResponse, newReview.reviewId, reviewer), 404);
});

test("DOCX review persists the exact managed original, preserving earlier PDF receipts", async (t) => {
  const { dir, managed, a: pdf, historyFile, save, writeIndex } = await fixture(t);
  const first = await exportOfficeDocument({ name: "Same title", format: "docx", blocks: [{ title: "Version A", text: "Approved Word content" }] });
  const second = await exportOfficeDocument({ name: "Same title", format: "docx", blocks: [{ title: "Version B", text: "Different Word content" }] });
  const invalid = save("invalid-docx", join(managed, "invalid.docx"), Buffer.from("invalid OOXML"), 1, "doc");
  const docA = save("docx-a", join(managed, "a.docx"), first.data, 1, "doc");
  const docB = save("docx-b", join(managed, "b.docx"), second.data, 2, "doc");
  const docWithoutProof = { ...docA, id: "docx-legacy", proof: undefined };
  docB.proof!.level = "approved";
  writeIndex([pdf, docA, docB, invalid, docWithoutProof]);
  const runtime = runtimeAt(dir);
  const pdfMeta = await runtime.artifactReview(pdf.id, reviewer);
  const pdfReceipt = await runtime.confirmArtifactReview(pdf.id, reviewer, { sha256: pdfMeta.sha256, byteLength: pdfMeta.byteLength });
  const storedPdfOnly = readFileSync(historyFile);

  const meta = await runtime.artifactReview(docA.id, reviewer);
  assert.equal(meta.format, "docx");
  assert.equal(meta.version, 1);
  assert.equal(meta.review, null);
  const preview = await captureFile((response) => runtime.previewArtifactReview(response, docA.id, meta));
  assert.equal(preview.headers?.["Content-Type"], first.contentType);
  assert.match(String(preview.headers?.["Content-Disposition"]), /^inline;.*a\.docx/);
  assert.deepEqual(preview.data, first.data);
  assert.deepEqual(readFileSync(historyFile), storedPdfOnly);
  await assertStatus(() => runtime.confirmArtifactReview(docB.id, reviewer, meta), 409);
  await assertStatus(() => runtime.confirmArtifactReview(docA.id, reviewer, { ...meta, format: "pdf" }), 409);
  await assertStatus(() => runtime.artifactReview(invalid.id, reviewer), 422);
  await assertStatus(() => runtime.artifactReview(docWithoutProof.id, reviewer), 422);

  const [review, repeated] = await Promise.all([runtime.confirmArtifactReview(docA.id, reviewer, meta), runtime.confirmArtifactReview(docA.id, reviewer, meta)]);
  assert.deepEqual(repeated, review);
  assert.equal(review.format, "docx");
  assert.equal(review.sha256, createHash("sha256").update(first.data).digest("hex"));
  assert.equal(review.byteLength, first.data.length);
  assert.equal((await runtime.artifactReview(docB.id, reviewer)).review, null);
  await assertStatus(() => runtime.exportReviewedArtifact({} as ServerResponse, review.reviewId, "different-user"), 404);

  const restarted = runtimeAt(dir);
  assert.deepEqual((await restarted.artifactReview(pdf.id, reviewer)).review, pdfReceipt);
  assert.deepEqual((await restarted.artifactReview(docA.id, reviewer)).review, review);
  const downloaded = await captureFile((response) => restarted.exportReviewedArtifact(response, review.reviewId, reviewer));
  assert.equal(downloaded.headers?.["Content-Type"], first.contentType);
  assert.match(String(downloaded.headers?.["Content-Disposition"]), /^attachment;.*a\.docx/);
  assert.deepEqual(downloaded.data, preview.data);

  const modified = Buffer.from(first.data);
  modified[modified.length - 1] ^= 1;
  writeFileSync(docA.file, modified);
  await assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, review.reviewId, reviewer), 409);
  unlinkSync(docA.file);
  await assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, review.reviewId, reviewer), 409);
});

test("PPTX review requires both the source file and its exact persisted PDF preview", async (t) => {
  const { dir, managed, historyFile, save, writeIndex } = await fixture(t);
  const blocks = [{ title: "First slide", text: "One complete page" }];
  const original = await exportOfficeDocument({ name: "Same title", format: "pptx", blocks });
  // This fixture exercises persisted preview attribution and bypasses the platform renderer.
  // Real PowerPoint-to-PDF fidelity is covered by the independent Windows loopback check.
  const previewBytes = (await exportOfficeDocument({ name: "Same title", format: "pdf", blocks })).data;
  const deck = save("pptx-a", join(managed, "reviewed.pptx"), original.data, 1, "pptx");
  writeIndex([deck]);
  const runtime = runtimeAt(dir);
  const meta = await runtime.artifactReview(deck.id, reviewer);
  assert.equal(meta.format, "pptx");
  assert.equal(meta.preview, null);
  assert.equal(meta.review, null);
  await assertStatus(() => runtime.confirmArtifactReview(deck.id, reviewer, meta), 409);
  assert.equal(existsSync(historyFile), false);

  const source = { format: meta.format, sha256: meta.sha256, byteLength: meta.byteLength };
  const preview = { sha256: createHash("sha256").update(previewBytes).digest("hex"), byteLength: previewBytes.length, pages: 1 };
  const key = createHash("sha256").update(JSON.stringify([deck.id, source.format, source.sha256, source.byteLength])).digest("hex");
  const previews = join(dir, "capabilities", "artifact-review-previews");
  mkdirSync(previews);
  writeFileSync(join(previews, key + ".json"), JSON.stringify({ artifactId: deck.id, source, ...preview }));
  const previewFile = join(previews, key + ".pdf");
  writeFileSync(previewFile, previewBytes);
  const expected = { ...source, previewSha256: preview.sha256, previewByteLength: preview.byteLength };

  assert.deepEqual((await runtime.artifactReview(deck.id, reviewer)).preview, preview);
  await assertStatus(() => runtime.confirmArtifactReview(deck.id, reviewer, { ...expected, previewSha256: "a".repeat(64) }), 409);
  const frame = await captureFile((response) => runtime.previewArtifactReview(response, deck.id, expected));
  assert.equal(frame.headers?.["Content-Type"], "application/pdf");
  assert.deepEqual(frame.data, previewBytes);
  const review = await runtime.confirmArtifactReview(deck.id, reviewer, expected);
  assert.deepEqual(review.preview, preview);
  const restarted = runtimeAt(dir);
  const download = await captureFile((response) => restarted.exportReviewedArtifact(response, review.reviewId, reviewer));
  assert.equal(download.headers?.["Content-Type"], original.contentType);
  assert.match(String(download.headers?.["Content-Disposition"]), /^attachment;.*reviewed\.pptx/);
  assert.deepEqual(download.data, original.data);

  const corruptPreview = Buffer.from(previewBytes);
  corruptPreview[corruptPreview.length - 1] ^= 1;
  writeFileSync(previewFile, corruptPreview);
  await assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, review.reviewId, reviewer), 409);
  unlinkSync(previewFile);
  await assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, review.reviewId, reviewer), 409);

  writeFileSync(previewFile, previewBytes);
  restarted.deleteTaskData([deck.taskId], { keepFiles: true });
  assert.equal(existsSync(previewFile), true);
  assert.deepEqual((await captureFile((response) => restarted.exportReviewedArtifact(response, review.reviewId, reviewer))).data, original.data);
  assert.equal(restarted.deleteRetainedArtifact(deck.id), true);
  assert.equal(existsSync(previewFile), false);
  assert.equal(existsSync(join(previews, key + ".json")), false);
  await assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, review.reviewId, reviewer), 404);
});
