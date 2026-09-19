import { companionModelCapabilities, openAIReasoningFamily, type CompanionModelConnection } from "./model-connection.js";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
// Provider capability profiles take precedence; OpenAI Responses families then
// retain their transport-coupled effort list. Unknown/proxied models opt out.
export function supportedReasoningEfforts(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string): ReasoningEffort[] {
  return [...(companionModelCapabilities(connection, model).reasoningEfforts
    ?? openAIReasoningFamily(connection, model)?.efforts
    ?? [])];
}
export function resolveReasoningEffort(connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined, model: string, value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === "auto") return undefined;
  if (typeof value !== "string" || !supportedReasoningEfforts(connection, model).includes(value as ReasoningEffort)) {
    throw new Error("当前模型不支持所选思考强度，请选择自动或重新选择强度。");
  }
  return value as ReasoningEffort;
}

export function resolveReasoningPreference(
  connection: Pick<CompanionModelConnection, "provider" | "protocol"> | undefined,
  model: string,
  values: { request?: ReasoningEffort | "auto"; scene?: ReasoningEffort | "auto"; system?: ReasoningEffort | "auto" },
): ReasoningEffort | undefined {
  return resolveReasoningEffort(connection, model, values.request ?? values.scene ?? values.system ?? "auto");
}
