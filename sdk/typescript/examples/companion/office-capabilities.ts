import type { OfficeFileKind } from "./office-file-parser.js";

/**
 * 文件页对每种格式的真实能力。界面只根据这张表显示按钮和说明，
 * 不再按扩展名猜"可编辑"。新增格式必须先在这里写清楚能做什么、不能做什么。
 */
export type FileCapability = "edit" | "annotate" | "view" | "convert" | "unsupported";

export interface OfficeFormatCapability {
  format: OfficeFileKind;
  formatLabel: string;
  capability: FileCapability;
  capabilityLabel: string;
  summary: string;
  /** 文字视图是在编辑文件本身，还是只展示提取出来的文字。 */
  textView: "edit" | "extract";
  /** 文字视图这个标签页显示什么名字。界面不按扩展名自己拼。 */
  textViewLabel: string;
  /**
   * 修改保存到哪里。
   * `original` 写回你打开的那个文件；`copy` 只生成新文件；`none` 不提供保存。
   * 标为"可编辑"不等于能覆盖原文件——两者必须分开说清楚。
   */
  savesTo: "original" | "copy" | "none";
  /** 修改后的文字能否写回打开的那个文件。等价于 savesTo === "original"。 */
  sourceWritable: boolean;
  /**
   * 只能另存为副本：该格式的写入路径不足以安全覆盖原文件。
   * 与 canSaveCopy 是两件事——copyOnly 是限制，canSaveCopy 是提供的选项。
   */
  copyOnly: boolean;
  /** 是否提供"另存为副本"这个选项。 */
  canSaveCopy: boolean;
  /**
   * 打开时是否先转成 Markdown 再处理。
   * 转换过的文档在工作台里是 Markdown，原文件保留、可下载，但不再被写回。
   */
  convertsToMarkdown: boolean;
  limitations: string[];
}

export const OFFICE_CAPABILITY_LABELS: Record<FileCapability, string> = {
  edit: "可编辑",
  annotate: "可批注",
  view: "仅查看",
  convert: "需转换",
  unsupported: "不支持",
};

const CAPABILITIES: Record<OfficeFileKind, OfficeFormatCapability> = {
  txt: {
    format: "txt",
    formatLabel: "纯文本",
    capability: "edit",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.edit,
    summary: "可以直接编辑，并写回你打开的那个文件。",
    textView: "edit",
    textViewLabel: "编辑文本",
    savesTo: "original",
    sourceWritable: true,
    copyOnly: false,
    canSaveCopy: false,
    convertsToMarkdown: false,
    limitations: ["写回时保持原有的编码和换行符。"],
  },
  md: {
    format: "md",
    formatLabel: "Markdown",
    capability: "edit",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.edit,
    summary: "源码与预览双视图，可以直接编辑并写回原文件。",
    textView: "edit",
    textViewLabel: "编辑 Markdown",
    savesTo: "original",
    sourceWritable: true,
    copyOnly: false,
    canSaveCopy: false,
    convertsToMarkdown: false,
    limitations: ["图片按相对路径引用，移动文件后需要自己核对路径。"],
  },
  docx: {
    format: "docx",
    formatLabel: "Word 文档",
    capability: "convert",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.convert,
    summary: "打开后转成 Markdown 处理；原文件保留、可下载，不会被改写。",
    textView: "extract",
    textViewLabel: "原文预览",
    savesTo: "copy",
    sourceWritable: false,
    copyOnly: false,
    canSaveCopy: false,
    convertsToMarkdown: true,
    limitations: [
      "标题层级、段落、列表和表格会转成 Markdown。",
      "字体、字号、颜色、对齐、页眉页脚、批注和修订不在 Markdown 的表达范围内。",
      "图片留位置说明，图片本身仍在原文件里。",
      "每次转换都会列出这一份具体丢了什么。",
    ],
  },
  pptx: {
    format: "pptx",
    formatLabel: "PowerPoint 演示",
    capability: "convert",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.convert,
    summary: "打开后转成 Markdown 处理；原文件保留、可下载，不会被改写。",
    textView: "extract",
    textViewLabel: "原文预览",
    savesTo: "copy",
    sourceWritable: false,
    copyOnly: false,
    canSaveCopy: false,
    convertsToMarkdown: true,
    limitations: [
      "每页文字、表格和讲者备注会转成 Markdown。",
      "版式、母版、主题和动画不在 Markdown 的表达范围内。",
      "图片和图表没有带过来，仍在原文件里。",
      "每次转换都会列出这一份具体丢了什么。",
    ],
  },
  xlsx: {
    format: "xlsx",
    formatLabel: "Excel 表格",
    capability: "convert",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.convert,
    summary: "打开后转成 Markdown 表格处理；原文件保留、可下载，不会被改写。",
    textView: "extract",
    textViewLabel: "原文预览",
    savesTo: "copy",
    sourceWritable: false,
    copyOnly: false,
    canSaveCopy: false,
    convertsToMarkdown: true,
    limitations: [
      "每个工作表转成一个 Markdown 表格，公式只保留计算结果。",
      "单元格样式、条件格式、数据验证和图表没有带过来。",
      "每次转换都会列出这一份具体丢了什么。",
    ],
  },
  pdf: {
    format: "pdf",
    formatLabel: "PDF",
    capability: "convert",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.convert,
    summary: "打开后提取文字转成 Markdown 处理；原文件保留、可下载，不会被改写。",
    textView: "extract",
    textViewLabel: "原文预览",
    savesTo: "copy",
    sourceWritable: false,
    copyOnly: false,
    canSaveCopy: false,
    convertsToMarkdown: true,
    limitations: [
      "只提取文字，版式、图片、表格线和表单都没有带过来。",
      "扫描件没有可提取的文字时会是空白，需要先做 OCR。",
      "每次转换都会列出这一份具体丢了什么。",
    ],
  },
};

export const OFFICE_FORMAT_CAPABILITIES: readonly OfficeFormatCapability[] = Object.freeze(Object.values(CAPABILITIES));

export function officeCapabilityOf(format: string): OfficeFormatCapability | null {
  const normalized = String(format || "").trim().toLowerCase();
  const key = normalized === "markdown" ? "md" : normalized;
  return (CAPABILITIES as Record<string, OfficeFormatCapability>)[key] ?? null;
}

/** 浏览器端读同一份表，避免界面文案和服务端行为各说各话。 */
export function officeCapabilityBrowserScript(): string {
  const payload = JSON.stringify({ capabilities: CAPABILITIES, labels: OFFICE_CAPABILITY_LABELS }).replace(/</g, "\\u003c");
  return `window.ClownfishOfficeCapabilities = Object.freeze(${payload});\n`;
}
