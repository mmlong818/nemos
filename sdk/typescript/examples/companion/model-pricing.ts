import type { AgentCostEstimate, AgentTokenUsage } from "../../src/index.js";

interface ModelPrice {
  matches: (model: string) => boolean;
  currency: "CNY" | "USD";
  inputPerMillion: number;
  outputPerMillion: number;
}

export const COMPANION_PRICING_DATE = "2026-08-02";

// Nemos Companion currently executes Agent runs through BigModel China.
// Tiered models use the highest published text-token tier to avoid understating cost.
const MODEL_PRICES: readonly ModelPrice[] = [
  price(/^glm-5\.2(?:\[1m\])?$/i, "CNY", 8, 28),
  price(/^glm-5\.1$/i, "CNY", 8, 28),
  price(/^glm-5-turbo$/i, "CNY", 7, 26),
  price(/^glm-5$/i, "CNY", 6, 22),
  price(/^glm-4\.7-flashx$/i, "CNY", 0.5, 3),
  price(/^glm-4\.7-flash$/i, "CNY", 0, 0),
  price(/^glm-4\.7$/i, "CNY", 4, 16),
];

export function estimateCompanionModelCost(
  model: string | undefined,
  usage: AgentTokenUsage,
): AgentCostEstimate | null {
  const normalizedModel = model?.trim();
  if (!normalizedModel) return null;
  const selected = MODEL_PRICES.find((item) => item.matches(normalizedModel));
  if (!selected) return null;
  const inputAmount = usage.inputTokens / 1_000_000 * selected.inputPerMillion;
  const outputAmount = usage.outputTokens / 1_000_000 * selected.outputPerMillion;
  return {
    breakdowns: [{
      currency: selected.currency,
      inputAmount: roundCost(inputAmount),
      outputAmount: roundCost(outputAmount),
      totalAmount: roundCost(inputAmount + outputAmount),
    }],
    pricedRuns: 1,
    unpricedRuns: 0,
    estimated: true,
    pricingDate: COMPANION_PRICING_DATE,
  };
}

export function aggregateCompanionCosts(
  estimates: readonly AgentCostEstimate[],
  unpricedRuns = 0,
): AgentCostEstimate {
  const totals = new Map<string, { inputAmount: number; outputAmount: number; totalAmount: number }>();
  for (const estimate of estimates) {
    for (const item of estimate.breakdowns) {
      const current = totals.get(item.currency) ?? { inputAmount: 0, outputAmount: 0, totalAmount: 0 };
      current.inputAmount += item.inputAmount;
      current.outputAmount += item.outputAmount;
      current.totalAmount += item.totalAmount;
      totals.set(item.currency, current);
    }
  }
  return {
    breakdowns: [...totals.entries()].map(([currency, total]) => ({
      currency,
      inputAmount: roundCost(total.inputAmount),
      outputAmount: roundCost(total.outputAmount),
      totalAmount: roundCost(total.totalAmount),
    })),
    pricedRuns: estimates.reduce((sum, item) => sum + item.pricedRuns, 0),
    unpricedRuns: unpricedRuns + estimates.reduce((sum, item) => sum + item.unpricedRuns, 0),
    estimated: true,
    pricingDate: estimates.map((item) => item.pricingDate).sort().at(-1) ?? COMPANION_PRICING_DATE,
  };
}

function price(
  pattern: RegExp,
  currency: ModelPrice["currency"],
  inputPerMillion: number,
  outputPerMillion: number,
): ModelPrice {
  return {
    matches: (model) => pattern.test(model),
    currency,
    inputPerMillion,
    outputPerMillion,
  };
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}