export const DEVELOPMENT_ENGINES = ["pi", "dsh", "kilo", "opencode", "codex"] as const;

export type DevelopmentEngine = typeof DEVELOPMENT_ENGINES[number];

export function normalizeDevelopmentEngine(value: unknown): DevelopmentEngine {
  return DEVELOPMENT_ENGINES.includes(value as DevelopmentEngine) ? value as DevelopmentEngine : "pi";
}
