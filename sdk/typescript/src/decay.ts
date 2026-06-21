// decay.ts — v0.4 FSRS 简化版衰减引擎
//
// 设计目标：
// - 每条非 archival memory 维护 stability (S) 和 retrievability (R = exp(-Δt/S))
// - 访问命中（search hit）→ S *= 1.3, capped (stability_cap_days)
// - 周期性 worker 任务 decay-scan：算 R；R < threshold 且 access_count==0
//   且距 last_accessed 超过 dormancyDays → 标 cold
// - archival 永不衰减（archival_protected hard skip）
// - 跨 user namespace 永不互相影响（candidate 列表已带 tenant_id / user_id）
//
// 公式与 RFC 0004 §B9 一致；完整 FSRS（含 D 参数）留 v0.5。

import type { Storage } from "./storage.js";
import type { DecayCandidate } from "./storage/types.js";
import type { LogLevel, NemosConfig } from "./types.js";

export interface DecayConfig {
  enabled: boolean;
  coldThreshold: number;       // R 阈值，默认 0.1
  coldDormancyDays: number;    // cold 多少天后 hide search，默认 7
  scanIntervalMs: number;      // worker 跑 decay-scan 的间隔，默认 24h
  stabilityCapDays: number;    // S 上限（天），默认 365
}

export const DECAY_DEFAULTS: DecayConfig = {
  enabled: false,
  coldThreshold: 0.1,
  coldDormancyDays: 7,
  scanIntervalMs: 24 * 60 * 60 * 1000,
  stabilityCapDays: 365,
};

/** 从 NemosConfig 解出 DecayConfig（缺省字段用默认值）。 */
export function resolveDecayConfig(config: NemosConfig): DecayConfig {
  const raw = config.features?.decay;
  if (!raw) return { ...DECAY_DEFAULTS };
  return {
    enabled: raw.enabled === true,
    coldThreshold:
      typeof raw.coldThreshold === "number" ? raw.coldThreshold : DECAY_DEFAULTS.coldThreshold,
    coldDormancyDays:
      typeof raw.coldDormancyDays === "number"
        ? raw.coldDormancyDays
        : DECAY_DEFAULTS.coldDormancyDays,
    scanIntervalMs:
      typeof raw.scanIntervalMs === "number"
        ? raw.scanIntervalMs
        : DECAY_DEFAULTS.scanIntervalMs,
    stabilityCapDays:
      typeof raw.stabilityCapDays === "number"
        ? raw.stabilityCapDays
        : DECAY_DEFAULTS.stabilityCapDays,
  };
}

/**
 * 命中后的 S 强化：S *= 1.3，capped at cap。
 * 已是 cap 的不再增长。S 必须 > 0。
 */
export function reinforceStability(currentS: number, cap: number): number {
  const safe = currentS > 0 ? currentS : 1.0;
  return Math.min(safe * 1.3, cap);
}

/**
 * 计算 retrievability：R = exp(-Δt / S)
 * Δt = (now - lastAccessed) days；S 单位也是天。
 *
 * 边界：
 * - S <= 0 → 返回 0（已遗忘）
 * - Δt < 0（last_accessed 在未来）→ 返回 1.0（刚 touch）
 */
export function computeRetrievability(
  nowMs: number,
  lastAccessedMs: number,
  stability: number,
): number {
  if (stability <= 0) return 0;
  const dtDays = (nowMs - lastAccessedMs) / (24 * 60 * 60 * 1000);
  if (dtDays <= 0) return 1.0;
  return Math.exp(-dtDays / stability);
}

/**
 * 决定一条 candidate 在本次 scan 是否应该被标 cold。
 *
 * 规则（与 RFC 0004 §B9 一致）：
 * 1. 已经 cold → 不再处理
 * 2. archival_protected → 跳过
 * 3. access_count > 0 → 跳过（被访问过，认为还有价值）
 * 4. R 必须 < coldThreshold
 * 5. 距离 last_accessed 必须 ≥ coldDormancyDays
 */
export interface DecayDecision {
  shouldMarkCold: boolean;
  retrievability: number;
}

export function decideDecay(
  candidate: DecayCandidate,
  config: Pick<DecayConfig, "coldThreshold" | "coldDormancyDays">,
  nowMs: number,
): DecayDecision {
  if (candidate.archival_protected === 1) {
    return { shouldMarkCold: false, retrievability: 1.0 };
  }
  const lastMs = Date.parse(candidate.last_accessed);
  const dtMs = nowMs - lastMs;
  const r = computeRetrievability(nowMs, lastMs, candidate.stability);
  if (candidate.cold === 1) {
    return { shouldMarkCold: false, retrievability: r };
  }
  if (candidate.access_count > 0) {
    return { shouldMarkCold: false, retrievability: r };
  }
  const dormancyMs = config.coldDormancyDays * 24 * 60 * 60 * 1000;
  if (dtMs < dormancyMs) {
    return { shouldMarkCold: false, retrievability: r };
  }
  return { shouldMarkCold: r < config.coldThreshold, retrievability: r };
}

/**
 * 跑一次 decay scan：扫描所有非 archival 候选；标 cold 满足条件的。
 *
 * 返回 { scanned, cooled }；nowMs 默认用 Date.now()，测试可注入。
 */
export interface DecayScanResult {
  scanned: number;
  cooled: number;
}

export function runDecayScan(
  storage: Storage,
  config: DecayConfig,
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
  nowMsOpt?: number,
): DecayScanResult {
  if (!config.enabled) return { scanned: 0, cooled: 0 };
  const nowMs = nowMsOpt ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const candidates = storage.listDecayCandidates(5000);
  let cooled = 0;
  for (const c of candidates) {
    const decision = decideDecay(c, config, nowMs);
    // 总是把 R 写回（便于审计）
    storage.updateDecayMeta(c.tenant_id, c.user_id, c.layer, c.id, decision.retrievability, nowIso);
    if (decision.shouldMarkCold) {
      storage.markCold(c.tenant_id, c.user_id, c.layer, c.id, nowIso);
      cooled++;
    }
  }
  log("info", "[nemos decay] scan finished", { scanned: candidates.length, cooled });
  return { scanned: candidates.length, cooled };
}
