// 模型连接切换的阶段状态机。
//
// 为什么需要它：原先只有一个进程内布尔量 modelConnectionUpdating，而
// hasActiveModelJobs() 只在切换开始前查一次。rebuildLLM 要 await boot()，
// 这段时间后台 worker 仍能领到新任务，看到的是半换完的运行时。
// 这里在整个切换窗口内挡住新任务领取，并把「有任务在跑」从一律硬拒
// 改成可按调用方给的预算有界排空。
//
// 刻意没有 verifying 阶段：保存连接本来就不探测服务可用性（检查是
// /api/llm-model/check 那个要用户明确点的入口），在这里加探测会改变产品语义。
//
// 尝试记录只在内存里，给界面看当前进展用。可追溯的审计仍然是
// agentUserActions 那条链（每次切换都有 auditRunId）。

export type ModelSwitchPhase =
  | "idle"
  /** 前置检查：是否已有切换在途、是否有模型任务在跑。 */
  | "validating"
  /** 等在跑的模型任务结束。只有调用方给了预算才会进入。 */
  | "draining"
  /** 落盘并重建运行时。 */
  | "activating"
  /** 切换完成。 */
  | "committed"
  /** 进到 activating 之后失败，已退回原连接。 */
  | "rolled_back"
  /** 前置检查没过，什么都没动。 */
  | "refused";

export interface ModelSwitchAttempt {
  id: string;
  /** 切换目标的可展示标签。不含密钥。 */
  target: string;
  phase: ModelSwitchPhase;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  /** 排空实际等了多少毫秒；0 表示没有需要等的任务。 */
  drainedMs?: number;
}

export interface ModelSwitchState {
  phase: ModelSwitchPhase;
  attempt: ModelSwitchAttempt | null;
  recent: ModelSwitchAttempt[];
}

export class ModelSwitchBusyError extends Error {
  readonly code = "model_update_busy";
  constructor(message = "another model switch is in progress") {
    super(message);
    this.name = "ModelSwitchBusyError";
  }
}

export class ModelSwitchJobsActiveError extends Error {
  readonly code = "model_jobs_active";
  constructor(message = "model jobs are still running") {
    super(message);
    this.name = "ModelSwitchJobsActiveError";
  }
}

export interface ModelSwitchDeps {
  /** 是否还有会用到模型连接的任务在跑。 */
  readonly hasActiveJobs: () => boolean;
  /** 挡住新任务领取，返回恢复函数。恢复函数在所有分支都会被调用。 */
  readonly holdJobIntake: () => () => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxRecent?: number;
  readonly maxDrainMs?: number;
}

const DEFAULT_MAX_RECENT = 10;
const DEFAULT_MAX_DRAIN_MS = 120_000;
const DRAIN_POLL_MS = 200;

export class ModelSwitchCoordinator {
  private phase: ModelSwitchPhase = "idle";
  /**
   * 模型设置类操作的互斥锁。切换、显式检查、目录读取共用它——
   * 它们都读写同一份连接状态，任意两个并行都会互相看到半截数据。
   * 和 phase 分开：phase 只描述"有没有切换在进行"，检查和目录读取不是切换。
   */
  private locked = false;
  private current: ModelSwitchAttempt | null = null;
  private readonly history: ModelSwitchAttempt[] = [];
  private readonly maxRecent: number;
  private readonly maxDrainMs: number;

  constructor(private readonly deps: ModelSwitchDeps) {
    this.maxRecent = Math.min(50, Math.max(1, deps.maxRecent ?? DEFAULT_MAX_RECENT));
    this.maxDrainMs = Math.min(10 * 60_000, Math.max(0, deps.maxDrainMs ?? DEFAULT_MAX_DRAIN_MS));
  }

  state(): ModelSwitchState {
    return {
      phase: this.phase,
      attempt: this.current ? { ...this.current } : null,
      recent: this.history.map((item) => ({ ...item })),
    };
  }

  /**
   * 串行执行一次切换。activate 里应当放真正会改状态的动作（落盘 + 重建运行时）；
   * 它自己负责失败回滚，这里只负责阶段、排空与任务领取的闸门。
   */
  /**
   * 只上互斥锁，不做排空、不挡任务领取、不记尝试。
   * 给显式模型检查和目录读取用：它们不改连接，但必须和切换互斥。
   * 拿不到锁返回 null，由调用方决定怎么回话。
   */
  tryLock(): (() => void) | null {
    if (this.locked) return null;
    this.locked = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locked = false;
    };
  }

  async run<T>(options: { target: string; drainMs?: number }, activate: () => Promise<T>): Promise<T> {
    const unlock = this.tryLock();
    if (!unlock) throw new ModelSwitchBusyError();
    const attempt: ModelSwitchAttempt = {
      id: `sw_${this.nowMs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      target: String(options.target || "unknown").slice(0, 120),
      phase: "validating",
      startedAt: new Date(this.nowMs()).toISOString(),
    };
    this.current = attempt;
    this.phase = "validating";
    try {
      attempt.drainedMs = await this.drain(attempt, options.drainMs ?? 0);
      // 闸门只在确实要切的时候才动 worker。放在排空之前会让"被拒绝的切换"
      // 也 stop/start 一次，扰动在跑任务的领取时序——那会让重启时的对账
      // 把它标成 uncertain，而不是让它按连接指纹失败。
      const release = this.deps.holdJobIntake();
      try {
        // 停掉领取之后再确认一次：排空判定和停掉之间仍有极小的窗口。
        if (this.deps.hasActiveJobs()) throw new ModelSwitchJobsActiveError("a model job started while closing the gate");
        this.enter(attempt, "activating");
        const value = await activate();
        this.finish(attempt, "committed");
        return value;
      } finally {
        release();
      }
    } catch (error) {
      attempt.error = error instanceof Error ? error.message : String(error);
      // 没进到 activating 就说明什么都没动，别谎报成"已回滚"。
      this.finish(attempt, attempt.phase === "activating" ? "rolled_back" : "refused");
      throw error;
    } finally {
      unlock();
    }
  }

  private async drain(attempt: ModelSwitchAttempt, requestedMs: number): Promise<number> {
    if (!this.deps.hasActiveJobs()) return 0;
    const budget = Math.min(this.maxDrainMs, Math.max(0, requestedMs));
    if (budget <= 0) throw new ModelSwitchJobsActiveError();
    this.enter(attempt, "draining");
    const startedAt = this.nowMs();
    for (;;) {
      await this.pause(DRAIN_POLL_MS);
      const waited = this.nowMs() - startedAt;
      if (!this.deps.hasActiveJobs()) return waited;
      if (waited >= budget) {
        throw new ModelSwitchJobsActiveError("timed out waiting for model jobs to finish");
      }
    }
  }

  private enter(attempt: ModelSwitchAttempt, phase: ModelSwitchPhase): void {
    attempt.phase = phase;
    this.phase = phase;
  }

  private finish(attempt: ModelSwitchAttempt, phase: ModelSwitchPhase): void {
    attempt.phase = phase;
    attempt.finishedAt = new Date(this.nowMs()).toISOString();
    this.history.unshift({ ...attempt });
    while (this.history.length > this.maxRecent) this.history.pop();
    this.current = null;
    this.phase = "idle";
  }

  private nowMs(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private pause(ms: number): Promise<void> {
    if (this.deps.sleep) return this.deps.sleep(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
}
