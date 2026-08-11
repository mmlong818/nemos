// visibility.ts — 记忆可见性作用域（agent / user / storyline / team / global）
//
// 与 Memory.scope 正交：scope 说的是「这条记忆属于哪个主题域」（project:xxx / task:xxx），
// 这里说的是「谁能看见它」。默认隔离——一条记忆只对归属层可见，跨层必须显式共享。

/** 五层可见性，范围由窄到宽。 */
export const MEMORY_SCOPE_KINDS = ["agent", "user", "storyline", "team", "global"] as const;

export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];

const SCOPE_KIND_SET = new Set<string>(MEMORY_SCOPE_KINDS);

/** 指向某一层的具体主体；global 是唯一不需要 id 的层。 */
export interface MemoryScopeRef {
  kind: MemoryScopeKind;
  id?: string;
}

/** 记忆的归属层，以及显式共享出去的目标。 */
export interface MemoryVisibility {
  owner: MemoryScopeRef;
  /** 显式共享目标；未共享时不写。 */
  sharedWith?: MemoryScopeRef[];
}

/** 一次读取的身份上下文，决定这次能看见哪些记忆。 */
export interface MemoryViewer {
  userId: string;
  agentId?: string;
  storylineId?: string;
  teamIds?: string[];
}

export function isMemoryScopeKind(value: unknown): value is MemoryScopeKind {
  return typeof value === "string" && SCOPE_KIND_SET.has(value);
}

/**
 * 规范化一个作用域引用。
 * global 忽略 id；其余四层缺 id 就是配置错误——静默放行会让隔离失效，所以直接抛。
 */
export function normalizeScopeRef(kind: unknown, id?: unknown): MemoryScopeRef {
  if (!isMemoryScopeKind(kind)) throw new Error(`未知的记忆作用域：${String(kind)}`);
  if (kind === "global") return { kind };
  const owner = typeof id === "string" ? id.trim() : "";
  if (!owner) throw new Error(`${kind} 作用域必须指明归属 id。`);
  return { kind, id: owner };
}

/** 稳定的字符串键，用于去重和 SQL 匹配。 */
export function scopeRefKey(ref: MemoryScopeRef): string {
  return ref.kind === "global" ? "global" : `${ref.kind}:${ref.id}`;
}

/** 老数据和未声明归属的写入都落到「该用户私有」，这是最接近既有语义的安全默认。 */
export function defaultVisibility(userId: string): MemoryVisibility {
  return { owner: normalizeScopeRef("user", userId) };
}

/** 读取方在这次上下文里持有的全部身份。 */
export function viewerScopeRefs(viewer: MemoryViewer): MemoryScopeRef[] {
  const refs: MemoryScopeRef[] = [{ kind: "global" }];
  if (viewer.userId) refs.push({ kind: "user", id: viewer.userId });
  if (viewer.agentId) refs.push({ kind: "agent", id: viewer.agentId });
  if (viewer.storylineId) refs.push({ kind: "storyline", id: viewer.storylineId });
  for (const teamId of viewer.teamIds ?? []) {
    if (teamId) refs.push({ kind: "team", id: teamId });
  }
  return refs;
}

/** 归属层命中，或被显式共享给读取方持有的任一身份。 */
export function canView(visibility: MemoryVisibility | undefined, viewer: MemoryViewer): boolean {
  if (!visibility) return true; // 未标注归属的记忆按老语义处理，由 tenant/user 过滤兜底
  const held = new Set(viewerScopeRefs(viewer).map(scopeRefKey));
  if (held.has(scopeRefKey(visibility.owner))) return true;
  return (visibility.sharedWith ?? []).some((ref) => held.has(scopeRefKey(ref)));
}

/**
 * 共享目标的扁平键串，形如 `|agent:a1|team:t2|`。
 * 两侧和中间都带分隔符，SQL 用 LIKE '%|agent:a1|%' 匹配时不会把 `team:t2` 错配成 `team:t20`。
 */
export function serializeSharedKeys(sharedWith: MemoryScopeRef[] | undefined): string | null {
  if (!sharedWith || sharedWith.length === 0) return null;
  const keys = [...new Set(sharedWith.map(scopeRefKey))];
  return `|${keys.join("|")}|`;
}

export function parseSharedWith(json: string | null | undefined): MemoryScopeRef[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const refs = parsed
      .filter((item): item is { kind: unknown; id?: unknown } => !!item && typeof item === "object")
      .filter((item) => isMemoryScopeKind(item.kind))
      .map((item) => normalizeScopeRef(item.kind, item.id));
    return refs.length > 0 ? refs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 构造可见性的 SQL 过滤子句。
 * `alias` 是记忆表的别名（不带点）。返回的 sql 已用括号包好，可直接 AND 拼接。
 */
export function visibilitySqlClause(
  alias: string,
  viewer: MemoryViewer,
): { sql: string; params: string[] } {
  const params: string[] = [];
  const owned: string[] = [`${alias}.scope_kind = 'global'`];
  for (const ref of viewerScopeRefs(viewer)) {
    if (ref.kind === "global") continue;
    owned.push(`(${alias}.scope_kind = ? AND ${alias}.scope_owner_id = ?)`);
    params.push(ref.kind, ref.id as string);
  }
  // 显式共享：shared_keys 绝大多数行为 NULL，LIKE 只在少数行上求值。
  const shared: string[] = [];
  for (const ref of viewerScopeRefs(viewer)) {
    shared.push(`${alias}.shared_keys LIKE ?`);
    params.push(`%|${scopeRefKey(ref)}|%`);
  }
  // 未标注归属的老数据继续可见，避免迁移当天把历史记忆全部隐藏。
  const legacy = `${alias}.scope_kind IS NULL`;
  const sharedSql = `(${alias}.shared_keys IS NOT NULL AND (${shared.join(" OR ")}))`;
  return { sql: `(${legacy} OR ${owned.join(" OR ")} OR ${sharedSql})`, params };
}
