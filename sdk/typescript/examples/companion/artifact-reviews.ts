import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export type ReviewedArtifactFormat = "pdf" | "docx" | "pptx";

export interface ArtifactFingerprint {
  sha256: string;
  byteLength: number;
}

export interface ArtifactPreviewIdentity extends ArtifactFingerprint {
  pages: number;
}

export interface ReviewedArtifactIdentity extends ArtifactFingerprint {
  format: ReviewedArtifactFormat;
}

export interface ExpectedArtifactIdentity extends ArtifactFingerprint {
  // The original PDF client did not send a format. An omitted format still means PDF.
  format?: string;
  previewSha256?: string;
  previewByteLength?: number;
}

export interface ArtifactReviewReceipt extends ReviewedArtifactIdentity {
  reviewId: string;
  artifactId: string;
  reviewedBy: string;
  reviewedAt: string;
  preview?: ArtifactPreviewIdentity;
}

export class ArtifactReviewError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 422, message: string) {
    super(message);
  }
}

export function validArtifactFingerprint(identity: ArtifactFingerprint): boolean {
  return typeof identity.sha256 === "string" && /^[a-f0-9]{64}$/i.test(identity.sha256)
    && Number.isSafeInteger(identity.byteLength) && identity.byteLength > 0;
}

export function isReviewedArtifactFormat(format: unknown): format is ReviewedArtifactFormat {
  return format === "pdf" || format === "docx" || format === "pptx";
}

export function sameArtifactIdentity(a: ReviewedArtifactIdentity, b: ReviewedArtifactIdentity): boolean {
  return a.format === b.format && sameArtifactFingerprint(a, b);
}

export function sameArtifactFingerprint(a: ArtifactFingerprint, b: ArtifactFingerprint): boolean {
  return a.sha256.toLowerCase() === b.sha256.toLowerCase() && a.byteLength === b.byteLength;
}

function samePreview(a: ArtifactPreviewIdentity | undefined, b: ArtifactPreviewIdentity | undefined): boolean {
  return a && b ? sameArtifactFingerprint(a, b) && a.pages === b.pages : !a && !b;
}

export class ArtifactReviewStore {
  constructor(private readonly file: string) {}

  findVersion(artifactId: string, reviewedBy: string, identity: ReviewedArtifactIdentity, preview?: ArtifactPreviewIdentity): ArtifactReviewReceipt | null {
    return findVersion(this.read(), artifactId, reviewedBy, identity, preview) ?? null;
  }

  get(reviewId: string, reviewedBy: string): ArtifactReviewReceipt | null {
    return this.read().find((item) => item.reviewId === reviewId && item.reviewedBy === reviewedBy) ?? null;
  }

  confirm(artifactId: string, reviewedBy: string, identity: ReviewedArtifactIdentity, preview?: ArtifactPreviewIdentity): ArtifactReviewReceipt {
    if ((identity.format === "pptx") !== !!preview) throw new ArtifactReviewError(409, "没有可绑定此文件的审阅预览。");
    const receipts = this.read();
    const existing = findVersion(receipts, artifactId, reviewedBy, identity, preview);
    if (existing) return existing;
    const receipt: ArtifactReviewReceipt = {
      reviewId: `artifact-review-${randomUUID()}`,
      artifactId,
      format: identity.format,
      sha256: identity.sha256,
      byteLength: identity.byteLength,
      reviewedBy,
      reviewedAt: new Date().toISOString(),
      ...(preview ? { preview } : {}),
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

function findVersion(receipts: ArtifactReviewReceipt[], artifactId: string, reviewedBy: string, identity: ReviewedArtifactIdentity, preview?: ArtifactPreviewIdentity) {
  return receipts.find((item) => item.artifactId === artifactId && item.reviewedBy === reviewedBy && sameArtifactIdentity(item, identity) && samePreview(item.preview, preview));
}

function isReceipt(value: unknown): value is ArtifactReviewReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ArtifactReviewReceipt>;
  return typeof item.reviewId === "string" && /^artifact-review-[0-9a-f-]{36}$/i.test(item.reviewId)
    && typeof item.artifactId === "string" && item.artifactId.length > 0 && isReviewedArtifactFormat(item.format)
    && typeof item.reviewedBy === "string" && item.reviewedBy.length > 0
    && typeof item.reviewedAt === "string" && Number.isFinite(Date.parse(item.reviewedAt))
    && typeof item.sha256 === "string" && typeof item.byteLength === "number"
    && validArtifactFingerprint({ sha256: item.sha256, byteLength: item.byteLength })
    && (item.format === "pptx" ? !!item.preview && validArtifactFingerprint(item.preview)
      && Number.isSafeInteger(item.preview.pages) && item.preview.pages > 0 : item.preview === undefined);
}
