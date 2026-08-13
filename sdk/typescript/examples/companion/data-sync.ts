import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export type DataStorageMode = "local" | "server";

export interface DataSyncPublicSettings {
  mode: DataStorageMode;
  endpoint: string;
  userId: string;
  deviceId: string;
  hasToken: boolean;
  hasPassphrase: boolean;
  lastRevision: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface DataSyncSecrets { token: string; passphrase: string }
export interface DataSyncStoredSettings extends Omit<DataSyncPublicSettings, "hasToken" | "hasPassphrase"> {
  tokenCipher?: string;
  passphraseCipher?: string;
}

interface SnapshotFile { path: string; data: string; sha256: string; bytes: number }
interface PlainSnapshot { version: 1; createdAt: string; deviceId: string; files: SnapshotFile[] }
export interface EncryptedSnapshot { version: 1; createdAt: string; deviceId: string; salt: string; iv: string; tag: string; ciphertext: string; sha256: string }

const EXCLUDED_NAMES = new Set(["backups", "logs", "cache", "tmp", "sync-restore-pending.json"]);

export function normalizeSyncEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("服务器地址只支持 HTTP 或 HTTPS。");
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (url.protocol !== "https:" && !localHosts.has(url.hostname)) {
    throw new Error("远程同步服务器必须使用 HTTPS；本机 Docker 可使用 HTTP。");
  }
  return url.toString().replace(/\/$/, "");
}

export function syncSettingsSummary(settings: DataSyncStoredSettings): DataSyncPublicSettings {
  return {
    mode: settings.mode === "server" ? "server" : "local",
    endpoint: settings.endpoint || "",
    userId: settings.userId || "",
    deviceId: settings.deviceId || "",
    hasToken: Boolean(settings.tokenCipher),
    hasPassphrase: Boolean(settings.passphraseCipher),
    lastRevision: settings.lastRevision || "",
    lastSyncedAt: settings.lastSyncedAt || null,
    lastError: settings.lastError || null,
  };
}

function allowedRelativePath(root: string, file: string): string {
  const value = relative(root, file).replace(/\\/g, "/");
  if (!value || value === ".." || value.startsWith("../") || value.includes("/../")) throw new Error("同步文件超出数据目录。");
  return value;
}

function shouldExclude(relativePath: string): boolean {
  const parts = relativePath.split("/");
  const name = parts.at(-1) || "";
  return parts.some((part) => EXCLUDED_NAMES.has(part))
    || name.endsWith(".dpapi.json")
    || name.endsWith("-wal")
    || name.endsWith("-shm")
    || name.endsWith(".lock");
}

function collectFiles(root: string, directory = root): SnapshotFile[] {
  if (!existsSync(directory)) return [];
  const files: SnapshotFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = allowedRelativePath(root, path);
    if (shouldExclude(rel)) continue;
    if (entry.isDirectory()) files.push(...collectFiles(root, path));
    else if (entry.isFile()) {
      const data = readFileSync(path);
      files.push({ path: rel, data: data.toString("base64"), sha256: createHash("sha256").update(data).digest("hex"), bytes: data.byteLength });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function createEncryptedDataSnapshot(dataDir: string, deviceId: string, passphrase: string): EncryptedSnapshot {
  if (passphrase.length < 12) throw new Error("同步加密口令至少需要 12 个字符。");
  const snapshot: PlainSnapshot = { version: 1, createdAt: new Date().toISOString(), deviceId, files: collectFiles(resolve(dataDir)) };
  const plain = Buffer.from(JSON.stringify(snapshot));
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    createdAt: snapshot.createdAt,
    deviceId,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    sha256: createHash("sha256").update(ciphertext).digest("hex"),
  };
}

export function decryptDataSnapshot(payload: EncryptedSnapshot, passphrase: string): PlainSnapshot {
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  if (createHash("sha256").update(ciphertext).digest("hex") !== payload.sha256) throw new Error("服务器快照校验失败。");
  const key = scryptSync(passphrase, Buffer.from(payload.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const snapshot = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as PlainSnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.files)) throw new Error("服务器快照格式不受支持。");
  for (const file of snapshot.files) {
    const data = Buffer.from(file.data, "base64");
    if (!file.path || file.path.startsWith("/") || file.path.includes("..") || createHash("sha256").update(data).digest("hex") !== file.sha256) {
      throw new Error("服务器快照包含无效文件。");
    }
  }
  return snapshot;
}

export function stageDataRestore(dataDir: string, payload: EncryptedSnapshot, passphrase: string): { fileCount: number; createdAt: string } {
  const snapshot = decryptDataSnapshot(payload, passphrase);
  writeFileSync(join(dataDir, "sync-restore-pending.json"), JSON.stringify(snapshot), "utf8");
  return { fileCount: snapshot.files.length, createdAt: snapshot.createdAt };
}

export function applyPendingDataRestore(dataDir: string): { applied: boolean; fileCount: number } {
  const pending = join(dataDir, "sync-restore-pending.json");
  if (!existsSync(pending)) return { applied: false, fileCount: 0 };
  const snapshot = JSON.parse(readFileSync(pending, "utf8")) as PlainSnapshot;
  const staging = join(dataDir, `.sync-restore-${Date.now()}`);
  mkdirSync(staging, { recursive: true });
  try {
    for (const file of snapshot.files) {
      const target = resolve(staging, file.path);
      if (!target.startsWith(`${resolve(staging)}${sep}`)) throw new Error("恢复文件超出暂存目录。");
      const data = Buffer.from(file.data, "base64");
      if (createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error("恢复文件校验失败。");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    for (const file of snapshot.files) {
      const source = resolve(staging, file.path);
      const target = resolve(dataDir, file.path);
      if (!target.startsWith(`${resolve(dataDir)}${sep}`)) throw new Error("恢复文件超出数据目录。");
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) rmSync(target, { force: true });
      renameSync(source, target);
    }
    rmSync(pending, { force: true });
    return { applied: true, fileCount: snapshot.files.length };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function syncRequest(settings: DataSyncStoredSettings, secrets: DataSyncSecrets, method: "GET" | "PUT", body?: EncryptedSnapshot): Promise<{ snapshot?: EncryptedSnapshot; revision: string }> {
  const endpoint = normalizeSyncEndpoint(settings.endpoint);
  const response = await fetch(`${endpoint}/v1/snapshots/latest`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secrets.token}`,
      "x-clownfish-user": settings.userId,
      "x-clownfish-device": settings.deviceId,
      ...(method === "PUT" && settings.lastRevision ? { "if-match": settings.lastRevision } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({})) as { snapshot?: EncryptedSnapshot; revision?: string; error?: string };
  if (!response.ok) throw new Error(result.error || `同步服务器返回 ${response.status}`);
  return { snapshot: result.snapshot, revision: String(result.revision || response.headers.get("etag") || "") };
}

export async function testDataSync(settings: DataSyncStoredSettings, secrets: DataSyncSecrets): Promise<{ revision: string; hasSnapshot: boolean }> {
  const result = await syncRequest(settings, secrets, "GET");
  return { revision: result.revision, hasSnapshot: Boolean(result.snapshot) };
}

export async function pushDataSync(dataDir: string, settings: DataSyncStoredSettings, secrets: DataSyncSecrets): Promise<{ revision: string; createdAt: string }> {
  const snapshot = createEncryptedDataSnapshot(dataDir, settings.deviceId, secrets.passphrase);
  const result = await syncRequest(settings, secrets, "PUT", snapshot);
  return { revision: result.revision, createdAt: snapshot.createdAt };
}

export async function pullDataSync(dataDir: string, settings: DataSyncStoredSettings, secrets: DataSyncSecrets): Promise<{ revision: string; fileCount: number; createdAt: string }> {
  const result = await syncRequest(settings, secrets, "GET");
  if (!result.snapshot) throw new Error("服务器还没有可恢复的数据快照。");
  const staged = stageDataRestore(dataDir, result.snapshot, secrets.passphrase);
  return { revision: result.revision, ...staged };
}
