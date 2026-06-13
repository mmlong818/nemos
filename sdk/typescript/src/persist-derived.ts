// persist-derived.ts — 共用 helper：把 derived 列表带 5 强约束兜底写入 storage + embedding
//
// 被 user-memory.ts（sync 路径）和 queue.ts（background worker 路径）共用。

import type { Storage } from "./storage.js";
import type { EmbeddingProvider, LogLevel, Memory } from "./types.js";
import { LAYERS } from "./types.js";
import { newId } from "./utils/id.js";

/**
 * 持久化 derived 列表。守住：
 * - 跳过未知 layer
 * - 跳过 derived 中的 archival（archival 仅原文）
 * - personal_semantic 拒绝 authoritative=true → 降级 episodic
 * - 所有 derived 强制 authoritative=false / kind='derived'
 */
export async function persistDerivedList(
  storage: Storage,
  embedding: EmbeddingProvider | null,
  log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
  tenantId: string,
  userId: string,
  derived: Memory[],
): Promise<Memory[]> {
  const persisted: Memory[] = [];
  for (const d of derived) {
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
    storage.insert(tenantId, userId, d);
    if (embedding) {
      try {
        const vec = await embedding.embed(d.content);
        storage.insertEmbedding(tenantId, userId, d.layer, d.id, vec, embedding.modelId);
        d.embedding_model_id = embedding.modelId;
      } catch (e) {
        log("warn", "embedding 失败（不阻塞）", {
          id: d.id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
    persisted.push(d);
  }
  return persisted;
}
