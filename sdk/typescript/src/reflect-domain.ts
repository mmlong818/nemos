// reflect-domain.ts — v0.5 领域演化 + 前瞻验证（reflect 离线层）
//
// RFC 0005 §6（领域生命周期 birth/split/merge/sleep）+ RFC 0006 §5（预测-验证闭环）。
// 全部在 reflect 离线执行，绝不进热路径。反固化原则：过时结构沉 cold 降权而非物理删除。

import type {
  EmbeddingProvider,
  LLMProvider,
  LogLevel,
  Memory,
  MemoryDomain,
  ProspectivePrediction,
} from "./types.js";
import { GLOBAL_DOMAIN_ID } from "./types.js";
import type { Storage } from "./storage.js";
import { cosineSimLocal } from "./utils/vector.js";
import { newPrefixedId, nowIso } from "./utils/id.js";

type Logger = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void;

const MIN_CLUSTER_SIZE = 3; // birth：同标签最小成团数（防抖）
const SPLIT_MIN_SIZE = 8; // 领域成员数 ≥ 此值才考虑 split
const SPLIT_SEPARATION = 0.35; // 二次聚类两簇质心距离(1-cos) ≥ 此值才算多峰
const MERGE_AFFINITY = 0.6; // 领域对 affinity ≥ 此值才考虑 merge
const MERGE_OVERLAP = 0.3; // 成员交叠比例 ≥ 此值才 merge
const SLEEP_IDLE_MS = 30 * 24 * 3600 * 1000; // 30 天未命中 → sleep
const SLEEP_RETRIEVABILITY = 0.2; // sleep/merge 沉睡后 retrievability 敲低到
const MIN_DOMAIN_AGE_MS = 7 * 24 * 3600 * 1000; // 最小存活期（防抖）

export interface DomainEvolutionConfig {
  enabled: boolean;
  minClusterSize: number;
}

export interface DomainEvolutionResult {
  born: number;
  recomputed: number;
  split: number;
  merged: number;
  slept: number;
}

// ── 主入口：birth → recompute → split → merge → sleep ──────────────────────
export async function runDomainEvolution(
  storage: Storage,
  llm: LLMProvider,
  embedding: EmbeddingProvider | null,
  log: Logger,
  input: { tenantId: string; userId: string; defaultScope: string },
  cfg: DomainEvolutionConfig,
): Promise<DomainEvolutionResult> {
  void embedding;
  const tenantId = input.tenantId;
  const userId = input.userId;
  storage.ensureGlobalDomain(tenantId, userId);

  // 取未归属任何非 GLOBAL 领域的最近记忆
  const recent = storage.listRecentEpisodic(tenantId, userId, 100);
  const unassigned: Memory[] = [];
  for (const m of recent) {
    const doms = storage.getMemoryDomainsFor(tenantId, userId, [m.id]);
    if (doms.filter((d) => d.domain_id !== GLOBAL_DOMAIN_ID).length === 0) {
      unassigned.push(m);
    }
  }

  let born = 0;
  if (unassigned.length >= cfg.minClusterSize) {
    born = await birthDomains(storage, llm, log, input, cfg, unassigned);
  }
  const recomputed = recomputeCentroids(storage, log, tenantId, userId);

  // 领域生命周期（RFC 0005 §6）
  const nowMs = Date.parse(nowIso());
  const split = splitDomains(storage, log, tenantId, userId, nowMs);
  accumulateAffinity(storage, log, tenantId, userId); // 共边累积，喂给 merge
  const merged = mergeDomains(storage, log, tenantId, userId);
  const slept = sleepDomains(storage, log, tenantId, userId, nowMs);

  return { born, recomputed, split, merged, slept };
}

// ── birth：LLM 打标签 → 聚团 → 成团且无同名领域则建领域 ────────────────────
async function birthDomains(
  storage: Storage,
  llm: LLMProvider,
  log: Logger,
  input: { tenantId: string; userId: string; defaultScope: string },
  cfg: DomainEvolutionConfig,
  unassigned: Memory[],
): Promise<number> {
  const tenantId = input.tenantId;
  const userId = input.userId;
  const labeled = await labelMemories(llm, log, unassigned);
  const clusters = new Map<string, Memory[]>();
  for (let i = 0; i < unassigned.length; i++) {
    const label = labeled[i];
    if (!label) continue;
    const arr = clusters.get(label) ?? [];
    arr.push(unassigned[i]);
    clusters.set(label, arr);
  }

  let born = 0;
  for (const entry of clusters.entries()) {
    const label = entry[0];
    const members = entry[1];
    if (members.length < cfg.minClusterSize) continue;
    const existing = storage.listDomains(tenantId, userId, { includeCold: true });
    const same = existing.find((d) => d.label === label && d.id !== GLOBAL_DOMAIN_ID);
    let domainId: string;
    if (same) {
      domainId = same.id;
    } else {
      domainId = newPrefixedId("dom");
      const now = nowIso();
      const centroid = centroidOfMembers(storage, tenantId, userId, members.map((m) => m.id));
      storage.upsertDomain(tenantId, userId, {
        id: domainId,
        tenant_id: tenantId,
        user_id: userId,
        label,
        prototype_vec: centroid,
        parent_id: undefined,
        level: 0,
        status: "warm",
        origin: "emergent",
        always_on: false,
        load_count: 0,
        retrievability: 1.0,
        last_routed_at: undefined,
        created_at: now,
        updated_at: now,
      });
      born++;
    }
    for (const m of members) {
      storage.setMemoryDomains(tenantId, userId, m.id, [
        { memory_id: m.id, domain_id: domainId, membership_weight: 1.0, is_primary: true },
      ]);
    }
  }
  return born;
}

async function labelMemories(
  llm: LLMProvider,
  log: Logger,
  memories: Memory[],
): Promise<(string | null)[]> {
  const list = memories.map((m, i) => `${i}: ${m.content}`).join("\n");
  const system = `你是记忆领域分类器。给每条记忆打一个简短领域标签（如「医疗」「音乐」「法律」「编程」）。
输出严格 JSON 数组（不要 markdown 围栏），每个元素 {"index": <序号>, "label": "<标签>"}。`;
  const user = `记忆列表：\n${list}\n\n输出 JSON 数组：`;
  let raw: string;
  try {
    raw = await llm.chat(system, user);
  } catch (e) {
    log("warn", "[reflect-domain] labelMemories LLM 失败", {
      err: e instanceof Error ? e.message : String(e),
    });
    return memories.map(() => null);
  }
  return parseLabels(raw, memories.length);
}

function parseLabels(raw: string, n: number): (string | null)[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const out: (string | null)[] = new Array(n).fill(null);
  try {
    const arr = JSON.parse(cleaned) as Array<{ index?: number; label?: string }>;
    for (const item of arr) {
      if (typeof item.index === "number" && item.index >= 0 && item.index < n && item.label) {
        out[item.index] = String(item.label).trim();
      }
    }
  } catch {
    // 解析失败 → 全 null
  }
  return out;
}

// ── 质心计算 ───────────────────────────────────────────────────────────────
function centroidOf(vecs: Float32Array[]): Float32Array | null {
  if (vecs.length === 0) return null;
  const dim = vecs[0].length;
  const sum = new Float32Array(dim);
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vecs.length;
  return sum;
}

function centroidOfMembers(
  storage: Storage,
  tenantId: string,
  userId: string,
  memberIds: string[],
): Float32Array | null {
  const vecs: Float32Array[] = [];
  for (const id of memberIds) {
    const v = storage.getEmbedding(tenantId, userId, id);
    if (v) vecs.push(v);
  }
  return centroidOf(vecs);
}

export function recomputeCentroids(
  storage: Storage,
  log: Logger,
  tenantId: string,
  userId: string,
): number {
  void log;
  const domains = storage.listDomains(tenantId, userId, { includeCold: true });
  let recomputed = 0;
  for (const d of domains) {
    if (d.id === GLOBAL_DOMAIN_ID || d.always_on) continue;
    const memberIds = storage.getDomainMemberIds(tenantId, userId, d.id);
    if (memberIds.length === 0) continue;
    const centroid = centroidOfMembers(storage, tenantId, userId, memberIds);
    if (!centroid) continue;
    storage.upsertDomain(tenantId, userId, {
      ...d,
      prototype_vec: centroid,
      updated_at: nowIso(),
    });
    recomputed++;
  }
  return recomputed;
}

// ── 确定性 2-means（cosine）：种子取最远点对 ───────────────────────────────
function twoMeans(
  items: Array<{ id: string; vec: Float32Array }>,
): { a: string[]; b: string[]; separation: number } | null {
  if (items.length < 2) return null;
  let s1 = 0;
  let s2 = 1;
  let minSim = Infinity;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sim = cosineSimLocal(items[i].vec, items[j].vec);
      if (sim < minSim) {
        minSim = sim;
        s1 = i;
        s2 = j;
      }
    }
  }
  let cA = items[s1].vec;
  let cB = items[s2].vec;
  let aIds: string[] = [];
  let bIds: string[] = [];
  for (let iter = 0; iter < 6; iter++) {
    aIds = [];
    bIds = [];
    const aVecs: Float32Array[] = [];
    const bVecs: Float32Array[] = [];
    for (const it of items) {
      if (cosineSimLocal(it.vec, cA) >= cosineSimLocal(it.vec, cB)) {
        aIds.push(it.id);
        aVecs.push(it.vec);
      } else {
        bIds.push(it.id);
        bVecs.push(it.vec);
      }
    }
    const nA = centroidOf(aVecs);
    const nB = centroidOf(bVecs);
    if (!nA || !nB) break;
    cA = nA;
    cB = nB;
  }
  return { a: aIds, b: bIds, separation: 1 - cosineSimLocal(cA, cB) };
}

// 把记忆的 fromId 领域归属改挂到 toId（保留其它归属，去重）。
function reassignMemoryDomain(
  storage: Storage,
  tenantId: string,
  userId: string,
  memoryId: string,
  fromId: string,
  toId: string,
): void {
  const links = storage.getMemoryDomainsFor(tenantId, userId, [memoryId]);
  const next: MemoryDomain[] = [];
  let hasTo = false;
  for (const l of links) {
    if (l.domain_id === toId) hasTo = true;
    if (l.domain_id === fromId) continue;
    next.push(l);
  }
  if (!hasTo) {
    next.push({ memory_id: memoryId, domain_id: toId, membership_weight: 1.0, is_primary: true });
  }
  storage.setMemoryDomains(tenantId, userId, memoryId, next);
}

// ── split：领域过载且多峰 → 裂子领域 ───────────────────────────────────────
export function splitDomains(
  storage: Storage,
  log: Logger,
  tenantId: string,
  userId: string,
  nowMs: number,
): number {
  const domains = storage.listDomains(tenantId, userId);
  let split = 0;
  for (const d of domains) {
    if (d.id === GLOBAL_DOMAIN_ID || d.always_on) continue;
    if (nowMs - Date.parse(d.created_at) < MIN_DOMAIN_AGE_MS) continue;
    const memberIds = storage.getDomainMemberIds(tenantId, userId, d.id);
    if (memberIds.length < SPLIT_MIN_SIZE) continue;
    const items: Array<{ id: string; vec: Float32Array }> = [];
    for (const id of memberIds) {
      const v = storage.getEmbedding(tenantId, userId, id);
      if (v) items.push({ id, vec: v });
    }
    if (items.length < SPLIT_MIN_SIZE) continue;
    const res = twoMeans(items);
    if (!res) continue;
    if (res.separation < SPLIT_SEPARATION) continue; // 单峰
    if (Math.min(res.a.length, res.b.length) < MIN_CLUSTER_SIZE) continue; // 太偏斜

    const smallSet = new Set(res.a.length <= res.b.length ? res.a : res.b);
    const smallVecs: Float32Array[] = [];
    const largeVecs: Float32Array[] = [];
    for (const it of items) {
      if (smallSet.has(it.id)) smallVecs.push(it.vec);
      else largeVecs.push(it.vec);
    }
    const childId = newPrefixedId("dom");
    const now = nowIso();
    storage.upsertDomain(tenantId, userId, {
      id: childId,
      tenant_id: tenantId,
      user_id: userId,
      label: `${d.label}·子`,
      prototype_vec: centroidOf(smallVecs),
      parent_id: d.id,
      level: d.level + 1,
      status: "warm",
      origin: "emergent",
      always_on: false,
      load_count: 0,
      retrievability: 1.0,
      last_routed_at: undefined,
      created_at: now,
      updated_at: now,
    });
    for (const id of smallSet) {
      reassignMemoryDomain(storage, tenantId, userId, id, d.id, childId);
    }
    storage.upsertDomain(tenantId, userId, {
      ...d,
      prototype_vec: centroidOf(largeVecs) ?? d.prototype_vec,
      updated_at: now,
    });
    split++;
    log("info", "[reflect-domain] split", {
      parent: d.id,
      child: childId,
      small: smallSet.size,
      large: largeVecs.length,
      separation: res.separation,
    });
  }
  return split;
}

// 每条跨域 related 边为两端领域累积的亲和度增量。
const AFFINITY_EDGE_GAIN = 0.2;

/** 数 fromIds 里指向 toSet 的 cross-memory 边数（跨域连接强度的原料）。 */
function countCrossEdges(
  storage: Storage,
  tenantId: string,
  userId: string,
  fromIds: Iterable<string>,
  toSet: Set<string>,
): number {
  let n = 0;
  for (const id of fromIds) {
    const m = storage.findById(tenantId, userId, id);
    if (!m) continue;
    for (const rid of m.related ?? []) if (toSet.has(rid)) n++;
  }
  return n;
}

// ── 共边累积（RFC 0005「共边统计」）：把 domain_affinity 接进生产链路 ───────────
// 跨域的 cross-memory 边 = 两领域相关的信号。每轮 reflect 按跨域边数累积 affinity；
// 持续互链 → affinity 升高 → 达阈值且连接紧密时被 merge。无需 embedding，纯结构信号。
export function accumulateAffinity(
  storage: Storage,
  log: Logger,
  tenantId: string,
  userId: string,
): number {
  const domains = storage
    .listDomains(tenantId, userId)
    .filter((d) => d.id !== GLOBAL_DOMAIN_ID && !d.always_on);
  if (domains.length < 2) return 0;
  // memberId → 所属领域（单归属下唯一；多归属取一个，仅用于边的跨域判定）
  const memberDomain = new Map<string, string>();
  for (const d of domains) {
    for (const id of storage.getDomainMemberIds(tenantId, userId, d.id)) memberDomain.set(id, d.id);
  }
  const pairEdges = new Map<string, number>();
  for (const [id, da] of memberDomain) {
    const m = storage.findById(tenantId, userId, id);
    if (!m) continue;
    for (const rid of m.related ?? []) {
      const db = memberDomain.get(rid);
      if (!db || db === da) continue;
      const key = da < db ? `${da}|${db}` : `${db}|${da}`;
      pairEdges.set(key, (pairEdges.get(key) ?? 0) + 1);
    }
  }
  const now = nowIso();
  let bumped = 0;
  for (const [key, count] of pairEdges) {
    const [a, b] = key.split("|");
    storage.upsertAffinity(tenantId, userId, a as string, b as string, count * AFFINITY_EDGE_GAIN, now);
    bumped++;
  }
  if (bumped > 0) log("info", "[reflect-domain] affinity accumulated", { pairs: bumped });
  return bumped;
}

// ── merge：两领域 affinity 高且（成员交叠大 或 跨域连接紧密）→ 合并（被并方沉 cold）────
export function mergeDomains(
  storage: Storage,
  log: Logger,
  tenantId: string,
  userId: string,
): number {
  const domains = storage.listDomains(tenantId, userId);
  const byId = new Map(domains.map((d) => [d.id, d]));
  const gone = new Set<string>();
  let merged = 0;
  for (const a of domains) {
    if (a.id === GLOBAL_DOMAIN_ID || a.always_on || gone.has(a.id)) continue;
    const affs = storage
      .listAffinities(tenantId, userId, a.id)
      .slice()
      .sort((x, y) => y.affinity - x.affinity);
    for (const aff of affs) {
      if (aff.affinity < MERGE_AFFINITY) break;
      const otherId = aff.domain_a === a.id ? aff.domain_b : aff.domain_a;
      const b = byId.get(otherId);
      if (!b || b.id === GLOBAL_DOMAIN_ID || b.always_on || gone.has(b.id)) continue;
      const aMem = new Set(storage.getDomainMemberIds(tenantId, userId, a.id));
      const bMem = storage.getDomainMemberIds(tenantId, userId, b.id);
      if (bMem.length === 0 || aMem.size === 0) continue;
      const denom = Math.min(aMem.size, bMem.length);
      const overlapCount = bMem.filter((x) => aMem.has(x)).length;
      // 第二道闸：成员交叠 OR 跨域连接紧密度（任一达标）。单归属下交叠恒 0，
      // 此时靠跨域 cross-memory 边的密度来判定两领域是否"其实在讲同一件事"。
      let connection = overlapCount / denom;
      if (connection < MERGE_OVERLAP) {
        const cross = countCrossEdges(storage, tenantId, userId, aMem, new Set(bMem));
        connection = cross / denom;
      }
      if (connection < MERGE_OVERLAP) continue;

      for (const id of bMem) {
        reassignMemoryDomain(storage, tenantId, userId, id, b.id, a.id);
      }
      const now = nowIso();
      storage.upsertDomain(tenantId, userId, {
        ...b,
        status: "cold",
        retrievability: Math.min(b.retrievability, SLEEP_RETRIEVABILITY),
        updated_at: now,
      });
      const aVecs: Float32Array[] = [];
      for (const id of storage.getDomainMemberIds(tenantId, userId, a.id)) {
        const v = storage.getEmbedding(tenantId, userId, id);
        if (v) aVecs.push(v);
      }
      storage.upsertDomain(tenantId, userId, {
        ...a,
        prototype_vec: centroidOf(aVecs) ?? a.prototype_vec,
        updated_at: now,
      });
      gone.add(b.id);
      merged++;
      log("info", "[reflect-domain] merge", { into: a.id, from: b.id, affinity: aff.affinity });
    }
  }
  return merged;
}

// ── sleep：长期未命中 → 沉 cold 降权（反固化）──────────────────────────────
export function sleepDomains(
  storage: Storage,
  log: Logger,
  tenantId: string,
  userId: string,
  nowMs: number,
): number {
  const domains = storage.listDomains(tenantId, userId);
  let slept = 0;
  for (const d of domains) {
    if (d.id === GLOBAL_DOMAIN_ID || d.always_on) continue;
    if (nowMs - Date.parse(d.created_at) < MIN_DOMAIN_AGE_MS) continue;
    const lastMs = d.last_routed_at ? Date.parse(d.last_routed_at) : Date.parse(d.created_at);
    if (nowMs - lastMs < SLEEP_IDLE_MS) continue;
    storage.upsertDomain(tenantId, userId, {
      ...d,
      status: "cold",
      retrievability: Math.min(d.retrievability, SLEEP_RETRIEVABILITY),
      updated_at: nowIso(),
    });
    slept++;
    log("info", "[reflect-domain] sleep", { domain: d.id, idleMs: nowMs - lastMs });
  }
  return slept;
}

// ── 前瞻预测-验证闭环（RFC 0006 §5）────────────────────────────────────────
export async function runProspectiveVerification(
  storage: Storage,
  llm: LLMProvider,
  log: Logger,
  input: { tenantId: string; userId: string },
  recentEpisodic: Memory[],
): Promise<{ verified: number }> {
  const tenantId = input.tenantId;
  const userId = input.userId;
  const all = storage.listProspective(tenantId, userId);
  let verified = 0;
  for (const p of all) {
    const pendingIdx = p.prediction_log.findIndex((x) => !x.resolved);
    if (pendingIdx < 0) continue;
    const match = await matchRealityToCue(llm, log, p.cue, p.projection, recentEpisodic);
    if (!match || !match.occurred) continue;

    const surprise = clamp01(match.surprise);
    const log2: ProspectivePrediction[] = p.prediction_log.map((x, i) =>
      i === pendingIdx
        ? { ...x, actual: match.actual, surprise, resolved: true }
        : x,
    );
    // surprise 高 → 下调 confidence（预测误差驱动修正）
    const nextConfidence = clamp01(p.confidence * (1 - 0.5 * surprise));
    storage.updateProspective(tenantId, userId, p.id, {
      prediction_log: log2,
      confidence: nextConfidence,
      last_verified_at: nowIso(),
    });
    verified++;
    log("info", "[reflect-domain] prospective verified", {
      id: p.id,
      surprise,
      confidence: nextConfidence,
    });
  }
  return { verified };
}

interface RealityMatch {
  occurred: boolean;
  actual: string;
  surprise: number;
}

async function matchRealityToCue(
  llm: LLMProvider,
  log: Logger,
  cue: string,
  projection: string,
  recent: Memory[],
): Promise<RealityMatch | null> {
  if (recent.length === 0) return null;
  const events = recent.map((m, i) => `${i}: ${m.content}`).join("\n");
  const system = `你是前瞻预测验证器。给定一个情境 cue、对该情境的预测 projection、以及最近发生的真实事件列表。
判断：cue 描述的情境是否在真实事件中发生过(occurred)；若发生，真实情况是什么(actual)，与预测的偏离程度 surprise(0-1，0=完全吻合，1=完全相反)。
输出严格 JSON（不要 markdown 围栏）：{"occurred": <bool>, "actual": "<真实情况，未发生则空>", "surprise": <0-1>}`;
  const user = `cue: ${cue}\nprojection: ${projection}\n真实事件:\n${events}\n\n输出 JSON：`;
  let raw: string;
  try {
    raw = await llm.chat(system, user);
  } catch (e) {
    log("warn", "[reflect-domain] matchReality LLM 失败", {
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    const obj = JSON.parse(cleaned) as RealityMatch;
    if (typeof obj.occurred !== "boolean") return null;
    return {
      occurred: obj.occurred,
      actual: typeof obj.actual === "string" ? obj.actual : "",
      surprise: typeof obj.surprise === "number" ? obj.surprise : 0,
    };
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
