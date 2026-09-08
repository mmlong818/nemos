/**
 * 运行预算的单一来源。
 *
 * 这些边界此前在 llm.ts 里存在两份：agentLimits() 给新发起的对话算一套，
 * makeConnectionAgentResume() 给续跑的任务再写一套字面量。两份已经开始漂移——
 * 续跑路径把 maxOutputChars 写死成 4800，只是恰好等于它自己的 maxTokens 默认值
 * 乘四；一旦对话侧改了默认 token 数，续跑就会沿用旧上限而没人发现。
 *
 * 因此：新发起与续跑必须读同一处。改数字只改这里。
 */

/** Agent 循环的预算边界。上限是安全阀，默认值是产品选择，两者都不该散落在调用点。 */
export const AGENT_BUDGET = {
  /** 单轮回复 token。上限对齐模型侧可接受的最大输出。 */
  maxTokens: { fallback: 1_200, minimum: 1, maximum: 200_000 },
  /** 模型轮次。4 轮足够「答复 + 工具 + 复核 + 收尾」，20 是防跑飞的硬顶。 */
  maxRounds: { fallback: 4, minimum: 1, maximum: 20 },
  /** 允许携带工具的轮次；其余轮次只能纯文本收尾，避免无限工具循环。 */
  maxToolRounds: { fallback: 2, minimum: 0 },
  /** 累计 token 预算。默认按「单轮 token × 轮次 × 2」推算，覆盖输入侧的重复上下文。 */
  maxTotalTokens: { multiplier: 2, minimum: 100, maximum: 2_000_000 },
  /** 输出字符上限。默认按单轮 token 的四倍估算中文字符数。 */
  maxOutputChars: { tokenMultiplier: 4, minimum: 100, maximum: 200_000 },
} as const;

export interface AgentBudgetRequest {
  maxTokens?: number;
  maxRounds?: number;
  maxToolRounds?: number;
  maxTotalTokens?: number;
  maxOutputChars?: number;
}

export interface AgentBudget {
  maxTokens: number;
  maxRounds: number;
  maxToolRounds: number;
  maxTotalTokens: number;
  maxOutputChars: number;
}

/**
 * 把一次请求（或一次续跑的元数据）折算成实际预算。
 *
 * requestedMaxTokens 是调用点自己的回复长度选择（人格、工作模式各不相同），
 * 作为 maxTokens 的默认值传入；request 里的值是显式覆盖，仍受上下限约束。
 */
export function resolveAgentBudget(
  request: AgentBudgetRequest | undefined,
  requestedMaxTokens: number = AGENT_BUDGET.maxTokens.fallback,
): AgentBudget {
  const tokenFallback = bounded(
    requestedMaxTokens,
    AGENT_BUDGET.maxTokens.fallback,
    AGENT_BUDGET.maxTokens.minimum,
    AGENT_BUDGET.maxTokens.maximum,
  );
  const maxRounds = bounded(
    request?.maxRounds,
    AGENT_BUDGET.maxRounds.fallback,
    AGENT_BUDGET.maxRounds.minimum,
    AGENT_BUDGET.maxRounds.maximum,
  );
  const maxToolRounds = bounded(
    request?.maxToolRounds,
    AGENT_BUDGET.maxToolRounds.fallback,
    AGENT_BUDGET.maxToolRounds.minimum,
    maxRounds,
  );
  const maxOutputChars = bounded(
    request?.maxOutputChars,
    tokenFallback * AGENT_BUDGET.maxOutputChars.tokenMultiplier,
    AGENT_BUDGET.maxOutputChars.minimum,
    AGENT_BUDGET.maxOutputChars.maximum,
  );
  // 回复 token 不能超过字符上限换算出的空间，否则模型写满了也会被截断。
  const maxTokens = Math.max(1, Math.min(bounded(
    request?.maxTokens,
    tokenFallback,
    AGENT_BUDGET.maxTokens.minimum,
    AGENT_BUDGET.maxTokens.maximum,
  ), maxOutputChars));
  const maxTotalTokens = bounded(
    request?.maxTotalTokens,
    maxTokens * maxRounds * AGENT_BUDGET.maxTotalTokens.multiplier,
    AGENT_BUDGET.maxTotalTokens.minimum,
    AGENT_BUDGET.maxTotalTokens.maximum,
  );
  return { maxTokens, maxRounds, maxToolRounds, maxTotalTokens, maxOutputChars };
}

/**
 * 计划任务的运营边界。
 *
 * unreadRunsBeforePause：连续多少次产出结果无人查看就自动暂停。计划任务在无人
 * 读取结果时继续跑，只是在稳定地花模型额度换没人看的产物；暂停由用户显式恢复，
 * 定时器不会自行恢复，否则「自动暂停」等于没暂停。
 */
export const ROUTINE_LIMITS = {
  unreadRunsBeforePause: 3,
  /** 后台调度轮询间隔，与 BackgroundScheduler 的默认值保持一致。 */
  tickIntervalMs: 15_000,
} as const;

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.isFinite(value) ? Math.floor(value!) : fallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}
