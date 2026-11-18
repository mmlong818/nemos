import { determinePromotion, type Memory, type Nemos } from "../../src/index.js";
import { COMPANION_MEMORY_SCOPE } from "./memory-config.js";
import { isCurrentUserMemory } from "./memory-evidence.js";
import type { LearningProposal } from "./personal-work.js";

const layers = ["personal_semantic", "semantic", "episodic", "procedural", "archival"] as const;

export function memoryDisplayContent(content: string): string {
  return content
    .replace(/^用户:self\s*/i, "")
    .replace(/^用户(?:偏好|喜欢)\s*/i, "偏好")
    .replace(/^用户(?:想要|想|希望)\s*/i, "希望")
    .trim();
}

interface RecordView {
  memory: Nemos;
  owner: string;
  speaker: string;
  personaId?: string;
  learnings: LearningProposal[];
}

function mayViewRecord(record: Memory, { owner, personaId }: RecordView): boolean {
  if (!record.visibility) return true; // Namespace already enforced by the SDK lookup.
  return [record.visibility.owner, ...(record.visibility.sharedWith ?? [])].some((scope) =>
    scope.kind === "global"
    || (scope.kind === "user" && scope.id === owner)
    || (scope.kind === "agent" && !!personaId && scope.id === personaId));
}

function recordState(record: Memory | null, view: RecordView): "active" | "inactive" | "unavailable" {
  if (!record || !layers.some((layer) => layer === record.layer)
    || record.belief_state === "hidden" || !mayViewRecord(record, view)) return "unavailable";
  if (record.layer === "archival") {
    return (!record.belief_state || record.belief_state === "active") && !record.invalid_at && !record.expired_at
      ? "active" : "inactive";
  }
  if (view.personaId && !["persona-bio", "persona-self"].includes(record.source.origin)) return "unavailable";
  if ((record.promotion_state ?? determinePromotion(record).state) !== "promoted") return "unavailable";
  return isCurrentUserMemory(record) ? "active" : "inactive";
}

function memoryRecordView(view: RecordView, archivalWindow?: Memory[]) {
  const storage = view.memory.raw().storage;
  const read = (id: string) => storage.findById(COMPANION_MEMORY_SCOPE.tenantId, view.owner, id);
  const learningByMemory = new Map(view.learnings
    .filter((proposal) => proposal.memoryId && proposal.state === "confirmed")
    .map((proposal) => [proposal.memoryId, proposal]));
  const archives = new Map<string, Memory | null>((archivalWindow ?? [])
    .filter((record) => recordState(record, view) === "active").map((record) => [record.id, record]));
  function fact(record: Memory) {
    if (!archivalWindow && record.archival_ref && !archives.has(record.archival_ref)) {
      const source = read(record.archival_ref);
      archives.set(record.archival_ref, source?.layer === "archival" && recordState(source, view) === "active" ? source : null);
    }
    const archival = record.layer === "archival" ? record : record.archival_ref ? archives.get(record.archival_ref) : undefined;
    const learning = learningByMemory.get(record.id);
    return {
      id: record.id,
      layer: record.layer,
      who: view.speaker,
      content: memoryDisplayContent(record.content),
      created: record.created_at,
      correctable: record.layer !== "archival" && !!record.claim_key && !!record.predicate && !!record.subject_id,
      source: {
        origin: record.source.origin,
        sourceMessageId: learning ? undefined : archival?.source.source_message_id || record.source.source_message_id,
        speakerId: archival?.source.speaker_id || record.source.speaker_id,
        subjectId: archival?.source.subject_id || record.source.subject_id,
        conversationId: archival?.source.conversation_id || record.source.conversation_id,
        archivalId: archival?.id,
        excerpt: learning ? (learning.source.excerpt || learning.content).slice(0, 1500) : archival?.content.slice(0, 500),
        ...(learning ? { kind: "confirmed-learning" as const, proposalId: learning.id } : {}),
      },
    };
  }
  return { read, fact };
}

export function readMemoryRecord(view: RecordView, id: string) {
  const { read, fact } = memoryRecordView(view);
  const record = id && id.length <= 256 ? read(id) : null;
  const status = recordState(record, view);
  if (status !== "active" || !record) return { status: status === "inactive" ? "inactive" : "unavailable" } as const;
  return { status: "active", fact: fact(record) } as const;
}

export async function listMemoryRecords(view: RecordView) {
  const store = view.memory.forUser(view.owner);
  const records = await Promise.all(layers.map((layer) => store.listByLayer(layer, { limit: 500 })));
  const { fact } = memoryRecordView(view, records[layers.indexOf("archival")]);
  return records.flat().filter((record) => recordState(record, view) === "active")
    .map(fact).sort((a, b) => b.created.localeCompare(a.created));
}
