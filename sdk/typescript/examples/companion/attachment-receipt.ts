/**
 * 附件回执：把附件的名称、类型、行数、字数和是否完整写进交接文本，并要求模型先复述。
 *
 * 大输入最常见的静默失败是截断：附件超过上限被截到前 12 万字，模型基于半份材料作答，
 * 用户看不出来。回执让"收到了什么"成为可核对的事实——模型复述的行数与真实行数不一致，
 * 用户一眼就能发现。
 */
export interface AttachmentReceiptInput {
  name: string;
  kind: string;
  /** 实际交给模型的文本（已截断则是截断后的）。 */
  text: string;
  truncated?: boolean;
  /** 原始大小（字节或字符，能拿到哪个就给哪个），只用于说明截断了多少。 */
  originalSize?: number;
}

export interface AttachmentMeasure {
  lines: number;
  chars: number;
}

export function measureAttachment(text: string): AttachmentMeasure {
  const trimmed = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!trimmed) return { lines: 0, chars: 0 };
  return { lines: trimmed.split("\n").length, chars: trimmed.length };
}

const formatNumber = (value: number): string => value.toLocaleString("zh-CN");

export function attachmentReceiptLine(input: AttachmentReceiptInput): string {
  const { lines, chars } = measureAttachment(input.text);
  const completeness = input.truncated
    ? `已截断，仅含前 ${formatNumber(chars)} 字${input.originalSize && input.originalSize > chars ? `（原文约 ${formatNumber(input.originalSize)}）` : ""}`
    : "完整";
  return `附件回执：${input.name}（${input.kind}）· ${formatNumber(lines)} 行 · ${formatNumber(chars)} 字 · ${completeness}`;
}

/** 放在附件正文之前的一条规则；与回执行配对使用。 */
export const ATTACHMENT_RECEIPT_RULE = "回答的第一句先复述收到的附件名、行数和是否完整；如果你实际看到的内容与回执不符（例如明显不完整或格式异常），先指出再继续。";
