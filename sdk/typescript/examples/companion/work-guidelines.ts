/**
 * 工作准则表：「用户希望我怎么做事」的落点，同时是工具授权的规则层。
 *
 * 为什么不放进记忆：记忆记的是**用户事实**（他是谁、他的项目、他的偏好），有完整的
 * 主体归属、双时间轴和证据晋升。而「用户反复纠正我，所以我以后应该先问」是关于
 * **助理自己该怎么做**的规则，主体是助理不是用户，写进用户事实会污染身份。
 *
 * 为什么不放进审批记录：AgentApprovalStore 按「工具名 + 完整参数」指纹一次性放行，
 * 这是对的——它保证批准过的那一次调用只执行一次。但它没有「以后这类动作都这样办」
 * 的表达能力，所以用户每次都要重新点一遍同样的批准。这里补的正是那一层，而且刻意做成
 * **可读、可改、可删的自然语言条目**，而不是一个记住了什么却说不清的开关。
 *
 * 证据门槛是这套东西的核心，不是装饰。只有三种事实算证据：
 *   - correction：用户明确纠正了助理做过的事
 *   - revert：用户撤销或拒绝了助理的动作
 *   - explicit-instruction：用户明确说了「别做 X」「以后都 Y」
 * 不允许从「用户问了关于 X 的问题」「用户自己做了 X」「助理没做过 X」推断出准则——
 * 这三种是最容易把一次提问固化成一条错误规则的路径。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { CompanionFailure } from "./failure-registry.js";

/**
 * 行为三档。
 *
 * 冲突时的优先级是 never > ask-first > allow-automatically：安全方向单调。
 * 「冲突时先问」的本意是不要让某条宽泛的自动放行盖掉一条谨慎的规则；never 只会
 * 比 ask-first 更谨慎，所以它排在最前，而不是反过来。
 */
export type GuidelineBehavior = "never" | "ask-first" | "allow-automatically";

export type GuidelineEvidenceKind = "correction" | "revert" | "explicit-instruction";

/** 证据只留可追溯标识与时间，不留用户原话——准则本身也不许出现原话。 */
export interface GuidelineEvidence {
  kind: GuidelineEvidenceKind;
  conversationId: string;
  at: string;
}

export interface WorkGuideline {
  id: string;
  /** 一句自然语言。写给用户读，也写给模型读。 */
  text: string;
  behavior: GuidelineBehavior;
  /**
   * 命中的动作名，逐个匹配工具名或能力 id（前缀匹配）。
   * 空数组 = 匹配任何动作，只允许出现在 never 与 ask-first 上：
   * 一条「凡事都自动放行」的准则等于关掉整个审批，那不该由一条准则做到。
   */
  match: string[];
  /** user = 用户当场的决定或手写；derived = 从历史证据派生。 */
  origin: "user" | "derived";
  evidence: GuidelineEvidence[];
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
}

export const GUIDELINE_LIMITS = {
  /** 条目上限。超过这个数用户就读不完，也就不再是「可读的规则」了。 */
  maxEntries: 40,
  /** 单条长度。一句话讲不完的规则应该拆开。 */
  maxTextLength: 200,
  /**
   * 派生准则的最少引用数。一次纠正是偶然，四次同向纠正才是稳定模式；
   * 用户当场的决定（origin: user）不需要凑四次，他自己就是权威。
   */
  minimumDerivedCitations: 4,
  /** 逐字引述判定：连续命中这么多字符就算引用了原话。 */
  verbatimWindow: 12,
} as const;

export interface GuidelineProposal {
  text: string;
  behavior: GuidelineBehavior;
  match: string[];
  evidence: GuidelineEvidence[];
}

/**
 * 派生准则的准入。不通过就丢弃整条提案——不截断、不降级保存，
 * 因为「证据不足的规则」和「没有规则」相比只是更糟。
 *
 * userUtterances 是本次证据涉及的用户原话，只用于查重，不会被存下来。
 */
export function reviewGuidelineProposal(
  proposal: GuidelineProposal,
  context: { userUtterances?: readonly string[] } = {},
): WorkGuideline {
  const text = normalizeText(proposal.text);
  if (!text) throw new CompanionFailure("CF-E0305", { citations: 0, minimumCitations: GUIDELINE_LIMITS.minimumDerivedCitations });
  const evidence = normalizeEvidence(proposal.evidence);
  if (evidence.length < GUIDELINE_LIMITS.minimumDerivedCitations) {
    throw new CompanionFailure("CF-E0305", {
      citations: evidence.length,
      minimumCitations: GUIDELINE_LIMITS.minimumDerivedCitations,
    });
  }
  if (quotesUser(text, context.userUtterances ?? [])) throw new CompanionFailure("CF-E0306");
  return buildGuideline({ ...proposal, text, evidence }, "derived");
}

/**
 * 用户当场的决定。审批卡上勾「以后总是允许」走这里：
 * 落成一条看得见的准则，而不是一个记住了什么却说不清的开关。
 */
export function userGuideline(input: {
  text: string;
  behavior: GuidelineBehavior;
  match: string[];
  conversationId?: string;
  at?: string;
}): WorkGuideline {
  const text = normalizeText(input.text);
  if (!text) throw new Error("准则内容不能为空");
  return buildGuideline({
    text,
    behavior: input.behavior,
    match: input.match,
    evidence: [{
      kind: "explicit-instruction",
      conversationId: clean(input.conversationId) || "user-decision",
      at: input.at ?? new Date().toISOString(),
    }],
  }, "user");
}

export interface GuidelineDecision {
  behavior: GuidelineBehavior | "unset";
  guidelineId?: string;
  guidelineText?: string;
}

/**
 * 命中判定。返回最保守的那一条，并带上是哪一条——用户必须能追问「凭什么」。
 */
export function resolveGuidelineDecision(
  guidelines: readonly WorkGuideline[],
  action: { toolName: string },
): GuidelineDecision {
  const toolName = clean(action.toolName);
  if (!toolName) return { behavior: "unset" };
  const order: GuidelineBehavior[] = ["never", "ask-first", "allow-automatically"];
  for (const behavior of order) {
    const hit = guidelines.find((item) => item.enabled
      && item.behavior === behavior
      && matchesAction(item, toolName));
    if (hit) return { behavior, guidelineId: hit.id, guidelineText: hit.text };
  }
  return { behavior: "unset" };
}

function matchesAction(guideline: WorkGuideline, toolName: string): boolean {
  if (guideline.match.length === 0) return guideline.behavior !== "allow-automatically";
  return guideline.match.some((pattern) => toolName === pattern || toolName.startsWith(pattern));
}

interface GuidelineFile {
  version: 1;
  guidelines: WorkGuideline[];
}

/** 本机 JSON 持久化，写法与投递外发箱、审批存储保持一致：临时文件 + 原子改名。 */
export class WorkGuidelineStore {
  private readonly guidelines = new Map<string, WorkGuideline>();

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.load();
  }

  list(): WorkGuideline[] {
    return [...this.guidelines.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => structuredClone(item));
  }

  add(guideline: WorkGuideline): WorkGuideline {
    const duplicate = [...this.guidelines.values()].find((item) => item.text === guideline.text);
    if (duplicate) {
      // 同一句话再来一次不该变成两条：合并证据，行为按更保守的那个取。
      duplicate.evidence = normalizeEvidence([...duplicate.evidence, ...guideline.evidence]);
      duplicate.behavior = stricter(duplicate.behavior, guideline.behavior);
      duplicate.match = [...new Set([...duplicate.match, ...guideline.match])].slice(0, 20);
      duplicate.enabled = true;
      duplicate.updatedAt = new Date().toISOString();
      this.save();
      return structuredClone(duplicate);
    }
    if (this.guidelines.size >= GUIDELINE_LIMITS.maxEntries) {
      throw new Error(`工作准则最多 ${GUIDELINE_LIMITS.maxEntries} 条，请先删除不再需要的规则`);
    }
    this.guidelines.set(guideline.id, structuredClone(guideline));
    this.save();
    return structuredClone(guideline);
  }

  /** 只允许改用户读得懂的三件事；证据与来源不可编辑，否则「凭什么」就说不清了。 */
  update(id: string, patch: { text?: string; behavior?: GuidelineBehavior; enabled?: boolean }): WorkGuideline {
    const guideline = this.guidelines.get(id);
    if (!guideline) throw new Error(`工作准则不存在：${id}`);
    if (patch.text !== undefined) {
      const text = normalizeText(patch.text);
      if (!text) throw new Error("准则内容不能为空");
      guideline.text = text;
    }
    if (patch.behavior !== undefined) {
      assertMatchAllowed(patch.behavior, guideline.match);
      guideline.behavior = patch.behavior;
    }
    if (patch.enabled !== undefined) guideline.enabled = patch.enabled;
    guideline.updatedAt = new Date().toISOString();
    this.save();
    return structuredClone(guideline);
  }

  remove(id: string): boolean {
    if (!this.guidelines.delete(id)) return false;
    this.save();
    return true;
  }

  decide(action: { toolName: string }): GuidelineDecision {
    return resolveGuidelineDecision(this.list(), action);
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8")) as GuidelineFile;
      if (value.version !== 1 || !Array.isArray(value.guidelines)) return;
      for (const item of value.guidelines) {
        // 落盘内容可能被手工改坏。坏条目逐条跳过，而不是整表作废——
        // 一条格式错误不该让所有准则连带失效，那会静默放开授权。
        try {
          const restored = buildGuideline(item, item.origin === "user" ? "user" : "derived", item.id, item.createdAt);
          restored.enabled = item.enabled !== false;
          restored.updatedAt = clean(item.updatedAt) || restored.createdAt;
          this.guidelines.set(restored.id, restored);
        } catch { /* 跳过坏条目 */ }
      }
    } catch {
      // 整个文件损坏时按空表启动；首次写入会生成新的有效文件。
    }
  }

  private save(): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, guidelines: [...this.guidelines.values()] }, null, 2), "utf8");
    renameSync(temp, this.file);
  }
}

/**
 * 授权链：准则先判，判不了才落到审批。
 *
 * never 直接拒且不打扰用户；allow-automatically 直接放行；ask-first 与无准则都进
 * 原有的持久化审批。read 类工具本来不进审批，这里也不会因为一条准则而变严——
 * 调用方只在需要授权时才会走到这里。
 */
export async function authorizeWithGuidelines<Input extends { call: { name: string } }, Result>(
  store: Pick<WorkGuidelineStore, "decide">,
  input: Input,
  fallback: (input: Input) => Promise<Result>,
  deny: (reason: string) => Result,
  allow: (reason: string) => Result,
): Promise<Result> {
  const decision = store.decide({ toolName: input.call.name });
  if (decision.behavior === "never") {
    const failure = new CompanionFailure("CF-E0205", {
      toolName: input.call.name,
      guidelineId: decision.guidelineId,
    });
    return deny(`${failure.code} 工作准则不允许这个动作：${decision.guidelineText ?? ""}`.trim());
  }
  if (decision.behavior === "allow-automatically") {
    return allow(`工作准则自动放行（${decision.guidelineId}）：${decision.guidelineText ?? ""}`.trim());
  }
  return fallback(input);
}

function buildGuideline(
  input: GuidelineProposal,
  origin: WorkGuideline["origin"],
  id = `guideline-${randomUUID()}`,
  createdAt = new Date().toISOString(),
): WorkGuideline {
  const text = normalizeText(input.text);
  if (!text) throw new Error("准则内容不能为空");
  const behavior = input.behavior;
  if (behavior !== "never" && behavior !== "ask-first" && behavior !== "allow-automatically") {
    throw new Error(`未知的准则行为：${String(behavior)}`);
  }
  const match = [...new Set((Array.isArray(input.match) ? input.match : []).map(clean).filter(Boolean))].slice(0, 20);
  assertMatchAllowed(behavior, match);
  return {
    id: clean(id) || `guideline-${randomUUID()}`,
    text,
    behavior,
    match,
    origin,
    evidence: normalizeEvidence(input.evidence),
    createdAt: clean(createdAt) || new Date().toISOString(),
    updatedAt: clean(createdAt) || new Date().toISOString(),
    enabled: true,
  };
}

function assertMatchAllowed(behavior: GuidelineBehavior, match: readonly string[]): void {
  if (behavior === "allow-automatically" && match.length === 0) {
    throw new Error("自动放行的准则必须点名它适用的动作，不能匹配全部动作");
  }
}

function stricter(left: GuidelineBehavior, right: GuidelineBehavior): GuidelineBehavior {
  const rank: Record<GuidelineBehavior, number> = { never: 0, "ask-first": 1, "allow-automatically": 2 };
  return rank[left] <= rank[right] ? left : right;
}

function normalizeEvidence(evidence: unknown): GuidelineEvidence[] {
  const kinds = new Set<GuidelineEvidenceKind>(["correction", "revert", "explicit-instruction"]);
  const seen = new Set<string>();
  const result: GuidelineEvidence[] = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const record = item as Partial<GuidelineEvidence> | null;
    if (!record || !kinds.has(record.kind as GuidelineEvidenceKind)) continue;
    const conversationId = clean(record.conversationId);
    if (!conversationId) continue;
    // 同一次对话不能被数成多条引用，否则「四条引用」可以用一次对话刷出来。
    if (seen.has(conversationId)) continue;
    seen.add(conversationId);
    result.push({
      kind: record.kind as GuidelineEvidenceKind,
      conversationId,
      at: clean(record.at) || new Date().toISOString(),
    });
    if (result.length >= 20) break;
  }
  return result;
}

/**
 * 逐字引述检测。准则里出现用户原话就意味着这条规则可能只是复述了一次具体请求，
 * 而不是提炼出的稳定模式；同时也避免把用户的私人措辞永久固化到规则里。
 */
function quotesUser(text: string, utterances: readonly string[]): boolean {
  const haystack = compact(text);
  if (haystack.length < GUIDELINE_LIMITS.verbatimWindow) return false;
  for (const utterance of utterances) {
    const source = compact(utterance);
    for (let start = 0; start + GUIDELINE_LIMITS.verbatimWindow <= source.length; start++) {
      if (haystack.includes(source.slice(start, start + GUIDELINE_LIMITS.verbatimWindow))) return true;
    }
  }
  return false;
}

function compact(value: string): string {
  return value.replace(/[\s，。、；：？！,.;:?!"'“”‘’()（）]/g, "");
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, GUIDELINE_LIMITS.maxTextLength);
}

function clean(value: unknown): string {
  return String(value ?? "").trim().slice(0, 200);
}
