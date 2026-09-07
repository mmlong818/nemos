// relationship-memory.ts — v0.8 关系记忆
//
// 与 contact-roster 分开：那边管的是「用户通讯录里有哪些角色」，
// 这里管的是「面对某个具体对象该怎么说话、什么不能说」。
//
// 同一个请求对不同对象给出不同口径，靠的是这份档案，而不是让模型自由发挥。

import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export type RelationKind =
  | "teammate"
  | "client"
  | "partner"
  | "investor"
  | "vendor"
  | "family"
  | "friend"
  | "other";

export interface CounterpartNote {
  text: string;
  at: string;
  /** user=用户直接说的；observed=从互动里总结的。两者可信度不同，不能混为一谈。 */
  source: "user" | "observed";
}

export interface CounterpartProfile {
  id: string;
  displayName: string;
  relation: RelationKind;
  /** 沟通口径：语气、详略、称呼习惯。 */
  tone?: string;
  /** 偏好语言，例如 "中文"。 */
  language?: string;
  /** 硬边界：面对这个对象不能说、不能分享的内容。 */
  boundaries: string[];
  notes: CounterpartNote[];
  firstInteractionAt?: string;
  lastInteractionAt?: string;
  interactionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CounterpartPatch {
  displayName?: string;
  relation?: RelationKind;
  tone?: string;
  language?: string;
  boundaries?: string[];
  /** 追加观察；不覆盖既有的。 */
  addNotes?: Array<{ text: string; source?: "user" | "observed" }>;
  /** 记一次互动，刷新首末次时间与计数。 */
  recordInteraction?: boolean;
}

const MAX_NOTES = 50;
const MAX_BOUNDARIES = 20;

const RELATION_KINDS = new Set<RelationKind>([
  "teammate", "client", "partner", "investor", "vendor", "family", "friend", "other",
]);

function normalizeRelation(value: unknown): RelationKind {
  return RELATION_KINDS.has(value as RelationKind) ? (value as RelationKind) : "other";
}

function cleanList(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  const cleaned = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, limit);
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, "utf8");
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch { /* Rename succeeded, or no temporary file was created. */ }
  }
}

export class RelationshipMemoryUnavailableError extends Error {
  readonly code = "RELATIONSHIP_MEMORY_UNAVAILABLE";
  constructor() {
    super("关系记忆暂时无法读取或已被外部修改，不能当作空档案。已停止相关读写，请恢复原文件后重启应用；不会自动清空或覆盖。");
    this.name = "RelationshipMemoryUnavailableError";
  }
}

function validProfiles(value: unknown): value is CounterpartProfile[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) return false;
    ids.add(item.id);
    return typeof item.displayName === "string" && RELATION_KINDS.has(item.relation)
      && Array.isArray(item.boundaries) && item.boundaries.every((text: unknown) => typeof text === "string")
      && Array.isArray(item.notes) && item.notes.every((note: CounterpartNote) => note && typeof note.text === "string"
        && Number.isFinite(Date.parse(note.at)) && ["user", "observed"].includes(note.source))
      && Number.isSafeInteger(item.interactionCount) && item.interactionCount >= 0
      && [item.createdAt, item.updatedAt].every((at) => typeof at === "string" && Number.isFinite(Date.parse(at)))
      && [item.tone, item.language, item.firstInteractionAt, item.lastInteractionAt].every((field) => field === undefined || typeof field === "string");
  });
}

export class RelationshipMemory {
  private readonly file: string;
  private profiles: CounterpartProfile[];
  private persistedText: string | undefined;
  private readState: "missing" | "ready" | "unavailable" = "missing";

  constructor(dataDir: string) {
    this.file = join(dataDir, "counterparts.json");
    this.profiles = this.load();
  }

  private load(): CounterpartProfile[] {
    try {
      const text = readFileSync(this.file, "utf8");
      const parsed: unknown = JSON.parse(text);
      if (!validProfiles(parsed)) throw new Error("Invalid relationship memory schema");
      this.persistedText = text;
      this.readState = "ready";
      return parsed;
    } catch (error) {
      // Buzz engram_fetch.rs distinguishes confirmed absence from unreadable memory.
      // Apply that boundary locally: only ENOENT is absence; invalid data is never reset.
      this.readState = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
      return [];
    }
  }

  getReadStatus(): { state: "missing" | "ready" | "unavailable"; writable: boolean } {
    return { state: this.readState, writable: this.readState !== "unavailable" };
  }

  private assertReadable(): void {
    if (this.readState === "unavailable") throw new RelationshipMemoryUnavailableError();
  }

  private save(profiles: CounterpartProfile[]): void {
    this.assertReadable();
    // Do not silently overwrite a file repaired/changed by another process since load.
    let current: string | undefined;
    try { current = readFileSync(this.file, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.readState = "unavailable";
        throw new RelationshipMemoryUnavailableError();
      }
    }
    if (current !== this.persistedText) {
      this.readState = "unavailable";
      throw new RelationshipMemoryUnavailableError();
    }
    const text = JSON.stringify(profiles, null, 2);
    writeAtomic(this.file, text);
    // Publish the new in-memory state only after the durable write succeeds.
    this.profiles = profiles;
    this.persistedText = text;
    this.readState = "ready";
  }

  list(): CounterpartProfile[] {
    this.assertReadable();
    return this.profiles.map((item) => structuredClone(item));
  }

  get(id: string): CounterpartProfile | undefined {
    this.assertReadable();
    const found = this.profiles.find((item) => item.id === id.trim());
    return found ? structuredClone(found) : undefined;
  }

  upsert(id: string, patch: CounterpartPatch): CounterpartProfile {
    this.assertReadable();
    const key = id.trim();
    if (!key) throw new Error("关系档案需要一个对象 id。");
    const now = new Date().toISOString();
    const next = structuredClone(this.profiles);
    const existing = next.find((item) => item.id === key);
    const profile: CounterpartProfile = existing ?? {
      id: key,
      displayName: key,
      relation: "other",
      boundaries: [],
      notes: [],
      interactionCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (typeof patch.displayName === "string" && patch.displayName.trim()) {
      profile.displayName = patch.displayName.trim();
    }
    if (patch.relation !== undefined) profile.relation = normalizeRelation(patch.relation);
    if (typeof patch.tone === "string") profile.tone = patch.tone.trim() || undefined;
    if (typeof patch.language === "string") profile.language = patch.language.trim() || undefined;
    if (patch.boundaries !== undefined) profile.boundaries = cleanList(patch.boundaries, MAX_BOUNDARIES);
    for (const note of patch.addNotes ?? []) {
      const text = String(note?.text ?? "").trim();
      if (!text) continue;
      profile.notes.push({ text, at: now, source: note.source === "user" ? "user" : "observed" });
    }
    // 只截断观察，不截断边界——边界被挤掉就等于悄悄放开了限制。
    if (profile.notes.length > MAX_NOTES) profile.notes = profile.notes.slice(-MAX_NOTES);
    if (patch.recordInteraction) {
      profile.firstInteractionAt = profile.firstInteractionAt ?? now;
      profile.lastInteractionAt = now;
      profile.interactionCount += 1;
    }
    profile.updatedAt = now;
    if (!existing) next.push(profile);
    this.save(next);
    return structuredClone(profile);
  }

  remove(id: string): boolean {
    this.assertReadable();
    const index = this.profiles.findIndex((item) => item.id === id.trim());
    if (index < 0) return false;
    const next = structuredClone(this.profiles);
    next.splice(index, 1);
    this.save(next);
    return true;
  }

  /**
   * 渲染成注入提示词的一段。
   *
   * 没有档案时返回空串——凭空编一段「对方偏好」比没有更糟。
   * 边界永远单独成节并写明是硬约束，避免被当成可权衡的风格建议。
   */
  buildPromptBlock(id: string): string {
    const profile = this.get(id);
    if (!profile) return "";
    const lines: string[] = [
      `## 沟通对象：${profile.displayName}`,
      `关系：${relationLabel(profile.relation)}`,
    ];
    if (profile.tone) lines.push(`口径：${profile.tone}`);
    if (profile.language) lines.push(`语言：${profile.language}`);
    if (profile.interactionCount > 0) {
      lines.push(`已互动 ${profile.interactionCount} 次，最近一次：${profile.lastInteractionAt ?? "未知"}`);
    }
    const userNotes = profile.notes.filter((note) => note.source === "user");
    const observed = profile.notes.filter((note) => note.source === "observed");
    if (userNotes.length) {
      lines.push("", "### 用户明确说过", ...userNotes.map((note) => `- ${note.text}`));
    }
    if (observed.length) {
      // 标明是推断，避免被当成用户确认过的事实。
      lines.push("", "### 从过往互动总结（未经用户确认）", ...observed.map((note) => `- ${note.text}`));
    }
    if (profile.boundaries.length) {
      lines.push(
        "",
        "### 硬边界（不得违反）",
        ...profile.boundaries.map((item) => `- ${item}`),
        "以上边界高于风格偏好；与本次任务要求冲突时，先说明冲突，不要自行突破。",
      );
    }
    return lines.join("\n");
  }
}

function relationLabel(relation: RelationKind): string {
  const labels: Record<RelationKind, string> = {
    teammate: "同事", client: "客户", partner: "合作方", investor: "投资人",
    vendor: "供应商", family: "家人", friend: "朋友", other: "其他",
  };
  return labels[relation];
}
