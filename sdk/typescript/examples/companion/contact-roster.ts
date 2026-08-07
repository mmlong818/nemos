export const DEFAULT_CONTACT_IDS = [
  "clownfish",
  "feifei",
  "teacher_lin",
] as const;

export const CONTACTABLE_PERSONA_IDS = [
  ...DEFAULT_CONTACT_IDS,
  "azhe",
  "lingling",
] as const;

export function normalizeAddedContactIds(allPersonaIds: string[], candidateIds: unknown): string[] {
  if (!Array.isArray(candidateIds)) return [];
  const validIds = new Set(allPersonaIds);
  const contactableIds = new Set<string>(CONTACTABLE_PERSONA_IDS);
  const defaultIds = new Set<string>(DEFAULT_CONTACT_IDS);
  const normalized = candidateIds
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => validIds.has(id) && contactableIds.has(id) && !defaultIds.has(id));
  return Array.from(new Set(normalized));
}

export function visibleContactIds(allPersonaIds: string[], addedContactIds: unknown): string[] {
  const validIds = new Set(allPersonaIds);
  const defaults = DEFAULT_CONTACT_IDS.filter((id) => validIds.has(id));
  const added = new Set(normalizeAddedContactIds(allPersonaIds, addedContactIds));
  return [...defaults, ...allPersonaIds.filter((id) => added.has(id))];
}
