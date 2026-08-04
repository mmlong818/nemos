import { randomUUID } from "node:crypto";
import { makeClaimKey } from "./claims.js";
import type { LifecycleOrchestrator } from "./lifecycle.js";
import { propagateCorrection } from "./reconcile.js";
import type { Storage } from "./storage.js";
import {
  SCHEMA_VERSION,
  type CorrectionInput,
  type IdentityOperation,
  type Memory,
  type MemoryOperation,
} from "./types.js";
import { detectArousalSignals, estimateArousal, estimateSurprise } from "./utils/arousal.js";
import { newId, nowIso } from "./utils/id.js";

interface ClaimServiceOptions {
  storage: Storage;
  lifecycle: LifecycleOrchestrator;
  tenantId: string;
  userId: string;
  defaultScope: string;
  buildArchival: (content: string, scope: string) => Memory;
  embed: (memory: Memory) => Promise<void>;
}

export class ClaimService {
  constructor(private readonly options: ClaimServiceOptions) {}

  async correct(memoryId: string, correction: string | CorrectionInput): Promise<MemoryOperation> {
    const { storage, lifecycle, tenantId, userId } = this.options;
    const target = storage.findById(tenantId, userId, memoryId);
    if (!target || target.layer === "archival") throw new Error(`[nemos] correct target not found: ${memoryId}`);
    if (!target.claim_key || !target.predicate || !target.subject_id) {
      throw new Error("[nemos] correct() 当前要求目标是已结构化 Assertion");
    }
    const input: CorrectionInput = typeof correction === "string" ? { content: correction } : correction;
    const content = input.content.trim();
    if (!content) throw new Error("[nemos] correction content is empty");
    const archival = this.options.buildArchival(content, target.scope);
    archival.source.origin = "user-correction";
    lifecycle.appendEvent(tenantId, userId, archival);
    await this.options.embed(archival);

    const now = nowIso();
    const corrected: Memory = {
      id: newId(target.layer), layer: target.layer, type: target.type, scope: target.scope, content,
      source: { authoritative: false, kind: "derived", origin: "user-correction", chain_depth: 1, extractor: "user_typed" },
      arousal: { value: estimateArousal(content), signal_sources: detectArousalSignals(content) },
      surprise: { value: estimateSurprise(content), basis: "explicit user correction" },
      ownership: target.ownership,
      created_at: now, last_accessed: now, access_count: 0, stability: 1,
      schema_version: SCHEMA_VERSION, generation: 1, archival_ref: archival.id,
      subject_id: target.subject_id, predicate: target.predicate,
      context_dimensions: target.context_dimensions, object_json: input.object,
      valid_at: input.valid_from, trust_tier: 1, utterance_mode: "literal",
      specificity: target.specificity ?? "global", corrects: [target.id], source_event_ids: [archival.id],
    };
    lifecycle.recordExtraction(archival.id, [corrected]);
    const result = await lifecycle.processDerived(tenantId, userId, archival.id, [corrected], { correctionOf: target.id });
    lifecycle.markScheduled(archival.id, { correction_of: target.id });
    const winner = result.persisted[0];
    if (!winner) throw new Error("[nemos] correction produced no assertion");
    propagateCorrection(storage, tenantId, userId, target.id, winner.id, now);
    const operation = storage.listMemoryOperations(tenantId, userId, target.claim_key)
      .reverse().find((item) => item.source_event_id === archival.id);
    if (!operation) throw new Error("[nemos] correction operation missing");
    return operation;
  }

  async invalidate(memoryId: string, reason: string): Promise<MemoryOperation> {
    const { storage, lifecycle, tenantId, userId } = this.options;
    const target = storage.findById(tenantId, userId, memoryId);
    if (!target || target.layer === "archival") throw new Error(`[nemos] invalidate target not found: ${memoryId}`);
    const explanation = reason.trim();
    if (!explanation) throw new Error("[nemos] invalidate reason is empty");
    const event = this.options.buildArchival(explanation, target.scope);
    event.source.origin = "user-invalidation";
    lifecycle.appendEvent(tenantId, userId, event);
    lifecycle.markSkipped(event.id);
    const at = nowIso();
    const operation: MemoryOperation = {
      id: `op:${randomUUID()}`, tenant_id: tenantId, user_id: userId,
      space_id: target.scope, claim_key: target.claim_key ?? null, kind: "INVALIDATE",
      subject_memory_ids: [target.id], source_event_id: event.id, reason: explanation, created_at: at,
    };
    storage.transaction(() => {
      storage.updateMemoryBeliefState(tenantId, userId, target.layer, target.id, "invalidated", { invalidAt: at, expiredAt: at });
      storage.insertMemoryOperation(operation);
      storage.insertProvenanceEdge({
        tenant_id: tenantId, user_id: userId, source_id: event.id,
        derived_id: target.id, relation: "corrected_from", created_at: at,
      });
    });
    propagateCorrection(storage, tenantId, userId, target.id, target.id, at);
    return operation;
  }

  async resolveDispute(claimKey: string, winnerMemoryId: string): Promise<MemoryOperation> {
    const { storage, tenantId, userId } = this.options;
    const canonicalClaimKey = storage.resolveCanonicalClaimKey(claimKey);
    const winner = storage.findById(tenantId, userId, winnerMemoryId);
    const winnerClaimKey = winner?.claim_key
      ? storage.resolveCanonicalClaimKey(winner.claim_key)
      : undefined;
    if (!winner || winnerClaimKey !== canonicalClaimKey || winner.object_json === undefined) {
      throw new Error("[nemos] dispute winner is not a member of the claim");
    }
    return this.correct(winner.id, {
      content: winner.content,
      object: winner.object_json,
      valid_from: winner.valid_at,
    });
  }
  listOperations(claimKey?: string): MemoryOperation[] {
    return this.options.storage.listMemoryOperations(this.options.tenantId, this.options.userId, claimKey);
  }

  rekeyClaim(oldClaimKey: string, canonicalClaimKey: string, reason: string, scope = this.options.defaultScope): MemoryOperation {
    const { storage, lifecycle, tenantId, userId } = this.options;
    const oldKey = oldClaimKey.trim();
    const nextKey = canonicalClaimKey.trim();
    if (!oldKey.startsWith("ck:") || !nextKey.startsWith("ck:") || oldKey === nextKey) {
      throw new Error("[nemos] rekeyClaim requires two different claim keys");
    }
    const entries = storage.listClaimEntries(tenantId, userId, scope, oldKey);
    if (entries.length === 0) throw new Error(`[nemos] claim not found: ${oldKey}`);
    const explanation = reason.trim() || "claim key migration";
    const event = this.options.buildArchival(explanation, entries[0]!.space_id);
    event.source.origin = "claim-rekey";
    lifecycle.appendEvent(tenantId, userId, event);
    lifecycle.markSkipped(event.id);
    const operation: MemoryOperation = {
      id: `op:${randomUUID()}`, tenant_id: tenantId, user_id: userId,
      space_id: entries[0]!.space_id, claim_key: nextKey, kind: "MERGE",
      subject_memory_ids: entries.map((entry) => entry.memory_id), source_event_id: event.id,
      reason: explanation, created_at: nowIso(),
    };
    storage.transaction(() => {
      for (const entry of entries) storage.rekeyMemoryClaim(tenantId, userId, entry.layer, entry.memory_id, nextKey);
      storage.recordClaimKeyAlias(oldKey, nextKey, operation.id, operation.created_at);
      storage.insertMemoryOperation(operation);
      const combined = storage.listClaimEntries(tenantId, userId, entries[0]!.space_id, nextKey);
      const active = combined.filter((entry) => entry.status === "active" || entry.status === "disputed");
      if (new Set(active.map((entry) => entry.canonical_object_hash)).size > 1) {
        for (const entry of active) storage.updateMemoryBeliefState(tenantId, userId, entry.layer, entry.memory_id, "disputed");
      }
    });
    return operation;
  }

  mergeIdentity(subjectIds: string[], canonicalSubjectId: string, scope = this.options.defaultScope): IdentityOperation {
    const { storage, tenantId, userId } = this.options;
    const ids = [...new Set([...subjectIds, canonicalSubjectId].map((id) => id.trim()).filter(Boolean))];
    if (ids.length < 2 || !canonicalSubjectId.trim()) throw new Error("[nemos] mergeIdentity requires at least two subjects and a canonical subject");
    const operation: IdentityOperation = {
      id: `identity-op:${randomUUID()}`, tenant_id: tenantId, user_id: userId, space_id: scope,
      kind: "MERGE", subject_ids: ids, canonical_subject_id: canonicalSubjectId.trim(), created_at: nowIso(),
    };
    storage.transaction(() => {
      storage.applyIdentityOperation(operation);
      this.rekeyIdentityMemories(scope, ids, canonicalSubjectId.trim());
    });
    return operation;
  }

  splitIdentity(operationId: string): IdentityOperation {
    const { storage, tenantId, userId } = this.options;
    const merged = storage.getIdentityOperation(tenantId, userId, operationId);
    if (!merged || merged.kind !== "MERGE") throw new Error(`[nemos] merge identity operation not found: ${operationId}`);
    const operation: IdentityOperation = {
      id: `identity-op:${randomUUID()}`, tenant_id: tenantId, user_id: userId, space_id: merged.space_id,
      kind: "SPLIT", subject_ids: [...merged.subject_ids], canonical_subject_id: merged.canonical_subject_id,
      reverses_operation_id: merged.id, created_at: nowIso(),
    };
    storage.transaction(() => {
      storage.applyIdentityOperation(operation);
      const restored = new Map<string, Memory[]>();
      for (const memory of storage.listAll(tenantId, userId)) {
        if (memory.scope !== merged.space_id || !memory.subject_id || !memory.predicate || !memory.claim_key) continue;
        if (!merged.subject_ids.includes(memory.subject_id)) continue;
        const claimKey = makeClaimKey(memory.subject_id, memory.predicate, memory.context_dimensions ?? {});
        storage.rekeyMemoryClaim(tenantId, userId, memory.layer, memory.id, claimKey);
        memory.claim_key = claimKey;
        restored.set(claimKey, [...(restored.get(claimKey) ?? []), memory]);
      }
      for (const group of restored.values()) {
        if (group.length !== 1) continue;
        const memory = group[0]!;
        storage.updateMemoryBeliefState(tenantId, userId, memory.layer, memory.id, "active");
      }
    });
    return operation;
  }

  private rekeyIdentityMemories(scope: string, subjectIds: string[], canonicalSubjectId: string): void {
    const { storage, tenantId, userId } = this.options;
    const affected: Memory[] = [];
    for (const memory of storage.listAll(tenantId, userId)) {
      if (memory.scope !== scope || !memory.subject_id || !memory.predicate || !memory.claim_key) continue;
      if (!subjectIds.includes(memory.subject_id)) continue;
      const claimKey = makeClaimKey(canonicalSubjectId, memory.predicate, memory.context_dimensions ?? {});
      storage.rekeyMemoryClaim(tenantId, userId, memory.layer, memory.id, claimKey);
      memory.claim_key = claimKey;
      affected.push(memory);
    }
    const groups = new Map<string, Memory[]>();
    for (const memory of affected) groups.set(memory.claim_key!, [...(groups.get(memory.claim_key!) ?? []), memory]);
    for (const group of groups.values()) {
      const hashes = new Set(group.filter((item) => !item.belief_state || item.belief_state === "active").map((item) => item.canonical_object_hash));
      if (hashes.size < 2) continue;
      for (const memory of group) storage.updateMemoryBeliefState(tenantId, userId, memory.layer, memory.id, "disputed");
    }
  }
}