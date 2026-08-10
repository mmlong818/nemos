import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { officeCapabilityOf } from "./office-capabilities.js";
import { applyDocxTextEdits, readDocxText, type DocxTextBlock, type DocxTextEdit } from "./office-docx-text-edit.js";
import { UserFacingError } from "./office-errors.js";
import { applyStructuredOfficeEdit, type StructuredOfficeBlock, type StructuredSpreadsheetCell } from "./office-structured-edit.js";
import { validateOfficeFile, type ValidationReceipt } from "./office-validation.js";

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
  reason: "imported" | "external-change" | "structured-edit" | "restored";
  file: string;
}

export interface OfficeFileEvent {
  id: string;
  sessionId: string;
  type: "imported" | "external-change" | "structured-edit" | "structured-copy" | "restored" | "missing" | "renamed";
  createdAt: string;
  from?: string;
  to?: string;
  contentHash?: string;
}

const EXTENSIONS = new Set(["docx", "pptx", "xlsx", "pdf", "txt", "md"]);

export class OfficeFileSessionStore {
  private readonly sessions = new Map<string, OfficeFileSession>();
  private readonly versions = new Map<string, OfficeFileVersion[]>();
  private readonly events = new Map<string, OfficeFileEvent[]>();
  private readonly watchedPaths = new Map<string, string>();
  private readonly indexFile: string;
  private readonly versionIndexFile: string;
  private readonly eventIndexFile: string;
  private readonly historyDirectory: string;

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.indexFile = join(directory, "sessions.json");
    this.historyDirectory = join(directory, "history");
    this.versionIndexFile = join(this.historyDirectory, "versions.json");
    this.eventIndexFile = join(this.historyDirectory, "events.json");
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
    this.captureEvent(session, "imported", { to: session.file, contentHash: session.contentHash });
    this.watchSession(session);
    this.persist();
    return structuredClone(session);
  }

  inspect(id: string): OfficeFileSession {
    const session = this.requireRecord(id);
    this.resolveRenamedFile(session);
    this.assertManagedFile(session);
    const data = readFileSync(session.file);
    const previousHash = session.contentHash;
    session.byteLength = data.byteLength;
    session.contentHash = hash(data);
    session.updatedAt = statSync(session.file).mtime.toISOString();
    if (session.contentHash !== previousHash) {
      this.captureVersion(session, data, "external-change");
      this.captureEvent(session, "external-change", { to: session.file, contentHash: session.contentHash });
    }
    this.persist();
    return structuredClone(session);
  }

  read(id: string): { session: OfficeFileSession; data: Buffer } {
    const session = this.inspect(id);
    return { session, data: readFileSync(session.file) };
  }

  openDesktop(id: string): OfficeFileSession {
    const session = this.inspect(id);
    if (process.platform !== "win32") throw new UserFacingError("桌面完整编辑目前仅支持 Windows");
    const child = spawn("explorer.exe", [session.file], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return session;
  }

  history(id: string): Array<Omit<OfficeFileVersion, "file">> {
    this.inspect(id);
    return (this.versions.get(id) || []).map(({ file: _file, ...version }) => structuredClone(version));
  }

  eventHistory(id: string): OfficeFileEvent[] {
    const session = this.requireRecord(id);
    try { this.inspect(id); } catch { /* Missing state is already recorded by inspect. */ }
    return (this.events.get(session.id) || []).map((event) => structuredClone(event));
  }

  /** 读取 DOCX 的块结构：可改文字的段落，以及只能透传的表格、图片、图形。 */
  async readDocxBlocks(id: string): Promise<DocxTextBlock[]> {
    const session = this.requireRecord(id);
    this.inspect(id);
    if (session.extension !== "docx") throw new UserFacingError("只有 Word 文件有段落结构");
    return readDocxText(readFileSync(session.file));
  }

  /**
   * DOCX 文字修改：按 docxIndex 定位，只改指定段落，其余部件保持原字节。
   * 与下面已冻结的 saveStructuredCopy 不同，这条路径不会压平行内格式。
   * 结果仍然写入新文件——覆盖用户打开的那个文件要等真实文件回归验证之后。
   */
  async saveDocxTextCopy(id: string, expectedHash: string, edits: DocxTextEdit[]): Promise<{
    source: OfficeFileSession;
    copy: OfficeFileSession;
    changed: number[];
    skipped: number[];
    warnings: string[];
    validation: ValidationReceipt;
  }> {
    this.inspect(id);
    const session = this.requireRecord(id);
    if (!expectedHash || session.contentHash !== expectedHash) throw new UserFacingError("文件已在其他程序中变化，请重新载入后再生成副本");
    if (session.extension !== "docx") throw new UserFacingError("这条路径只处理 Word 文件");
    if (!edits.length) throw new UserFacingError("没有需要写入的修改");
    const edited = await applyDocxTextEdits(readFileSync(session.file), edits);
    if (!edited.changed.length) throw new UserFacingError("请求修改的内容没有实际变化，没有生成副本");
    const validation = await validateOfficeFile("docx", edited.data);
    if (!validation.passed) throw new UserFacingError(`生成的副本没有通过格式检查，已放弃写入：${failedChecksOf(validation)}`);
    const copy = this.create(copyName(session.name, session.extension), edited.data);
    this.captureEvent(session, "structured-copy", { from: session.file, to: copy.file, contentHash: copy.contentHash });
    this.persist();
    const warnings: string[] = [];
    if (edited.skipped.length) warnings.push(`有 ${edited.skipped.length} 处内容不是可改文字的段落（表格、图片或图形），没有改动。`);
    return { source: structuredClone(session), copy, changed: edited.changed, skipped: edited.skipped, warnings, validation };
  }

  /**
   * 文字替换只生成另一个文件。当前的 OOXML 写入是文字级替换，
   * 无法保证行内格式和未覆盖部件的完整性，因此不允许覆盖用户打开的那个文件。
   */
  async saveStructuredCopy(id: string, expectedHash: string, blocks: StructuredOfficeBlock[], cells: StructuredSpreadsheetCell[] = [], complete = false): Promise<{ source: OfficeFileSession; copy: OfficeFileSession; warnings: string[]; changedParts: string[]; validation: ValidationReceipt }> {
    this.inspect(id);
    const session = this.requireRecord(id);
    if (!expectedHash || session.contentHash !== expectedHash) throw new UserFacingError("文件已在其他程序中变化，请重新载入后再生成副本");
    const kind = session.extension;
    const capability = officeCapabilityOf(kind);
    if (!capability?.copyOnly || (kind !== "docx" && kind !== "pptx" && kind !== "xlsx")) throw new UserFacingError("这个格式不支持文字替换副本");
    const source = readFileSync(session.file);
    const edited = await applyStructuredOfficeEdit({ kind, data: source, blocks, cells, complete });
    const validation = await validateOfficeFile(kind, edited.data);
    if (!validation.passed) throw new UserFacingError(`生成的副本没有通过格式检查，已放弃写入：${failedChecksOf(validation)}`);
    const copy = this.create(copyName(session.name, session.extension), edited.data);
    this.captureEvent(session, "structured-copy", { from: session.file, to: copy.file, contentHash: copy.contentHash });
    this.persist();
    return {
      source: structuredClone(session),
      copy,
      warnings: [...capability.limitations, ...edited.warnings],
      changedParts: edited.changedParts,
      validation,
    };
  }

  scan(): OfficeFileSession[] {
    return [...this.sessions.keys()].flatMap((id) => {
      try { return [this.inspect(id)]; } catch { return []; }
    });
  }

  restore(id: string, versionId: string, expectedHash: string): OfficeFileSession {
    const session = this.requireRecord(id);
    this.inspect(id);
    if (!expectedHash || session.contentHash !== expectedHash) throw new UserFacingError("文件已在其他程序中变化，请重新载入后再恢复版本");
    const version = (this.versions.get(id) || []).find((item) => item.id === versionId);
    if (!version || !this.isManagedHistoryFile(version.file)) throw new UserFacingError("文件版本不存在或已经清理");
    const data = readFileSync(version.file);
    writeAtomic(session.file, data);
    session.byteLength = data.byteLength;
    session.contentHash = hash(data);
    session.updatedAt = new Date().toISOString();
    this.captureVersion(session, data, "restored");
    this.captureEvent(session, "restored", { to: session.file, contentHash: session.contentHash });
    this.persist();
    return structuredClone(session);
  }

  private requireRecord(id: string): OfficeFileSession {
    if (!/^office-[a-f0-9-]{36}$/i.test(id)) throw new UserFacingError("文件会话编号无效");
    const session = this.sessions.get(id);
    if (!session) throw new UserFacingError("文件工作副本不存在或已经清理");
    return session;
  }

  private assertManagedFile(session: OfficeFileSession): void {
    const root = realpathSync(resolve(this.directory)) + sep;
    if (!existsSync(session.file)) {
      this.captureEvent(session, "missing", { from: session.file, contentHash: session.contentHash });
      this.persist();
      throw new UserFacingError("文件工作副本不可用；删除事件已记录");
    }
    const file = realpathSync(resolve(session.file));
    const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const comparableFile = process.platform === "win32" ? file.toLowerCase() : file;
    if (!comparableFile.startsWith(comparableRoot) || !statSync(file).isFile()) throw new UserFacingError("文件工作副本不可用");
  }

  private load(): void {
    if (!existsSync(this.indexFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, "utf8"));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.file !== "string") continue;
        if (!EXTENSIONS.has(item.extension) || !this.isManagedSessionPath(item.file)) continue;
        this.sessions.set(item.id, item as OfficeFileSession);
        this.watchSession(item as OfficeFileSession);
      }
    } catch {
      // A damaged index never grants access to arbitrary paths.
    }
    if (existsSync(this.versionIndexFile)) {
      try {
        const parsed = JSON.parse(readFileSync(this.versionIndexFile, "utf8"));
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (!item || typeof item.sessionId !== "string" || typeof item.file !== "string" || !this.isManagedHistoryFile(item.file)) continue;
            const current = this.versions.get(item.sessionId) || [];
            current.push(item as OfficeFileVersion);
            this.versions.set(item.sessionId, current);
          }
        }
      } catch {
        // History corruption cannot grant access to files outside the managed directory.
      }
    }
    if (existsSync(this.eventIndexFile)) {
      try {
        const parsed = JSON.parse(readFileSync(this.eventIndexFile, "utf8"));
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (!item || typeof item.sessionId !== "string" || typeof item.type !== "string") continue;
            const current = this.events.get(item.sessionId) || [];
            current.push(item as OfficeFileEvent);
            this.events.set(item.sessionId, current.slice(-120));
          }
        }
      } catch { /* A damaged event index is ignored. */ }
    }
  }

  private persist(): void {
    writeAtomic(this.indexFile, Buffer.from(JSON.stringify([...this.sessions.values()].slice(-200), null, 2), "utf8"));
    writeAtomic(this.versionIndexFile, Buffer.from(JSON.stringify([...this.versions.values()].flat(), null, 2), "utf8"));
    writeAtomic(this.eventIndexFile, Buffer.from(JSON.stringify([...this.events.values()].flat(), null, 2), "utf8"));
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
    const retained = current.slice(0, 40);
    const removed = current.slice(40);
    this.versions.set(session.id, retained);
    for (const expired of removed) {
      try { if (this.isManagedHistoryFile(expired.file)) unlinkSync(expired.file); } catch { /* Best-effort retention cleanup. */ }
    }
  }

  private watchSession(session: OfficeFileSession): void {
    const previousPath = this.watchedPaths.get(session.id);
    if (previousPath === session.file) return;
    if (previousPath) unwatchFile(previousPath);
    this.watchedPaths.set(session.id, session.file);
    watchFile(session.file, { interval: 2_000, persistent: false }, (current, previous) => {
      if (!current.isFile()) {
        try { this.inspect(session.id); } catch { /* Missing or renamed state was recorded. */ }
        return;
      }
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
      try { this.inspect(session.id); } catch { /* The next explicit refresh will report an unavailable copy. */ }
    });
  }

  private resolveRenamedFile(session: OfficeFileSession): void {
    if (existsSync(session.file)) return;
    const oldPath = session.file;
    const candidates = readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === `.${session.extension}`)
      .map((entry) => join(this.directory, entry.name));
    const moved = candidates.find((candidate) => {
      try { return statSync(candidate).size === session.byteLength && hash(readFileSync(candidate)) === session.contentHash; } catch { return false; }
    });
    if (!moved) return;
    session.file = moved;
    session.updatedAt = new Date().toISOString();
    this.captureEvent(session, "renamed", { from: oldPath, to: moved, contentHash: session.contentHash });
    this.watchSession(session);
  }

  private captureEvent(session: OfficeFileSession, type: OfficeFileEvent["type"], details: Pick<OfficeFileEvent, "from" | "to" | "contentHash">): void {
    const current = this.events.get(session.id) || [];
    const latest = current[current.length - 1];
    if (latest?.type === type && latest.from === details.from && latest.to === details.to && latest.contentHash === details.contentHash) return;
    current.push({ id: `event-${randomUUID()}`, sessionId: session.id, type, createdAt: new Date().toISOString(), ...details });
    this.events.set(session.id, current.slice(-120));
  }

  private isManagedHistoryFile(file: string): boolean {
    if (!existsSync(file)) return false;
    const root = realpathSync(resolve(this.historyDirectory)) + sep;
    const target = realpathSync(resolve(file));
    const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const comparableTarget = process.platform === "win32" ? target.toLowerCase() : target;
    return comparableTarget.startsWith(comparableRoot) && statSync(target).isFile();
  }

  private isManagedSessionPath(file: string): boolean {
    const root = resolve(this.directory) + sep;
    const target = resolve(file);
    const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const comparableTarget = process.platform === "win32" ? target.toLowerCase() : target;
    return comparableTarget.startsWith(comparableRoot) && dirname(target) === resolve(this.directory);
  }
}

function normalizeExtension(name: string): OfficeFileSession["extension"] {
  const raw = extname(name).slice(1).toLowerCase();
  const extension = raw === "markdown" ? "md" : raw;
  if (!EXTENSIONS.has(extension)) throw new UserFacingError("不支持这个文件格式");
  return extension as OfficeFileSession["extension"];
}

function failedChecksOf(validation: ValidationReceipt): string {
  return validation.checks
    .filter((check) => !check.passed)
    .map((check) => (check.detail ? `${check.name}：${check.detail}` : check.name))
    .join("；");
}

function copyName(name: string, extension: string): string {
  const base = name.toLowerCase().endsWith(`.${extension}`) ? name.slice(0, -(extension.length + 1)) : name;
  return `${base.replace(/（文字副本(?: \d+)?）$/, "").slice(0, 150) || "文件"}（文字副本）.${extension}`;
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
