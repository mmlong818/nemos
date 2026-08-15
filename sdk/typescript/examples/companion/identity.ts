export const APP_PERSONA_ID = "clownfish";

const LEGACY_PERSONA_CODEPOINTS: ReadonlyArray<readonly [readonly number[], string]> = [
  [[122, 104, 105, 119, 101, 105], APP_PERSONA_ID],
  [[109, 117, 115, 107], "first_principles"],
  [[106, 111, 98, 115], "product_lead"],
  [[109, 117, 110, 103, 101, 114], "decision_analysis"],
  [[115, 111, 99, 114, 97, 116, 101, 115], "critical_thinking"],
  [[98, 101, 122, 111, 115], "long_term_strategy"],
  [[118, 111, 103, 101, 108, 115], "system_architecture"],
  [[110, 111, 114, 109, 97, 110], "user_experience"],
  [[100, 117, 97, 114, 116, 101], "interface_design"],
  [[99, 111, 111, 112, 101, 114], "interaction_design"],
  [[100, 104, 104], "lean_engineering"],
  [[98, 97, 99, 104], "quality_testing"],
  [[104, 105, 103, 104, 116, 111, 119, 101, 114], "release_operations"],
  [[116, 104, 111, 109, 112, 115, 111, 110], "industry_analysis"],
  [[99, 97, 109, 112, 98, 101, 108, 108], "pricing_finance"],
  [[103, 111, 100, 105, 110], "brand_strategy"],
  [[114, 111, 115, 115], "sales_growth"],
  [[103, 114, 97, 104, 97, 109], "startup_validation"],
];

const legacyToCurrent = new Map(
  LEGACY_PERSONA_CODEPOINTS.map(([codes, current]) => [String.fromCharCode(...codes), current]),
);
const currentToLegacy = new Map(
  [...legacyToCurrent].map(([legacy, current]) => [current, legacy]),
);
const STORAGE_KEYS_THAT_COLLIDE_WITH_LEGACY_PERSONAS = new Set(["jobs"]);

export function normalizePersonaId(value: string): string {
  return legacyToCurrent.get(value) ?? value;
}

export function personaIdentityAliases(value: string): string[] {
  const current = normalizePersonaId(value);
  const legacy = currentToLegacy.get(current);
  return legacy ? [current, legacy] : [current];
}

export function normalizePersonaReference(value: string): string {
  const direct = normalizePersonaId(value);
  if (direct !== value) return direct;
  const separator = value.lastIndexOf(":");
  if (separator < 0) return value;
  const suffix = value.slice(separator + 1);
  const normalized = normalizePersonaId(suffix);
  return normalized === suffix ? value : value.slice(0, separator + 1) + normalized;
}

export function migratePersonaIdentityValue<T>(input: T): { value: T; changed: boolean } {
  let changed = false;

  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      const normalized = normalizePersonaReference(value);
      if (normalized !== value) changed = true;
      return normalized;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = STORAGE_KEYS_THAT_COLLIDE_WITH_LEGACY_PERSONAS.has(key)
        ? key
        : normalizePersonaReference(key);
      if (normalizedKey !== key) changed = true;
      next[normalizedKey] = visit(item);
    }
    return next;
  };

  return { value: visit(input) as T, changed };
}
