export type AgentRole = "system" | "user" | "assistant" | "tool";

export type AgentToolEffect = "read" | "write";
export type AgentToolRisk = "normal" | "destructive";

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentMessage {
  role: AgentRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effect?: AgentToolEffect;
  /** destructive 工具一旦执行失败，本次运行后续同类操作会立即熔断。 */
  risk?: AgentToolRisk;
  timeoutMs?: number;
}

export interface AgentToolResult {
  content: string;
  isError?: boolean;
  data?: unknown;
}

export interface AgentToolContext {
  /** 本次模型—工具循环的唯一执行标识。 */
  runId: string;
  /** 可跨多次运行复用的长期对话或任务会话标识。 */
  sessionId: string;
  signal: AbortSignal;
}

export interface AgentTool {
  definition: AgentToolDefinition;
  execute: (
    input: Record<string, unknown>,
    context: AgentToolContext,
  ) => Promise<AgentToolResult>;
}

export interface AgentToolAuthorizationResult {
  allowed: boolean;
  approvalId?: string;
  reason?: string;
}

export interface AgentToolAuthorizationInput {
  runId: string;
  sessionId: string;
  call: AgentToolCall;
  tool: AgentToolDefinition;
  metadata?: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface AgentModelRequest {
  messages: readonly AgentMessage[];
  tools: readonly AgentToolDefinition[];
  signal: AbortSignal;
  /** Remaining output budget for this model call when the run has a hard token cap. */
  maxOutputTokens?: number;
  onTextDelta?: (text: string) => void;
}

export interface AgentModelResponse {
  text: string;
  toolCalls?: AgentToolCall[];
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelCalls: number;
}

export interface AgentModel {
  complete: (request: AgentModelRequest) => Promise<AgentModelResponse>;
}

export type AgentRunEvent =
  | { type: "run_start"; runId: string; sessionId: string; metadata?: Readonly<Record<string, string>> }
  | { type: "run_resume"; runId: string; sessionId: string; round: number }
  | { type: "round_start"; round: number }
  | { type: "model_end"; round: number; toolCallCount: number; inputTokens?: number; outputTokens?: number }
  | { type: "token_budget_exhausted"; limit: number; used: number }
  | { type: "tool_start"; call: AgentToolCall }
  | { type: "tool_authorization"; call: AgentToolCall; allowed: boolean; reason?: string }
  | { type: "tool_end"; call: AgentToolCall; result: AgentToolResult }
  | { type: "handoff"; count: number; beforeChars: number; afterChars: number }
  | { type: "run_error"; message: string }
  | { type: "run_end"; reason: AgentStopReason; rounds: number };

export interface AgentRunObserver {
  onStart?: (input: AgentRunInput, messages: readonly AgentMessage[]) => void;
  onResume?: (input: AgentRunInput, checkpoint: AgentRunCheckpoint) => void;
  onEvent?: (runId: string, event: AgentRunEvent) => void;
  onCheckpoint?: (runId: string, checkpoint: AgentRunCheckpoint) => void;
  onComplete?: (runId: string, result: AgentRunResult) => void;
  onError?: (runId: string, error: Error) => void;
}

export type AgentStopReason =
  | "completed"
  | "cancelled"
  | "max_rounds"
  | "token_budget_exhausted"
  | "repeated_tool_call";

export interface AgentHandoffInput {
  systemPrompt: string;
  messages: readonly AgentMessage[];
  originalPrompt: string;
  signal: AbortSignal;
}

export interface AgentRuntimeConfig {
  maxRounds?: number;
  /** Hard per-run token budget. The current provider call is capped by the remaining allowance. */
  maxTotalTokens?: number;
  maxToolRounds?: number;
  maxParallelReadTools?: number;
  maxToolCallsPerRound?: number;
  maxIdenticalToolCalls?: number;
  maxToolResultChars?: number;
  maxHistoryChars?: number;
  handoffThresholdChars?: number;
  maxHandoffs?: number;
  createHandoff?: (input: AgentHandoffInput) => Promise<string>;
  /** 写工具默认拒绝；只有该回调明确允许后才会执行。 */
  authorizeTool?: (input: AgentToolAuthorizationInput) => Promise<AgentToolAuthorizationResult>;
}

export interface AgentRunInput {
  /** 唯一运行标识；旧调用未提供时暂时回退为 sessionId。 */
  runId?: string;
  /** 长期会话标识，可关联同一对话中的多次运行。 */
  sessionId: string;
  systemPrompt: string;
  prompt: string;
  history?: readonly AgentMessage[];
  /** 进入事件与授权回调的非敏感审计字段，例如 userId、personaId 和 scope。 */
  metadata?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  onEvent?: (event: AgentRunEvent) => void;
  onTextDelta?: (text: string) => void;
  /** 持久化或遥测观察器；观察器失败不会中断 Agent 主循环。 */
  observer?: AgentRunObserver;
  /** 从持久化检查点继续；不会再次追加原始用户消息。 */
  resume?: AgentRunCheckpoint;
}

export type AgentCheckpointPhase = "after_model" | "after_tools";

export interface AgentRunCheckpoint {
  phase: AgentCheckpointPhase;
  round: number;
  nextRound: number;
  messages: AgentMessage[];
  handoffs: number;
  previousToolCallSignature: string;
  repeatedToolCallCount: number;
  pendingToolCalls?: AgentToolCall[];
  /** 累计到此检查点的模型调用与 Token；旧检查点缺失时按 0 继续。 */
  usage?: AgentTokenUsage;
  /** 高风险操作失败后保持到恢复运行，避免进程重启绕过熔断。 */
  destructiveFailureStopped?: boolean;
}

export interface AgentRunResult {
  runId: string;
  sessionId: string;
  output: string;
  reason: AgentStopReason;
  rounds: number;
  handoffs: number;
  messages: AgentMessage[];
  usage: AgentTokenUsage;
}
