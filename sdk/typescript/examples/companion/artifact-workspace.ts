import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ArtifactWorkspaceStatus = "draft" | "review" | "done";

export interface ArtifactWorkspaceSnapshot {
  body: string;
  notes: Record<string, string>;
  checks: Record<string, boolean>;
  status: ArtifactWorkspaceStatus;
}

export interface ArtifactWorkspaceVersion extends ArtifactWorkspaceSnapshot {
  id: string;
  createdAt: string;
}

export interface ArtifactEvidencePack {
  hash: string;
  sourceCount: number;
  anchorCount: number;
  capturedAt: string;
}

export interface ArtifactWorkspaceState extends ArtifactWorkspaceSnapshot {
  artifactId: string;
  updatedAt: string;
  revision: number;
  versions: ArtifactWorkspaceVersion[];
  evidence?: ArtifactEvidencePack;
}

export class ArtifactWorkspaceStore {
  private states: ArtifactWorkspaceState[];

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.states = readStates(file);
  }

  get(artifactId: string): ArtifactWorkspaceState {
    const found = this.states.find((item) => item.artifactId === artifactId);
    return structuredClone(found ?? emptyState(artifactId));
  }

  saveCurrent(artifactId: string, input: unknown, expectedRevision?: number): ArtifactWorkspaceState {
    const state = this.mutable(artifactId);
    assertRevision(state, expectedRevision);
    Object.assign(state, normalizeSnapshot(input));
    state.revision++;
    state.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(state);
  }

  saveVersion(artifactId: string, input: unknown, expectedRevision?: number): ArtifactWorkspaceState {
    const state = this.mutable(artifactId);
    assertRevision(state, expectedRevision);
    const snapshot = normalizeSnapshot(input);
    state.revision++;
    Object.assign(state, snapshot);
    state.updatedAt = new Date().toISOString();
    state.versions.unshift({ id: `version-${randomUUID()}`, createdAt: state.updatedAt, ...snapshot });
    state.versions = state.versions.slice(0, 20);
    this.persist();
    return structuredClone(state);
  }

  restoreVersion(artifactId: string, versionId: string, expectedRevision?: number): ArtifactWorkspaceState {
    const state = this.mutable(artifactId);
    assertRevision(state, expectedRevision);
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) throw new Error("找不到这个工作台版本。");
    state.body = version.body;
    state.notes = structuredClone(version.notes);
    state.checks = structuredClone(version.checks);
    state.status = version.status;
    state.revision++;
    state.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(state);
  }

  initializeEvidence(artifactId: string, evidence: ArtifactEvidencePack, initialBody = ""): ArtifactWorkspaceState {
    const state = this.mutable(artifactId);
    if (!state.evidence) {
      state.evidence = structuredClone(evidence);
      if (!state.body) state.body = initialBody.slice(0, 160_000);
      state.updatedAt = new Date().toISOString();
      this.persist();
    }
    return structuredClone(state);
  }
  context(artifactId: string): string {
    const state = this.states.find((item) => item.artifactId === artifactId);
    if (!state) return "";
    const notes = Object.values(state.notes).map((item) => item.trim()).filter(Boolean);
    const completed = Object.entries(state.checks).filter(([, checked]) => checked).map(([key]) => key);
    if (!notes.length && !completed.length && state.status === "draft") return "";
    return [
      "【工作台最新状态】",
      `状态：${statusLabel(state.status)}`,
      state.body.trim() ? `用户编辑正文：\n${state.body.trim()}` : "",
      notes.length ? `用户补充：\n${notes.map((item) => `- ${item}`).join("\n")}` : "",
      completed.length ? `用户已勾选：\n${completed.map((item) => `- ${item}`).join("\n")}` : "",
      `更新时间：${state.updatedAt}`,
    ].filter(Boolean).join("\n");
  }

  private mutable(artifactId: string): ArtifactWorkspaceState {
    const id = normalizeId(artifactId);
    let state = this.states.find((item) => item.artifactId === id);
    if (!state) {
      state = emptyState(id);
      this.states.push(state);
    }
    return state;
  }

  private persist(): void {
    this.states = this.states.slice(-200);
    writeAtomic(this.file, JSON.stringify(this.states, null, 2));
  }
}

function assertRevision(state: ArtifactWorkspaceState, expectedRevision: number | undefined): void {
  if (expectedRevision !== undefined && expectedRevision !== state.revision) {
    throw new Error(`工作台内容已在别处更新（当前版本 ${state.revision}，提交基于 ${expectedRevision}）。请刷新后合并修改。`);
  }
}
function normalizeSnapshot(value: unknown): ArtifactWorkspaceSnapshot {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const notes: Record<string, string> = {};
  if (input.notes && typeof input.notes === "object" && !Array.isArray(input.notes)) {
    for (const [key, raw] of Object.entries(input.notes as Record<string, unknown>).slice(0, 20)) {
      const safeKey = normalizeKey(key);
      if (safeKey && typeof raw === "string") notes[safeKey] = raw.slice(0, 20_000);
    }
  }
  const checks: Record<string, boolean> = {};
  if (input.checks && typeof input.checks === "object" && !Array.isArray(input.checks)) {
    for (const [key, raw] of Object.entries(input.checks as Record<string, unknown>).slice(0, 200)) {
      const safeKey = normalizeKey(key);
      if (safeKey) checks[safeKey] = raw === true;
    }
  }
  return {
    body: typeof input.body === "string" ? input.body.slice(0, 160_000) : "",
    notes,
    checks,
    status: input.status === "review" || input.status === "done" ? input.status : "draft",
  };
}

function emptyState(artifactId: string): ArtifactWorkspaceState {
  return { artifactId: normalizeId(artifactId), body: "", notes: {}, checks: {}, status: "draft", updatedAt: "", revision: 0, versions: [] };
}

function normalizeId(value: string): string {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(id)) throw new Error("工作台产物编号无效。");
  return id;
}

function normalizeKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_\-:.]/g, "").slice(0, 120);
}

function statusLabel(status: ArtifactWorkspaceStatus): string {
  return status === "done" ? "已确认" : status === "review" ? "待复核" : "整理中";
}

function readStates(file: string): ArtifactWorkspaceState[] {
  if (!existsSync(file)) return [];
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(value)) return [];
    return value.map((state) => ({
      ...state,
      body: typeof state?.body === "string" ? state.body : "",
      revision: Number.isInteger(state?.revision) ? state.revision : 0,
      versions: Array.isArray(state?.versions) ? state.versions.map((version: ArtifactWorkspaceVersion) => ({ ...version, body: typeof version.body === "string" ? version.body : "" })) : [],
    }));
  } catch {
    return [];
  }
}

function writeAtomic(file: string, value: string): void {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, "utf8");
  renameSync(temporary, file);
}
