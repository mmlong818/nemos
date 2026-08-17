import { relative, resolve } from "node:path";
import type { DevelopmentEngine } from "./development-engine-contract.js";

interface ExternalDevelopmentSessionReference {
  version: 1;
  engine: DevelopmentEngine;
  runHome: string;
  sessionId: string;
}

export function encodeDevelopmentSessionReference(
  engine: DevelopmentEngine,
  runHome: string,
  sessionId: string,
): string {
  const payload: ExternalDevelopmentSessionReference = {
    version: 1,
    engine,
    runHome: resolve(runHome),
    sessionId: sessionId.trim(),
  };
  return `clownfish-session:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export function decodeDevelopmentSessionReference(
  value: string | undefined,
  engine: DevelopmentEngine,
  agentDir: string,
): { runHome: string; sessionId: string } | undefined {
  if (!value?.startsWith("clownfish-session:")) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value.slice("clownfish-session:".length), "base64url").toString("utf8")) as ExternalDevelopmentSessionReference;
    if (parsed.version !== 1 || parsed.engine !== engine || !parsed.sessionId?.trim()) return undefined;
    const runHome = resolve(parsed.runHome);
    const runsRoot = resolve(agentDir, "runs");
    const rel = relative(runsRoot, runHome);
    if (!rel || rel.startsWith("..") || resolve(runsRoot, rel) !== runHome) return undefined;
    return { runHome, sessionId: parsed.sessionId.trim() };
  } catch {
    return undefined;
  }
}
