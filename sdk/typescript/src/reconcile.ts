import { createHash } from "node:crypto";
import { getPredicate, normalizeAssertion } from "./claims.js";
import type { Storage } from "./storage.js";
import type {
  BeliefState,
  ClaimIndexEntry,
  EventMetadata,
  Memory,
  MemoryOperation,
  MemoryOperationKind,
  ProvenanceEdge,
} from "./types.js";
import { nowIso } from "./utils/id.js";

export interface ReconcileOptions {
  correctionOf?: string;
}

export interface ReconcileResult {
  memory: Memory;
  inserted: boolean;
  operation: MemoryOperation;
  hasConflict: boolean;
}

export function reconcileAndCommit(
  storage: Storage,
  tenantId: string,
  userId: string,
  event: EventMetadata,
  memory: Memory,
  insert: () => void,
  options: ReconcileOptions = {},
): ReconcileResult {
  return storage.transaction(() => {
    const sourceEventId = event.event_id;
    const alreadyInserted = storage.findById(tenantId, userId, memory.id);
    if (alreadyInserted) {
      const prior = storage.listMemoryOperations(tenantId, userId, memory.claim_key)
        .find((item) => item.source_event_id === sourceEventId && item.subject_memory_ids.includes(memory.id));
      if (prior) {
        return { memory: alreadyInserted, inserted: false, operation: prior, hasConflict: prior.kind === "DISPUTE" };
      }
    }
    if (!memory.claim_key || !memory.canonical_object_hash || !memory.predicate) {
      insert();
      addProvenance(storage, tenantId, userId, memory, sourceEventId);
      const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, "ADD", [memory.id], "unstructured assertion retained");
      return { memory, inserted: true, operation, hasConflict: false };
    }

    // When an event time exists, use it as the implicit validity start before
    // storage can backfill valid_at with ingestion time. Without event time we
    // deliberately keep valid_at empty so event_seq remains the ordering source.
    if (memory.valid_at === undefined && memory.event_at !== undefined) {
      memory.valid_at = memory.event_at;
    }

    const predicate = getPredicate(memory.predicate);
    const entries = storage.listClaimEntries(tenantId, userId, memory.scope, memory.claim_key);
    const equivalent = entries.find((entry) => entry.canonical_object_hash === memory.canonical_object_hash);
    const disputed = entries.filter((entry) => entry.status === "disputed");
    const active = entries.filter((entry) => entry.status === "active" || entry.status === "disputed");
    const candidateTime = memory.valid_at ?? memory.event_at ?? memory.created_at;
    const isFutureFact = candidateTime > memory.created_at;
    const effectiveActive = isFutureFact
      ? active.filter((entry) => entry.valid_from === candidateTime)
      : active.filter((entry) => !entry.valid_from || entry.valid_from <= memory.created_at);

    if (equivalent) {
      const existing = storage.findById(tenantId, userId, equivalent.memory_id);
      if (existing) {
        storage.addMemorySourceEvent(tenantId, userId, existing.layer, existing.id, sourceEventId);
        storage.insertProvenanceEdge(edge(tenantId, userId, sourceEventId, existing.id, "extracted_from"));
        if (disputed.length > 0 && winsDispute(memory, equivalent, disputed, options)) {
          for (const candidate of disputed) {
            const next: BeliefState = candidate.memory_id === existing.id ? "active" : "superseded";
            storage.updateMemoryBeliefState(tenantId, userId, candidate.layer, candidate.memory_id, next, {
              expiredAt: next === "superseded" ? memory.created_at : undefined,
              correctedBy: next === "superseded" ? existing.id : undefined,
            });
          }
          const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, "RESOLVE_DISPUTE", disputed.map((item) => item.memory_id), "new evidence resolved disputed claim");
          return { memory: existing, inserted: false, operation, hasConflict: false };
        }
        const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, "CONFIRM", [existing.id], "canonical object already exists");
        return { memory: existing, inserted: false, operation, hasConflict: disputed.length > 0 };
      }
    }

    const legacy = findLegacyCandidates(storage, tenantId, userId, memory);
    if (active.length === 0 && legacy.length > 0) {
      insert();
      addClaimEntry(storage, tenantId, userId, event, memory, "active");
      addProvenance(storage, tenantId, userId, memory, sourceEventId);
      const equivalentLegacy = legacy.every((item) => item.canonicalHash === memory.canonical_object_hash);
      for (const item of legacy) {
        storage.updateMemoryBeliefState(tenantId, userId, item.memory.layer, item.memory.id, "superseded", {
          invalidAt: memory.valid_at ?? memory.event_at ?? memory.created_at,
          expiredAt: memory.created_at,
          correctedBy: memory.id,
        });
      }
      const operation = recordOperation(
        storage, tenantId, userId, memory, sourceEventId,
        equivalentLegacy ? "MERGE" : "SUPERSEDE",
        [memory.id, ...legacy.map((item) => item.memory.id)],
        equivalentLegacy ? "structured assertion retired equivalent legacy text" : "structured assertion retired deterministic legacy conflict",
      );
      return { memory, inserted: true, operation, hasConflict: false };
    }
    if (!predicate?.single_valued || effectiveActive.length === 0) {
      insert();
      addClaimEntry(storage, tenantId, userId, event, memory, "active");
      addProvenance(storage, tenantId, userId, memory, sourceEventId);
      const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, "ADD", [memory.id], predicate?.single_valued === false ? "multi-valued predicate member" : "new claim slot");
      return { memory, inserted: true, operation, hasConflict: false };
    }

    const current = chooseCurrent(effectiveActive);
    const temporal = compareTemporal(memory, event.event_seq, current);
    const candidateTrust = memory.trust_tier ?? 6;
    const forced = options.correctionOf !== undefined;

    if (temporal < 0 && !forced) {
      memory.belief_state = "superseded";
      memory.expired_at = current.updated_at;
      insert();
      addClaimEntry(storage, tenantId, userId, event, memory, "superseded");
      addProvenance(storage, tenantId, userId, memory, sourceEventId);
      const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, "ADD", [memory.id, current.memory_id], "late extraction retained as historical fact");
      return { memory, inserted: true, operation, hasConflict: false };
    }

    if (forced || (temporal > 0 && candidateTrust <= current.trust_tier) || (temporal === 0 && candidateTrust < current.trust_tier)) {
      insert();
      for (const old of effectiveActive) {
        storage.updateMemoryBeliefState(tenantId, userId, old.layer, old.memory_id, "superseded", {
          invalidAt: memory.valid_at ?? memory.event_at ?? memory.created_at,
          expiredAt: memory.created_at,
          correctedBy: memory.id,
        });
      }
      addClaimEntry(storage, tenantId, userId, event, memory, "active");
      addProvenance(storage, tenantId, userId, memory, sourceEventId);
      if (options.correctionOf) {
        storage.insertProvenanceEdge(edge(tenantId, userId, options.correctionOf, memory.id, "corrected_from"));
      }
      const kind: MemoryOperationKind = disputed.length > 0 ? "RESOLVE_DISPUTE" : "SUPERSEDE";
      const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, kind, [memory.id, ...effectiveActive.map((item) => item.memory_id)], forced ? "explicit user correction" : "newer or higher-trust fact");
      return { memory, inserted: true, operation, hasConflict: false };
    }

    if (candidateTrust > current.trust_tier && temporal >= 0) {
      memory.belief_state = "invalidated";
      insert();
      addClaimEntry(storage, tenantId, userId, event, memory, "invalidated");
      addProvenance(storage, tenantId, userId, memory, sourceEventId);
      const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, "IGNORE", [memory.id, current.memory_id], "lower-trust conflict cannot replace current fact");
      return { memory, inserted: true, operation, hasConflict: false };
    }

    memory.belief_state = "disputed";
    insert();
    addClaimEntry(storage, tenantId, userId, event, memory, "disputed");
    for (const old of effectiveActive) {
      storage.updateMemoryBeliefState(tenantId, userId, old.layer, old.memory_id, "disputed");
    }
    addProvenance(storage, tenantId, userId, memory, sourceEventId);
    const operation = recordOperation(storage, tenantId, userId, memory, sourceEventId, "DISPUTE", [memory.id, ...effectiveActive.map((item) => item.memory_id)], "same-time same-trust values conflict");
    return { memory, inserted: true, operation, hasConflict: true };
  });
}

export function propagateCorrection(
  storage: Storage,
  tenantId: string,
  userId: string,
  correctedMemoryId: string,
  correctionMemoryId: string,
  at: string,
): string[] {
  const stale: string[] = [];
  const queue = [correctedMemoryId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const sourceId = queue.shift()!;
    if (visited.has(sourceId)) continue;
    visited.add(sourceId);
    for (const edgeItem of storage.listProvenanceFrom(tenantId, userId, sourceId)) {
      if (edgeItem.derived_id === correctionMemoryId) continue;
      const dependent = storage.findById(tenantId, userId, edgeItem.derived_id);
      if (!dependent || dependent.layer === "archival") continue;
      const hasIndependentSource = storage.listProvenanceTo(tenantId, userId, dependent.id).some((incoming) => {
        if (incoming.source_id === sourceId || visited.has(incoming.source_id)) return false;
        const source = storage.findById(tenantId, userId, incoming.source_id);
        return source !== null && (!source.belief_state || source.belief_state === "active");
      });
      if (hasIndependentSource) continue;
      storage.updateMemoryBeliefState(tenantId, userId, dependent.layer, dependent.id, "stale", {
        invalidAt: at,
        expiredAt: at,
        correctedBy: correctionMemoryId,
      });
      stale.push(dependent.id);
      queue.push(dependent.id);
    }
  }
  return [...new Set(stale)];
}

function findLegacyCandidates(
  storage: Storage,
  tenantId: string,
  userId: string,
  incoming: Memory,
): Array<{ memory: Memory; canonicalHash: string | null }> {
  if (!incoming.predicate || !incoming.subject_id) return [];
  const out: Array<{ memory: Memory; canonicalHash: string | null }> = [];
  for (const memory of storage.listPersonalSemantic(tenantId, userId)) {
    if (memory.id === incoming.id || memory.claim_key || (memory.belief_state && memory.belief_state !== "active")) continue;
    const normalized = normalizeAssertion(memory, userId);
    if (!normalized?.predicate || normalized.subject_id !== incoming.subject_id) continue;
    if (normalized.predicate.id !== incoming.predicate || !normalized.claim_key) continue;
    out.push({ memory, canonicalHash: normalized.canonical_object_hash });
  }
  return out;
}
function addClaimEntry(
  storage: Storage,
  tenantId: string,
  userId: string,
  event: EventMetadata,
  memory: Memory,
  status: BeliefState,
): void {
  storage.upsertClaimEntry({
    tenant_id: tenantId,
    user_id: userId,
    space_id: memory.scope,
    claim_key: memory.claim_key!,
    memory_id: memory.id,
    layer: memory.layer,
    canonical_object_hash: memory.canonical_object_hash!,
    event_seq: event.event_seq,
    valid_from: memory.valid_at ?? memory.event_at ?? null,
    trust_tier: memory.trust_tier ?? 6,
    status,
    updated_at: memory.created_at,
  });
}

function addProvenance(
  storage: Storage,
  tenantId: string,
  userId: string,
  memory: Memory,
  sourceEventId: string,
  relation: ProvenanceEdge["relation"] = "extracted_from",
): void {
  if (sourceEventId !== memory.id) {
    storage.insertProvenanceEdge(edge(tenantId, userId, sourceEventId, memory.id, relation));
  }
  for (const sourceId of memory.consolidated_from ?? []) {
    storage.insertProvenanceEdge(edge(tenantId, userId, sourceId, memory.id, "consolidated_from"));
  }
}

function edge(
  tenantId: string,
  userId: string,
  sourceId: string,
  derivedId: string,
  relation: ProvenanceEdge["relation"],
): ProvenanceEdge {
  return { tenant_id: tenantId, user_id: userId, source_id: sourceId, derived_id: derivedId, relation, created_at: nowIso() };
}

function recordOperation(
  storage: Storage,
  tenantId: string,
  userId: string,
  memory: Memory,
  sourceEventId: string,
  kind: MemoryOperationKind,
  ids: string[],
  reason: string,
): MemoryOperation {
  const subjectIds = [...new Set(ids)].sort();
  const operation: MemoryOperation = {
    id: `op:${createHash("sha256").update(`${sourceEventId}|${kind}|${subjectIds.join(",")}`).digest("hex")}`,
    tenant_id: tenantId,
    user_id: userId,
    space_id: memory.scope,
    claim_key: memory.claim_key ?? null,
    kind,
    subject_memory_ids: subjectIds,
    source_event_id: sourceEventId,
    reason,
    created_at: nowIso(),
  };
  storage.insertMemoryOperation(operation);
  return operation;
}

function chooseCurrent(entries: ClaimIndexEntry[]): ClaimIndexEntry {
  return [...entries].sort((a, b) => {
    const time = compareIso(a.valid_from, b.valid_from);
    if (time !== 0) return -time;
    if (a.event_seq !== b.event_seq) return b.event_seq - a.event_seq;
    if (a.trust_tier !== b.trust_tier) return a.trust_tier - b.trust_tier;
    return a.memory_id.localeCompare(b.memory_id);
  })[0]!;
}

function compareTemporal(memory: Memory, eventSeq: number, current: ClaimIndexEntry): number {
  const candidateTime = memory.valid_at ?? memory.event_at ?? null;
  if (candidateTime && current.valid_from) {
    return candidateTime === current.valid_from ? 0 : candidateTime.localeCompare(current.valid_from);
  }
  return Math.sign(eventSeq - current.event_seq);
}

function compareIso(left: string | null, right: string | null): number {
  if (left && right && left !== right) return left.localeCompare(right);
  return 0;
}

function winsDispute(
  memory: Memory,
  matching: ClaimIndexEntry,
  disputed: ClaimIndexEntry[],
  options: ReconcileOptions,
): boolean {
  if (options.correctionOf) return true;
  const otherTrust = disputed.filter((item) => item.memory_id !== matching.memory_id).map((item) => item.trust_tier);
  return otherTrust.length > 0 && (memory.trust_tier ?? 6) < Math.min(...otherTrust);
}