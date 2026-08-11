import { createHash, randomUUID } from "node:crypto";

export type CapabilityHandoffSource = "chat" | "capability" | "office";

export interface CapabilityHandoffMessage {
  sourceMessageId: string;
  role: "user" | "assistant" | "system";
  speakerId: string;
  subjectId: string;
  speaker: string;
  text: string;
}

export interface CapabilityHandoffMaterial {
  name: string;
  text: string;
  byteLength: number;
  contentHash: string;
  fileRecordId?: string;
  artifactId?: string;
}

export interface CapabilityHandoffEnvelope {
  version: 1;
  id: string;
  source: CapabilityHandoffSource;
  createdAt: string;
  sourceConversationKey?: string;
  sourceJobId?: string;
  sourceCapabilityId?: string;
  targetCapabilityId: string;
  goal: string;
  summary: string;
  conversation: CapabilityHandoffMessage[];
  materials: CapabilityHandoffMaterial[];
  decisions: string[];
  constraints: string[];
  unresolved: string[];
  chain: string[];
  baseRevision: string;
  contentHash: string;
}

export interface CapabilityHandoffReceipt {
  envelopeId: string;
  contentHash: string;
  status: "received" | "returned" | "failed";
  receivedAt: string;
  returnedAt?: string;
  /** 失败落点时间；与 returnedAt 互斥，failed 回执不得带交付时间。 */
  failedAt?: string;
  targetCapabilityId: string;
  resultArtifactId?: string;
  error?: string;
  /** 失败原因分类，决定「能不能重试」而不是让调用方猜错误文本。 */
  failureKind?: CapabilityHandoffFailureKind;
  retryable?: boolean;
}

/**
 * 交接失败的类型。
 * - execution：接收能力跑了但没跑成
 * - timeout：超时，动作可能已部分执行
 * - missing-capability：目标能力不存在或已下线
 * - rejected：接收方拒绝接手（权限、边界或输入不合约）
 */
export type CapabilityHandoffFailureKind = "execution" | "timeout" | "missing-capability" | "rejected";

/** 只有这些失败值得重试；missing-capability 和 rejected 重试多少次都一样。 */
const RETRYABLE_FAILURES = new Set<CapabilityHandoffFailureKind>(["execution", "timeout"]);

/** 交接是否已经真正交付。用它判断「完成」，不要直接看 status 字符串。 */
export function isCapabilityHandoffDelivered(receipt: CapabilityHandoffReceipt | undefined): boolean {
  return receipt?.status === "returned" && !!receipt.resultArtifactId;
}

export interface CapabilityHandoffInput {
  source?: unknown;
  sourceConversationKey?: unknown;
  sourceJobId?: unknown;
  sourceCapabilityId?: unknown;
  goal?: unknown;
  summary?: unknown;
  conversation?: unknown;
  materials?: unknown;
  decisions?: unknown;
  constraints?: unknown;
  unresolved?: unknown;
  chain?: unknown;
}

export function createCapabilityHandoffEnvelope(
  input: CapabilityHandoffInput,
  targetCapabilityId: string,
  now = new Date(),
): CapabilityHandoffEnvelope | undefined {
  const target = boundedText(targetCapabilityId, 120);
  if (!target) return undefined;
  const source: CapabilityHandoffSource = input.source === "capability" ? "capability" : input.source === "office" ? "office" : "chat";
  const conversation = normalizeMessages(input.conversation);
  const materials = normalizeMaterials(input.materials);
  const goal = boundedText(input.goal, 4_000);
  const summary = boundedText(input.summary, 24_000);
  const sourceJobId = boundedText(input.sourceJobId, 120) || undefined;
  if (!goal && !summary && conversation.length === 0 && materials.length === 0 && !sourceJobId) return undefined;
  const chain = stringList(input.chain, 12, 120);
  const identity = {
    source,
    sourceConversationKey: safeConversationKey(input.sourceConversationKey),
    sourceJobId,
    sourceCapabilityId: boundedText(input.sourceCapabilityId, 120) || undefined,
    targetCapabilityId: target,
    goal,
    summary,
    conversation,
    materials,
    decisions: stringList(input.decisions, 40, 1_000),
    constraints: stringList(input.constraints, 40, 1_000),
    unresolved: stringList(input.unresolved, 40, 1_000),
    chain,
  };
  const baseRevision = digest({
    source: identity.source,
    sourceConversationKey: identity.sourceConversationKey,
    sourceJobId: identity.sourceJobId,
    messageIds: conversation.map((item) => item.sourceMessageId),
    materialHashes: materials.map((item) => item.contentHash),
  });
  return {
    version: 1,
    id: `handoff-${randomUUID()}`,
    createdAt: now.toISOString(),
    ...identity,
    baseRevision,
    contentHash: digest({ ...identity, baseRevision }),
  };
}

export function receiveCapabilityHandoff(
  envelope: CapabilityHandoffEnvelope,
  now = new Date(),
): CapabilityHandoffReceipt {
  return {
    envelopeId: envelope.id,
    contentHash: envelope.contentHash,
    status: "received",
    receivedAt: now.toISOString(),
    targetCapabilityId: envelope.targetCapabilityId,
  };
}

export function renderCapabilityHandoffContext(envelope: CapabilityHandoffEnvelope): string {
  const sections: string[] = [];
  if (envelope.summary) sections.push(`【上下文提要】\n${envelope.summary}`);
  if (envelope.conversation.length) {
    sections.push([
      "【完整原文】",
      "提要与原文冲突时以原文为准。继承已确认的目标、限制和判断，不要求用户重复说明。",
      ...envelope.conversation.map((item) => `${item.speaker}：${item.text}`),
    ].join("\n\n"));
  }
  if (envelope.materials.length) {
    sections.push(["【交接材料】", ...envelope.materials.map((item) => `--- ${item.name} ---\n${item.text}`)].join("\n"));
  }
  if (envelope.decisions.length) sections.push(`【已确认决定】\n${envelope.decisions.map((item) => `- ${item}`).join("\n")}`);
  if (envelope.constraints.length) sections.push(`【约束】\n${envelope.constraints.map((item) => `- ${item}`).join("\n")}`);
  if (envelope.unresolved.length) sections.push(`【未完成事项】\n${envelope.unresolved.map((item) => `- ${item}`).join("\n")}`);
  return sections.join("\n\n");
}
export function returnCapabilityHandoff(
  receipt: CapabilityHandoffReceipt,
  resultArtifactId: string,
  now = new Date(),
): CapabilityHandoffReceipt {
  const artifactId = boundedText(resultArtifactId, 160) || undefined;
  // 没有产物就不是交付。允许 returned 而无产物，等于把空手而归显示成完成。
  if (!artifactId) {
    return failCapabilityHandoff(receipt, {
      kind: "execution",
      error: "接收能力没有返回可交付产物。",
    }, now);
  }
  const next: CapabilityHandoffReceipt = {
    ...receipt,
    status: "returned",
    returnedAt: now.toISOString(),
    resultArtifactId: artifactId,
  };
  // 从失败状态重试成功后要清干净失败痕迹，否则界面会同时看到交付和失败。
  delete next.failedAt;
  delete next.failureKind;
  delete next.retryable;
  delete next.error;
  return next;
}

/**
 * 把交接标记为失败。
 *
 * 失败必须有自己的落点：只保留 received 会让中断的交接一直显示为「进行中」，
 * 而复用 returned 会让它显示为「已完成」。两者都会骗人。
 */
export function failCapabilityHandoff(
  receipt: CapabilityHandoffReceipt,
  failure: { kind: CapabilityHandoffFailureKind; error?: string },
  now = new Date(),
): CapabilityHandoffReceipt {
  const next: CapabilityHandoffReceipt = {
    ...receipt,
    status: "failed",
    failedAt: now.toISOString(),
    failureKind: failure.kind,
    retryable: RETRYABLE_FAILURES.has(failure.kind),
    error: boundedText(failure.error, 2_000) || failureText(failure.kind),
  };
  // 失败回执不得携带交付痕迹，否则「失败不显示完成」这条门形同虚设。
  delete next.returnedAt;
  delete next.resultArtifactId;
  return next;
}

function failureText(kind: CapabilityHandoffFailureKind): string {
  const labels: Record<CapabilityHandoffFailureKind, string> = {
    execution: "接收能力执行失败。",
    timeout: "接收能力超时，动作可能已部分执行，重试前需先对账。",
    "missing-capability": "目标能力不存在或已下线。",
    rejected: "接收能力拒绝接手这次交接。",
  };
  return labels[kind];
}

function normalizeMessages(value: unknown): CapabilityHandoffMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-120).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const text = boundedText(item.text, 12_000);
    if (!text) return [];
    const role = item.role === "assistant" || item.role === "system" ? item.role : "user";
    const speakerId = boundedText(item.speakerId, 160) || (role === "user" ? "user:current" : role === "assistant" ? "agent:clownfish" : "system");
    const subjectId = boundedText(item.subjectId, 160) || speakerId;
    return [{
      sourceMessageId: boundedText(item.sourceMessageId, 160) || `message-${index + 1}`,
      role,
      speakerId,
      subjectId,
      speaker: boundedText(item.speaker, 60) || (role === "user" ? "用户" : role === "assistant" ? "小丑鱼" : "系统"),
      text,
    }];
  });
}

function normalizeMaterials(value: unknown): CapabilityHandoffMaterial[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const text = boundedText(item.text, 160_000);
    if (!text) return [];
    return [{
      name: boundedText(item.name, 160) || "交接材料.txt",
      text,
      byteLength: Buffer.byteLength(text, "utf8"),
      contentHash: digest(text),
      fileRecordId: /^file-[a-f0-9-]{36}$/i.test(boundedText(item.fileRecordId, 80)) ? boundedText(item.fileRecordId, 80) : undefined,
      artifactId: boundedText(item.artifactId, 160) || undefined,
    }];
  });
}

function stringList(value: unknown, limit: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, maxChars)).filter(Boolean).slice(0, limit);
}

function boundedText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function safeConversationKey(value: unknown): string | undefined {
  const key = boundedText(value, 200);
  return /^(persona|group):[^:][^\r\n]{0,180}$/.test(key) ? key : undefined;
}

function digest(value: unknown): string {
  const text = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(text).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
