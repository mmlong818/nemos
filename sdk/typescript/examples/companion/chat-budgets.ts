/**
 * 聊天三档思考强度的运行上限。
 *
 * maxTotalTokens 是整次运行（含每一轮的输入）的上限，不是花费：一次就能答完的请求不会因为上限高而多花钱。
 * 真实运行测得助理页单次输入约 7800 token（系统提示 + 记忆与近期上下文）。原先"快速"档是 2 轮共 8000，
 * 第一轮刚想调一次工具就超限，运行以 token_budget_exhausted 收场，用户什么也拿不到。
 * 所以每档按"每轮约 12000 token"留余量：输入会随记忆和上下文增长，上限要跟得上轮数。
 */
export type ChatReasoning = "fast" | "balanced" | "deep";

export interface ChatRuntimeLimits {
  maxRounds: number;
  maxToolRounds: number;
  maxTotalTokens: number;
  maxOutputChars: number;
}

export const PER_ROUND_TOKEN_ALLOWANCE = 12_000;

export const CHAT_REASONING_LIMITS: Readonly<Record<ChatReasoning, ChatRuntimeLimits>> = {
  fast: { maxRounds: 2, maxToolRounds: 1, maxTotalTokens: 2 * PER_ROUND_TOKEN_ALLOWANCE, maxOutputChars: 4_000 },
  balanced: { maxRounds: 4, maxToolRounds: 2, maxTotalTokens: 4 * PER_ROUND_TOKEN_ALLOWANCE, maxOutputChars: 10_000 },
  deep: { maxRounds: 8, maxToolRounds: 5, maxTotalTokens: 8 * PER_ROUND_TOKEN_ALLOWANCE, maxOutputChars: 20_000 },
};

export function chatRuntimeLimits(reasoning: unknown): ChatRuntimeLimits {
  const key: ChatReasoning = reasoning === "fast" ? "fast" : reasoning === "deep" ? "deep" : "balanced";
  return { ...CHAT_REASONING_LIMITS[key] };
}
