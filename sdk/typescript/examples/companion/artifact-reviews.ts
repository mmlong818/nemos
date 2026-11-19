import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export interface ReviewedPdfIdentity {
  sha256: string;
  byteLength: number;
}

export interface ArtifactReviewReceipt extends ReviewedPdfIdentity {
  reviewId: string;
  artifactId: string;
  format: "pdf";
  reviewedBy: string;
  reviewedAt: string;
}

export class ArtifactReviewError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 422, message: string) {
    super(message);
  }
}

export function validPdfIdentity(identity: ReviewedPdfIdentity): boolean {
  return typeof identity.sha256 === "string" && /^[a-f0-9]{64}$/i.test(identity.sha256)
    && Number.isSafeInteger(identity.byteLength) && identity.byteLength > 0;
}

export function samePdfIdentity(a: ReviewedPdfIdentity, b: ReviewedPdfIdentity): boolean {
  return a.sha256.toLowerCase() === b.sha256.toLowerCase() && a.byteLength === b.byteLength;
}

export class ArtifactReviewStore {
  constructor(private readonly file: string) {}

  findVersion(artifactId: string, reviewedBy: string, identity: ReviewedPdfIdentity): ArtifactReviewReceipt | null {
    return findVersion(this.read(), artifactId, reviewedBy, identity) ?? null;
  }

  get(reviewId: string, reviewedBy: string): ArtifactReviewReceipt | null {
    return this.read().find((item) => item.reviewId === reviewId && item.reviewedBy === reviewedBy) ?? null;
  }

  confirm(artifactId: string, reviewedBy: string, identity: ReviewedPdfIdentity): ArtifactReviewReceipt {
    const receipts = this.read();
    const existing = findVersion(receipts, artifactId, reviewedBy, identity);
    if (existing) return existing;
    const receipt: ArtifactReviewReceipt = {
      reviewId: `artifact-review-${randomUUID()}`,
      artifactId,
      format: "pdf",
      sha256: identity.sha256,
      byteLength: identity.byteLength,
      reviewedBy,
      reviewedAt: new Date().toISOString(),
    };
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify([...receipts, receipt], null, 2), { flag: "wx" });
      renameSync(temporary, this.file);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* The write may not have created it. */ }
      throw error;
    }
    return receipt;
  }

  private read(): ArtifactReviewReceipt[] {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored) || !stored.every(isReceipt)) throw new Error("成果审阅记录无效。");
    return stored;
  }
}

function findVersion(receipts: ArtifactReviewReceipt[], artifactId: string, reviewedBy: string, identity: ReviewedPdfIdentity) {
  return receipts.find((item) => item.artifactId === artifactId && item.reviewedBy === reviewedBy && samePdfIdentity(item, identity));
}

function isReceipt(value: unknown): value is ArtifactReviewReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ArtifactReviewReceipt>;
  return typeof item.reviewId === "string" && /^artifact-review-[0-9a-f-]{36}$/i.test(item.reviewId)
    && typeof item.artifactId === "string" && item.artifactId.length > 0 && item.format === "pdf"
    && typeof item.reviewedBy === "string" && item.reviewedBy.length > 0
    && typeof item.reviewedAt === "string" && Number.isFinite(Date.parse(item.reviewedAt))
    && typeof item.sha256 === "string" && typeof item.byteLength === "number"
    && validPdfIdentity({ sha256: item.sha256, byteLength: item.byteLength });
}
