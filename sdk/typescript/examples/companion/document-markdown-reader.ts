import { formatFromBytes, formatFromExtension, toMarkdownBytes, type ConvertErrorCode, type Format } from "@firecrawl/anydoc";

import { UserFacingError } from "./office-errors.js";

type ConversionError = Error & { code?: ConvertErrorCode };

/**
 * 本地读取多种办公与出版文件，并统一输出 Markdown。
 *
 * 优先按文件内容识别格式，扩展名只在 CSV 等没有文件签名的格式中作为后备。
 * 这样可以避免把改过后缀名的文件交给错误的解析器。
 */
export async function readDocumentAsMarkdown(fileName: string, data: Uint8Array): Promise<string> {
  const extension = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const detected = formatFromBytes(data);
  const fallback = formatFromExtension(extension);
  const format = detected ?? fallback;
  if (!format) throw new UserFacingError("无法识别这个文件格式");

  try {
    // 有签名的格式继续让读取器按内容判断；CSV 等纯文本格式需要显式提示。
    return await toMarkdownBytes(data, detected ? undefined : format as Format);
  } catch (error) {
    throw conversionError(error, format);
  }
}

function conversionError(error: unknown, format: Format): UserFacingError {
  const code = error instanceof Error ? (error as ConversionError).code : undefined;
  if (code === "encrypted") return new UserFacingError("文件已加密或受密码保护，请先解除保护后重试");
  if (code === "resourceLimit") return new UserFacingError("文件结构过于复杂，已停止读取以保护本机资源");
  if (code === "malformed" || code === "missingPart") return new UserFacingError("文件结构不完整或已经损坏，请用原应用重新保存后再试");
  if (code === "unsupported" && format === "pdf") return new UserFacingError("这个 PDF 没有可提取的文字；扫描件需要先做 OCR");
  if (code === "unsupported") return new UserFacingError("这个文件没有可读取的正文，或使用了暂不支持的结构");
  if (code === "io") return new UserFacingError("文件读取失败，请确认文件仍然可用");
  return new UserFacingError("无法读取这个文件，请确认文件没有损坏或加密");
}
