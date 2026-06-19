// reflect.ts — v0.4 Reflect consolidation job
//
// 设计目标：
// - 读最近 N 条 episodic + （可选）现有 personal_semantic 当 anchor
// - LLM 抽出可升 semantic / personal_semantic 的 pattern（每条带 consolidated_from）
// - 矛盾检测：新 episodic 与现 personal_semantic 不一致时标 perspectives_conflict 提示
// - 输出 derived 走 persistDerivedList，所有硬约束沿用（authoritative=false 强制）
// - archival 永不被修改（reflect 只产新 derived，不 update 已有 archival）
// - 跨 user namespace 永不互相 reflect

import type { EmbeddingProvider, LLMProvider, LogLevel, Memory, NemosConfig } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import type { Storage } from "./storage.js";
import { persistDerivedList } from "./persist-derived.js";
import {
  runDomainEvolution,
  runProspectiveVerification,
  type DomainEvolutionResult,
} from "./reflect-domain.js";
import { detectArousalSignals, estimateArousal, estimateSurprise } from "./utils/arousal.js";
import { newId, nowIso } from "./utils/id.js";

export interface ReflectConfig {
  enabled: boolean;
  autoTriggerThreshold: number;
  includePersonalSemantic: boolean;
}

export const REFLECT_DEFAULTS: ReflectConfig = {
  enabled: false,
  autoTriggerThreshold: 20,
  includePersonalSemantic: true,
};

export function resolveReflectConfig(config: NemosConfig): ReflectConfig {
  const raw = config.features?.reflect;
  if (!raw) return { ...REFLECT_DEFAULTS };
  return {
    enabled: raw.enabled === true,
    autoTriggerThreshold:
      typeof raw.autoTriggerThreshold === "number"
        ? raw.autoTriggerThreshold
        : REFLECT_DEFAULTS.autoTriggerThreshold,
    includePersonalSemantic:
      raw.includePersonalSemantic !== false,
  };
}

export const REFLECT_SYSTEM_PROMPT = `你是 nemos 反思整合器。

任务：读用户最近的 episodic 经验（事件流）与现有 personal_semantic（关于用户自身的稳定事实，作为 anchor），抽出可升入 semantic / personal_semantic 的 pattern。这模拟人脑睡眠期的记忆整合（consolidation）。

规则：
1. 仅当你看到**多条 episodic 反复指向同一模式**时，才输出新 derived（≥2 条支持）。一条 episodic 不要单独升层。
2. 每条新 derived 必须填 consolidated_from = [对应 episodic id 数组]
3. 新 derived 的 layer 只能是 semantic / personal_semantic：
   - personal_semantic：关于用户自身（偏好 / 习惯 / 性格 / 长期目标）
   - semantic：跨用户适用的事实 / 概念 / 规律
4. 不要重复已有 personal_semantic 已经表达过的事实
5. 检测矛盾：新 episodic 与现有 personal_semantic 显著冲突（同一事物，旧说法已不再为真）→ 输出一条 layer='personal_semantic' 的新 derived，content 注明「过去 X，最近改为 Y（基于 ep_xxx, ep_yyy）」，source.perspectives_conflict=true，并在 invalidates 数组里列出被这条新事实推翻的现有 personal_semantic 的 id（**必须来自上面 anchor 列表里的 id**，不要编造）。仅在确实矛盾时填 invalidates；只是补充/细化而非推翻时，留空数组。
6. 不要输出 archival / episodic / procedural
7. 不要新增没有 episodic 支持的事实（不要发明）

输出严格 JSON（不要 markdown 围栏）：
{
  "derived": [
    {
      "layer": "semantic" | "personal_semantic",
      "content": "<提炼的事实>",
      "type": "user" | "project" | "reference",
      "source": {
        "authoritative": false,
        "origin": "reflect-consolidation",
        "chain_depth": 1,
        "confidence": "high" | "medium",
        "perspectives_conflict": false
      },
      "consolidated_from": ["ep_xxx", "ep_yyy"],
      "invalidates": [],
      "arousal": {"value": 0.0-1.0, "signal_sources": []},
      "surprise": {"value": 0.0-1.0, "basis": "consolidated from N episodes"}
    }
  ]
}

invalidates：可选，仅冲突时填；列出被本条推翻、应失效的现有 personal_semantic 的 id（来自 anchor）。无则省略或留空数组。

不要输出 JSON 以外的任何内容。如果 episodic 数据不足以提炼任何 pattern，返回 {"derived": []}。`;

interface RawReflectDerived {
  layer?: string;
  content?: string;
  type?: string;
  source?: {
    authoritative?: boolean;
    origin?: string;
    chain_depth?: number;
    confidence?: string;
    perspectives_conflict?: boolean;
  };
  consolidated_from?: string[];
  invalidates?: string[];
  arousal?: { value?: number; signal_sources?: string[] };
  surprise?: { value?: number; basis?: string };
}

interface ReflectJsonOutput {
  derived?: RawReflectDerived[];
}

/**
 * 跑一次 reflect job：读 episodic + personal_semantic → LLM → 写 derived。
 *
 * 不变量：
 * - 仅生成 semantic / personal_semantic derived
 * - 每条带 consolidated_from / consolidated_at
 * - 走 persistDerivedList → 自动应用 authoritative=false / kind='derived' 守门
 * - archival 不被读也不被写（reflect 只看 derived）
 * - 跨 user 隔离由 storage 接口保证（tenantId + userId 强制）
 */
export interface ReflectInput {
  tenantId: string;
  userId: string;
  defaultScope: string;
  recentLimit?: number;
  /** v0.5：开启领域演化（birth/split/merge/sleep）。默认 false。 */
  domainsEnabled?: boolean;
  /** v0.5：开启前瞻预测-验证闭环。默认 false。 */
  prospectiveEnabled?: boolean;
  /** v0.6（RFC 0007/0008）：开启矛盾驱动自动失效（仅 personal_semantic anchor）。默认 false。 */
  invalidationEnabled?: boolean;
}

export interface ReflectResult {
  episodicConsumed: number;
  anchorCount: number;
  derived: Memory[];
  /** v0.5：领域演化统计（domainsEnabled 时）。 */
  domainEvolution?: DomainEvolutionResult;
  /** v0.5：本轮验证的前瞻条数（prospectiveEnabled 时）。 */
  prospectiveVerified?: number;
  /** v0.6：本轮被矛盾失效的旧 personal_semantic 条数（invalidationEnabled 时）。 */
  invalidated?: number;
}

export async function runReflect(
  storage: Storage,
  llm: LLMProvider,
  embedding: EmbeddingProvider | null,
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
  config: ReflectConfig,
  input: ReflectInput,
): Promise<ReflectResult> {
  const limit = input.recentLimit ?? config.autoTriggerThreshold;
  const episodic = storage.listRecentEpisodic(input.tenantId, input.userId, limit);
  if (episodic.length === 0) {
    return { episodicConsumed: 0, anchorCount: 0, derived: [] };
  }

  const anchor = config.includePersonalSemantic
    ? storage.listPersonalSemantic(input.tenantId, input.userId)
    : [];

  const userMessage = buildReflectUserMessage(episodic, anchor, input.defaultScope);
  let raw: string;
  try {
    raw = await llm.chat(REFLECT_SYSTEM_PROMPT, userMessage);
  } catch (e) {
    throw new Error(
      `[nemos] reflect LLM 调用失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const parsed = parseReflectJson(raw);
  const built: Memory[] = [];
  const epIdSet = new Set(episodic.map((e) => e.id));
  // v0.6：矛盾失效——anchor（全是 personal_semantic）id 集合 + 新记录 id → 被推翻的旧 id。
  const anchorById = new Map(anchor.map((a) => [a.id, a]));
  const invalidatesMap = new Map<string, string[]>();
  for (const d of parsed.derived ?? []) {
    const memory = buildReflectDerived(d, input.defaultScope, epIdSet, log);
    if (!memory) continue;
    built.push(memory);
    if (input.invalidationEnabled && Array.isArray(d.invalidates) && d.invalidates.length > 0) {
      // 守门：被失效 id 必须来自 anchor（即现有 personal_semantic），杜绝 LLM 编造
      const valid = d.invalidates.filter((id) => anchorById.has(id));
      if (valid.length > 0) invalidatesMap.set(memory.id, valid);
    }
  }

  const persisted = await persistDerivedList(
    storage,
    embedding,
    log,
    input.tenantId,
    input.userId,
    built,
  );

  // v0.6（RFC 0007 §2.3 / RFC 0008 §5）：把被推翻的旧 personal_semantic 标失效。
  // I4：anchor 恒为 personal_semantic，且只在 reflect 这条用户自述流上触发；flag 默认关。
  let invalidated = 0;
  if (input.invalidationEnabled && invalidatesMap.size > 0) {
    const now = nowIso();
    for (const p of persisted) {
      const oldIds = invalidatesMap.get(p.id);
      if (!oldIds) continue;
      for (const oldId of oldIds) {
        const old = anchorById.get(oldId);
        if (!old) continue;
        storage.markInvalidated(input.tenantId, input.userId, old.layer, oldId, {
          invalidAt: p.valid_at ?? now,
          expiredAt: now,
          correctedBy: p.id,
        });
        invalidated++;
      }
    }
  }

  log("info", "[nemos reflect] consolidated", {
    user: input.userId,
    episodic_in: episodic.length,
    anchor: anchor.length,
    derived_out: persisted.length,
    invalidated,
  });

  // v0.5：领域演化（RFC 0005）+ 前瞻验证（RFC 0006），全部离线。默认关 → 等价 v0.4。
  let domainEvolution: DomainEvolutionResult | undefined;
  if (input.domainsEnabled) {
    domainEvolution = await runDomainEvolution(
      storage,
      llm,
      embedding,
      log,
      { tenantId: input.tenantId, userId: input.userId, defaultScope: input.defaultScope },
      { enabled: true, minClusterSize: 3 },
    );
    log("info", "[nemos reflect] domain evolution", { ...domainEvolution });
  }
  let prospectiveVerified: number | undefined;
  if (input.prospectiveEnabled) {
    const r = await runProspectiveVerification(
      storage,
      llm,
      log,
      { tenantId: input.tenantId, userId: input.userId },
      episodic,
    );
    prospectiveVerified = r.verified;
  }

  return {
    episodicConsumed: episodic.length,
    anchorCount: anchor.length,
    derived: persisted,
    domainEvolution,
    prospectiveVerified,
    invalidated,
  };
}

function buildReflectUserMessage(
  episodic: Memory[],
  anchor: Memory[],
  defaultScope: string,
): string {
  const ep = episodic.map((m) => ({
    id: m.id,
    created_at: m.created_at,
    content: m.content,
    scope: m.scope,
  }));
  const an = anchor.map((m) => ({
    id: m.id,
    content: m.content,
    confidence: m.source.confidence ?? "medium",
  }));
  return (
    `default_scope: ${defaultScope}\n` +
    `recent_episodic (${ep.length} 条，按时间倒序):\n${JSON.stringify(ep, null, 2)}\n\n` +
    `existing_personal_semantic anchor (${an.length} 条):\n${JSON.stringify(an, null, 2)}`
  );
}

function parseReflectJson(raw: string): ReflectJsonOutput {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    const obj = JSON.parse(cleaned) as ReflectJsonOutput;
    return obj && Array.isArray(obj.derived) ? obj : { derived: [] };
  } catch {
    return { derived: [] };
  }
}

function buildReflectDerived(
  raw: RawReflectDerived,
  defaultScope: string,
  epIdSet: Set<string>,
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
): Memory | null {
  const layerRaw = String(raw.layer || "").toLowerCase();
  if (layerRaw !== "semantic" && layerRaw !== "personal_semantic") {
    log("warn", "[nemos reflect] 跳过非 semantic/personal_semantic derived", { layer: raw.layer });
    return null;
  }
  const content = (raw.content || "").trim();
  if (!content) return null;

  // consolidated_from 严格过滤：必须是本次输入 episodic 集合的 id
  const fromIds = Array.isArray(raw.consolidated_from)
    ? raw.consolidated_from.filter((id) => typeof id === "string" && epIdSet.has(id))
    : [];
  if (fromIds.length === 0) {
    log("warn", "[nemos reflect] 跳过没有 consolidated_from 的 derived（防止 LLM 编造）", {
      content: content.slice(0, 80),
    });
    return null;
  }

  const now = nowIso();
  const layer: Memory["layer"] = layerRaw;
  const confidence = raw.source?.confidence === "medium" ? "medium" : "high";
  const memory: Memory = {
    id: newId(layer),
    layer,
    type: (raw.type as Memory["type"]) || (layer === "personal_semantic" ? "user" : "project"),
    scope: defaultScope,
    content,
    source: {
      authoritative: false,
      kind: "derived",
      origin: "reflect-consolidation",
      chain_depth: 1,
      confidence,
      extractor: "llm_inference",
      perspectives_conflict: raw.source?.perspectives_conflict === true ? true : undefined,
    },
    arousal: {
      value:
        typeof raw.arousal?.value === "number"
          ? raw.arousal.value
          : estimateArousal(content),
      signal_sources: raw.arousal?.signal_sources ?? detectArousalSignals(content),
    },
    surprise: {
      value:
        typeof raw.surprise?.value === "number"
          ? raw.surprise.value
          : estimateSurprise(content),
      basis: raw.surprise?.basis || `consolidated from ${fromIds.length} episodes`,
    },
    ownership: { kind: "self", consent_status: "implicit" },
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 1.0,
    schema_version: SCHEMA_VERSION,
    consolidated_from: fromIds,
    consolidated_at: now,
  };
  // 清理 source 中的 undefined（避免 JSON.stringify 留下空字段）
  if (memory.source.perspectives_conflict === undefined) {
    delete memory.source.perspectives_conflict;
  }
  return memory;
}
