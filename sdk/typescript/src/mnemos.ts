// mnemos.ts — Mnemos class（顶层入口，管 storage + llm + embedding + worker）
//
// 公开类，朋友 `new Mnemos(config)` 拿到实例。

import { makeEmbeddingProvider } from "./embedding.js";
import type { EmbeddingProvider } from "./types.js";
import { makeProvider } from "./llm.js";
import { makeStorage, type Storage } from "./storage.js";
import { MnemosWorker } from "./queue.js";
import { persistDerivedList } from "./persist-derived.js";
import type {
  IngestStatusInfo,
  LLMProvider,
  LogLevel,
  MnemosConfig,
} from "./types.js";
import { UserMemory } from "./user-memory.js";

const DEFAULT_SCOPE = "global";
const DEFAULT_TENANT = "default";

/**
 * mnemos SDK 主入口。
 *
 * 使用示例：
 * ```ts
 * const mem = new Mnemos({
 *   storage: { type: 'sqlite', path: './mnemos.db' },
 *   llm: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
 * });
 * const userMem = mem.forUser('alice');
 * await userMem.ingest('我喜欢早上 6 点写作');
 * const ctx = await userMem.getRelevantContext('写作偏好');
 * ```
 */
export class Mnemos {
  private readonly storage: Storage;
  private readonly llm: LLMProvider;
  private readonly embedding: EmbeddingProvider | null;
  private readonly config: Required<
    Pick<MnemosConfig, "defaultScope" | "tenantId">
  > & MnemosConfig;
  private readonly log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void;
  /** v0.3：后台 worker。任何模式下都构造（队列状态查询需要）。 */
  private readonly worker: MnemosWorker;

  constructor(config: MnemosConfig) {
    if (config.storage.type === "remote") {
      throw new Error(
        "[mnemos] storage.type='remote' 暂未实现（v0.1 仅嵌入式）。请用 'sqlite' 或 'memory'。",
      );
    }

    // v0.3 互斥校验：features.doubleCheck 与 features.perspectives 不可同时显式启用
    const f = config.features;
    if (f && f.doubleCheck === true && Array.isArray(f.perspectives) && f.perspectives.length > 0) {
      throw new Error(
        "[mnemos] features.doubleCheck 与 features.perspectives 互斥。" +
          "doubleCheck=true 走 v0.2 双 pass 路径；perspectives 非空走 v0.3 多视角。" +
          "请只显式启用一个；或两个都不传以使用默认（doubleCheck=true）。",
      );
    }

    this.storage = makeStorage(config.storage);
    this.llm = makeProvider(config.llm);
    this.embedding = makeEmbeddingProvider(config.embedding);
    this.config = {
      ...config,
      defaultScope: config.defaultScope || DEFAULT_SCOPE,
      tenantId: config.tenantId || DEFAULT_TENANT,
    };
    this.log =
      config.logger ||
      ((level, msg, meta) => {
        if (level === "error" || level === "warn") {
          // 仅在 error/warn 时输出到 stderr，info/debug 默认静默
          const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
          process.stderr.write(`[mnemos ${level}] ${line}\n`);
        }
      });

    // 构造 worker（共享 storage/llm/embedding）
    // 注意：构造立即跑 resetStaleAnalyzing 触碰 ingest_queue 表
    this.worker = new MnemosWorker(
      {
        storage: this.storage,
        llm: this.llm,
        embedding: this.embedding,
        log: this.log,
        persistDerived: async (tenantId, userId, derived) => {
          return persistDerivedList(
            this.storage,
            this.embedding,
            this.log,
            tenantId,
            userId,
            derived,
          );
        },
      },
      this.config,
    );
    this.worker.start();
  }

  /** v0.3：手动跑一次 worker tick（serverless 友好）。 */
  runWorkerTick(): Promise<void> {
    return this.worker.runTick();
  }

  /** v0.3：停止 worker（进程退出前调用）。 */
  stopWorker(): void {
    this.worker.stop();
  }

  /** v0.3：等待某 background ingest 完成。 */
  waitForIngest(id: string, timeoutMs?: number): Promise<IngestStatusInfo> {
    return this.worker.waitFor(id, timeoutMs);
  }

  /** v0.3：power-user 接口，暴露 worker。 */
  workerHandle(): MnemosWorker {
    return this.worker;
  }

  /**
   * 为某个用户取一个 namespace 隔离的 UserMemory。
   * 不同 userId 之间数据完全隔离。
   */
  forUser(userId: string): UserMemory {
    if (!userId || typeof userId !== "string") {
      throw new Error("[mnemos] forUser(userId) 需要非空字符串");
    }
    return new UserMemory(
      this.storage,
      this.llm,
      this.embedding,
      this.config.tenantId,
      userId,
      this.config,
      this.log,
      this.worker,
    );
  }

  /**
   * Power-user 接口：暴露底层组件给高级用户做组合。
   * 大部分朋友不需要它。
   */
  raw(): { storage: Storage; llm: LLMProvider; embedding: EmbeddingProvider | null } {
    return { storage: this.storage, llm: this.llm, embedding: this.embedding };
  }

  /**
   * 关闭底层资源（SQLite 连接等）。Node 进程退出时建议调用。
   */
  close(): void {
    this.worker.stop();
    this.storage.close();
  }
}
