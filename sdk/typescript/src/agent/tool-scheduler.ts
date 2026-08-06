import type {
  AgentRunEvent,
  AgentTool,
  AgentToolAuthorizationInput,
  AgentToolAuthorizationResult,
  AgentToolCall,
  AgentToolResult,
} from "./types.js";
import { validateToolInput } from "./input-validation.js";

interface SchedulerOptions {
  runId: string;
  sessionId: string;
  maxParallelReads: number;
  maxResultChars: number;
  signal: AbortSignal;
  emit: (event: AgentRunEvent) => void;
  metadata?: Readonly<Record<string, string>>;
  authorizeTool?: (input: AgentToolAuthorizationInput) => Promise<AgentToolAuthorizationResult>;
}

export class ToolScheduler {
  private readonly byName: Map<string, AgentTool>;

  constructor(tools: readonly AgentTool[], private readonly options: SchedulerOptions) {
    this.byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  async execute(calls: readonly AgentToolCall[]): Promise<AgentToolResult[]> {
    const hasWrite = calls.some((call) => this.effectOf(call) === "write");
    if (hasWrite) return this.executeSequential(calls);
    return this.executeReadPool(calls);
  }

  private async executeSequential(calls: readonly AgentToolCall[]): Promise<AgentToolResult[]> {
    const results: AgentToolResult[] = [];
    for (const call of calls) {
      results.push(await this.executeOne(call));
    }
    return results;
  }

  private async executeReadPool(calls: readonly AgentToolCall[]): Promise<AgentToolResult[]> {
    const results = new Array<AgentToolResult>(calls.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < calls.length) {
        const index = cursor++;
        results[index] = await this.executeOne(calls[index]!);
      }
    };
    const count = Math.min(Math.max(1, this.options.maxParallelReads), calls.length);
    await Promise.all(Array.from({ length: count }, worker));
    return results;
  }

  private async executeOne(call: AgentToolCall): Promise<AgentToolResult> {
    if (this.options.signal.aborted) return errorResult("cancelled");
    const tool = this.byName.get(call.name);
    this.options.emit({ type: "tool_start", call });
    if (!tool) {
      const result = errorResult(`unknown tool: ${call.name}`);
      this.options.emit({ type: "tool_end", call, result });
      return result;
    }
    let validationErrors: string[];
    try {
      validationErrors = validateToolInput(tool.definition.inputSchema, call.arguments);
    } catch (error) {
      const result = errorResult(`tool input validation failed: ${errorMessage(error)}`);
      this.options.emit({ type: "tool_end", call, result });
      return result;
    }
    if (validationErrors.length > 0) {
      const result = errorResult(`invalid tool input: ${validationErrors.join("; ")}`);
      this.options.emit({ type: "tool_end", call, result });
      return result;
    }
    if (tool.definition.effect !== "read") {
      const decision = await this.authorizeWrite(tool, call);
      this.options.emit({
        type: "tool_authorization",
        call,
        allowed: decision.allowed,
        reason: decision.reason,
      });
      if (!decision.allowed) {
        const result = errorResult(`write tool authorization denied: ${decision.reason ?? "confirmation required"}`);
        this.options.emit({ type: "tool_end", call, result });
        return result;
      }
    }
    const result = await this.runWithTimeout(tool, call);
    const bounded = {
      ...result,
      content: boundText(result.content, this.options.maxResultChars),
    };
    this.options.emit({ type: "tool_end", call, result: bounded });
    return bounded;
  }

  private async authorizeWrite(
    tool: AgentTool,
    call: AgentToolCall,
  ): Promise<AgentToolAuthorizationResult> {
    if (!this.options.authorizeTool) {
      return { allowed: false, reason: "no write authorization handler is configured" };
    }
    if (this.options.signal.aborted) return { allowed: false, reason: "cancelled" };
    try {
      return await this.options.authorizeTool({
        runId: this.options.runId,
        sessionId: this.options.sessionId,
        call,
        tool: tool.definition,
        metadata: this.options.metadata,
        signal: this.options.signal,
      });
    } catch (error) {
      return { allowed: false, reason: errorMessage(error) };
    }
  }

  private async runWithTimeout(tool: AgentTool, call: AgentToolCall): Promise<AgentToolResult> {
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort(this.options.signal.reason ?? new Error("cancelled"));
    };
    this.options.signal.addEventListener("abort", onAbort, { once: true });
    const timeoutMs = Math.max(1, tool.definition.timeoutMs ?? 90_000);
    const timer = setTimeout(
      () => controller.abort(new Error(`tool timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      return await Promise.race([
        tool.execute(call.arguments, {
          runId: this.options.runId,
          sessionId: this.options.sessionId,
          signal: controller.signal,
        }),
        abortPromise(controller.signal),
      ]);
    } catch (error) {
      return errorResult(errorMessage(error));
    } finally {
      clearTimeout(timer);
      this.options.signal.removeEventListener("abort", onAbort);
    }
  }

  private effectOf(call: AgentToolCall): "read" | "write" {
    return this.byName.get(call.name)?.definition.effect ?? "write";
  }
}

function abortPromise(signal: AbortSignal): Promise<AgentToolResult> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("cancelled");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorResult(content: string): AgentToolResult {
  return { content, isError: true };
}

function boundText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const marker = `\n...[tool result truncated: ${value.length - maxChars} chars omitted]...\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(remaining / 2);
  return value.slice(0, head) + marker + value.slice(value.length - (remaining - head));
}
