import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MAX_PROJECT_NAME_LENGTH = 36;

export interface ManagedDevelopmentProject {
  path: string;
  name: string;
}

export function ensureDevelopmentProjectsRoot(root: string): string {
  mkdirSync(root, { recursive: true });
  return realpathSync(resolve(root));
}

export function createManagedDevelopmentProject(root: string, title: string): ManagedDevelopmentProject {
  const projectsRoot = ensureDevelopmentProjectsRoot(root);
  const baseName = projectDirectoryName(title);
  let name = baseName;
  let sequence = 2;
  while (existsSync(join(projectsRoot, name))) {
    name = `${baseName}-${sequence}`;
    sequence += 1;
  }
  const path = join(projectsRoot, name);
  mkdirSync(path);
  return { path: realpathSync(path), name };
}

export function extractDevelopmentWorkspaceReference(text: string): string | undefined {
  const source = String(text || "");
  const quoted = [...source.matchAll(/["'`]([A-Za-z]:[\\/][^"'`\r\n]+|\/[^　"'`\r\n]+)["'`]/g)];
  for (const match of quoted) {
    const path = existingDirectoryPrefix(match[1]);
    if (path) return path;
  }

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    const labelled = trimmed.match(/^(?:项目目录|项目|目录|文件夹|路径)\s*[:：]\s*(.+)$/i)?.[1];
    const standalone = /^(?:[A-Za-z]:[\\/]|\/)/.test(trimmed) ? trimmed : "";
    const candidate = labelled || standalone;
    if (!candidate) continue;
    const path = existingDirectoryPrefix(candidate);
    if (path) return path;
    return stripSentenceTail(candidate);
  }
  return undefined;
}

function existingDirectoryPrefix(value: string): string | undefined {
  let candidate = stripSentenceTail(value);
  while (candidate) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return realpathSync(resolve(candidate));
    const previousSpace = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\t"));
    if (previousSpace < 0) break;
    candidate = candidate.slice(0, previousSpace).trimEnd();
  }
  return undefined;
}

function stripSentenceTail(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[，,；;。！？!?].*$/u, "")
    .replace(/[。；;，,]+$/u, "")
    .trim();
}

function projectDirectoryName(title: string): string {
  const normalized = String(title || "")
    .split(/\r?\n/, 1)[0]
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, MAX_PROJECT_NAME_LENGTH)
    .replace(/[. ]+$/g, "");
  return normalized || "新项目";
}
