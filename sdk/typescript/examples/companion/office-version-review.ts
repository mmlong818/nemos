import { createHash } from "node:crypto";
import { ArtifactReviewError } from "./artifact-reviews.js";
import type { OfficeExportBlock, OfficeExportInput } from "./office-export.js";
import type { OfficeWorkbenchSnapshot } from "./office-workbench-state.js";

export type OfficeReviewFormat = "docx" | "pptx";

export interface OfficeReviewSource {
  documentId: string;
  versionId: string;
  input: OfficeExportInput & { format: OfficeReviewFormat };
  inputSha256: string;
}

export function readOfficeReviewSource(
  snapshot: OfficeWorkbenchSnapshot,
  documentId: string,
  versionId: string,
  format: OfficeReviewFormat,
  expectedRevision?: number,
): OfficeReviewSource {
  if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) {
    throw new ArtifactReviewError(409, "工作台保存状态已变化，请刷新并重新选择已保存的版本。");
  }
  const document = uniqueRecord(snapshot.documents, documentId);
  const version = document && uniqueRecord(document.versions, versionId);
  if (!version) throw new ArtifactReviewError(404, "找不到已保存的工作台版本。");
  // Older versions recorded their own label but did not save the document title.
  const name = typeof version.documentName === "string" && version.documentName.trim()
    ? version.documentName : version.name;
  if (typeof name !== "string" || !name.trim() || name.length > 120 || !Array.isArray(version.blocks) || !version.blocks.length) {
    throw new ArtifactReviewError(422, "这个已保存版本缺少导出所需的标题或正文。");
  }
  const blocks = version.blocks.map(parseBlock);
  const input = { name, format, blocks };
  return { documentId, versionId, input, inputSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex") };
}

function uniqueRecord(collection: unknown, id: string): Record<string, unknown> | undefined {
  if (!Array.isArray(collection)) return undefined;
  const matching = collection.filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && value.id === id);
  if (matching.length > 1) throw new ArtifactReviewError(409, "已保存版本的编号重复，无法确认来源。");
  return matching[0];
}

function parseBlock(value: unknown): OfficeExportBlock {
  const block = value as Partial<OfficeExportBlock> | null;
  if (!block || typeof block.title !== "string" || typeof block.text !== "string"
      || block.titleAlignment !== undefined && !isAlignment(block.titleAlignment)
      || block.paragraphAlignments !== undefined
         && (!Array.isArray(block.paragraphAlignments) || !block.paragraphAlignments.every(isAlignment))) {
    throw new ArtifactReviewError(422, "已保存版本包含无法安全导出的正文块。");
  }
  const { title, text, titleAlignment, paragraphAlignments } = block;
  return { title, text, titleAlignment, paragraphAlignments };
}

function isAlignment(value: unknown): value is NonNullable<OfficeExportBlock["titleAlignment"]> {
  return value === "left" || value === "center" || value === "right" || value === "justify";
}
