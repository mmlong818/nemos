// queue.ts — v0.3 后台 ingest 队列 + Worker
//
// 设计目标：
// - archival 仍由调用方同步写入（守住"用户原文 0 损失"承诺）
// - derived 抽取 / entity 抽取 / cross-memory linking 走队列异步
// - 进程崩溃后恢复：启动时把 'analyzing' 重置为 'queued'
// - 失败重试 backoff 1s / 4s / 16s（attempts 1/2/3）；超出 → 'failed'
// - 无第三方依赖：只用 setTimeout/Promise/SQLite
//
// 单线程串行处理（v0.3 不做并行）；若调用方需要 throughput，可起多个 Nemos
// 实例指向同一 DB（SQLite 的写锁保证安全；后续 v0.4 可加 row-level claim）。

import { analyze } from "./analyzer.js";
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
  type NemosConfig,
  type Perspective,
  type ScenarioProfile,
} from "./types.js";
import type { IngestQueueRow, Storage } from "./storage.js";
import { newId, nowIso } from "./utils/id.js";
import type { LifecycleOrchestrator } from "./lifecycle.js";

export interface WorkerDeps {
  storage: Storage;
  llm: LLMProvider;
  embedding: EmbeddingProvider | null;
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void;
  lifecycle: LifecycleOrchestrator;
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

export class NemosWorker {
  private readonly deps: WorkerDeps;
  private readonly features: Required<Pick<NemosConfig, "defaultScope" | "tenantId">> & NemosConfig;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly manual: boolean;

  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;

  /** 在途异步工作（游离 reflect / 定时 tick）。close() 前 drain，防止恢复执行时命中已关闭的连接。 */
  private readonly inFlight = new Set<Promise<unknown>>();
  /** 同进程内 derived 完成回调（测试 / API polling 友好）。 */
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly reflectInFlight = new Map<string, Promise<ReflectResult>>();

  // v0.4：decay / reflect 配置 + 调度
  private readonly decayConfig: DecayConfig;
  private readonly reflectConfig: ReflectConfig;
  private lastDecayScanMs = 0;

  constructor(deps: WorkerDeps, config: NemosConfig) {
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

    // 崩溃恢复（analyzingLeaseMs>0 时按租约窗口，避免多实例共库互抢在途任务）
    const reset = deps.storage.resetStaleAnalyzing(config.worker?.analyzingLeaseMs ?? 0);
    if (reset > 0) {
      deps.log("info", `[nemos worker] 启动恢复：${reset} 个 'analyzing' → 'queued'`);
    }
  }

  /** v0.4：导出 decay/reflect 配置（user-memory 用来判定 auto-trigger）。 */
  getDecayConfig(): DecayConfig {
    return this.decayConfig;
  }

  getReflectConfig(): ReflectConfig {
    return this.reflectConfig;
  }

  /** 登记一个在途 promise，settle 后自动移除。 */
  private track<T>(p: Promise<T>): Promise<T> {
    this.inFlight.add(p);
    const drop = () => this.inFlight.delete(p);
    p.then(drop, drop);
    return p;
  }

  /** 是否有在途异步工作。 */
  hasInFlight(): boolean {
    return this.inFlight.size > 0;
  }

  /**
   * 等待全部在途异步工作 settle（含 drain 期间新产生的级联工作）。
   * Nemos.close() 在关闭 storage 前调用。
   */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  runAutomaticReflectFor(tenantId: string, userId: string, defaultScope: string): Promise<ReflectResult> {
    if (this.stopped) return Promise.reject(new Error("[nemos] worker 已停止，拒绝新的 reflect"));
    return this.scheduleReflect(tenantId, userId, defaultScope, true);
  }
  /** 手动 reflect 保留显式失效能力；自动 reflect 先以 shadow mode 运行。 */
  runReflectFor(tenantId: string, userId: string, defaultScope: string): Promise<ReflectResult> {
    if (this.stopped) return Promise.reject(new Error("[nemos] worker 已停止，拒绝新的 reflect"));
    return this.scheduleReflect(tenantId, userId, defaultScope, false);
  }

  private scheduleReflect(tenantId: string, userId: string, scope: string, automatic: boolean): Promise<ReflectResult> {
    const key = JSON.stringify([tenantId, userId, scope]);
    const existing = this.reflectInFlight.get(key);
    if (existing) return existing;
    const running = this.track(this.doRunReflect(tenantId, userId, scope, automatic));
    this.reflectInFlight.set(key, running);
    const clear = () => this.reflectInFlight.delete(key);
    running.then(clear, clear);
    return running;
  }

  private async doRunReflect(
    tenantId: string,
    userId: string,
    defaultScope: string,
    automatic: boolean,
  ): Promise<ReflectResult> {
    const state = this.deps.storage.getReflectionState(tenantId, userId, defaultScope);
    const targetEventSeq = this.deps.storage.getLatestEventSeq(tenantId, userId, defaultScope);
    const owner = `reflect_${process.pid}_${newId("archival")}`;
    const now = nowIso();
    const leaseUntil = new Date(Date.now() + 60_000).toISOString();
    if (!this.deps.storage.tryAcquireReflectionLease(tenantId, userId, defaultScope, owner, leaseUntil, now)) {
      return { episodicConsumed: 0, anchorCount: 0, derived: [], skippedReason: "lease-held" };
    }
    try {
      const result = await runReflect(
        this.deps.storage,
        this.deps.llm,
        this.deps.embedding,
        this.deps.log,
        this.reflectConfig,
        {
          tenantId,
          userId,
          defaultScope,
          afterEventSeq: automatic ? state.last_event_seq : undefined,
          upToEventSeq: automatic ? targetEventSeq : undefined,
          domainsEnabled: this.features.features?.domains?.enabled === true,
          prospectiveEnabled: this.features.features?.prospective?.enabled === true,
          invalidationEnabled: automatic ? false : this.features.features?.invalidation?.enabled === true,
          invalidationDetector: this.features.features?.invalidation?.detector,
          invalidationTopN: this.features.features?.invalidation?.candidateTopN,
          invalidationMinCosine: this.features.features?.invalidation?.minCosine,
        },
      );
      this.deps.storage.updateReflectionState({
        ...state,
        last_event_seq: targetEventSeq,
        last_run_at: nowIso(),
        lease_owner: null,
        lease_until: null,
        last_error: null,
      });
      return result;
    } catch (error) {
      this.deps.storage.updateReflectionState({
        ...state,
        lease_owner: null,
        lease_until: null,
        last_error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** v0.4：调用方手动跑一次 decay scan。 */
  runDecayScanNow(nowMs?: number): { scanned: number; cooled: number } {
    return runDecayScan(this.deps.storage, this.decayConfig, this.deps.log, nowMs);
  }

  /** 持久化 event_seq 游标判定自动 reflect，进程重启不会重复消费旧批次。 */
  async maybeAutoReflect(tenantId: string, userId: string, defaultScope: string): Promise<ReflectResult | null> {
    if (this.stopped || !this.reflectConfig.enabled) return null;
    const key = JSON.stringify([tenantId, userId, defaultScope]);
    const running = this.reflectInFlight.get(key);
    if (running) await running;
    const state = this.deps.storage.getReflectionState(tenantId, userId, defaultScope);
    const latest = this.deps.storage.getLatestEventSeq(tenantId, userId, defaultScope);
    if (latest - state.last_event_seq < this.reflectConfig.autoTriggerThreshold) return null;
    return this.scheduleReflect(tenantId, userId, defaultScope, true);
  }

  /** 启动 auto-poll（manualWorker 模式下不会启；pollIntervalMs<=0 也不启）。 */
  start(): void {
    if (this.manual || this.stopped) return;
    if (this.pollIntervalMs <= 0) return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.track(this.runTick()).catch((e) => {
        this.deps.log("warn", "[nemos worker] tick 异常", {
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
    const row: Omit<IngestQueueRow, "updated_at" | "completed_at" | "derived_count" | "next_attempt_at"> = {
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
          reject(new Error(`[nemos] queue id 不存在: ${id}`));
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
        reject(new Error(`[nemos] waitFor 超时: ${id}`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  /**
   * 跑一次 tick：取一个 queued 任务跑一次。无任务则 no-op。
   * 调用方在 manualWorker 模式下也可手动调（serverless 场景）。
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
            this.deps.log("warn", "[nemos worker] decay-scan 失败", {
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
    // takeNextQueued 已原子认领（status=analyzing），这里只记 attempts
    this.deps.storage.updateQueueStatus(row.id, { attempts });

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
      this.deps.log("warn", "[nemos worker] 任务失败", { id: row.id, attempts, err: msg });
      const lifecycle = this.deps.lifecycle.status(row.archival_id);
      const completedStages = new Set(
        lifecycle?.stages.filter((stage) => stage.status === "completed").map((stage) => stage.stage),
      );
      const failedStage = !completedStages.has("extract")
        ? "extract"
        : (!completedStages.has("persist") ? "persist" : "link");
      this.deps.lifecycle.markFailure(row.archival_id, failedStage, e);

      if (attempts >= this.maxAttempts) {
        this.deps.storage.updateQueueStatus(row.id, {
          status: "failed",
          last_error: msg,
          completed_at: nowIso(),
        });
        this.notifyDone(row.id);
        return;
      }
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 16000;
      this.deps.storage.updateQueueStatus(row.id, {
        status: "queued",
        last_error: msg,
        next_attempt_at: new Date(Date.now() + wait).toISOString(),
      });
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
    const cached = this.deps.lifecycle.loadExtraction(row.archival_id);
    let derived: Memory[];
    if (cached) {
      derived = cached;
    } else {
      const scenarioRaw = row.scenario_json
        ? (JSON.parse(row.scenario_json) as string | ScenarioProfile)
        : undefined;
      const profile = resolveScenario(scenarioRaw);
      const perspectives = row.perspectives_json
        ? (JSON.parse(row.perspectives_json) as Perspective[])
        : undefined;
      const result = await analyze(row.content, row.scope, this.deps.llm, row.origin_agent ?? undefined, {
        profile,
        contentDate: row.content_date ?? undefined,
        doubleCheck: perspectives?.length ? false : this.features.features?.doubleCheck !== false,
        perspectives,
      });
      derived = result.derived.map((memory) => ({ ...memory, archival_ref: row.archival_id, generation: 1 }));
      this.deps.lifecycle.recordExtraction(row.archival_id, derived);
    }
    const result = await this.deps.lifecycle.processDerived(row.tenant_id, row.user_id, row.archival_id, derived);
    this.deps.lifecycle.markScheduled(row.archival_id, { background: true });
    if (result.hasConflict && this.features.features?.reflect?.enabled) {
      void this.runAutomaticReflectFor(row.tenant_id, row.user_id, row.scope);
    } else {
      void this.maybeAutoReflect(row.tenant_id, row.user_id, row.scope);
    }
    return result.persisted.length;
  }
}
