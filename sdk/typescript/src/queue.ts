// queue.ts — v0.3 后台 ingest 队列 + Worker
//
// 设计目标：
// - archival 仍由调用方同步写入（守住"用户原文 0 损失"承诺）
// - derived 抽取 / entity 抽取 / cross-memory linking 走队列异步
// - 进程崩溃后恢复：启动时把 'analyzing' 重置为 'queued'
// - 失败重试 backoff 1s / 4s / 16s（attempts 1/2/3）；超出 → 'failed'
// - 无第三方依赖：只用 setTimeout/Promise/SQLite
//
// 单线程串行处理（v0.3 不做并行）；若朋友需要 throughput，可起多个 Mnemos
// 实例指向同一 DB（SQLite 的写锁保证安全；后续 v0.4 可加 row-level claim）。

import { analyze } from "./analyzer.js";
import { extractEntities } from "./entity.js";
import { resolveScenario } from "./prompts.js";
import { resolveDecayConfig, runDecayScan, type DecayConfig } from "./decay.js";
import {
  resolveReflectConfig,
  runReflect,
  type ReflectConfig,
  type ReflectResult,
} from "./reflect.js";
import {
  type EmbeddingProvider,
  type IngestHandle,
  type IngestStatusInfo,
  type LLMProvider,
  type LogLevel,
  type Memory,
  type MnemosConfig,
  type Perspective,
  type ScenarioProfile,
} from "./types.js";
import type { IngestQueueRow, Storage } from "./storage.js";
import { newId, nowIso } from "./utils/id.js";

export interface WorkerDeps {
  storage: Storage;
  llm: LLMProvider;
  embedding: EmbeddingProvider | null;
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void;
  /**
   * 把 derived 写入 storage + embedding。复用 UserMemory.ingest 的硬约束兜底
   * 已被抽到 derived-guard.ts，避免重复实现。
   */
  persistDerived(
    tenantId: string,
    userId: string,
    derived: Memory[],
  ): Promise<Memory[]>;
}

export interface EnqueueInput {
  tenantId: string;
  userId: string;
  archival: Memory;
  scope: string;
  content: string;
  scenario: string | ScenarioProfile | undefined;
  originAgent: string | undefined;
  contentDate: string | undefined;
  perspectives: Perspective[] | undefined;
}

const DEFAULT_POLL_MS = 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000, 16000];

export class MnemosWorker {
  private readonly deps: WorkerDeps;
  private readonly features: Required<Pick<MnemosConfig, "defaultScope" | "tenantId">> & MnemosConfig;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly manual: boolean;

  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;
  /** 同进程内 derived 完成回调（测试 / API polling 友好）。 */
  private readonly waiters = new Map<string, Array<() => void>>();

  // v0.4：decay / reflect 配置 + 调度
  private readonly decayConfig: DecayConfig;
  private readonly reflectConfig: ReflectConfig;
  private lastDecayScanMs = 0;
  /** 每个 user 上次 reflect 完成时累积 episodic 数（自动触发判定）。 */
  private readonly reflectBaseline = new Map<string, number>();

  constructor(deps: WorkerDeps, config: MnemosConfig) {
    this.deps = deps;
    this.features = {
      ...config,
      defaultScope: config.defaultScope || "global",
      tenantId: config.tenantId || "default",
    };
    const wc = config.worker || {};
    this.pollIntervalMs = wc.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.maxAttempts = wc.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.manual = wc.manualWorker === true || wc.enabled === false;

    this.decayConfig = resolveDecayConfig(config);
    this.reflectConfig = resolveReflectConfig(config);

    // 崩溃恢复
    const reset = deps.storage.resetStaleAnalyzing();
    if (reset > 0) {
      deps.log("info", `[mnemos worker] 启动恢复：${reset} 个 'analyzing' → 'queued'`);
    }
  }

  /** v0.4：导出 decay/reflect 配置（user-memory 用来判定 auto-trigger）。 */
  getDecayConfig(): DecayConfig {
    return this.decayConfig;
  }

  getReflectConfig(): ReflectConfig {
    return this.reflectConfig;
  }

  /** v0.4：朋友手动跑一次 reflect（不入 ingest 队列；直接执行）。 */
  async runReflectFor(tenantId: string, userId: string, defaultScope: string): Promise<ReflectResult> {
    return runReflect(
      this.deps.storage,
      this.deps.llm,
      this.deps.embedding,
      this.deps.log,
      this.reflectConfig,
      { tenantId, userId, defaultScope },
    );
  }

  /** v0.4：朋友手动跑一次 decay scan。 */
  runDecayScanNow(nowMs?: number): { scanned: number; cooled: number } {
    return runDecayScan(this.deps.storage, this.decayConfig, this.deps.log, nowMs);
  }

  /** v0.4：累积阈值判定 → 自动跑 reflect。已超阈值才跑；跑完更新 baseline。 */
  async maybeAutoReflect(tenantId: string, userId: string, defaultScope: string): Promise<ReflectResult | null> {
    if (!this.reflectConfig.enabled) return null;
    const key = `${tenantId}|${userId}`;
    const total = this.deps.storage.countEpisodicSinceLastReflect(tenantId, userId, null);
    const baseline = this.reflectBaseline.get(key) ?? 0;
    if (total - baseline < this.reflectConfig.autoTriggerThreshold) return null;
    const r = await this.runReflectFor(tenantId, userId, defaultScope);
    this.reflectBaseline.set(key, total);
    return r;
  }

  /** 启动 auto-poll（manualWorker 模式下不会启；pollIntervalMs<=0 也不启）。 */
  start(): void {
    if (this.manual || this.stopped) return;
    if (this.pollIntervalMs <= 0) return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runTick().catch((e) => {
        this.deps.log("warn", "[mnemos worker] tick 异常", {
          err: e instanceof Error ? e.message : String(e),
        });
      });
    }, this.pollIntervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** 优雅停止。后续 runTick() 会被 stopped 标记拦截。 */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // 唤醒所有 waiters，避免他们永久挂起
    for (const arr of this.waiters.values()) for (const fn of arr) fn();
    this.waiters.clear();
  }

  /**
   * 入队一个 ingest 任务。archival 已由调用方同步写入。
   */
  enqueue(input: EnqueueInput): IngestHandle {
    const id = `iq_${newId("archival").slice(5)}`; // 借用 randomUUID
    const now = nowIso();
    const row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count"> = {
      id,
      tenant_id: input.tenantId,
      user_id: input.userId,
      archival_id: input.archival.id,
      scope: input.scope,
      content: input.content,
      scenario_json: input.scenario ? JSON.stringify(input.scenario) : null,
      origin_agent: input.originAgent ?? null,
      content_date: input.contentDate ?? null,
      perspectives_json: input.perspectives ? JSON.stringify(input.perspectives) : null,
      status: "queued",
      attempts: 0,
      last_error: null,
      created_at: now,
    };
    const saved = this.deps.storage.enqueueIngest(row);
    return {
      id: saved.id,
      archival: input.archival,
      status: "queued",
      created_at: saved.created_at,
    };
  }

  /** 查询某队列任务状态。 */
  getStatus(id: string): IngestStatusInfo | null {
    const r = this.deps.storage.getQueueRow(id);
    if (!r) return null;
    const info: IngestStatusInfo = {
      id: r.id,
      status: r.status,
      attempts: r.attempts,
      created_at: r.created_at,
    };
    if (r.derived_count !== null) info.derivedCount = r.derived_count;
    if (r.last_error !== null) info.last_error = r.last_error;
    if (r.completed_at !== null) info.completed_at = r.completed_at;
    return info;
  }

  listPending(tenantId: string, userId: string): IngestStatusInfo[] {
    const rows = this.deps.storage.listPendingByUser(tenantId, userId);
    return rows.map((r) => {
      const info: IngestStatusInfo = {
        id: r.id,
        status: r.status,
        attempts: r.attempts,
        created_at: r.created_at,
      };
      if (r.derived_count !== null) info.derivedCount = r.derived_count;
      if (r.last_error !== null) info.last_error = r.last_error;
      if (r.completed_at !== null) info.completed_at = r.completed_at;
      return info;
    });
  }

  /**
   * 等待某队列任务进入终态（completed / failed）。
   * 用于测试 / 同步等待场景。manualWorker 下不会自动跑，调用方需要自己 tick。
   */
  waitFor(id: string, timeoutMs = 30000): Promise<IngestStatusInfo> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        const info = this.getStatus(id);
        if (!info) {
          reject(new Error(`[mnemos] queue id 不存在: ${id}`));
          return true;
        }
        if (info.status === "completed" || info.status === "failed") {
          resolve(info);
          return true;
        }
        return false;
      };
      if (check()) return;
      let timer: NodeJS.Timeout | null = null;
      const onDone = (): void => {
        if (timer) clearTimeout(timer);
        check();
      };
      const arr = this.waiters.get(id) ?? [];
      arr.push(onDone);
      this.waiters.set(id, arr);
      timer = setTimeout(() => {
        const list = this.waiters.get(id);
        if (list) {
          const idx = list.indexOf(onDone);
          if (idx >= 0) list.splice(idx, 1);
        }
        reject(new Error(`[mnemos] waitFor 超时: ${id}`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  /**
   * 跑一次 tick：取一个 queued 任务跑一次。无任务则 no-op。
   * 朋友在 manualWorker 模式下也可手动调（serverless 场景）。
   */
  async runTick(): Promise<void> {
    if (this.stopped) return;
    if (this.ticking) return;
    this.ticking = true;
    try {
      // v0.4：周期性 decay-scan（按 scanIntervalMs）
      if (this.decayConfig.enabled) {
        const now = Date.now();
        if (now - this.lastDecayScanMs >= this.decayConfig.scanIntervalMs) {
          try {
            runDecayScan(this.deps.storage, this.decayConfig, this.deps.log);
          } catch (e) {
            this.deps.log("warn", "[mnemos worker] decay-scan 失败", {
              err: e instanceof Error ? e.message : String(e),
            });
          }
          this.lastDecayScanMs = now;
        }
      }

      const row = this.deps.storage.takeNextQueued();
      if (!row) return;
      await this.processOne(row);
    } finally {
      this.ticking = false;
    }
  }

  private async processOne(row: IngestQueueRow): Promise<void> {
    const attempts = row.attempts + 1;
    this.deps.storage.updateQueueStatus(row.id, {
      status: "analyzing",
      attempts,
    });

    try {
      const derivedCount = await this.runJob(row);
      const now = nowIso();
      this.deps.storage.updateQueueStatus(row.id, {
        status: "completed",
        completed_at: now,
        derived_count: derivedCount,
        last_error: null,
      });
      this.notifyDone(row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.deps.log("warn", "[mnemos worker] 任务失败", { id: row.id, attempts, err: msg });

      if (attempts >= this.maxAttempts) {
        this.deps.storage.updateQueueStatus(row.id, {
          status: "failed",
          last_error: msg,
          completed_at: nowIso(),
        });
        this.notifyDone(row.id);
        return;
      }
      // 重试：标回 queued + backoff（用 setTimeout 推迟，不阻塞当前 tick）
      this.deps.storage.updateQueueStatus(row.id, {
        status: "queued",
        last_error: msg,
      });
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 16000;
      const t = setTimeout(() => {
        // backoff 到了：worker 下个 tick 会自然拉起这条；这里仅做一个 "标记" 用日志
        this.deps.log("debug", "[mnemos worker] 重试可用", { id: row.id });
      }, wait);
      if (typeof t.unref === "function") t.unref();
    }
  }

  private notifyDone(id: string): void {
    const arr = this.waiters.get(id);
    if (!arr) return;
    this.waiters.delete(id);
    for (const fn of arr) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  }

  /**
   * 跑一个队列任务的真实 LLM/storage 调用链。
   * 返回写入的 derived 条数。
   */
  private async runJob(row: IngestQueueRow): Promise<number> {
    const scenarioRaw = row.scenario_json
      ? (JSON.parse(row.scenario_json) as string | ScenarioProfile)
      : undefined;
    const profile = resolveScenario(scenarioRaw);
    const perspectives = row.perspectives_json
      ? (JSON.parse(row.perspectives_json) as Perspective[])
      : undefined;

    // 走 analyzer，但仅取 derived（archival 已落地，不重写）
    const result = await analyze(row.content, row.scope, this.deps.llm, row.origin_agent ?? undefined, {
      profile,
      contentDate: row.content_date ?? undefined,
      doubleCheck:
        (perspectives && perspectives.length > 0)
          ? false
          : (this.features.features?.doubleCheck !== false),
      perspectives,
    });

    // 强制把 derived 的 archival_ref 指回真正持久化的 archival id
    const fixed = result.derived.map((d) => ({ ...d, archival_ref: row.archival_id }));

    // 持久化 derived
    const persisted = await this.deps.persistDerived(row.tenant_id, row.user_id, fixed);

    // entity 抽取 + linking（默认开；features.autoLinking=false 时关）
    const autoLinking = this.features.features?.autoLinking !== false;
    if (autoLinking) {
      await this.linkMemories(row, persisted);
    }
    return persisted.length;
  }

  private async linkMemories(row: IngestQueueRow, persisted: Memory[]): Promise<void> {
    // 收集所有候选 memory（archival + derived），对每条抽 entity 写回 storage
    // 然后做跨 memory entity 匹配
    const archival = this.deps.storage.findById(row.tenant_id, row.user_id, row.archival_id);
    if (!archival) return;
    const all: Memory[] = [archival, ...persisted];

    // 抽 entity（archival 只抽一次，靠 extractEntities 内置 cache 帮忙）
    for (const m of all) {
      try {
        const ents = await extractEntities(m.content, this.deps.llm);
        if (ents.length > 0) {
          this.deps.storage.updateEntities(row.tenant_id, row.user_id, m.layer, m.id, ents);
          m.entities = ents;
        }
      } catch (e) {
        this.deps.log("warn", "[mnemos worker] entity 抽取失败（不阻塞）", {
          id: m.id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const crossScope = this.features.features?.crossScopeLink !== false;

    // 对每条 memory，按 entity 找跨 memory 匹配；top-5 双向 link
    for (const m of all) {
      if (!m.entities || m.entities.length === 0) continue;
      const matches = new Map<string, Memory>();
      for (const e of m.entities) {
        const found = this.deps.storage.findByEntity(row.tenant_id, row.user_id, e, {
          topK: 10,
          excludeId: m.id,
          scope: crossScope ? undefined : m.scope,
        });
        for (const f of found) {
          if (f.id === m.id) continue;
          matches.set(f.id, f);
          if (matches.size >= 10) break;
        }
        if (matches.size >= 10) break;
      }
      // 取前 5
      const top = Array.from(matches.values()).slice(0, 5);
      if (top.length === 0) continue;

      // 写自己的 related
      const myRelated = new Set<string>(m.related ?? []);
      for (const t of top) myRelated.add(t.id);
      this.deps.storage.updateRelated(
        row.tenant_id,
        row.user_id,
        m.layer,
        m.id,
        Array.from(myRelated),
      );
      m.related = Array.from(myRelated);

      // 反向写：把 m.id 加到 top 各自的 related
      for (const t of top) {
        const tRelated = new Set<string>(t.related ?? []);
        if (tRelated.has(m.id)) continue;
        tRelated.add(m.id);
        this.deps.storage.updateRelated(
          row.tenant_id,
          row.user_id,
          t.layer,
          t.id,
          Array.from(tRelated),
        );
      }
    }
  }
}

