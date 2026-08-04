import { createHash } from "node:crypto";
import { applyNormalizedAssertion, makeClaimKey, normalizeAssertion } from "./claims.js";
import { reconcileAndCommit, type ReconcileOptions } from "./reconcile.js";
import { extractEntities } from "./entity.js";
import { prepareDerived, writePreparedDerived } from "./persist-derived.js";
import type { Storage } from "./storage.js";
import {
  LIFECYCLE_ALGORITHM_VERSION,
  type EmbeddingProvider,
  type EventMetadata,
  type LifecycleStage,
  type LifecycleStageRecord,
  type LifecycleStatusInfo,
  type LLMProvider,
  type LogLevel,
  type Memory,
} from "./types.js";
import { nowIso } from "./utils/id.js";

interface LifecycleOptions {
  autoLinking: boolean;
  crossScopeLink: boolean;
}

export class LifecycleOrchestrator {
  constructor(
    private readonly storage: Storage,
    private readonly llm: LLMProvider,
    private readonly embedding: EmbeddingProvider | null,
    private readonly log: (level: LogLevel, msg: string, meta?: Record<string, unknown>) => void,
    private readonly options: LifecycleOptions,
  ) {}

  appendEvent(tenantId: string, userId: string, archival: Memory): EventMetadata {
    archival.generation = 0;
    return this.storage.transaction(() => {
      const existing = this.storage.getEventMetadata(archival.id);
      if (existing) return existing;
      const event = this.storage.ensureEventMetadata({
        event_id: archival.id,
        tenant_id: tenantId,
        user_id: userId,
        space_id: archival.scope,
        generation: 0,
        source_event_ids: [archival.id],
        created_at: archival.created_at,
      });
      this.storage.insert(tenantId, userId, archival);
      this.writeStage(archival.id, "append", "completed", 0, null);
      return event;
    });
  }

  async appendStructuredMemory(tenantId: string, userId: string, memory: Memory): Promise<{ memory: Memory; hasConflict: boolean }> {
    if (memory.layer === "archival") {
      this.appendEvent(tenantId, userId, memory);
      this.markSkipped(memory.id);
      return { memory, hasConflict: false };
    }
    memory.generation = memory.generation ?? 1;
    if (memory.generation > 2) {
      throw new Error(`[nemos] automatic generation limit exceeded: ${memory.generation}`);
    }
    memory.source_event_ids = [...new Set([...(memory.source_event_ids ?? []), memory.id])];
    const event = this.storage.transaction(() => {
      const metadata = this.storage.ensureEventMetadata({
        event_id: memory.id,
        tenant_id: tenantId,
        user_id: userId,
        space_id: memory.scope,
        generation: memory.generation!,
        source_event_ids: [memory.id],
        created_at: memory.created_at,
      });
      this.writeStage(memory.id, "append", "completed", memory.generation!, { structured: true });
      this.writeStage(memory.id, "extract", "skipped", memory.generation!, { structured: true });
      return metadata;
    });
    this.normalizeMemory(tenantId, userId, memory);
    const reconciled = reconcileAndCommit(
      this.storage, tenantId, userId, event, memory,
      () => { this.storage.insert(tenantId, userId, memory); },
    );
    this.writeStage(memory.id, "persist", "completed", memory.generation!, {
      memory_ids: [reconciled.memory.id], operation: reconciled.operation.kind,
    });
    const legacyConflict = this.linkPersonalSemanticConflicts(tenantId, userId, [reconciled.memory]);
    if (this.options.autoLinking) await this.linkEntities(tenantId, userId, memory.id, [reconciled.memory]);
    const hasConflict = reconciled.hasConflict || legacyConflict;
    this.writeStage(memory.id, "link", "completed", memory.generation, { has_conflict: hasConflict });
    this.writeStage(memory.id, "schedule", "skipped", memory.generation, null);
    this.writeStage(memory.id, "complete", "completed", memory.generation, null);
    return { memory: reconciled.memory, hasConflict };
  }
  recordExtraction(eventId: string, derived: Memory[]): void {
    const normalized = derived.map((memory) => ({ ...memory, generation: memory.generation ?? 1 }));
    this.writeStage(eventId, "extract", "completed", 1, { derived: normalized });
  }

  loadExtraction(eventId: string): Memory[] | null {
    const stage = this.storage.getLifecycleStage(eventId, "extract", LIFECYCLE_ALGORITHM_VERSION);
    if (!stage || stage.status !== "completed" || !stage.metadata_json) return null;
    const value = JSON.parse(stage.metadata_json) as { derived?: Memory[] };
    return Array.isArray(value.derived) ? value.derived : null;
  }

  async processDerived(
    tenantId: string,
    userId: string,
    eventId: string,
    derived: Memory[],
    options: ReconcileOptions = {},
  ): Promise<{ persisted: Memory[]; hasConflict: boolean }> {
    const completed = this.storage.getLifecycleStage(eventId, "persist", LIFECYCLE_ALGORITHM_VERSION);
    let persisted: Memory[];
    let reconcileConflict = false;
    if (completed?.status === "completed") {
      const metadata = completed.metadata_json ? JSON.parse(completed.metadata_json) as { memory_ids?: string[] } : {};
      persisted = (metadata.memory_ids ?? [])
        .map((id) => this.storage.findById(tenantId, userId, id))
        .filter((memory): memory is Memory => memory !== null);
    } else {
      const event = this.storage.getEventMetadata(eventId);
      if (!event) throw new Error(`[nemos] event metadata missing: ${eventId}`);
      const guarded = derived.map((memory) => {
        const generation = memory.generation ?? 1;
        if (generation > 2) throw new Error(`[nemos] automatic generation limit exceeded: ${generation}`);
        const next = { ...memory, archival_ref: eventId, generation, source_event_ids: [eventId] };
        this.normalizeMemory(tenantId, userId, next);
        return next;
      });
      const prepared = await prepareDerived(this.embedding, this.log, guarded);
      const results = prepared.map((item) => reconcileAndCommit(
        this.storage,
        tenantId,
        userId,
        event,
        item.memory,
        () => { writePreparedDerived(this.storage, tenantId, userId, [item]); },
        options,
      ));
      reconcileConflict = results.some((result) => result.hasConflict);
      persisted = [...new Map(results.map((result) => [result.memory.id, result.memory])).values()];
      this.writeStage(eventId, "persist", "completed", 1, {
        memory_ids: persisted.map((memory) => memory.id),
        operations: results.map((result) => result.operation.kind),
      });
    }

    const legacyConflict = this.linkPersonalSemanticConflicts(tenantId, userId, persisted);
    if (this.options.autoLinking) await this.linkEntities(tenantId, userId, eventId, persisted);
    const hasConflict = reconcileConflict || legacyConflict;
    this.writeStage(eventId, "link", "completed", 1, { has_conflict: hasConflict });
    return { persisted, hasConflict };
  }
  markFailure(eventId: string, stage: LifecycleStage, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const generation = this.storage.getEventMetadata(eventId)?.generation ?? 1;
    this.writeStage(eventId, stage, "failed", generation, null, message);
  }
  markScheduled(eventId: string, metadata?: Record<string, unknown>): void {
    this.writeStage(eventId, "schedule", "completed", 1, metadata ?? null);
    this.writeStage(eventId, "complete", "completed", 1, null);
  }

  markSkipped(eventId: string): void {
    for (const stage of ["extract", "persist", "link", "schedule"] as LifecycleStage[]) {
      this.writeStage(eventId, stage, "skipped", 0, null);
    }
    this.writeStage(eventId, "complete", "completed", 0, null);
  }

  status(eventId: string): LifecycleStatusInfo | null {
    const event = this.storage.getEventMetadata(eventId);
    if (!event) return null;
    const stages = this.storage.listLifecycleStages(eventId);
    return {
      event,
      stages,
      completed: stages.some((stage) => stage.stage === "complete" && stage.status === "completed"),
      failed: stages.some((stage) => stage.status === "failed"),
    };
  }

  private writeStage(
    eventId: string,
    stage: LifecycleStage,
    status: LifecycleStageRecord["status"],
    generation: number,
    metadata: Record<string, unknown> | null,
    lastError: string | null = null,
  ): void {
    const existing = this.storage.getLifecycleStage(eventId, stage, LIFECYCLE_ALGORITHM_VERSION);
    const now = nowIso();
    this.storage.upsertLifecycleStage({
      event_id: eventId,
      stage,
      algorithm_version: LIFECYCLE_ALGORITHM_VERSION,
      idempotency_key: createHash("sha256").update(`${eventId}|${stage}|${LIFECYCLE_ALGORITHM_VERSION}`).digest("hex"),
      status,
      generation,
      metadata_json: metadata ? JSON.stringify(metadata) : null,
      started_at: existing?.started_at ?? now,
      updated_at: now,
      completed_at: status === "completed" || status === "skipped" ? now : null,
      last_error: lastError,
    });
  }

  private normalizeMemory(tenantId: string, userId: string, memory: Memory): void {
    const normalized = normalizeAssertion(memory, userId);
    if (!normalized) {
      memory.source_event_ids = [...new Set(memory.source_event_ids ?? (memory.archival_ref ? [memory.archival_ref] : []))];
      return;
    }
    if (normalized.subject_id) {
      const canonical = this.storage.resolveCanonicalSubject(tenantId, userId, memory.scope, normalized.subject_id);
      if (canonical !== normalized.subject_id && normalized.predicate && normalized.claim_key) {
        normalized.subject_id = canonical;
        normalized.subject_resolution = "resolved";
        normalized.claim_key = makeClaimKey(canonical, normalized.predicate.id, normalized.context_dimensions);
      }
    }
    applyNormalizedAssertion(memory, normalized);
  }
  private linkPersonalSemanticConflicts(tenantId: string, userId: string, persisted: Memory[]): boolean {
    let found = false;
    for (const memory of persisted.filter((item) => item.layer === "personal_semantic" && !item.claim_key)) {
      const similar = this.storage.searchFts(
        tenantId, userId, memory.content, ["personal_semantic"], undefined, 5, {},
      ).filter((item) => item.id !== memory.id);
      if (similar.length === 0) continue;
      found = true;
      this.storage.updateRelated(tenantId, userId, memory.layer, memory.id,
        [...new Set([...(memory.related ?? []), ...similar.map((item) => item.id)])]);
      for (const item of similar) {
        this.storage.updateRelated(tenantId, userId, item.layer, item.id,
          [...new Set([...(item.related ?? []), memory.id])]);
      }
    }
    return found;
  }

  private async linkEntities(tenantId: string, userId: string, eventId: string, persisted: Memory[]): Promise<void> {
    const eventMemory = this.storage.findById(tenantId, userId, eventId);
    if (!eventMemory) return;
    const memories = [...new Map([eventMemory, ...persisted].map((memory) => [memory.id, memory])).values()];
    for (const memory of memories) {
      if (memory.layer === "archival") continue;
      try {
        const entities = await extractEntities(memory.content, this.llm);
        if (entities.length > 0) {
          this.storage.updateEntities(tenantId, userId, memory.layer, memory.id, entities);
          memory.entities = this.storage.findById(tenantId, userId, memory.id)?.entities;
        }
      } catch (error) {
        this.log("warn", "[nemos lifecycle] entity extraction failed", {
          id: memory.id, err: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const memory of memories) this.linkOneByEntities(tenantId, userId, memory);
  }

  private linkOneByEntities(tenantId: string, userId: string, memory: Memory): void {
    if (!memory.entities?.length) return;
    const matches = new Map<string, Memory>();
    for (const entity of memory.entities) {
      const found = this.storage.findByEntity(tenantId, userId, entity, {
        topK: 10,
        excludeId: memory.id,
        scope: this.options.crossScopeLink ? undefined : memory.scope,
      });
      for (const item of found) matches.set(item.id, item);
    }
    const top = [...matches.values()].slice(0, 5);
    if (top.length === 0) return;
    this.storage.updateRelated(tenantId, userId, memory.layer, memory.id,
      [...new Set([...(memory.related ?? []), ...top.map((item) => item.id)])]);
    for (const item of top) {
      this.storage.updateRelated(tenantId, userId, item.layer, item.id,
        [...new Set([...(item.related ?? []), memory.id])]);
    }
  }
}