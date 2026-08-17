import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  prepareIsolatedDevelopmentWorkspace,
  prepareReadOnlyDevelopmentWorkspace,
  type DevelopmentAccessMode,
} from "./pi-development.js";

interface PersistedExecutionWorkspace {
  version: 1;
  sourceWorkspace: string;
  executionWorkspace: string;
  accessMode: DevelopmentAccessMode;
}

/**
 * 外部 CLI 会把 cwd 写进会话。隔离目录需要跟会话一起保留，否则下一轮即使有 session id 也无法恢复。
 */
export async function preparePersistentDevelopmentIsolation(input: {
  workspace: string;
  agentDir: string;
  runHome: string;
  accessMode: DevelopmentAccessMode;
}): Promise<{ workspace: string; isolated: boolean; reason?: "not-a-repo" | "dirty"; cleanup: () => Promise<void> }> {
  mkdirSync(input.runHome, { recursive: true });
  const stateFile = resolve(input.runHome, "execution-workspace.json");
  const previous = readState(stateFile);
  if (previous &&
      resolve(previous.sourceWorkspace) === resolve(input.workspace) &&
      previous.accessMode === input.accessMode &&
      existsSync(previous.executionWorkspace) &&
      isInside(previous.executionWorkspace, input.agentDir)) {
    return { workspace: resolve(previous.executionWorkspace), isolated: true, cleanup: async () => undefined };
  }
  const prepared = input.accessMode === "develop"
    ? await prepareIsolatedDevelopmentWorkspace(input.workspace, input.agentDir)
    : await prepareReadOnlyDevelopmentWorkspace(input.workspace, input.agentDir);
  if (!prepared.isolated) return prepared;
  writeFileSync(stateFile, JSON.stringify({
    version: 1,
    sourceWorkspace: resolve(input.workspace),
    executionWorkspace: resolve(prepared.workspace),
    accessMode: input.accessMode,
  } satisfies PersistedExecutionWorkspace, null, 2), "utf8");
  // 此目录由会话拥有；项目归档/会话清理时再释放，单轮结束不能删除。
  return { workspace: prepared.workspace, isolated: true, cleanup: async () => undefined };
}

function readState(file: string): PersistedExecutionWorkspace | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as PersistedExecutionWorkspace;
    return value.version === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

function isInside(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return Boolean(rel) && rel !== ".." && !rel.startsWith(`..\\`) && !rel.startsWith("../");
}
