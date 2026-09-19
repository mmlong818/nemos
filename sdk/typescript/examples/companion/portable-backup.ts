import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const EXCLUDED_DIRECTORIES = new Set(["backups", "logs", "webview-profile"]);
const EXCLUDED_FILES = new Set(["companion-server.pid"]);

export interface PortableBackupEntry {
  readonly path: string;
  readonly kind: "file" | "sqlite";
  readonly bytes: number;
}

export interface PortableBackupResult {
  readonly created: boolean;
  readonly directory: string | null;
  readonly entries: readonly PortableBackupEntry[];
}

export function shouldCreateUpgradeBackup(installedVersion: string | null, appVersion: string): boolean {
  return installedVersion !== appVersion;
}

function isTransientFile(name: string): boolean {
  return EXCLUDED_FILES.has(name)
    || name.endsWith("-wal")
    || name.endsWith("-shm")
    || name.endsWith(".tmp")
    || name.includes(".tmp.");
}

function collectPersistentFiles(root: string, current = root): string[] {
  if (!existsSync(current)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const source = join(current, entry.name);
    if (entry.isDirectory()) {
      if (current === root && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      files.push(...collectPersistentFiles(root, source));
      continue;
    }
    if (entry.isFile() && !isTransientFile(entry.name)) files.push(source);
  }
  return files;
}

function assertChildPath(root: string, candidate: string): void {
  const rootPrefix = resolve(root) + sep;
  const resolvedCandidate = resolve(candidate);
  if (!resolvedCandidate.startsWith(rootPrefix)) {
    throw new Error(`Backup path escapes data directory: ${resolvedCandidate}`);
  }
}

function copyStableFile(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = statSync(source);
    const content = readFileSync(source);
    const after = statSync(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || content.byteLength !== after.size) continue;
    writeFileSync(temporary, content);
    renameSync(temporary, destination);
    return;
  }
  throw new Error(`Persistent file changed while it was being backed up: ${source}`);
}

async function backupSqlite(source: string, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true });
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
}

/**
 * Creates an application-consistent pre-start snapshot. SQLite databases use
 * SQLite's online backup API so a concurrently present WAL is never copied as
 * an inconsistent pair. Other application files are atomically replaced by
 * their writers and can therefore be copied directly before this sidecar boots.
 */
export async function createConsistentPortableBackup(
  dataDirectory: string,
  appVersion: string,
  now = new Date(),
): Promise<PortableBackupResult> {
  const root = resolve(dataDirectory);
  mkdirSync(root, { recursive: true });
  const sources = collectPersistentFiles(root);
  if (sources.length === 0) return { created: false, directory: null, entries: [] };

  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").replace("Z", "Z");
  const backupRoot = join(root, "backups");
  const backupDirectory = join(backupRoot, `${stamp}-v${appVersion}`);
  const incompleteDirectory = `${backupDirectory}.incomplete-${process.pid}-${randomUUID()}`;
  assertChildPath(root, incompleteDirectory);
  mkdirSync(incompleteDirectory, { recursive: true });

  const entries: PortableBackupEntry[] = [];
  try {
    for (const source of sources) {
      const relativePath = relative(root, source);
      const destination = join(incompleteDirectory, relativePath);
      assertChildPath(incompleteDirectory, destination);
      const sqlite = source.toLowerCase().endsWith(".db");
      if (sqlite) await backupSqlite(source, destination);
      else copyStableFile(source, destination);
      entries.push({
        path: relativePath.replace(/\\/g, "/"),
        kind: sqlite ? "sqlite" : "file",
        bytes: statSync(destination).size,
      });
    }
    writeFileSync(join(incompleteDirectory, "backup-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      appVersion,
      createdAt: now.toISOString(),
      sourceDirectoryName: basename(root),
      entries,
    }, null, 2), "utf8");
    mkdirSync(backupRoot, { recursive: true });
    renameSync(incompleteDirectory, backupDirectory);
  } catch (error) {
    rmSync(incompleteDirectory, { recursive: true, force: true });
    throw error;
  }

  return { created: true, directory: backupDirectory, entries };
}
