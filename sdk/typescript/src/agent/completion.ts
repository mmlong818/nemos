import type {
  AgentCompletionEvidence,
  AgentToolCall,
  AgentToolDefinition,
  AgentTurnDisposition,
} from "./types.js";

export const FINISH_TURN_TOOL_NAME = "finish_turn";

export type DeclaredTurnDisposition =
  | { state: "completed"; evidenceRefs: string[] }
  | { state: "waiting_input"; question: string }
  | { state: "blocked"; blocker: string };

export interface CompletionValidation {
  accepted: boolean;
  disposition?: AgentTurnDisposition;
  reason?: string;
}

export class AgentTurnDispositionError extends Error {
  readonly name = "AgentTurnDispositionError";

  constructor(readonly disposition: Exclude<AgentTurnDisposition, { state: "completed" }>) {
    super(disposition.state === "waiting_input"
      ? disposition.question
      : disposition.state === "blocked"
        ? disposition.blocker
        : disposition.reason || "Agent run cancelled");
  }
}

export function finishTurnToolDefinition(): AgentToolDefinition {
  return {
    name: FINISH_TURN_TOOL_NAME,
    description: "Explicitly end this task turn as completed, waiting for user input, or blocked. A completion declaration is accepted only when the runtime can verify a user-visible answer or referenced artifact receipt.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["completed", "waiting_input", "blocked"] },
        evidenceRefs: { type: "array", items: { type: "string" } },
        question: { type: "string" },
        blocker: { type: "string" },
      },
      required: ["state"],
      additionalProperties: false,
    },
    effect: "read",
  };
}

export function parseTurnDisposition(call: AgentToolCall): DeclaredTurnDisposition | null {
  if (call.name !== FINISH_TURN_TOOL_NAME) return null;
  const state = call.arguments.state;
  if (state === "completed") {
    const refs = Array.isArray(call.arguments.evidenceRefs)
      ? call.arguments.evidenceRefs.map((value) => clean(value)).filter(Boolean)
      : [];
    return { state, evidenceRefs: [...new Set(refs)] };
  }
  if (state === "waiting_input") return { state, question: clean(call.arguments.question) };
  if (state === "blocked") return { state, blocker: clean(call.arguments.blocker) };
  return null;
}

export function validateTurnCompletion(input: {
  declaration: DeclaredTurnDisposition;
  assistantText: string;
  trustedEvidence: readonly AgentCompletionEvidence[];
}): CompletionValidation {
  const output = input.assistantText.trim();
  if (input.declaration.state === "waiting_input") {
    if (!input.declaration.question) return { accepted: false, reason: "waiting_input requires a concrete question" };
    return {
      accepted: true,
      disposition: {
        state: "waiting_input",
        question: input.declaration.question,
        ...(output ? { partialOutput: output } : {}),
        ...(input.trustedEvidence.length ? { evidence: input.trustedEvidence.map((item) => structuredClone(item)) } : {}),
      },
    };
  }
  if (input.declaration.state === "blocked") {
    if (!input.declaration.blocker) return { accepted: false, reason: "blocked requires a concrete blocker" };
    return {
      accepted: true,
      disposition: {
        state: "blocked",
        blocker: input.declaration.blocker,
        ...(output ? { partialOutput: output } : {}),
        ...(input.trustedEvidence.length ? { evidence: input.trustedEvidence.map((item) => structuredClone(item)) } : {}),
      },
    };
  }

  const byRef = new Map(input.trustedEvidence.map((item) => [item.ref, item]));
  const referenced = input.declaration.evidenceRefs.flatMap((ref) => {
    const evidence = byRef.get(ref);
    return evidence ? [evidence] : [];
  });
  if (referenced.length !== input.declaration.evidenceRefs.length) {
    return { accepted: false, reason: "completion referenced evidence that the runtime did not observe" };
  }
  const artifacts = referenced.filter((item) => item.kind === "artifact");
  const evidence: AgentCompletionEvidence[] = output
    ? [{ kind: "text", ref: "assistant:final" }, ...artifacts]
    : artifacts;
  if (!evidence.length) {
    return { accepted: false, reason: "completed requires a non-empty user-visible answer or a verified artifact" };
  }
  return { accepted: true, disposition: { state: "completed", evidence } };
}

export function legacyTurnDisposition(output: string): AgentTurnDisposition {
  return output.trim()
    ? { state: "completed", evidence: [{ kind: "text", ref: "assistant:final" }] }
    : { state: "blocked", blocker: "The model ended the turn without a user-visible answer or artifact." };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 4_000) : "";
}
