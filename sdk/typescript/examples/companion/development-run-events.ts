export const DEVELOPMENT_RUN_EVENT_TYPES = [
  "queued",
  "context_ready",
  "thinking",
  "reading",
  "tool_call",
  "file_changed",
  "checking",
  "needs_attention",
  "completed",
  "failed",
  "cancelled",
] as const;

export type DevelopmentRunEventType = typeof DEVELOPMENT_RUN_EVENT_TYPES[number];

export interface DevelopmentRunEvent {
  version: 1;
  type: DevelopmentRunEventType;
  label: string;
  at: string;
  progress?: number;
  engine?: string;
  detail?: string;
}

export function createDevelopmentRunEvent(input: {
  type?: DevelopmentRunEventType;
  label: string;
  progress?: number;
  engine?: string;
  detail?: string;
}): DevelopmentRunEvent {
  const label = String(input.label || "正在处理").trim().slice(0, 320) || "正在处理";
  return {
    version: 1,
    type: input.type ?? inferDevelopmentRunEventType(label, input.progress),
    label,
    at: new Date().toISOString(),
    progress: Number.isFinite(input.progress) ? Math.max(0, Math.min(100, Number(input.progress))) : undefined,
    engine: clean(input.engine, 40),
    detail: clean(input.detail, 1_000),
  };
}

export function inferDevelopmentRunEventType(label: string, progress?: number): DevelopmentRunEventType {
  if (/取消|停止/.test(label)) return "cancelled";
  if (/失败|错误|冲突|未完成/.test(label)) return "failed";
  if (/批准|确认|需要你|等待用户|待确认/.test(label)) return "needs_attention";
  if (/检查|测试|构建|验证|核对/.test(label)) return "checking";
  if (/修改|写入|创建文件|收集修改/.test(label)) return "file_changed";
  if (/读取|分析项目|查看|扫描|上下文/.test(label)) return "reading";
  if (/工具|执行命令|安装依赖/.test(label)) return "tool_call";
  if (/完成|已保存|已生成/.test(label) || Number(progress) >= 100) return "completed";
  if (/排队|等待开始/.test(label)) return "queued";
  return "thinking";
}

export function developmentRunEventFromUnknown(value: unknown): DevelopmentRunEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = DEVELOPMENT_RUN_EVENT_TYPES.includes(record.type as DevelopmentRunEventType)
    ? record.type as DevelopmentRunEventType
    : undefined;
  const label = clean(record.label, 320);
  if (!type || !label) return undefined;
  return {
    version: 1,
    type,
    label,
    at: clean(record.at, 80) || new Date().toISOString(),
    progress: Number.isFinite(record.progress) ? Math.max(0, Math.min(100, Number(record.progress))) : undefined,
    engine: clean(record.engine, 40),
    detail: clean(record.detail, 1_000),
  };
}

function clean(value: unknown, max: number): string | undefined {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : undefined;
}
