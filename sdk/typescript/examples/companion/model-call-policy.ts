import type { LlmCallPurpose } from "./llm-call-ledger.js";
import { randomUUID } from "node:crypto";
import type { ModelBudgetStore } from "./model-budget-store.js";

/** Versioned output-token reservation rules for the shared text-model gateway. */
export const MODEL_CALL_POLICY = {
  schema: "nemos.model-call-policy",
  version: 1,
  default: { perCallOutputTokens: 4096, perTaskOutputTokens: 16384 },
  purposes: {
    chat: { perCallOutputTokens: 4096, perTaskOutputTokens: 16384 },
    task_turn: { perCallOutputTokens: 4096, perTaskOutputTokens: 46080 },
    team_plan: { perCallOutputTokens: 4096, perTaskOutputTokens: 46080 },
    team_worker: { perCallOutputTokens: 4096, perTaskOutputTokens: 46080 },
    team_review: { perCallOutputTokens: 4096, perTaskOutputTokens: 46080 },
    team_final: { perCallOutputTokens: 4096, perTaskOutputTokens: 46080 },
    feed: { perCallOutputTokens: 2048, perTaskOutputTokens: 8192 },
    watch: { perCallOutputTokens: 2048, perTaskOutputTokens: 8192 },
    ideas: { perCallOutputTokens: 2048, perTaskOutputTokens: 8192 },
    tool_text: { perCallOutputTokens: 2600, perTaskOutputTokens: 5200 },
  } satisfies Partial<Record<LlmCallPurpose, { perCallOutputTokens: number; perTaskOutputTokens: number }>>,
  emptyText: "error",
  maxAutomaticRetries: 1,
  retry: "non-streaming, no-tools, no-visible-output only",
  effort: "validated explicit preference first; otherwise lowest supported effort only when thinking is enabled; unknown models omit effort",
  coverage: { textGateway: true, toolText: true, mediaAndDirectCalls: false },
} as const;

const reservations = new Map<string | symbol, { reserved: number; limit: number }>();
const MAX_TASK_IDENTITIES = 10000;

export function reservePersistentModelOutputTokens(
  store: ModelBudgetStore, scope: string, ownerKey: string, declaredIdentity: string,
  purpose: LlmCallPurpose, requested: number,
) {
  const rule = (MODEL_CALL_POLICY.purposes as Partial<Record<LlmCallPurpose, { perCallOutputTokens: number; perTaskOutputTokens: number }>>)[purpose]
    ?? MODEL_CALL_POLICY.default;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("模型输出 Token 上限无效。");
  const task = store.bindOwner(scope, ownerKey, declaredIdentity, rule.perTaskOutputTokens);
  const attemptId = randomUUID();
  const attempt = store.reserve(task, attemptId, Math.min(requested, rule.perCallOutputTokens), rule.perTaskOutputTokens);
  return {
    tokens: attempt.tokens,
    start: () => { store.start(task, attemptId); },
    releaseIfUnstarted: () => { if (store.getAttempt(task, attemptId)?.state === "reserved") store.refundBeforeStart(task, attemptId); },
    finish: (actual?: number | null) => { store.finish(task, attemptId, actual); },
    markAmbiguous: () => { store.markAmbiguous(task, attemptId); },
  };
}

export function reserveModelOutputTokens(identity: string | symbol, purpose: LlmCallPurpose, requested: number) {
  const rule = (MODEL_CALL_POLICY.purposes as Partial<Record<LlmCallPurpose, { perCallOutputTokens: number; perTaskOutputTokens: number }>>)[purpose]
    ?? MODEL_CALL_POLICY.default;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("模型输出 Token 上限无效。");
  const tokens = Math.min(requested, rule.perCallOutputTokens);
  let state = reservations.get(identity);
  if (!state) {
    if (reservations.size >= MAX_TASK_IDENTITIES) throw new Error("模型任务预算记录已满，暂不能开启新任务。");
    state = { reserved: 0, limit: rule.perTaskOutputTokens };
    reservations.set(identity, state);
  }
  state.limit = Math.min(state.limit, rule.perTaskOutputTokens);
  if (state.reserved + tokens > state.limit) throw new Error("本次任务的模型输出 Token 预留预算已用完。");
  state.reserved += tokens;
  let started = false;
  return {
    tokens,
    start: () => { started = true; },
    releaseIfUnstarted: () => {
      if (started) return;
      state!.reserved -= tokens;
      if (state!.reserved === 0) reservations.delete(identity);
    },
  };
}
