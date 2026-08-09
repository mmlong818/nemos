import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

export interface OfficeFileSession {
  id: string;
  name: string;
  file: string;
  extension: "docx" | "pptx" | "xlsx" | "pdf" | "txt" | "md";
  byteLength: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeFileVersion {
  id: string;
  sessionId: string;
  contentHash: string;
  byteLength: number;
  createdAt: string;
  reason: "imported" | "external-change" | "restored";
  file: string;
}

const EXTENSIONS = new Set(["docx", "pptx", "xlsx", "pdf", "txt", "md"]);

export class OfficeFileSessionStore {
  private readonly sessions = new Map<string, OfficeFileSession>();
  private readonly versions = new Map<string, OfficeFileVersion[]>();
  private readonly indexFile: string;
  private readonly versionIndexFile: string;
  private readonly historyDirectory: string;

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.indexFile = join(directory, "sessions.json");
    this.historyDirectory = join(directory, "history");
    this.versionIndexFile = join(this.historyDirectory, "versions.json");
    mkdirSync(this.historyDirectory, { recursive: true });
    this.load();
  }

  create(name: string, data: Buffer): OfficeFileSession {
    const extension = normalizeExtension(name);
    const id = `office-${randomUUID()}`;
    const safeName = `${id}.${extension}`;
    const file = join(this.directory, safeName);
    writeAtomic(file, data);
    const now = new Date().toISOString();
    const session: OfficeFileSession = {
      id,
      name: safeDisplayName(name, extension),
      file,
      extension,
      byteLength: data.byteLength,
      contentHash: hash(data),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    this.captureVersion(session, data, "imported");
    this.persist();
    return structuredClone(session);
  }

  inspect(id: string): OfficeFileSession {
    const session = this.require(id);
    const data = readFileSync(session.file);
    const previousHash = session.contentHash;
    session.byteLength = data.byteLength;
    session.contentHash = hash(data);
    session.updatedAt = statSync(session.file).mtime.toISOString();
    if (session.contentHash !== previousHash) this.captureVersion(session, data, "external-change");
    this.persist();
    return structuredClone(session);
  }

  read(id: string): { session: OfficeFileSession; data: Buffer } {
    const session = this.inspect(id);
    return { session, data: readFileSync(session.file) };
  }

  openDesktop(id: string): OfficeFileSession {
    const session = this.inspect(id);
    if (process.platform !== "win32") throw new Error("桌面完整编辑目前仅支持 Windows");
    const child = spawn("explorer.exe", [session.file], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return session;
  }

  history(id: string): Array<Omit<OfficeFileVersion, "file">> {
    this.require(id);
    return (this.versions.get(id) || []).map(({ file: _file, ...version }) => structuredClone(version));
  }

  restore(id: string, versionId: string, expectedHash: string): OfficeFileSession {
    const session = this.require(id);
    this.inspect(id);
    if (!expectedHash || session.contentHash !== expectedHash) throw new Error("文件已在其他程序中变化，请重新载入后再恢复版本");
    const version = (this.versions.get(id) || []).find((item) => item.id === versionId);
    if (!version || !this.isManagedHistoryFile(version.file)) throw new Error("文件版本不存在或已经清理");
    const data = readFileSync(version.file);
    writeAtomic(session.file, data);
    session.byteLength = data.byteLength;
    session.contentHash = hash(data);
    session.updatedAt = new Date().toISOString();
    this.captureVersion(session, data, "restored");
    this.persist();
    return structuredClone(session);
  }

  private require(id: string): OfficeFileSession {
    if (!/^office-[a-f0-9-]{36}$/i.test(id)) throw new Error("文件会话编号无效");
    const session = this.sessions.get(id);
    if (!session) throw new Error("文件工作副本不存在或已经清理");
    const root = realpathSync(resolve(this.directory)) + sep;
    if (!existsSync(session.file)) throw new Error("文件工作副本不可用");
    const file = realpathSync(resolve(session.file));
    const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const comparableFile = process.platform === "win32" ? file.toLowerCase() : file;
    if (!comparableFile.startsWith(comparableRoot) || !statSync(file).isFile()) throw new Error("文件工作副本不可用");
    return session;
  }

  private load(): void {
    if (!existsSync(this.indexFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, "utf8"));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.file !== "string") continue;
        if (!EXTENSIONS.has(item.extension) || !existsSync(item.file)) continue;
        this.sessions.set(item.id, item as OfficeFileSession);
      }
    } catch {
      // A damaged index never grants access to arbitrary paths.
    }
    if (!existsSync(this.versionIndexFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.versionIndexFile, "utf8"));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item.sessionId !== "string" || typeof item.file !== "string" || !this.isManagedHistoryFile(item.file)) continue;
        const current = this.versions.get(item.sessionId) || [];
        current.push(item as OfficeFileVersion);
        this.versions.set(item.sessionId, current);
      }
    } catch {
      // History corruption cannot grant access to files outside the managed directory.
    }
  }

  private persist(): void {
    writeAtomic(this.indexFile, Buffer.from(JSON.stringify([...this.sessions.values()].slice(-200), null, 2), "utf8"));
    writeAtomic(this.versionIndexFile, Buffer.from(JSON.stringify([...this.versions.values()].flat(), null, 2), "utf8"));
  }

  private captureVersion(session: OfficeFileSession, data: Buffer, reason: OfficeFileVersion["reason"]): void {
    const contentHash = hash(data);
    const current = this.versions.get(session.id) || [];
    if (current[0]?.contentHash === contentHash && reason !== "restored") return;
    const id = `version-${randomUUID()}`;
    const file = join(this.historyDirectory, `${id}.${session.extension}`);
    writeAtomic(file, data);
    current.unshift({
      id,
      sessionId: session.id,
      contentHash,
      byteLength: data.byteLength,
      createdAt: new Date().toISOString(),
      reason,
      file,
    });
    this.versions.set(session.id, current.slice(0, 40));
  }

  private isManagedHistoryFile(file: string): boolean {
    if (!existsSync(file)) return false;
    const root = realpathSync(resolve(this.historyDirectory)) + sep;
    const target = realpathSync(resolve(file));
    const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const comparableTarget = process.platform === "win32" ? target.toLowerCase() : target;
    return comparableTarget.startsWith(comparableRoot) && statSync(target).isFile();
  }
}

function normalizeExtension(name: string): OfficeFileSession["extension"] {
  const raw = extname(name).slice(1).toLowerCase();
  const extension = raw === "markdown" ? "md" : raw;
  if (!EXTENSIONS.has(extension)) throw new Error("不支持这个文件格式");
  return extension as OfficeFileSession["extension"];
}

function safeDisplayName(name: string, extension: string): string {
  const value = basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").slice(0, 180);
  return value.toLowerCase().endsWith(`.${extension}`) ? value : `${value || "文件"}.${extension}`;
}

function hash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function writeAtomic(file: string, data: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}
