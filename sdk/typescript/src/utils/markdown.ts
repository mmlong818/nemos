// utils/markdown.ts — getRelevantContext 的 markdown 拼接
//
// v0.3：memoriesToMarkdown（flat 默认行为）
// v0.4：memoriesToMarkdownTiered（按层分组 + confidence 标签）
//        memoriesToMarkdownNarrative（LLM 合成自然段，未配 llm 时调用方降级）

import type { Layer, LLMProvider, Memory } from "../types.js";

const LAYER_LABEL: Record<Layer, string> = {
  archival: "原始记录",
  episodic: "事件",
  semantic: "知识",
  personal_semantic: "关于用户",
  procedural: "习惯/流程",
};

const ORDER: Layer[] = [
  "personal_semantic",
  "semantic",
  "procedural",
  "episodic",
  "archival",
];

function groupByLayer(memories: Memory[]): Record<Layer, Memory[]> {
  const grouped: Record<Layer, Memory[]> = {
    archival: [],
    episodic: [],
    semantic: [],
    personal_semantic: [],
    procedural: [],
  };
  for (const m of memories) grouped[m.layer].push(m);
  return grouped;
}

/**
 * v0.3 默认 flat 形态：按 layer 分组，bullet 列表带 _conf:_ / _ai-inferred_ 后缀。
 */
export function memoriesToMarkdown(memories: Memory[], maxChars?: number): string {
  if (memories.length === 0) return "";
  const grouped = groupByLayer(memories);

  const parts: string[] = ["## Relevant memory context", ""];
  for (const layer of ORDER) {
    const group = grouped[layer];
    if (group.length === 0) continue;
    parts.push(`### ${LAYER_LABEL[layer]} (${layer})`);
    for (const m of group) {
      const conf = m.source.confidence ? ` _conf:${m.source.confidence}_` : "";
      const auth = m.source.authoritative ? "" : " _ai-inferred_";
      parts.push(`- ${m.content}${conf}${auth}`);
    }
    parts.push("");
  }
  return truncate(parts.join("\n"), maxChars);
}

/**
 * v0.4 tiered 形态：每层一个 H2 分节 + 中文层标签 + 显式 confidence 注释。
 *
 * 与 flat 的差异：
 * - 用 H2（##）层标题代替 H3，便于直接喂给 LLM 作为多段上下文
 * - confidence 行内括号注释，更可读：`偏好 6 点写作 (high confidence)`
 * - 跳过空层（不输出空标题）
 */
export function memoriesToMarkdownTiered(memories: Memory[], maxChars?: number): string {
  if (memories.length === 0) return "";
  const grouped = groupByLayer(memories);

  const parts: string[] = [];
  for (const layer of ORDER) {
    const group = grouped[layer];
    if (group.length === 0) continue;
    parts.push(`## ${LAYER_LABEL[layer]}（${layer}）`);
    for (const m of group) {
      const tag = formatConfidenceTag(m);
      parts.push(`- ${m.content}${tag}`);
    }
    parts.push("");
  }
  return truncate(parts.join("\n").trimEnd(), maxChars);
}

function formatConfidenceTag(m: Memory): string {
  if (m.source.confidence) {
    return ` (${m.source.confidence} confidence)`;
  }
  if (!m.source.authoritative) {
    return " (ai-inferred)";
  }
  return "";
}

/**
 * v0.4 narrative 形态：调 LLM 把 memory 列表合成成自然段。
 *
 * 调用方需提供 nemos 配置的 llm provider。LLM 失败 / 未配 → 调用方应降级到 tiered。
 * 本函数仅负责拼 prompt + 解析；不处理降级（保持职责单一）。
 */
export async function memoriesToMarkdownNarrative(
  memories: Memory[],
  llm: LLMProvider,
  maxChars?: number,
): Promise<string> {
  if (memories.length === 0) return "";
  // 给 LLM 一个紧凑的输入：tiered 形态本身已经按层分组
  const tiered = memoriesToMarkdownTiered(memories);
  const system =
    "你是 nemos 记忆叙事器。把下方按层分组的 memory 整合成一段流畅自然语言（中文），" +
    "向 AI agent 介绍这位用户。要求：\n" +
    "1. 一段或两段（视信息量），不要 bullet、不要分节标题\n" +
    "2. 区分稳定特征（personal_semantic / semantic）与近期事件（episodic）\n" +
    "3. 不要复述层标签 / 不要写元描述（如「以下是…」）\n" +
    "4. confidence 信息可用「相对稳定」「最近一次」「偶发」等自然口吻表达\n" +
    "5. 不编造未给出的事实\n" +
    "输出：只返回那段自然语言，前后无 markdown 围栏，无解释。";
  const user = `按层分组的 memory：\n\n${tiered}`;
  let narrative: string;
  try {
    narrative = await llm.chat(system, user);
  } catch (e) {
    throw new Error(
      `[nemos] narrative 合成失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // 去掉可能的围栏
  const cleaned = stripMarkdownFences(narrative).trim();
  return truncate(cleaned, maxChars);
}

function stripMarkdownFences(s: string): string {
  let out = s.trim();
  if (out.startsWith("```")) {
    const lines = out.split("\n");
    lines.shift();
    if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
    out = lines.join("\n");
  }
  return out;
}

function truncate(md: string, maxChars: number | undefined): string {
  if (!maxChars) return md;
  if (md.length <= maxChars) return md;
  return md.slice(0, maxChars - 20) + "\n...(truncated)";
}
