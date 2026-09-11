// 扩展的托管存储。
//
// 在此之前第三方扩展没有任何持久化能力：MCP 子进程只能往沙箱授权过的文件系统路径
// 自己写文件（没有配额、没有按扩展隔离的命名空间、没有结构化接口），进程内扩展
// 则完全没有——内置的那几个是把目录硬编码在宿主代码里的，第三方没有等价机制。
//
// 两种运行时必须分开处理，因为它们的能力面不同：
//   - 进程内（module / agent-app）：宿主可以在工具执行上下文里直接交一个作用域化的
//     接口，这就是本文件提供的东西。
//   - 子进程（mcp）：MCP 的 client capabilities 只有 sampling / roots / elicitation，
//     没有存储这一项，宿主无法在协议内给它一个 KV 接口。那条路只能走"宿主分配
//     每扩展目录 + 沿用既有沙箱 filesystemWrite 授权"，不在本文件范围内。
//
// 隔离靠命名空间，不靠自觉：句柄由宿主按 extensionId 创建，扩展拿不到别人的 id，
// 也无法越过句柄访问底层文件。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 键的字符集与长度都收紧：它要当 JSON 对象的属性名，也要出现在审计里。 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
/** 与 manifest.id 的校验保持一致，避免被拼成别的路径。 */
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_KEYS = 1_000;
const DEFAULT_MAX_VALUE_BYTES = 512 * 1024;

export interface AgentExtensionStorageUsage {
  bytes: number;
  keys: number;
  maxBytes: number;
  maxKeys: number;
  /**
   * 子进程扩展在自己数据目录里占的字节与文件数。
   *
   * 只是观测值，不是配额：那个目录由子进程经操作系统直接写，宿主拦不住它——
   * 要真拦得靠文件系统配额或监视器，这里都没有。所以如实报告占用，不假装在限制。
   * 统计会在扫描上限处截断，truncated 为真时说明实际值更大。
   */
  files: { bytes: number; count: number; truncated: boolean };
}

export interface AgentExtensionStore {
  get<T = unknown>(key: string): T | undefined;
  /** 超出配额或键值不合规时抛 AgentExtensionStorageError，不静默截断。 */
  set(key: string, value: unknown): void;
  delete(key: string): boolean;
  keys(prefix?: string): string[];
  usage(): AgentExtensionStorageUsage;
}

export interface FileAgentExtensionStorageOptions {
  maxBytesPerExtension?: number;
  maxKeys?: number;
  maxValueBytes?: number;
}

export class AgentExtensionStorageError extends Error {
  constructor(readonly reason: "invalid-key" | "invalid-value" | "quota-bytes" | "quota-keys", message: string) {
    super(message);
    this.name = "AgentExtensionStorageError";
  }
}

export class FileAgentExtensionStorage {
  private readonly cache = new Map<string, Record<string, unknown>>();
  private readonly maxBytes: number;
  private readonly maxKeys: number;
  private readonly maxValueBytes: number;

  constructor(private readonly dir: string, options: FileAgentExtensionStorageOptions = {}) {
    this.maxBytes = Math.min(64 * 1024 * 1024, Math.max(4 * 1024, options.maxBytesPerExtension ?? DEFAULT_MAX_BYTES));
    this.maxKeys = Math.min(100_000, Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS));
    this.maxValueBytes = Math.min(this.maxBytes, Math.max(1024, options.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES));
    // kv/ 给进程内扩展的键值；files/ 给子进程扩展的数据目录。分开放，互不覆盖。
    mkdirSync(join(dir, "kv"), { recursive: true });
    mkdirSync(join(dir, "files"), { recursive: true });
  }

  /**
   * 子进程扩展的数据目录，按扩展隔离。
   *
   * MCP 协议里没有存储能力，宿主给不了它 KV 接口，只能给一块地方并在沙箱里放行。
   * 目录会被创建好：AppContainer 的写路径必须是已存在的目录，否则启动就报错。
   */
  directoryFor(extensionId: string): string {
    const path = join(this.dir, "files", this.requireId(extensionId));
    mkdirSync(path, { recursive: true });
    return path;
  }

  forExtension(extensionId: string): AgentExtensionStore {
    const id = this.requireId(extensionId);
    return {
      get: <T>(key: string) => this.read(id)[this.requireKey(key)] as T | undefined,
      set: (key, value) => this.write(id, this.requireKey(key), value),
      delete: (key) => this.remove(id, this.requireKey(key)),
      keys: (prefix) => Object.keys(this.read(id)).filter((key) => !prefix || key.startsWith(prefix)).sort(),
      usage: () => this.usage(id),
    };
  }

  usage(extensionId: string): AgentExtensionStorageUsage {
    const id = this.requireId(extensionId);
    const data = this.read(id);
    return {
      bytes: byteLength(data),
      keys: Object.keys(data).length,
      maxBytes: this.maxBytes,
      maxKeys: this.maxKeys,
      files: measureDirectory(join(this.dir, "files", id)),
    };
  }

  /** 卸载扩展时清掉它的数据。留着等于卸载没卸干净。 */
  clear(extensionId: string): void {
    const id = this.requireId(extensionId);
    this.cache.delete(id);
    try {
      rmSync(this.fileFor(id), { force: true });
      rmSync(join(this.dir, "files", id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // 清不掉不阻塞卸载；下次同 id 安装会覆盖写。
    }
  }

  private write(id: string, key: string, value: unknown): void {
    let encoded: string;
    try {
      encoded = JSON.stringify(value);
    } catch {
      throw new AgentExtensionStorageError("invalid-value", "值必须可 JSON 序列化");
    }
    if (encoded === undefined) throw new AgentExtensionStorageError("invalid-value", "值必须可 JSON 序列化");
    if (Buffer.byteLength(encoded, "utf8") > this.maxValueBytes) {
      throw new AgentExtensionStorageError("quota-bytes", `单个值不能超过 ${this.maxValueBytes} 字节`);
    }
    const data = this.read(id);
    const next = { ...data, [key]: JSON.parse(encoded) as unknown };
    if (!(key in data) && Object.keys(next).length > this.maxKeys) {
      throw new AgentExtensionStorageError("quota-keys", `键数量不能超过 ${this.maxKeys}`);
    }
    // 配额在写入之前判定：超了就整笔拒绝，不写半截也不悄悄丢旧键。
    if (byteLength(next) > this.maxBytes) {
      throw new AgentExtensionStorageError("quota-bytes", `该扩展的数据总量不能超过 ${this.maxBytes} 字节`);
    }
    this.cache.set(id, next);
    this.save(id, next);
  }

  private remove(id: string, key: string): boolean {
    const data = this.read(id);
    if (!(key in data)) return false;
    const next = { ...data };
    delete next[key];
    this.cache.set(id, next);
    this.save(id, next);
    return true;
  }

  private read(id: string): Record<string, unknown> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    let data: Record<string, unknown> = {};
    const file = this.fileFor(id);
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
      } catch {
        // 数据损坏不阻塞扩展启动；按空处理，下次写入重建有效文件。
      }
    }
    this.cache.set(id, data);
    return data;
  }

  private save(id: string, data: Record<string, unknown>): void {
    const file = this.fileFor(id);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2));
    renameSync(temp, file);
  }

  private fileFor(id: string): string {
    return join(this.dir, "kv", `${id}.json`);
  }

  private requireId(extensionId: string): string {
    if (!EXTENSION_ID_PATTERN.test(extensionId)) {
      throw new AgentExtensionStorageError("invalid-key", `扩展标识不合规：${extensionId}`);
    }
    return extensionId;
  }

  private requireKey(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new AgentExtensionStorageError("invalid-key", `键不合规：${String(key).slice(0, 40)}`);
    }
    return key;
  }
}

function byteLength(data: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

/** 扫描上限：占用只是展示用，不值得为它遍历一棵很大的树。 */
const MAX_SCANNED_ENTRIES = 5_000;

function measureDirectory(root: string): { bytes: number; count: number; truncated: boolean } {
  let bytes = 0;
  let count = 0;
  let truncated = false;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= MAX_SCANNED_ENTRIES) return { bytes, count, truncated: true };
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      try {
        bytes += statSync(path).size;
        count += 1;
      } catch {
        // 扫描期间被删掉的文件跳过即可。
      }
    }
  }
  return { bytes, count, truncated };
}
