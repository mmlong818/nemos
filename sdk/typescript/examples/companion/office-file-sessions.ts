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

const EXTENSIONS = new Set(["docx", "pptx", "xlsx", "pdf", "txt", "md"]);

export class OfficeFileSessionStore {
  private readonly sessions = new Map<string, OfficeFileSession>();
  private readonly indexFile: string;

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.indexFile = join(directory, "sessions.json");
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
    this.persist();
    return structuredClone(session);
  }

  inspect(id: string): OfficeFileSession {
    const session = this.require(id);
    const data = readFileSync(session.file);
    session.byteLength = data.byteLength;
    session.contentHash = hash(data);
    session.updatedAt = statSync(session.file).mtime.toISOString();
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
  }

  private persist(): void {
    writeAtomic(this.indexFile, Buffer.from(JSON.stringify([...this.sessions.values()].slice(-200), null, 2), "utf8"));
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
