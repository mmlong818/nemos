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
  /** 修改后的文字能否写回打开的那个文件。 */
  sourceWritable: boolean;
  /** 结构化写入只允许生成另一个文件，不覆盖打开的文件。 */
  copyOnly: boolean;
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
    sourceWritable: true,
    copyOnly: false,
    limitations: ["写回时保持原有的编码和换行符。"],
  },
  md: {
    format: "md",
    formatLabel: "Markdown",
    capability: "edit",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.edit,
    summary: "源码与预览双视图，可以直接编辑并写回原文件。",
    textView: "edit",
    sourceWritable: true,
    copyOnly: false,
    limitations: ["图片按相对路径引用，移动文件后需要自己核对路径。"],
  },
  docx: {
    format: "docx",
    formatLabel: "Word 文档",
    capability: "view",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.view,
    summary: "保留原版式查看；文字可以提取和修改，但只能另存为副本，不覆盖原文件。",
    textView: "extract",
    sourceWritable: false,
    copyOnly: true,
    limitations: [
      "被改动的段落，其内部的加粗、字号、颜色等行内格式会合并成该段落的统一格式。",
      "页眉页脚、脚注尾注、批注和修订不在可修改范围内。",
      "图片、图表、公式和形状会原样保留，但无法在这里编辑。",
      "新增的段落使用正文样式。",
    ],
  },
  pptx: {
    format: "pptx",
    formatLabel: "PowerPoint 演示",
    capability: "view",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.view,
    summary: "逐页查看文字；文字可以提取和修改，但只能另存为副本，不覆盖原文件。",
    textView: "extract",
    sourceWritable: false,
    copyOnly: true,
    limitations: [
      "每页文字按出现顺序整体替换，原有的分行、占位符归属和行内格式会被合并。",
      "无法增删页面、移动元素，也无法修改版式与母版。",
      "图片、图表、形状和动画会原样保留，但无法在这里编辑。",
    ],
  },
  xlsx: {
    format: "xlsx",
    formatLabel: "Excel 表格",
    capability: "view",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.view,
    summary: "按工作表查看单元格；可以按地址改值和公式，但只能另存为副本，不覆盖原文件。",
    textView: "extract",
    sourceWritable: false,
    copyOnly: true,
    limitations: [
      "只写入单元格的值和公式，不改动样式、条件格式和数据验证。",
      "写入公式后不重新计算，数值需要在 Excel 中打开后刷新。",
      "无法增删工作表，也无法修改图表和透视表。",
      "新增的单元格使用工作簿默认样式。",
    ],
  },
  pdf: {
    format: "pdf",
    formatLabel: "PDF",
    capability: "view",
    capabilityLabel: OFFICE_CAPABILITY_LABELS.view,
    summary: "保留原版式查看并提取文字；不提供批注和内容编辑。",
    textView: "extract",
    sourceWritable: false,
    copyOnly: false,
    limitations: [
      "提取出来的文字不能写回 PDF。",
      "不提供高亮、批注、签名、表单填写和页面增删。",
      "扫描件需要先做 OCR，当前没有提供。",
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
