import { randomUUID } from "node:crypto";

import { AgentRuntime } from "./runtime.js";
import type {
  AgentModel,
  AgentRunObserver,
  AgentTool,
  AgentToolResult,
} from "./types.js";

export interface AgentUserActionInput<T> {
  name: string;
  description: string;
  arguments?: Record<string, unknown>;
  metadata?: Readonly<Record<string, string>>;
  runId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  execute: (signal: AbortSignal) => Promise<T> | T;
  summarizeResult?: (value: T) => unknown;
}

export interface AgentUserActionResult<T> {
  runId: string;
  sessionId: string;
  value: T;
}

/**
 * Runs an explicit client command through the same validation, authorization,
 * timeout, event, and audit path used by model-selected write tools.
 */
export class AgentUserActionGateway {
  constructor(private readonly observer?: AgentRunObserver) {}

  async execute<T>(input: AgentUserActionInput<T>): Promise<AgentUserActionResult<T>> {
    const runId = input.runId ?? `user-action-${randomUUID()}`;
    const sessionId = input.sessionId ?? "companion:management";
    const call = {
      id: `call-${randomUUID()}`,
      name: input.name,
      arguments: structuredClone(input.arguments ?? {}),
    };
    let executed = false;
    let executionError: Error | null = null;
    let value: T | undefined;

    const tool: AgentTool = {
      definition: {
        name: input.name,
        description: input.description,
        inputSchema: { type: "object", additionalProperties: true },
        effect: "write",
        timeoutMs: 90_000,
      },
      execute: async (_arguments, context): Promise<AgentToolResult> => {
        try {
          value = await input.execute(context.signal);
          executed = true;
          const summary = input.summarizeResult
            ? input.summarizeResult(value)
            : { ok: true };
          return { content: JSON.stringify(summary ?? { ok: true }) };
        } catch (error) {
          executionError = normalizeError(error);
          throw executionError;
        }
      },
    };

    const model: AgentModel = {
      complete: async (request) => {
        const toolMessage = [...request.messages].reverse()
          .find((message) => message.role === "tool" && message.toolCallId === call.id);
        if (!toolMessage) return { text: "", toolCalls: [call] };
        if (executionError) throw executionError;
        if (!executed) throw new Error(toolMessage.content || `${input.name} did not execute`);
        return { text: toolMessage.content };
      },
    };

    const runtime = new AgentRuntime(model, [tool], {
      maxRounds: 2,
      maxToolRounds: 1,
      authorizeTool: async () => ({
        allowed: true,
        reason: "explicit user action from the local client",
      }),
    });
    const result = await runtime.run({
      runId,
      sessionId,
      systemPrompt: "Execute one explicit local user action through the audited tool gateway.",
      prompt: input.description,
      metadata: {
        actor: "user",
        origin: "local-client",
        action: input.name,
        ...input.metadata,
      },
      signal: input.signal,
      observer: this.observer,
    });

    if (!executed) {
      throw new Error(result.reason === "cancelled" ? "user action cancelled" : `${input.name} did not produce a result`);
    }
    return { runId, sessionId, value: value as T };
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
