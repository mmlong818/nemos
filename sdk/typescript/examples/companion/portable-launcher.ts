import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createConsistentPortableBackup, shouldCreateUpgradeBackup } from "./portable-backup.js";

function manifestVersion(): string {
  const candidate = process.env.CLOWNFISH_MANIFEST?.trim();
  if (!candidate || !existsSync(candidate)) return "unknown";
  try {
    const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

function dataDirectory(): string {
  const configured = process.env.CLOWNFISH_HOME?.trim();
  return resolve(configured || join(homedir(), ".clownfish"));
}

function installedVersion(root: string): string | null {
  const marker = join(root, "app-version.json");
  if (!existsSync(marker)) return null;
  try {
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function writeVersionMarker(root: string, value: Record<string, unknown>): void {
  const marker = join(root, "app-version.json");
  const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  renameSync(temporary, marker);
}

async function launch(): Promise<void> {
  const root = dataDirectory();
  const version = manifestVersion();
  mkdirSync(root, { recursive: true });
  const previousVersion = installedVersion(root);
  if (shouldCreateUpgradeBackup(previousVersion, version)) {
    const backup = await createConsistentPortableBackup(root, version);
    writeVersionMarker(root, {
      version,
      previousVersion,
      updatedAt: new Date().toISOString(),
      backupDirectory: backup.directory,
    });
  }
  await import("./server.js");
}

launch().catch((error) => {
  console.error("[clownfish] portable sidecar startup failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
