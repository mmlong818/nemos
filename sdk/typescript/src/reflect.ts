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
import { capAnchors, applyInvalidations, selectSemanticCandidates, DEFAULT_ANCHOR_CAP } from "./invalidation.js";
import { prefilterCandidates } from "./prefilter.js";
import { cosineSimLocal } from "./utils/vector.js";

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
1. 仅当你看到**多条 episodic 反复指向同一模式**时，才输出新 derived（≥2 条支持）。一条 episodic 不要单独升层。（例外见规则 5 的明确矛盾。）
2. 每条新 derived 必须填 consolidated_from = [对应 episodic id 数组]
3. 新 derived 的 layer 只能是 semantic / personal_semantic：
   - personal_semantic：关于用户自身（偏好 / 习惯 / 性格 / 长期目标）
   - semantic：跨用户适用的事实 / 概念 / 规律
4. 不要重复已有 personal_semantic 已经表达过的事实
5. 检测矛盾：新 episodic 与现有 personal_semantic 显著冲突（同一事物，旧说法已不再为真）→ 输出一条 layer='personal_semantic' 的新 derived，content 注明「过去 X，最近改为 Y（基于 ep_xxx）」，source.perspectives_conflict=true，并在 invalidates 数组里列出被这条新事实推翻的现有 personal_semantic 的 id（**必须来自上面 anchor 列表里的 id**，不要编造）。仅在确实矛盾时填 invalidates；只是补充/细化而非推翻时，留空数组。
   **此条不受规则 1「≥2 条」限制**：哪怕只有一条 episodic，只要它明确、肯定地否定了某条现有 personal_semantic（如「X 去世 / 分手 / 离职 / 搬走 / 卖了」否定「养着 X / 在一起 / 任某职 / 住某地 / 拥有」），就要输出这条失效 derived。但必须是确定的事实变化，含糊、假设、一时情绪不算。
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

// v2（RFC 0007）：强化矛盾判定——把"属性替换"显式列为矛盾的第二类。
// v1 的规则 5 只给了强否定例子（去世/离职/搬走），导致"素食→鱼素"这类同属性换值被当作补充而漏判。
// 仅在 invalidation.detector='semantic' 时启用；'lexical' 仍用 v1 prompt，保证 before/after 对照干净。
export const REFLECT_SYSTEM_PROMPT_V2 = REFLECT_SYSTEM_PROMPT.replace(
  `5. 检测矛盾：新 episodic 与现有 personal_semantic 显著冲突（同一事物，旧说法已不再为真）→ 输出一条 layer='personal_semantic' 的新 derived，content 注明「过去 X，最近改为 Y（基于 ep_xxx）」，source.perspectives_conflict=true，并在 invalidates 数组里列出被这条新事实推翻的现有 personal_semantic 的 id（**必须来自上面 anchor 列表里的 id**，不要编造）。仅在确实矛盾时填 invalidates；只是补充/细化而非推翻时，留空数组。
   **此条不受规则 1「≥2 条」限制**：哪怕只有一条 episodic，只要它明确、肯定地否定了某条现有 personal_semantic（如「X 去世 / 分手 / 离职 / 搬走 / 卖了」否定「养着 X / 在一起 / 任某职 / 住某地 / 拥有」），就要输出这条失效 derived。但必须是确定的事实变化，含糊、假设、一时情绪不算。`,
  `5. 检测矛盾：新 episodic 与现有 personal_semantic 冲突（同一主体的同一属性，旧值已不再为真）→ 输出一条 layer='personal_semantic' 的新 derived，content 注明「过去 X，最近改为 Y（基于 ep_xxx）」，source.perspectives_conflict=true，并在 invalidates 数组里列出被推翻的现有 personal_semantic 的 id（**必须来自上面 anchor 列表里的 id**，不要编造）。
   矛盾分两类，都要失效旧值：
   (a) **强否定**：明确事件否定旧事实——「X 去世 / 分手 / 离职 / 搬走 / 卖了」否定「养着 X / 在一起 / 任某职 / 住某地 / 拥有」。
   (b) **属性替换**：同一**单值属性**出现与旧值**互斥**的新值——居住地（北京→上海）、职业/雇主（Google→OpenAI）、婚姻状态（单身→已婚）、饮食（素食→鱼素/吃肉）、所有物、当前目标等。新值与旧值不能同时为真时，旧值被推翻。
   **此条不受规则 1「≥2 条」限制**：哪怕只有一条 episodic，只要它明确否定或替换了某条现有 personal_semantic 就要失效。
   **防误杀**：仅当新旧**互斥**（不能同时为真）才失效；可并存的偏好/补充（喜欢茶 + 喜欢咖啡、又学了一门语言）不算矛盾，invalidates 留空。含糊、假设、一时情绪也不算。`,
);

// v0.6.1：psem ↔ psem 属性替换核对 prompt。
// 用于「旧值与新值在 ingest 阶段都已升为 personal_semantic、不存在新 episodic」的场景：
// 此时通道一（episodic→psem）拿不到新信息，需直接在现有 personal_semantic 集合内识别
// 「同一单值属性的旧值被更新值取代」的成对关系，失效旧值。判定纯靠语义互斥（LLM），
// 不针对任何具体属性硬编码。
export const RECONCILE_SYSTEM_PROMPT = `你是 nemos 信念一致性核对器。

你会收到同一用户的一组现有 personal_semantic 事实（每条带 id、content、created_at）。它们语义相近，可能存在「同一单值属性的旧值已被更新值取代」的情况。

任务：在这组事实里找出所有「被取代的旧值 → 取代它的当前值」的成对关系。

什么是单值属性（同一时刻只能有一个为真的属性）：
- 居住地（住在 A 城 vs 住在 B 城）
- 职业 / 当前雇主（在 X 任职 vs 在 Y 任职）
- 婚姻 / 关系状态（单身 vs 已婚 vs 离异）
- 饮食身份（素食者 vs 鱼素者 vs 杂食者）
- 当前所有物的唯一归属、当前主目标等

判定规则：
1. 仅当两条事实描述**同一主体的同一单值属性**、且**取值互斥**（不能同时为真）时，才构成「取代」关系。
2. 取代方向：内容更新、时间更晚（created_at 更近）、或语义上明显是「现状/最近」的那条是**当前值（current）**；与之互斥的较早/被推翻的那条是**旧值（stale）**。
3. 一条旧值可被同一条当前值取代；多步替换时（A→B→C）输出多对：A 被 C 取代、B 被 C 取代（统一指向最终当前值）。
4. **防误杀（关键）**：可并存的事实**绝不**配对——
   - 不同属性（住在 Berlin + 喜欢爬山）；
   - 同属性但可叠加的偏好（喜欢茶 + 喜欢咖啡、会说中文 + 又学了法语、喜欢爬山 + 喜欢游泳）；
   - 只是补充细化、范围更具体而非互斥的（喜欢咖啡 + 喜欢手冲咖啡）。
   以上一律不输出。宁可漏判，不可错杀。
5. 不确定是否互斥时，不配对。

输出严格 JSON（不要 markdown 围栏）：
{
  "replacements": [
    { "stale_id": "<被取代的旧值 id>", "current_id": "<取代它的当前值 id>" }
  ]
}

id 必须来自输入列表，不要编造。没有任何取代关系时返回 {"replacements": []}。不要输出 JSON 以外的任何内容。`;

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
  /** v0.6.1：矛盾候选检索方式。默认 'semantic'（无 embedding 时回退 'lexical'）。 */
  invalidationDetector?: "lexical" | "semantic";
  /** 'semantic' 候选上限。默认 50。 */
  invalidationTopN?: number;
  /** 'semantic' 候选最低 cosine。默认 0.30。 */
  invalidationMinCosine?: number;
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

  const detector = input.invalidationDetector ?? "semantic";
  const useSemantic = detector === "semantic" && embedding != null;
  // v0.6.1：semantic 失效路径下，即便本轮没有新 episodic，也可能有两条互斥的现有
  // personal_semantic 需要核对（属性替换：旧值/新值都已升为 psem，episodic 为空）。
  // 此时不 early-return，转而走 psem↔psem 互斥核对。lexical / 关闭路径行为不变。
  const psemReconcileEligible = useSemantic && input.invalidationEnabled === true;
  if (episodic.length === 0 && !psemReconcileEligible) {
    return { episodicConsumed: 0, anchorCount: 0, derived: [] };
  }

  const allAnchor = config.includePersonalSemantic
    ? storage.listPersonalSemantic(input.tenantId, input.userId)
    : [];
  const episodicText = episodic.map((e) => e.content).join("\n");
  // 候选检索：v2 'semantic'（embedding cosine，捕捉用词不同的属性替换矛盾）优先；
  // 无 embedding 或显式 'lexical' 时回退 v1 字符 bigram Jaccard 粗筛。再过 capAnchors 兜大集合上限。
  // allAnchor 为空时 anchor 也为空，行为不变。
  let anchor: Memory[];
  if (useSemantic) {
    const semantic = await selectSemanticCandidates(
      embedding,
      episodic.map((e) => e.content),
      allAnchor,
      input.invalidationTopN ?? DEFAULT_ANCHOR_CAP,
      input.invalidationMinCosine ?? 0.3,
    );
    anchor = capAnchors(semantic, episodicText);
  } else {
    const relevant = prefilterCandidates(episodicText, allAnchor).map((a) => {
      const { score, ...m } = a;
      void score;
      return m as Memory;
    });
    anchor = capAnchors(relevant, episodicText);
  }

  // v0.6：矛盾失效——anchor（全是 personal_semantic）id 集合 + 新记录 id → 被推翻的旧 id。
  const anchorById = new Map(anchor.map((a) => [a.id, a]));
  const invalidatesMap = new Map<string, string[]>();
  const built: Memory[] = [];
  const epIdSet = new Set(episodic.map((e) => e.id));

  // 通道一（episodic → psem 整合 + 强否定/属性替换矛盾）：仅在本轮有新 episodic 时跑。
  // episodic 为空时不喂空内容给 LLM（无意义且浪费）；此时仅靠下方 psem↔psem 核对。
  if (episodic.length > 0) {
    const reflectPrompt = useSemantic ? REFLECT_SYSTEM_PROMPT_V2 : REFLECT_SYSTEM_PROMPT;
    const userMessage = buildReflectUserMessage(episodic, anchor, input.defaultScope);
    let raw: string;
    try {
      raw = await llm.chat(reflectPrompt, userMessage);
    } catch (e) {
      throw new Error(
        `[nemos] reflect LLM 调用失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const parsed = parseReflectJson(raw);
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
  let invalidated =
    input.invalidationEnabled && invalidatesMap.size > 0
      ? applyInvalidations(storage, input.tenantId, input.userId, persisted, invalidatesMap, anchorById, nowIso())
      : 0;

  // 通道二（psem ↔ psem 属性替换核对）：仅 semantic 失效路径。
  // 解决「新旧值在 ingest 阶段都已升为 personal_semantic、episodic 为空」的属性替换漏判：
  // 在现有 active psem 中按语义聚簇，由 LLM 判定单值属性的「旧值被新值取代」对，失效旧值。
  // 这是机制层修复，对任意属性泛化；可并存偏好不配对（防误杀）由 LLM 互斥判定保证。
  if (psemReconcileEligible) {
    invalidated += await reconcilePersonalSemantic(
      storage,
      llm,
      embedding!,
      log,
      input,
    );
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
    anchorCount: allAnchor.length,
    derived: persisted,
    domainEvolution,
    prospectiveVerified,
    invalidated,
  };
}

interface RawReconcile {
  replacements?: Array<{ stale_id?: string; current_id?: string }>;
}

/**
 * v0.6.1：personal_semantic ↔ personal_semantic 属性替换核对。
 *
 * 背景：稳定偏好/属性类自述在 ingest 阶段常被直接抽成 personal_semantic（不经 episodic）。
 * 当某属性的旧值与新值「都已是 psem」时，通道一（episodic→psem）拿不到任何新 episodic，
 * 无从生成带 invalidates 的冲突 derived，旧值永不失效（属性替换漏判的机制根因）。
 *
 * 本函数直接在现有 **active** personal_semantic 集合内核对：
 *  1) embedding 语义聚簇——只把「至少与另一条 cosine ≥ minCosine」的 psem 选为候选，
 *     既捕捉用词不同的同属性对（素食↔鱼素、Berlin↔Amsterdam），又避免全量两两喂 LLM。
 *  2) LLM（RECONCILE_SYSTEM_PROMPT）在候选内判定「单值属性的旧值被新值取代」对（互斥才配对，
 *     可并存偏好不配对——防误杀靠 LLM 语义判定，不针对任何具体属性硬编码）。
 *  3) 守门：stale/current 必须都是本轮 active 候选；stale≠current；多步替换统一指向最终当前值。
 *  4) applyInvalidations 失效旧值（current 当 correctedBy，守 I4：只失效 personal_semantic）。
 *
 * 仅在 detector='semantic' 且 invalidation.enabled 时由 runReflect 调用；lexical/关闭路径不触及。
 * 返回失效条数。
 */
export async function reconcilePersonalSemantic(
  storage: Storage,
  llm: LLMProvider,
  embedding: EmbeddingProvider,
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
  input: ReflectInput,
): Promise<number> {
  // 只核对当前为真（active）的 psem——已失效的不再参与，避免重复失效 / 误当 winner。
  const allPsem = storage
    .listPersonalSemantic(input.tenantId, input.userId)
    .filter((m) => (m.belief_state ?? "active") === "active");
  if (allPsem.length < 2) return 0;

  const minCosine = input.invalidationMinCosine ?? 0.3;
  const topN = input.invalidationTopN ?? DEFAULT_ANCHOR_CAP;

  // 1) 语义聚簇：embed 全部 active psem，收集「至少与另一条相似」的节点作为候选。
  const vecs = await Promise.all(allPsem.map((m) => embedding.embed(m.content)));
  const inCandidate = new Set<number>();
  for (let i = 0; i < allPsem.length; i++) {
    for (let j = i + 1; j < allPsem.length; j++) {
      if (cosineSimLocal(vecs[i]!, vecs[j]!) >= minCosine) {
        inCandidate.add(i);
        inCandidate.add(j);
      }
    }
  }
  if (inCandidate.size < 2) return 0;
  const candidates = Array.from(inCandidate)
    .map((i) => allPsem[i]!)
    .slice(0, topN);
  if (candidates.length < 2) return 0;

  // 2) LLM 判替代对。
  const candById = new Map(candidates.map((m) => [m.id, m]));
  const userMessage =
    `default_scope: ${input.defaultScope}\n` +
    `personal_semantic 候选（${candidates.length} 条，需核对是否存在单值属性的旧值被取代）:\n` +
    JSON.stringify(
      candidates.map((m) => ({ id: m.id, content: m.content, created_at: m.created_at })),
      null,
      2,
    );
  let raw: string;
  try {
    raw = await llm.chat(RECONCILE_SYSTEM_PROMPT, userMessage);
  } catch (e) {
    log("warn", "[nemos reflect] psem 核对 LLM 调用失败（不阻塞）", {
      err: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }

  let parsed: RawReconcile;
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    }
    parsed = JSON.parse(cleaned) as RawReconcile;
  } catch {
    return 0;
  }
  const pairs = Array.isArray(parsed.replacements) ? parsed.replacements : [];
  if (pairs.length === 0) return 0;

  // 3) 守门 + 去重：stale/current 必须都是本轮候选、stale≠current、同一 stale 只失效一次。
  // invalidatesMap: current_id → [stale_id...]（applyInvalidations 以 current 为 correctedBy）。
  const invalidatesMap = new Map<string, string[]>();
  const staleSeen = new Set<string>();
  for (const p of pairs) {
    const staleId = typeof p.stale_id === "string" ? p.stale_id : "";
    const currentId = typeof p.current_id === "string" ? p.current_id : "";
    if (!staleId || !currentId || staleId === currentId) continue;
    if (!candById.has(staleId) || !candById.has(currentId)) continue;
    if (staleSeen.has(staleId)) continue;
    staleSeen.add(staleId);
    const arr = invalidatesMap.get(currentId) ?? [];
    arr.push(staleId);
    invalidatesMap.set(currentId, arr);
  }
  if (invalidatesMap.size === 0) return 0;

  // 4) 失效旧值。applyInvalidations 以 persisted（= current psem 们）为 correctedBy 来源。
  const currents = Array.from(invalidatesMap.keys())
    .map((id) => candById.get(id)!)
    .filter(Boolean);
  const n = applyInvalidations(
    storage,
    input.tenantId,
    input.userId,
    currents,
    invalidatesMap,
    candById,
    nowIso(),
  );
  log("info", "[nemos reflect] psem 属性替换核对", {
    user: input.userId,
    candidates: candidates.length,
    invalidated: n,
  });
  return n;
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
