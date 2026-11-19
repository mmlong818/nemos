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

function capturePdf(write: (response: ServerResponse) => void) {
  let status: number | undefined;
  let headers: OutgoingHttpHeaders | undefined;
  let data: Buffer | undefined;
  write({
    writeHead(code: number, supplied: OutgoingHttpHeaders) { status = code; headers = supplied; },
    end(content: Buffer) { data = content; },
  } as unknown as ServerResponse);
  return { status, headers, data };
}

function assertStatus(write: () => unknown, status: number) {
  assert.throws(write, (error: unknown) => error instanceof ArtifactReviewError && error.status === status);
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
  const meta = runtime.artifactReview(a.id, reviewer);
  assert.deepEqual(meta, {
    artifactId: a.id, title: a.title, createdAt: a.createdAt, filename: "approved-a.pdf",
    version: 1, format: "pdf", sha256: createHash("sha256").update(first).digest("hex"),
    byteLength: first.length, review: null,
  });
  const preview = capturePdf((response) => runtime.previewArtifactReview(response, a.id, meta));
  assert.match(String(preview.headers?.["Content-Disposition"]), /^inline;/);
  assert.equal(preview.headers?.["Content-Type"], "application/pdf");
  assert.deepEqual(preview.data, first);
  assert.equal(existsSync(historyFile), false);

  const review = runtime.confirmArtifactReview(a.id, reviewer, meta);
  const stored = readFileSync(historyFile);
  assert.equal(review.artifactId, a.id);
  assert.equal(review.reviewedBy, reviewer);
  assert.ok(Number.isFinite(Date.parse(review.reviewedAt)));
  assert.deepEqual(runtime.confirmArtifactReview(a.id, reviewer, meta), review);
  assert.deepEqual(readFileSync(historyFile), stored);
  assert.equal(runtime.artifactReview(b.id, reviewer).review, null);
  assert.equal(runtime.artifactReview(a.id, "different-user").review, null);
  assertStatus(() => runtime.confirmArtifactReview(b.id, reviewer, meta), 409);
  assertStatus(() => runtime.exportReviewedArtifact({} as ServerResponse, review.reviewId, "different-user"), 404);
  assertStatus(() => runtime.exportReviewedArtifact({} as ServerResponse, a.id, reviewer), 404);

  runtime.updateArtifactWorkspace({ id: a.id, action: "save", current: { body: "New working notes", status: "review" } });
  assert.deepEqual(readFileSync(historyFile), stored);
  const restarted = runtimeAt(dir);
  assert.deepEqual(restarted.artifactReview(a.id, reviewer).review, review);
  const download = capturePdf((response) => restarted.exportReviewedArtifact(response, review.reviewId, reviewer));
  assert.equal(download.status, 200);
  assert.equal(download.headers?.["Cache-Control"], "no-store");
  assert.match(String(download.headers?.["Content-Disposition"]), /^attachment;.*approved-a\.pdf/);
  assert.equal(download.headers?.["Content-Length"], first.length);
  assert.deepEqual(download.data, preview.data);
});

test("changed, missing, or unsupported files never produce an approved download", async (t) => {
  const { dir, managed, a, b, second, save, writeIndex } = await fixture(t);
  const runtime = runtimeAt(dir);
  const meta = runtime.artifactReview(a.id, reviewer);
  writeFileSync(a.file, second);
  assertStatus(() => runtime.previewArtifactReview({} as ServerResponse, a.id, meta), 409);
  assertStatus(() => runtime.confirmArtifactReview(a.id, reviewer, meta), 409);

  const metaB = runtime.artifactReview(b.id, reviewer);
  const receipt = runtime.confirmArtifactReview(b.id, reviewer, metaB);
  const changed = save(b.id, b.file, Buffer.concat([second, Buffer.from("\n% changed\n")]), 2);
  const noProof = { ...changed, id: "legacy", proof: undefined };
  const pdfNameOnly = save("invalid-pdf", join(managed, "invalid.pdf"), Buffer.from("not PDF"), 1);
  const otherFormat = save("other-format", join(managed, "other.md"), second, 1, "md");
  writeIndex([a, changed, noProof, pdfNameOnly, otherFormat]);
  const restarted = runtimeAt(dir);
  assert.equal(restarted.artifactReview(b.id, reviewer).review, null);
  assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, receipt.reviewId, reviewer), 409);
  assertStatus(() => restarted.artifactReview(noProof.id, reviewer), 422);
  assertStatus(() => restarted.artifactReview(pdfNameOnly.id, reviewer), 422);
  assertStatus(() => restarted.artifactReview(otherFormat.id, reviewer), 422);

  const newReview = restarted.confirmArtifactReview(b.id, reviewer, restarted.artifactReview(b.id, reviewer));
  assert.notEqual(newReview.reviewId, receipt.reviewId);
  unlinkSync(changed.file);
  assertStatus(() => restarted.exportReviewedArtifact({} as ServerResponse, newReview.reviewId, reviewer), 409);
  writeIndex([a]);
  assertStatus(() => runtimeAt(dir).exportReviewedArtifact({} as ServerResponse, newReview.reviewId, reviewer), 404);
});
