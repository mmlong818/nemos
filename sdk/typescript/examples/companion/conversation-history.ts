import type { Memory, Nemos } from "../../src/index.js";

/** Archive scope controls visibility; conversation identity controls transcript continuity. */
export async function conversationArchives(
  memory: Nemos,
  namespace: string,
  scope: string,
  sessionId: string | undefined,
  limit: number,
): Promise<Memory[]> {
  const store = memory.forUser(namespace);
  const selected: Memory[] = [];
  const pageSize = Math.max(100, limit);
  // Do not only filter the latest N messages across all conversations: an older
  // session must remain restorable after other sessions have become active.
  for (let offset = 0; ; offset += pageSize) {
    const page = await store.listByLayer("archival", { scope, limit: pageSize, offset });
    selected.push(...page.filter((item) => sessionId
      ? item.source.conversation_id === sessionId
      : !item.source.conversation_id || item.source.conversation_id === scope));
    if (page.length < pageSize || selected.length >= limit) break;
  }
  return selected
    .sort((a, b) => b.created_at.localeCompare(a.created_at)
      || eventSequence(memory, b) - eventSequence(memory, a))
    .slice(0, limit);
}

export function eventSequence(memory: Nemos, entry: Memory): number {
  return memory.raw().storage.getEventMetadata(entry.id)?.event_seq ?? 0;
}
