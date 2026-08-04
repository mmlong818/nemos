// persist-derived.ts — 共用 helper：把 derived 列表带 5 强约束兜底写入 storage + embedding
//
// 被 user-memory.ts（sync 路径）和 queue.ts（background worker 路径）共用。
// 拆成两阶段：prepareDerived（异步：约束校验 + 算 embedding）→ writePreparedDerived
// （同步：单事务写入）。SQLite 事务不能跨 await，所以 LLM/embedding 网络调用必须
// 全部发生在事务之外；reflect.ts 借这两个阶段把「写入新事实 + 失效旧事实」并进同一事务。

import type { Storage } from "./storage.js";
import type { EmbeddingProvider, LogLevel, Memory } from "./types.js";
import { LAYERS } from "./types.js";
import { newId, nowIso } from "./utils/id.js";

export interface PreparedDerived {
  memory: Memory;
  vec: Float32Array | null;
  modelId: string | null;
}

/**
 * 阶段一（异步）：约束校验 + embedding 计算。守住：
 * - 跳过未知 layer
 * - 跳过 derived 中的 archival（archival 仅原文）
 * - personal_semantic 拒绝 authoritative=true → 降级 episodic
 * - 所有 derived 强制 authoritative=false / kind='derived'
 */
export async function prepareDerived(
  embedding: EmbeddingProvider | null,
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
  derived: Memory[],
): Promise<PreparedDerived[]> {
  const prepared: PreparedDerived[] = [];
  for (const d of derived) {
    d.generation = d.generation ?? 1;
    if (d.generation > 2) {
      throw new Error(`[nemos] automatic generation limit exceeded: ${d.generation}`);
    }
    if (!LAYERS.includes(d.layer)) {
      log("warn", `忽略未知 layer: ${d.layer}`);
      continue;
    }
    if (d.layer === "archival") {
      log("warn", "忽略 derived 中的 archival（archival 仅原文）");
      continue;
    }
    if (d.layer === "personal_semantic" && d.source.authoritative === true) {
      log(
        "warn",
        "personal_semantic 拒绝 authoritative=true 的派生（spec I4），降级为 episodic",
        { id: d.id },
      );
      d.layer = "episodic";
      d.id = newId("episodic");
    }
    if (d.source.authoritative === true) {
      log(
        "warn",
        "强制将 derived.source.authoritative 置为 false（RFC 0001 §1）",
        { id: d.id },
      );
      d.source.authoritative = false;
      d.source.kind = "derived";
    }
    let vec: Float32Array | null = null;
    let modelId: string | null = null;
    if (embedding) {
      try {
        vec = await embedding.embed(d.content);
        modelId = embedding.modelId;
      } catch (e) {
        log("warn", "embedding 失败（不阻塞）", {
          id: d.id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
    prepared.push({ memory: d, vec, modelId });
  }
  return prepared;
}

/** 阶段二（同步）：写入主记录 + embedding。调用方负责包在 storage.transaction 里。 */
export function writePreparedDerived(
  storage: Storage,
  tenantId: string,
  userId: string,
  prepared: PreparedDerived[],
): Memory[] {
  const persisted: Memory[] = [];
  for (const p of prepared) {
    storage.insert(tenantId, userId, p.memory);
    const provenanceAt = nowIso();
    if (p.memory.archival_ref && p.memory.archival_ref !== p.memory.id) {
      storage.insertProvenanceEdge({ tenant_id: tenantId, user_id: userId, source_id: p.memory.archival_ref, derived_id: p.memory.id, relation: "extracted_from", created_at: provenanceAt });
    }
    for (const sourceId of p.memory.consolidated_from ?? []) {
      storage.insertProvenanceEdge({ tenant_id: tenantId, user_id: userId, source_id: sourceId, derived_id: p.memory.id, relation: "consolidated_from", created_at: provenanceAt });
    }
    if (p.vec && p.modelId) {
      storage.insertEmbedding(tenantId, userId, p.memory.layer, p.memory.id, p.vec, p.modelId);
      p.memory.embedding_model_id = p.modelId;
    }
    persisted.push(p.memory);
  }
  return persisted;
}

/**
 * 持久化 derived 列表（prepare + 单事务 write 的组合入口）。
 */
export async function persistDerivedList(
  storage: Storage,
  embedding: EmbeddingProvider | null,
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
  tenantId: string,
  userId: string,
  derived: Memory[],
): Promise<Memory[]> {
  const prepared = await prepareDerived(embedding, log, derived);
  return storage.transaction(() => writePreparedDerived(storage, tenantId, userId, prepared));
}
